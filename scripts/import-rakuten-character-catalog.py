"""Import image-verified Rakuten product catalogs into character pages via WP REST."""
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
CHARACTERS = {
    "cinnamoroll": (796, "character-cinnamoroll", "シナモロール"),
    "kuromi": (797, "character-kuromi", "クロミ"),
    "mymelody": (798, "character-mymelody", "マイメロディ"),
    "pompompurin": (799, "character-pompompurin", "ポムポムプリン"),
    "pochacco": (800, "character-pochacco", "ポチャッコ"),
    "hellokitty": (801, "character-hellokitty", "ハローキティ"),
    "hangyodon": (802, "character-hangyodon", "ハンギョドン"),
    "little-twin-stars": (803, "character-little-twin-stars", "リトルツインスターズ"),
    "kirimi-chan": (1080, "character-kirimi-chan", "KIRIMIちゃん."),
    "osaru-no-monkichi": (1082, "character-osaru-no-monkichi", "おさるのもんきち"),
    "gaopoweru": (1084, "character-gaopoweru", "がおぱわるぅ"),
    "corocorokuririn": (1086, "character-corocorokuririn", "コロコロクリリン"),
    "goropikadon": (1088, "character-goropikadon", "ゴロピカドン"),
    "jewelpet": (1090, "character-jewelpet", "ジュエルペット"),
    "sugar-bunnies": (1092, "character-sugar-bunnies", "シュガーバニーズ"),
    "charmmy-kitty": (1094, "character-charmmy-kitty", "チャーミーキティ"),
    "chococat": (1096, "character-chococat", "チョコキャット"),
    "dear-daniel": (1098, "character-dear-daniel", "ディアダニエル"),
    "hanamaru-obake": (1100, "character-hanamaru-obake", "はなまるおばけ"),
    "bonbonribbon": (1102, "character-bonbonribbon", "ぼんぼんりぼん"),
    "marshmallow-fuwafuwa-nyanko": (1104, "character-marshmallow-fuwafuwa-nyanko", "マシュマロみたいなふわふわにゃんこ"),
    "marumofubiyori": (1106, "character-marumofubiyori", "まるもふびより"),
    "marroncream": (1108, "character-marroncream", "マロンクリーム"),
    "minna-no-taabou": (1110, "character-minna-no-taabou", "みんなのたあ坊"),
    "little-forest-fellow": (1112, "character-little-forest-fellow", "リトルフォレストフェロォ"),
    "ruroromannic": (1114, "character-ruroromannic", "ルロロマニック"),
}
START = "<!-- sf-character-product-guides:v1 -->"
END = "<!-- /sf-character-product-guides:v1 -->"
RAKUTEN_IMAGE_HOSTS = {"image.rakuten.co.jp", "shop.r10s.jp", "tshop.r10s.jp"}
MAX_CARDS = 72
MIN_CARDS = 12
CATEGORIES = ["ぬいぐるみ", "バッグ・ポーチ", "文具・シール", "キーホルダー", "タオル", "食器・キッチン", "生活雑貨", "ファッション"]
MIN_IMAGE_EDGE = 300
AMAZON_TAG = "ononbrothers2-22"


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



ALIASES = {
    "kuromi": ["クロミ", "Kuromi"],
    "pompompurin": ["ポムポムプリン", "Pompompurin"],
    "pochacco": ["ポチャッコ", "Pochacco"],
    "hangyodon": ["ハンギョドン", "Hangyodon"],
    "cinnamoroll": ["シナモロール", "シナモンロール", "Cinnamoroll"],
    "mymelody": ["マイメロディ", "マイメロ", "My Melody"],
    "hellokitty": ["ハローキティ", "Hello Kitty"],
    "little-twin-stars": ["リトルツインスターズ", "キキララ", "キキ＆ララ", "Little Twin Stars"],
    "kirimi-chan": ["KIRIMIちゃん", "キリミちゃん", "きりみちゃん"],
    "gaopoweru": ["がおぱわるぅ", "がおぱわるう", "Gaopoweru"],
    "chococat": ["チョコキャット", "Chococat"],
    "sugar-bunnies": ["シュガーバニーズ", "Sugarbunnies"],
    "jewelpet": ["ジュエルペット", "Jewelpet"],
    "dear-daniel": ["ディアダニエル", "Dear Daniel"],
    "marshmallow-fuwafuwa-nyanko": ["マシュマロみたいなふわふわにゃんこ", "ふわふわにゃんこ"],
    "marroncream": ["マロンクリーム", "Marron Cream"],
}


