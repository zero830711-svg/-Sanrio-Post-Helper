"""Publish one-product Sanrio gacha articles from Rakuten API candidates."""
import argparse
import base64
import hashlib
import html
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from urllib import error, parse, request

from PIL import Image, ImageOps

SITE = "https://sanrio-fan.site"
PUBLISHER = Path(__file__).with_name("publish-editorial-article.py")
AMAZON_TAG = "ononbrothers2-22"
RAKUTEN_ATTRIBUTION = """<!-- Rakuten Web Services Attribution Snippet FROM HERE -->
<a href="https://webservice.rakuten.co.jp/" target="_blank"><img src="https://webservice.rakuten.co.jp/img/credit/200709/credit_22121.gif" border="0" alt="Rakuten Web Service Center" title="Rakuten Web Service Center" width="221" height="21"/></a>
<!-- Rakuten Web Services Attribution Snippet TO HERE -->"""
MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
IMAGE_HOSTS = {"image.rakuten.co.jp", "shop.r10s.jp", "tshop.r10s.jp"}
SANRIO_NAMES = (
    "サンリオ", "ハローキティ", "ハロー・キティ", "マイメロディ", "クロミ",
    "シナモロール", "ポムポムプリン", "ポチャッコ", "ハンギョドン",
    "けろけろけろっぴ", "タキシードサム", "あひるのペックル", "バッドばつ丸",
    "こぎみゅん", "はなまるおばけ", "ウサハナ", "ぐでたま", "キキララ",
    "キキ＆ララ", "リトルツインスターズ", "ジュエルペット", "ウィッシュミーメル",
    "ぼんぼんりぼん", "チョコキャット", "マロンクリーム", "がおぱわるぅ",
    "まるもふびより", "おさるのもんきち", "みんなのたあ坊", "JOCHUM", "Jochum", "jochum",
)
CAPSULE_RE = re.compile(r"ガチャ|ガシャポン|カプセルトイ|カプセル玩具|カプセルフィギュア|カプセルマスコット")
EXCLUDED_RE = re.compile(r"ガチャ詰め|ガチャ活|ガチャ本体|ガチャマシン|カプセルマシン|空カプセル|カプセルケース")


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Rakuten image redirects are refused.")


class WordPress:
    def __init__(self):
        user = os.environ.get("SANRIO_WP_USER", "").strip()
        password = "".join(os.environ.get("SANRIO_WP_APP_PASSWORD", "").split())
        if not user or not password:
            raise RuntimeError("WordPress REST credentials are not configured.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.auth = "Basic " + token
        self.opener = request.build_opener(NoRedirect)

    def call(self, path):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        req = request.Request(SITE + "/wp-json" + path, headers={
            "Authorization": self.auth,
            "User-Agent": "SanrioRakutenGachaPublisher/1.0",
        })
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress returned HTTP %s while checking an existing article." % exc.code) from None


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())


def plain_text(value):
    parser = TextExtractor()
    parser.feed(str(value or ""))
    return re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts))).strip()


def canonical_title(value):
    value = unicodedata.normalize("NFKC", plain_text(value)).casefold()
    value = re.sub(r"[\[【(（][^\]】)）]*(?:クーポン|送料無料|ポイント|割引|予約)[^\]】)）]*[\]】)）]", " ", value)
    value = re.sub(r"\b(?:新品|在庫あり|送料無料|予約|即納|楽天市場)\b", " ", value)
    return re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龠]", "", value)


def valid_affiliate(value):
    p = parse.urlsplit(str(value or ""))
    return (p.scheme == "https" and p.hostname == "hb.afl.rakuten.co.jp"
            and re.fullmatch(r"/hgc/[a-zA-Z0-9._-]{8,128}/?", p.path or "")
            and not p.username and not p.password and not p.port and not p.fragment)


def valid_product_url(value):
    p = parse.urlsplit(str(value or ""))
    return (p.scheme == "https" and p.hostname == "item.rakuten.co.jp"
            and p.path.startswith("/") and not p.username and not p.password and not p.port)


