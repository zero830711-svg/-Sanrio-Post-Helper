"""Import an image-verified Rakuten Cinnamoroll catalog into page 796 via WP REST."""
import argparse
import base64
import html
from html.parser import HTMLParser
import io
import json
import os
import re
import sys
import unicodedata
from urllib import error, parse, request

from PIL import Image

SITE = "https://sanrio-fan.site"
PAGE_ID = 796
START = "<!-- sf-character-product-guides:v1 -->"
END = "<!-- /sf-character-product-guides:v1 -->"
RAKUTEN_IMAGE_HOSTS = {"image.rakuten.co.jp", "shop.r10s.jp", "tshop.r10s.jp"}
MAX_CARDS = 72
MIN_CARDS = 48
CATEGORIES = ["ぬいぐるみ", "バッグ・ポーチ", "文具・シール", "キーホルダー", "タオル", "食器・キッチン", "生活雑貨", "ファッション"]
MIN_IMAGE_EDGE = 300
AMAZON_TAG = "ononbrothers2-22"
GUIDE_TITLE = "シナモロールの商品ガイド"


class WordPress:
    def __init__(self):
        user = os.environ.get("SANRIO_WP_USER", "")
        password = os.environ.get("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("WordPress REST credentials are not configured.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.auth = "Basic " + token

    def call(self, path, data=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST API routes are allowed.")
        headers = {
            "Authorization": self.auth,
            "User-Agent": "SanrioCinnamorollRakutenCatalog/1.0",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(
            SITE + "/wp-json" + path,
            data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None,
            headers=headers,
        )
        try:
            with request.urlopen(req, timeout=60) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s." % exc.code) from None


def canonical_text(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龠]", "", value)


def safe_image_url(value):
    parts = parse.urlsplit(str(value or ""))
    if (
        parts.scheme != "https"
        or (parts.hostname or "").lower() not in RAKUTEN_IMAGE_HOSTS
        or parts.username
        or parts.password
        or parts.port
        or not re.search(r"\.(?:jpe?g|png|webp)$", parts.path, re.I)
    ):
        return ""
    # The backend removes Rakuten's 128px thumbnail query. Never display a known
    # fixed-size thumbnail even if it accidentally passes the host check.
    query = parse.parse_qs(parts.query)
    if any(re.fullmatch(r"(?:128|150|200)x(?:128|150|200)", v) for v in query.get("_ex", [])):
        return ""
    if any(re.fullmatch(r"(?:128|150|200):(?:128|150|200)", v) for v in query.get("fitin", [])):
        return ""
    return parse.urlunsplit(parts)


def safe_affiliate_url(value):
    parts = parse.urlsplit(str(value or ""))
    return (
        value if parts.scheme == "https"
        and (parts.hostname or "").lower() == "hb.afl.rakuten.co.jp"
        and not parts.username and not parts.password and not parts.port
        and re.fullmatch(r"/hgc/[a-zA-Z0-9._-]{8,128}/?", parts.path)
        else ""
    )


def verify_image(url):
    req = request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; SanrioCatalogImageCheck/1.0)",
            "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
        },
    )
    try:
        with request.urlopen(req, timeout=15) as response:
            final = parse.urlsplit(response.geturl())
            if final.scheme != "https" or (final.hostname or "").lower() not in RAKUTEN_IMAGE_HOSTS:
                return None
            raw = response.read(5_000_001)
            if len(raw) > 5_000_000:
                return None
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                return None
            width, height = image.size
            image.verify()
        if min(width, height) < MIN_IMAGE_EDGE:
            return None
        return width, height
    except (error.URLError, OSError, ValueError, Image.DecompressionBombError):
        return None