def matches_character(title, character):
    if character not in CHARACTERS:
        return False
    names = ALIASES.get(character, [CHARACTERS[character][2]])
    value = canonical_text(title)
    return any(canonical_text(name) in value for name in names)


def display_title(title):
    # Remove shop promotions, keeping product specifications and character names.
    title = re.sub(r"[【\[][^】\]]*(?:クーポン|OFF|ポイント|送料無料|メール便|レビュー投稿)[^】\]]*[】\]]", "", title, flags=re.I)
    title = re.sub(r"^[◆◇]+.*?対応商品[◆◇]+", "", title)
    title = re.sub(r"^(?:数量限定\s*在庫セール\s*売れ筋|数量限定|在庫セール)\s*", "", title)
    title = re.sub(r"(?<!\S)(?:グッズ|定番|好評|楽天|通販|かわいい|可愛い|カワイイ|キャラクター|推しグッズ)(?!\S)", "", title)
    title = re.sub(r"\s+", " ", title).strip() or "商品情報"
    return title


def identity_keys(item, character=None):
    title = unicodedata.normalize("NFKC", item["title"])
    keys = {"code:" + item["code"], "image:" + parse.urlsplit(item["image"]).path}
    keys.add("name:" + canonical_text(display_title(title)))
    # JAN and manufacturer model numbers group offers across different shops.
    for number in re.findall(r"(?<!\d)(?:\d{13}|\d{8})(?!\d)", title):
        # Rightmost body digit has weight 3 for both EAN-13 and EAN-8.
        checksum = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(number[:-1][::-1]))
        if (10 - checksum % 10) % 10 == int(number[-1]):
            keys.add("jan:" + number)
    for number in re.findall(r"(?<![0-9a-z])\d{6}(?![0-9a-z])", title, re.I):
        keys.add("model:" + number)
    for model in re.findall(r"(?:型番|品番|商品番号)[:：\s]*([A-Za-z0-9][A-Za-z0-9_-]{3,})", title):
        keys.add("model:" + model.casefold())
    if character:
        names = ALIASES.get(character, [CHARACTERS[character][2]])
        # A shop may omit JAN but retain the manufacturer series/design number.
        for series in ["まじかる百貨店ステッカー"]:
            if series not in title:
                continue
            for name in names:
                variant = re.search(re.escape(name.rstrip(".")) + r"[.．]?\s*[（(]?\s*0*(\d{1,2})(?!\d)", title, re.I)
                if variant:
                    keys.add("series:" + series + ":" + character + ":" + str(int(variant.group(1))))
    return keys


def item_labels(title):
    labels = []
    if re.search(r"中古|未使用品|リユース", title):
        labels.append("中古・未使用品")
    known_names = [ALIASES.get(key, [value[2]]) for key, value in CHARACTERS.items()]
    matches = sum(any(canonical_text(name) in canonical_text(title) for name in names) for names in known_names)
    if matches > 1 or re.search(r"全\d+種|選べる|選択|各種|アソート", title):
        labels.append("種類を選択する商品")
    return labels


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
    pattern = re.compile(r'<article\b(?=[^>]*\bclass=["\'][^"\']*sf-(?:cinna-rakuten|rakuten-product)-card)[^>]*>', re.I)
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
    value = re.sub(r"バッグチャーム", "キーホルダー", value)
    if re.search(r"バッグ|ポーチ|リュック|ショルダー", value):
        return "バッグ・ポーチ"
    if re.search(r"文房具|ボールペン|シャープペン|ノート|シール|ステッカー|筆箱|メモ帳", value):
        return "文具・シール"
    if re.search(r"キーホルダー|マスコット|チャーム|ストラップ", value):
        return "キーホルダー"
    if re.search(r"タオル|ハンカチ", value):
        return "タオル"
    if re.search(r"水筒|マグ|弁当|ランチ|食器|カップ|ボトル", value):
        return "食器・キッチン"
    if re.search(r"服|アパレル|靴下|財布|ウォレット|帽子|ファッション|スニーカー|Tシャツ|パジャマ", value):
        return "ファッション"
    if re.search(r"クッション|時計|収納|雑貨|ミラー|傘", value):
        return "生活雑貨"
    if re.search(r"ぬいぐるみ|人形|ドール", value):
        return "ぬいぐるみ"
    return "生活雑貨"