def valid_image_url(value):
    p = parse.urlsplit(str(value or ""))
    return (p.scheme == "https" and p.hostname in IMAGE_HOSTS
            and p.path.startswith("/") and not p.username and not p.password and not p.port
            and not p.fragment)


def normalized_product_name(value, strip_characters=False):
    value = unicodedata.normalize("NFKC", plain_text(value)).casefold()
    value = re.sub(r"再販|再生産|予約受付中|新発売|全[0-9]+(?:種|種類)", "", value)
    if strip_characters:
        for name in sorted(SANRIO_NAMES, key=len, reverse=True):
            value = value.replace(unicodedata.normalize("NFKC", name).casefold(), "")
        value = value.replace("sanrio characters", "").replace("sanrio", "")
    return re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龠]", "", value)


def product_name_matches(seed, title):
    # Preserve character names and require the full product-specific seed in the listing title.
    brand_terms = ("サンリオキャラクターズ", "sanriocharacters", "サンリオ", "sanrio")
    left = normalized_product_name(seed)
    right = normalized_product_name(title)
    for term in brand_terms:
        left = left.replace(term, "")
        right = right.replace(term, "")
    if len(left) < 8 or len(right) < 8:
        return False
    return left == right or left in right


def has_capsule_evidence(item):
    evidence = plain_text(item.get("capsule_evidence", ""))
    return bool(CAPSULE_RE.search(evidence)) and not EXCLUDED_RE.search(evidence)


def eligible(item):
    title = plain_text(item.get("title", ""))
    seed = plain_text(item.get("source_product_name", ""))
    capsule_match = has_capsule_evidence(item)
    if seed:
        product_category_match = capsule_match and product_name_matches(seed, title)
    else:
        product_category_match = (capsule_match
                                  and any(name.casefold() in title.casefold() for name in SANRIO_NAMES))
    return (bool(title) and product_category_match
            and valid_affiliate(item.get("affiliate"))
            and valid_product_url(item.get("url"))
            and valid_image_url(item.get("image"))
            and bool(str(item.get("code", "")).strip()))

def unique_candidates(rows):
    result = []
    seen_codes = set()
    seen_titles = set()
    seen_products = set()
    for row in rows:
        if not isinstance(row, dict) or not eligible(row):
            continue
        code = str(row["code"]).strip()
        title_key = canonical_title(row["title"])
        product_key = canonical_title(row.get("source_product_name", ""))
        if (code in seen_codes or not title_key or title_key in seen_titles
                or (product_key and product_key in seen_products)):
            continue
        seen_codes.add(code)
        seen_titles.add(title_key)
        if product_key:
            seen_products.add(product_key)
        result.append(row)
    return result


def download_jpeg(url):
    if not valid_image_url(url):
        raise RuntimeError("A Rakuten image URL failed host validation.")
    opener = request.build_opener(NoRedirect)
    req = request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; SanrioRakutenGachaPublisher/1.0)",
        "Accept": "image/jpeg,image/png,image/webp",
    })
    try:
        with opener.open(req, timeout=45) as response:
            if response.status != 200 or response.geturl() != url:
                raise RuntimeError("The Rakuten product image could not be verified.")
            raw = response.read(MAX_DOWNLOAD_BYTES + 1)
    except (error.URLError, OSError) as exc:
        raise RuntimeError("The Rakuten product image could not be downloaded.") from exc
    if not raw or len(raw) > MAX_DOWNLOAD_BYTES:
        raise RuntimeError("The Rakuten product image is empty or too large.")
    try:
        with Image.open(io.BytesIO(raw)) as original:
            original.load()
            image = ImageOps.exif_transpose(original).convert("RGB")
    except Exception as exc:
        raise RuntimeError("The Rakuten API image is not a readable bitmap.") from exc
    image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    for quality in (86, 80, 74, 68):
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
        data = output.getvalue()
        if len(data) <= MAX_UPLOAD_BYTES:
            return base64.b64encode(data).decode("ascii")
    raise RuntimeError("The optimized Rakuten image exceeds the WordPress upload limit.")


def amazon_url(title):
    return "https://www.amazon.co.jp/s?" + parse.urlencode({"k": plain_text(title), "tag": AMAZON_TAG})