def extract_existing_cards(section):
    pattern = re.compile(r'<article\b(?=[^>]*\bclass=["\'][^"\']*sf-cinna-rakuten-card)[^>]*>', re.I)
    cards = []
    for match in pattern.finditer(section):
        tag = match.group(0)
        attrs = dict(re.findall(r'\b(data-[a-z-]+)=["\']([^"\']*)["\']', tag, re.I))
        required = ("data-code", "data-title", "data-image", "data-affiliate", "data-shop")
        if all(attrs.get(key) for key in required):
            cards.append({
                "code": html.unescape(attrs["data-code"]),
                "title": html.unescape(attrs["data-title"]),
                "image": html.unescape(attrs["data-image"]),
                "affiliate": html.unescape(attrs["data-affiliate"]),
                "shop": html.unescape(attrs["data-shop"]),
                "category": html.unescape(attrs.get("data-category", "")),
            })
    return cards


def extract_guide_cards(section):
    cards = []
    for article in re.findall(r"<article\b.*?</article>", section, flags=re.S):
        link = re.search(r"""<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>""", article, flags=re.S)
        title = re.search(r"<h3\b[^>]*>(.*?)</h3>", article, flags=re.S) or re.search(r"<strong\b[^>]*>(.*?)</strong>", article, flags=re.S)
        if not link or not title:
            continue
        href = html.unescape(link.group(1))
        if not href.startswith(SITE + "/"):
            continue
        cards.append((text_from(title.group(1)), href))
    return cards