def clean_candidate(item):
    if not isinstance(item, dict):
        return None
    code = str(item.get("code", "")).strip()
    title = re.sub(r"\s+", " ", str(item.get("title", ""))).strip()
    image = safe_image_url(item.get("image"))
    affiliate = safe_affiliate_url(item.get("affiliate"))
    shop = re.sub(r"\s+", " ", str(item.get("shop", ""))).strip()[:100]
    category = infer_category(title)
    if not re.fullmatch(r"[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+", code) or not title or not image or not affiliate:
        return None
    return {"code": code, "title": title[:300], "image": image, "affiliate": affiliate, "shop": shop, "category": category}


def build_candidate_set(raw_items, old_cards, character=None):
    buckets = {category: [] for category in CATEGORIES}
    seen_codes = set()
    seen_names = set()
    seen_images = set()
    duplicates = 0
    seen_identity = set()

    def add_to_pool(raw, existing=False):
        nonlocal duplicates
        item = clean_candidate(raw)
        if not item or (character and not matches_character(item["title"], character)):
            return
        identities = identity_keys(item, character)
        if identities & seen_identity:
            duplicates += 1
            return
        seen_identity.update(identities)
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

    # Prefer the fresh Rakuten response, then retain previous cards to fill any sparse categories.
    for item in raw_items:
        add_to_pool(item)
    for item in old_cards:
        add_to_pool(item, existing=True)

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
    short_title = html.escape(display_title(item["title"])[:64] + ("…" if len(display_title(item["title"])) > 64 else ""), quote=True)
    labels = "".join('<small class="sf-product-label">' + html.escape(label) + '</small>' for label in item_labels(item["title"]))
    code = html.escape(item["code"], quote=True)
    image = html.escape(item["image"], quote=True)
    affiliate = html.escape(item["affiliate"], quote=True)
    shop = html.escape(item["shop"] or "楽天市場", quote=True)
    amazon = html.escape(marketplace_urls(item["title"]), quote=True)
    category = html.escape(item.get("category", infer_category(item["title"])), quote=True)
    return (
        '<article class="sf-rakuten-product-card" data-code="' + code + '" data-title="' + title
        + '" data-image="' + image + '" data-affiliate="' + affiliate + '" data-shop="' + shop
        + '" data-category="' + category
        + '" style="min-width:0;overflow:hidden;border:1px solid #eadde5;border-radius:14px;background:#fff">'
        '<span style="display:grid;place-items:center;aspect-ratio:1/1;padding:5px;background:#fff">'
        '<img src="' + image + '" alt="' + title + '" loading="lazy" decoding="async" '
        'style="display:block;width:100%;height:100%;object-fit:contain"></span>'
        '<div style="display:flex;min-height:124px;flex-direction:column;gap:6px;padding:8px">'
        '<strong style="display:-webkit-box;overflow:hidden;font-size:clamp(11px,2.8vw,14px);line-height:1.45;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:3">'
        + short_title + '</strong>' + labels
        + '<small style="overflow:hidden;color:#756b78;font-size:10px;line-height:1.3;text-overflow:ellipsis;white-space:nowrap">' + shop + '</small>'
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:auto">'
        '<a href="' + affiliate + '" target="_blank" rel="sponsored nofollow noopener" '
        'style="display:flex;align-items:center;justify-content:center;min-height:44px;padding:4px 2px;border-radius:8px;background:#bf0000;color:#fff;font-size:11px;font-weight:700;text-align:center;text-decoration:none">楽天で見る</a>'
        '<a href="' + amazon + '" target="_blank" rel="sponsored nofollow noopener" '
        'style="display:flex;align-items:center;justify-content:center;min-height:44px;padding:4px 2px;border-radius:8px;background:#ffbd35;color:#202124;font-size:11px;font-weight:700;text-align:center;text-decoration:none">Amazonで探す</a>'
        '</div></div></article>'
    )