def article_for(item, image_base64):
    title = plain_text(item["title"])
    code = str(item["code"])
    slug = "sanrio-gacha-" + hashlib.sha256(code.encode("utf-8")).hexdigest()[:14]
    shop = plain_text(item.get("shop", "")) or "楽天市場の販売店"
    affiliate = item["affiliate"]
    amazon = amazon_url(title)
    safe_title = html.escape(title, quote=True)
    safe_shop = html.escape(shop, quote=True)
    safe_affiliate = html.escape(affiliate, quote=True)
    safe_amazon = html.escape(amazon, quote=True)
    content = f"""<p>この記事にはアフィリエイトリンクが含まれます。リンクから商品を購入された場合、運営者に報酬が入ることがあります。</p>
<figure class="wp-block-image size-large"><a href="{safe_affiliate}" target="_blank" rel="sponsored nofollow noopener noreferrer"><img src="{{{{image_url}}}}" alt="{safe_title}の商品画像" /></a><figcaption>画像は楽天市場の商品ページ掲載画像です。販売形態や最新情報はリンク先でご確認ください。</figcaption></figure>
<p>サンリオ関連のガチャ・カプセルトイを探している方向けに、楽天市場で見つかった「{safe_title}」を紹介します。商品名と商品画像を見ながら、販売ページでラインナップや購入条件を確認できます。</p>
<h2>楽天市場の商品情報</h2>
<table><tbody>
<tr><th>商品名</th><td>{safe_title}</td></tr>
<tr><th>販売店</th><td>{safe_shop}</td></tr>
<tr><th>商品ページ</th><td><a href="{safe_affiliate}" target="_blank" rel="sponsored nofollow noopener noreferrer">楽天市場で最新情報を確認する</a></td></tr>
</tbody></table>
<h2>購入前に確認したいこと</h2>
<p>カプセルトイは、店頭で1回ずつ回す商品と、通販で単品・セット・全種セットなどとして販売される商品があります。商品名だけでは販売形態が分かりにくい場合もあるため、選べる種類、セット内容、価格、送料、発送時期をリンク先でご確認ください。掲載内容や在庫は販売店によって異なり、更新されることがあります。</p>
<p>Amazonでも商品名で検索できます。販売状況や価格は各販売ページでご確認ください。</p>
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0">
<a href="{safe_affiliate}" target="_blank" rel="sponsored nofollow noopener noreferrer" style="display:flex;align-items:center;justify-content:center;min-height:50px;padding:10px 8px;border-radius:10px;background:#bf0000;color:#fff;font-weight:700;text-align:center;text-decoration:none">楽天市場で商品を見る</a>
<a href="{safe_amazon}" target="_blank" rel="sponsored nofollow noopener noreferrer" style="display:flex;align-items:center;justify-content:center;min-height:50px;padding:10px 8px;border-radius:10px;background:#ffbd35;color:#202124;font-weight:700;text-align:center;text-decoration:none">Amazonで商品名を検索</a>
</div>
<p><a href="https://sanrio-fan.site/category/gacha/">ほかのサンリオのガチャ・カプセルトイ記事を見る</a></p>
<p><small>商品名・画像は楽天市場の商品掲載情報をもとにしています。価格、送料、在庫、販売形態は変更される場合があります。購入前に販売ページの最新情報をご確認ください。</small></p>
{RAKUTEN_ATTRIBUTION}"""
    return {
        "title": title,
        "slug": slug,
        "excerpt": "楽天市場で見つけたサンリオ関連のガチャ・カプセルトイ。商品画像と販売ページ、購入前に確認したいポイントをまとめました。",
        "status": "publish",
        "category_slug": "gacha",
        "image_filename": slug + ".jpg",
        "alt_text": title + "の商品画像",
        "image_base64": image_base64,
        "content": content,
    }