def text_from(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def infer_category(title):
    value = str(title or "")
    if re.search(r"バッグ|ポーチ|リュック|ショルダー", value):
        return "バッグ・ポーチ"
    if re.search(r"文房具|ペン|ノート|シール|ステッカー|筆箱|メモ", value):
        return "文具・シール"
    if re.search(r"キーホルダー|マスコット|チャーム|ストラップ", value):
        return "キーホルダー"
    if re.search(r"タオル|ハンカチ", value):
        return "タオル"
    if re.search(r"水筒|マグ|弁当|ランチ|食器|カップ|ボトル", value):
        return "食器・キッチン"
    if re.search(r"服|アパレル|靴下|財布|帽子|ファッション|スニーカー", value):
        return "ファッション"
    if re.search(r"クッション|時計|収納|雑貨|ミラー|傘", value):
        return "生活雑貨"
    return "ぬいぐるみ"


def clean_candidate(item):
    if not isinstance(item, dict):
        return None
    code = str(item.get("code", "")).strip()
    title = re.sub(r"\s+", " ", str(item.get("title", ""))).strip()
    image = safe_image_url(item.get("image"))
    affiliate = safe_affiliate_url(item.get("affiliate"))
    shop = re.sub(r"\s+", " ", str(item.get("shop", ""))).strip()[:100]
    category = str(item.get("category", "")).strip()
    if category not in CATEGORIES:
        category = infer_category(title)
    if not re.fullmatch(r"[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+", code) or not title or not image or not affiliate:
        return None
    return {"code": code, "title": title[:300], "image": image, "affiliate": affiliate, "shop": shop, "category": category}


def build_candidate_set(raw_items, old_cards):
    buckets = {category: [] for category in CATEGORIES}
    seen_codes = set()
    seen_names = set()
    seen_images = set()
    duplicates = 0

    def add_to_pool(raw, existing=False):
        nonlocal duplicates
        item = clean_candidate(raw)
        if not item:
            return
        name_key = canonical_text(item["title"])
        if item["code"] in seen_codes or item["image"] in seen_images or (name_key and name_key in seen_names):
            duplicates += 1
            return
        item["existing"] = existing
        buckets[item["category"]].append(item)
        seen_codes.add(item["code"])
        seen_images.add(item["image"])
        if name_key:
            seen_names.add(name_key)

    for item in old_cards:
        add_to_pool(item, existing=True)
    for item in raw_items:
        add_to_pool(item)

    selected = []
    checked = 0
    low_or_failed = 0
    offsets = {category: 0 for category in CATEGORIES}
    made_progress = True
    while len(selected) < MAX_CARDS and made_progress:
        made_progress = False
        for category in CATEGORIES:
            while offsets[category] < len(buckets[category]):
                item = buckets[category][offsets[category]]
                offsets[category] += 1
                made_progress = True
                if item["existing"]:
                    selected.append(item)
                    break
                checked += 1
                dimensions = verify_image(item["image"])
                if not dimensions:
                    low_or_failed += 1
                    continue
                item["width"], item["height"] = dimensions
                selected.append(item)
                break
            if len(selected) >= MAX_CARDS:
                break
    return selected, checked, low_or_failed, duplicates


def marketplace_urls(title):
    amazon = "https://www.amazon.co.jp/s?k=" + parse.quote(title, safe="") + "&tag=" + AMAZON_TAG
    return amazon


def photo_card(item):
    title = html.escape(item["title"], quote=True)
    code = html.escape(item["code"], quote=True)
    image = html.escape(item["image"], quote=True)
    affiliate = html.escape(item["affiliate"], quote=True)
    shop = html.escape(item["shop"] or "楽天市場", quote=True)
    amazon = html.escape(marketplace_urls(item["title"]), quote=True)
    category = html.escape(item.get("category", infer_category(item["title"])), quote=True)
    return (
        '<article class="sf-cinna-rakuten-card" data-code="' + code + '" data-title="' + title
        + '" data-image="' + image + '" data-affiliate="' + affiliate + '" data-shop="' + shop
        + '" data-category="' + category
        + '" style="min-width:0;overflow:hidden;border:1px solid #eadde5;border-radius:14px;background:#fff">'
        '<span style="display:grid;place-items:center;aspect-ratio:1/1;padding:5px;background:#fff">'
        '<img src="' + image + '" alt="' + title + '" loading="lazy" decoding="async" '
        'style="display:block;width:100%;height:100%;object-fit:contain"></span>'
        '<div style="display:flex;min-height:124px;flex-direction:column;gap:6px;padding:8px">'
        '<strong style="display:-webkit-box;overflow:hidden;font-size:clamp(11px,2.8vw,14px);line-height:1.45;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:3">'
        + title + '</strong>'
        '<small style="overflow:hidden;color:#756b78;font-size:10px;line-height:1.3;text-overflow:ellipsis;white-space:nowrap">' + shop + '</small>'
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:auto">'
        '<a href="' + affiliate + '" target="_blank" rel="sponsored nofollow noopener" '
        'style="display:flex;align-items:center;justify-content:center;min-height:36px;padding:4px 2px;border-radius:8px;background:#bf0000;color:#fff;font-size:11px;font-weight:700;text-align:center;text-decoration:none">楽天で見る</a>'
        '<a href="' + amazon + '" target="_blank" rel="sponsored nofollow noopener" '
        'style="display:flex;align-items:center;justify-content:center;min-height:36px;padding:4px 2px;border-radius:8px;background:#ffbd35;color:#202124;font-size:11px;font-weight:700;text-align:center;text-decoration:none">Amazonで探す</a>'
        '</div></div></article>'
    )


def section_html(old_section, products, guide_cards):
    heading_match = re.search(r"<h2\b[^>]*>.*?</h2>", old_section, flags=re.S)
    intro_match = re.search(r"<p\b[^>]*>.*?</p>", old_section[heading_match.end():] if heading_match else "", flags=re.S)
    heading = heading_match.group(0) if heading_match else '<h2 id="sf-character-product-guides-title">' + GUIDE_TITLE + '</h2>'
    intro = '<p>楽天市場の画像を確認した商品を、ジャンルごとに写真付き3列で掲載しています。販売状況は購入先でご確認ください。</p>'
    card_grid = (
        '<div class="sf-cinna-photo-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(7px,1.8vw,12px)">'
        + "".join(photo_card(product) for product in products) + '</div>'
    )
    guides = ""
    if guide_cards:
        guide_links = "".join(
            '<a href="' + html.escape(url, quote=True) + '" style="display:block;padding:10px 12px;border:1px solid #eadde5;border-radius:10px;background:#fff;color:#403547;font-size:13px;line-height:1.5;text-decoration:none">'
            + html.escape(title) + ' →</a>'
            for title, url in guide_cards
        )
        guides = '<h3 style="margin:20px 0 8px;font-size:16px">商品ガイド・サイズ情報も読む</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px">' + guide_links + '</div>'
    disclosure = '<p style="margin:12px 0 0;color:#766b78;font-size:11px;line-height:1.5">商品画像は楽天市場APIの画像リンクを表示しています。価格・在庫・販売元・配送条件は購入先でご確認ください。リンクにはアフィリエイト広告を含みます。</p>'
    return (
        START + '<section class="sf-character-product-guides" aria-labelledby="sf-character-product-guides-title">'
        + heading + intro + '<p style="margin:4px 0 10px;color:#766b78;font-size:12px">写真を確認できた商品：' + str(len(products)) + '件</p>'
        + card_grid + guides + disclosure + '</section>' + END
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", required=True, help="Temporary JSON from the private Rakuten API endpoint")
    args = parser.parse_args()
    with open(args.candidates, encoding="utf-8") as handle:
        raw_items = json.load(handle)
    if not isinstance(raw_items, list):
        raise RuntimeError("Rakuten catalog response was not a list.")

    wp = WordPress()
    page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID)
    if page.get("id") != PAGE_ID or page.get("slug") != "character-cinnamoroll":
        raise RuntimeError("The target page is not the verified Cinnamoroll page.")
    content = page.get("content", {}).get("raw")
    if not isinstance(content, str):
        raise RuntimeError("Could not read the editable WordPress page.")
    match = re.search(re.escape(START) + r".*?" + re.escape(END), content, flags=re.S)
    if not match:
        raise RuntimeError("The existing Cinnamoroll guide markers were not found.")

    old_section = match.group(0)
    old_cards = extract_existing_cards(old_section)
    products, checked, rejected, duplicates = build_candidate_set(raw_items, old_cards)
    if len(products) < MIN_CARDS:
        raise RuntimeError(
            "Only %d verified photo products were available (minimum %d). "
            "Page was left unchanged. Images checked: %d; low-resolution or unavailable: %d."
            % (len(products), MIN_CARDS, checked, rejected)
        )
    guide_cards = extract_guide_cards(old_section)
    replacement = section_html(old_section, products, guide_cards)
    updated_content = content[:match.start()] + replacement + content[match.end():]

    wp.call("/wp/v2/pages/%d" % PAGE_ID, {"content": updated_content})
    verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID)
    saved = verify.get("content", {}).get("raw", "")
    saved_section_match = re.search(re.escape(START) + r".*?" + re.escape(END), saved, flags=re.S)
    if verify.get("id") != PAGE_ID or verify.get("slug") != "character-cinnamoroll" or not saved_section_match:
        raise RuntimeError("WordPress did not retain the Cinnamoroll catalog update.")
    saved_section = saved_section_match.group(0)
    card_count = saved_section.count('class="sf-cinna-rakuten-card"')
    image_count = saved_section.count("<img ")
    if card_count != len(products) or image_count != len(products) or "grid-template-columns:repeat(3,minmax(0,1fr))" not in saved_section:
        raise RuntimeError("The saved three-column photo catalog did not pass verification.")

    category_counts = {category: sum(1 for item in products if item["category"] == category) for category in CATEGORIES}
    print(
        "Updated Cinnamoroll page 796 through WordPress REST: "
        "%d photo cards; %d unique Rakuten item codes; "
        "%d candidate images checked; %d low-resolution/unavailable; "
        "%d duplicates skipped; category counts %s. New images require at least %d px on the short edge."
        % (card_count, card_count, checked, rejected, duplicates, category_counts, MIN_IMAGE_EDGE)
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, error.URLError, ValueError, KeyError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