def section_html(old_section, products, guide_cards, character_name):
    heading_match = re.search(r"<h2\b[^>]*>.*?</h2>", old_section, flags=re.S)
    intro_match = re.search(r"<p\b[^>]*>.*?</p>", old_section[heading_match.end():] if heading_match else "", flags=re.S)
    heading = heading_match.group(0) if heading_match else '<h2 id="sf-character-product-guides-title">' + html.escape(character_name) + 'の商品ガイド</h2>'
    intro = '<p>気になる商品を写真から探せます。購入先で種類・価格・在庫をご確認ください。</p>'
    card_grid = (
        '<div class="sf-character-photo-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(7px,1.8vw,12px)">'
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
        + category_controls(products) + card_grid + guides + disclosure + catalog_filter_script() + '</section>' + END
    )



def category_controls(products):
    counts = {c: sum(p["category"] == c for p in products) for c in CATEGORIES}
    options = '<option value="">すべて（%d件）</option>' % len(products)
    options += "".join('<option value="' + html.escape(c, quote=True) + '">' + c + '（' + str(n) + '件）</option>' for c, n in counts.items() if n)
    return '<label class="sf-catalog-filter">ジャンルで絞り込む <select data-sf-catalog-category aria-label="商品ジャンル">' + options + '</select></label><p data-sf-catalog-count aria-live="polite">' + str(len(products)) + '件を表示</p>'


def catalog_filter_script():
    return '''<style>.sf-character-photo-grid [hidden]{display:none!important}.sf-catalog-filter{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:14px}.sf-catalog-filter select{font-size:16px;min-height:44px;max-width:100%;padding:6px 10px}.sf-product-label{color:#65546a;background:#f7f0f5;border-radius:5px;padding:2px 4px;font-size:11px}[data-sf-catalog-count]{font-size:12px;color:#65546a;margin:6px 0 12px}</style><script>(function(){function init(){document.querySelectorAll('.sf-character-product-guides').forEach(function(root){if(root.dataset.filterReady)return;var select=root.querySelector('[data-sf-catalog-category]');if(!select)return;root.dataset.filterReady='1';var cards=Array.from(root.querySelectorAll('.sf-rakuten-product-card'));select.addEventListener('change',function(){var shown=0;cards.forEach(function(card){card.hidden=!!select.value&&card.dataset.category!==select.value;if(!card.hidden)shown++;});root.querySelector('[data-sf-catalog-count]').textContent=shown+'件を表示';});});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();</script>'''


def compact_page(content, character_name):
    # Theme controls are scoped to catalog pages. Keep directory order and guide links intact.
    style = '''<style id="sf-catalog-compact">.entry-content .toc,.entry-header .sns-share,.entry-header .sns-share-buttons,.article-header .sns-share,.article-header .sns-share-buttons{display:none!important}.entry-header{margin-bottom:10px!important}.entry-title{font-size:clamp(20px,5vw,28px)!important;line-height:1.4!important;margin-bottom:8px!important}.entry-content>p{margin:8px 0}.sf-character-product-guides h2{margin:12px 0 8px!important}.sf-character-search-guide{margin:0!important}.sf-character-search-guide>div,.sf-character-search-guide>aside{padding:12px!important}.sf-character-search-guide h2{font-size:20px!important;margin:8px 0!important}.sf-character-search-guide p{font-size:13px!important;line-height:1.6!important;margin:6px 0!important}.sf-character-search-guide .toc{display:none!important}.sf-character-product-guides{scroll-margin-top:12px}</style>'''
    content = re.sub(r'<style id="sf-catalog-compact">.*?</style>', '', content, flags=re.S)
    # Added 18 pages used a long search-only intro; retain its outbound links in a compact row.
    if '<!-- sf-character-search-page:v1 -->' in content:
        pattern = r'<section\b[^>]*class="sf-character-search-guide"[^>]*>.*?</section>'
        match = re.search(pattern, content, flags=re.S)
        if match:
            links = re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', match.group(0), flags=re.S)
            markets = [(html.unescape(url), text_from(label)) for url, label in links if 'amazon.co.jp/' in url or 'hb.afl.rakuten.co.jp/' in url]
            compact = '<section class="sf-character-search-guide"><p><a href="' + SITE + '/characters/">キャラクター一覧に戻る</a></p><p>' + html.escape(character_name) + 'の商品一覧。リンクにはアフィリエイト広告を含みます。</p><p>'
            compact += ' ／ '.join('<a href="' + html.escape(url, quote=True) + '" target="_blank" rel="sponsored nofollow noopener">' + ('Amazonで探す' if 'amazon.co.jp/' in url else '楽天で探す') + '</a>' for url, _ in markets)
            compact += '</p></section>'
            content = content[:match.start()] + compact + content[match.end():]
    return style + content