def self_test():
    valid = {
        "code": "shop:sku",
        "title": "サンリオキャラクターズ ガチャ カプセルトイ",
        "capsule_evidence": "カプセルトイの販売情報",
        "image": "https://image.rakuten.co.jp/shop/cabinet/item.jpg",
        "affiliate": "https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc=x",
        "url": "https://item.rakuten.co.jp/shop/item/",
        "shop": "テスト店",
    }
    assert eligible(valid)
    assert len(unique_candidates([valid, dict(valid), {**valid, "title": "サンリオのポーチ"}])) == 1
    assert not eligible({**valid, "image": "https://example.com/item.jpg"})
    assert not eligible({**valid, "title": "ガチャガチャ本体"})
    seeded = {
        **valid,
        "title": "サンリオキャラクターズ チアリステイルズ マスコット 全4種",
        "capsule_evidence": "カプセルトイの販売商品",
        "source_product_name": "チアリステイルズ マスコット",
    }
    assert eligible(seeded)
    assert not eligible({
        **seeded,
        "title": "サンリオキャラクターズ 無関係なぬいぐるみ",
    })
    text = article_for(valid, "ZmFrZQ==")["content"]
    assert text.count("{{image_url}}") == 1
    assert 'rel="sponsored nofollow noopener noreferrer"' in text
    assert "ononbrothers2-22" in text
    assert RAKUTEN_ATTRIBUTION in text
    print("Rakuten gacha article self-test passed.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--product-name", default="")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.candidates or not 1 <= args.limit <= 50:
        raise RuntimeError("A candidate file and a limit from 1 to 50 are required.")
    payload = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    rows = payload.get("candidates")
    if not isinstance(rows, list):
        raise RuntimeError("The Rakuten candidate list is invalid.")
    candidates = unique_candidates(rows)
    requested_product = plain_text(args.product_name)
    if not args.dry_run and not requested_product:
        raise RuntimeError("Publishing requires an exact source product name.")
    if requested_product:
        requested_key = canonical_title(requested_product)
        if not requested_key:
            raise RuntimeError("The requested source product name is invalid.")
        candidates = [
            item for item in candidates
            if canonical_title(item.get("source_product_name", "")) == requested_key
        ]
    if args.dry_run:
        print("DRY RUN: %d capsule-and-product-name-verified candidates (limit %d)." % (len(candidates), args.limit))
        for item in candidates[:args.limit]:
            source_name = plain_text(item.get("source_product_name", ""))
            title = plain_text(item.get("title", ""))
            evidence = plain_text(item.get("capsule_evidence", ""))
            print("CANDIDATE: %s => %s [evidence: %s]" % (source_name, title, evidence))
        if not candidates:
            print("No verified candidates; nothing was published.")
        return
    if not candidates:
        raise RuntimeError("No Sanrio capsule-toy candidates passed the strict product-name filter.")
    wp = WordPress()
    slug_prefix = "/wp/v2/posts?"
    published = 0
    attempted = 0
    failures = []
    with tempfile.TemporaryDirectory(prefix="sanrio-rakuten-gacha-") as temp_name:
        temp = Path(temp_name)
        for item in candidates:
            if published >= args.limit:
                break
            spec = article_for(item, "")
            existing = wp.call(slug_prefix + parse.urlencode({
                "slug": spec["slug"], "context": "edit", "_fields": "id,slug,status"
            }))
            if existing:
                continue
            try:
                spec["image_base64"] = download_jpeg(item["image"])
                article_path = temp / (spec["slug"] + ".json")
                article_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, str(PUBLISHER), str(article_path)],
                    check=False, capture_output=True, text=True,
                    env=os.environ.copy(),
                )
                if result.returncode != 0:
                    raise RuntimeError("The WordPress article publisher rejected an item.")
                published += 1
                attempted += 1
                print((result.stdout or "").strip() or "Published one gacha article.")
            except Exception as exc:
                attempted += 1
                failures.append(str(item.get("title", ""))[:120])
                print("Skipped one candidate because its image or article could not be published.")
    print("Published %d individual Rakuten gacha articles from %d filtered candidates." % (published, len(candidates)))
    print("Attempted %d candidate records; %d were skipped or already published." % (attempted, max(0, attempted - published)))
    if failures:
        print("%d candidates failed during publication." % len(failures))
    if published == 0:
        raise RuntimeError("No new gacha articles were published.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Rakuten gacha article batch failed.", file=sys.stderr)
        sys.exit(1)