class CatalogTooSmall(RuntimeError):
    pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", required=True, help="Temporary JSON from the private Rakuten API endpoint")
    parser.add_argument("--character", required=True, choices=CHARACTERS)
    args = parser.parse_args()
    page_id, expected_slug, character_name = CHARACTERS[args.character]
    with open(args.candidates, encoding="utf-8") as handle:
        raw_items = json.load(handle)
    if not isinstance(raw_items, list):
        raise RuntimeError("Rakuten catalog response was not a list.")

    wp = WordPress()
    page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % page_id)
    if page.get("id") != page_id or page.get("slug") != expected_slug:
        raise RuntimeError("The WordPress page identity did not match the selected character.")
    content = page.get("content", {}).get("raw")
    if not isinstance(content, str):
        raise RuntimeError("Could not read the editable WordPress page.")
    match = re.search(re.escape(START) + r".*?" + re.escape(END), content, flags=re.S)
    search_guide = None
    if match:
        old_section = match.group(0)
    else:
        # Preserve the existing search guide and place the managed catalog after it.
        if "<!-- sf-character-search-page:v1 -->" not in content:
            raise RuntimeError("A supported character-page template was not found.")
        search_guide = re.search(
            r'<section\b[^>]*\bclass="sf-character-search-guide"[^>]*>.*?</section>',
            content,
            flags=re.S,
        )
        if not search_guide:
            raise RuntimeError("The character search-guide section was not found.")
        old_section = ""

    old_cards = extract_existing_cards(old_section)
    products, checked, rejected, duplicates = build_candidate_set(raw_items, old_cards, args.character)
    if len(products) < MIN_CARDS and not old_cards:
        raise CatalogTooSmall(
            "Only %d verified photo products were available (minimum %d). "
            "Page was left unchanged. Images checked: %d; low-resolution or unavailable: %d."
            % (len(products), MIN_CARDS, checked, rejected)
        )
    guide_cards = extract_guide_cards(old_section)
    replacement = section_html(old_section, products, guide_cards, character_name)
    if match:
        updated_content = content[:match.start()] + replacement + content[match.end():]
    else:
        updated_content = content[:search_guide.end()] + "\n" + replacement + content[search_guide.end():]

    updated_content = compact_page(updated_content, character_name)
    wp.call("/wp/v2/pages/%d" % page_id, {"content": updated_content})
    verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % page_id)
    saved = verify.get("content", {}).get("raw", "")
    saved_section_match = re.search(re.escape(START) + r".*?" + re.escape(END), saved, flags=re.S)
    if verify.get("id") != page_id or verify.get("slug") != expected_slug or not saved_section_match:
        raise RuntimeError("WordPress did not retain the character catalog update.")
    saved_section = saved_section_match.group(0)
    card_count = saved_section.count('class="sf-rakuten-product-card"')
    image_count = saved_section.count("<img ")
    if card_count != len(products) or image_count != len(products) or "grid-template-columns:repeat(3,minmax(0,1fr))" not in saved_section:
        raise RuntimeError("The saved three-column photo catalog did not pass verification.")

    category_counts = {category: sum(1 for item in products if item["category"] == category) for category in CATEGORIES}
    print(
        "Updated %s page %d through WordPress REST: "
        "%d photo cards; %d unique Rakuten item codes; "
        "%d candidate images checked; %d low-resolution/unavailable; "
        "%d duplicates skipped; category counts %s. New images require at least %d px on the short edge."
        % (character_name, page_id, card_count, card_count, checked, rejected, duplicates, category_counts, MIN_IMAGE_EDGE)
    )


if __name__ == "__main__":
    try:
        main()
    except CatalogTooSmall as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    except (RuntimeError, error.URLError, ValueError, KeyError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

