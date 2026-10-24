"""Publish the first 100 English translations of verified Sanrio product details."""
import argparse
import base64
import hashlib
import html
import importlib.util
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib import robotparser

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("detail_catalog", ROOT / "product-detail-pilot.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
c = d.c

SITE = c.SITE
STATE = "sf-product-detail-english-state"
STATE_MARK = "<!-- sf-product-detail-english-state:v1 -->"
PAGE_MARK = "<!-- sf-product-detail-english:v1 -->"
LANDING_MARK = "<!-- sf-product-detail-english-landing:v1 -->"
HUB_MARK = "<!-- sf-product-detail-english-hub:v1 -->"
JA_LINK_START = "<!-- sf-product-detail-english-link:v1 -->"
JA_LINK_END = "<!-- /sf-product-detail-english-link:v1 -->"
TARGET = 100
BATCH_SIZE = 50
TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"
_rate_lock = threading.Lock()
_last_request = 0.0

CHARACTER_EN = {
    "tuxedo-sam": "Tuxedosam", "ahiru-no-pekkle": "Pekkle", "bad-badtz-maru": "Badtz-Maru",
    "cogimyun": "Cogimyun", "usahana": "U*SA*HA*NA", "kerokerokeroppi": "Keroppi",
    "gudetama": "Gudetama", "wish-me-mell": "Wish me mell", "my-sweet-piano": "My Sweet Piano",
    "jochum": "JOCHUM", "cinnamoroll": "Cinnamoroll", "kuromi": "Kuromi", "mymelody": "My Melody",
    "pompompurin": "Pompompurin", "pochacco": "Pochacco", "hellokitty": "Hello Kitty",
    "hangyodon": "Hangyodon", "little-twin-stars": "Little Twin Stars", "kirimi-chan": "KIRIMI-chan.",
    "osaru-no-monkichi": "Monkichi", "gaopoweru": "Gaopowerroo", "corocorokuririn": "Corocorokuririn",
    "goropikadon": "Goropikadon", "jewelpet": "Jewelpet", "sugar-bunnies": "Sugarbunnies",
    "charmmy-kitty": "Charmmy Kitty", "chococat": "Chococat", "dear-daniel": "Dear Daniel",
    "hanamaru-obake": "Hanamaru Obake", "bonbonribbon": "Bonbonribbon",
    "marshmallow-fuwafuwa-nyanko": "Marshmallow Fuwafuwa Nyanko", "marumofubiyori": "Marumofubiyori",
    "marroncream": "Marroncream", "minna-no-taabou": "Minna no Tabo",
    "little-forest-fellow": "Little Forest Fellow", "ruroromannic": "Lloromannic",
}

CHARACTER_JA_EN = {
    "サンリオ": "Sanrio", "タキシードサム": "Tuxedosam", "あひるのペックル": "Pekkle",
    "バッドばつ丸": "Badtz-Maru", "こぎみゅん": "Cogimyun", "ウサハナ": "U*SA*HA*NA",
    "けろけろけろっぴ": "Keroppi", "ぐでたま": "Gudetama", "ウィッシュミーメル": "Wish me mell",
    "マイスウィートピアノ": "My Sweet Piano", "シナモロール": "Cinnamoroll", "シナモン": "Cinnamoroll",
    "クロミ": "Kuromi", "マイメロディ": "My Melody", "ポムポムプリン": "Pompompurin",
    "ポチャッコ": "Pochacco", "ハローキティ": "Hello Kitty", "ハンギョドン": "Hangyodon",
    "リトルツインスターズ": "Little Twin Stars", "キキ&ララ": "Kiki & Lala", "キキララ": "Kiki & Lala",
    "KIRIMIちゃん.": "KIRIMI-chan.", "KIRIMIちゃん": "KIRIMI-chan", "おさるのもんきち": "Monkichi",
    "がおぱわるぅ": "Gaopowerroo", "コロコロクリリン": "Corocorokuririn", "ゴロピカドン": "Goropikadon",
    "ジュエルペット": "Jewelpet", "シュガーバニーズ": "Sugarbunnies", "チャーミーキティ": "Charmmy Kitty",
    "チョコキャット": "Chococat", "ディアダニエル": "Dear Daniel", "はなまるおばけ": "Hanamaru Obake",
    "ぼんぼんりぼん": "Bonbonribbon", "マシュマロみたいなふわふわにゃんこ": "Marshmallow Fuwafuwa Nyanko",
    "まるもふびより": "Marumofubiyori", "マロンクリーム": "Marroncream", "みんなのたあ坊": "Minna no Tabo",
    "リトルフォレストフェロォ": "Little Forest Fellow", "ルロロマニック": "Lloromannic",
    "たまごっち": "Tamagotchi",
}
_protected_names = re.compile("|".join(re.escape(x) for x in sorted(CHARACTER_JA_EN, key=len, reverse=True)))
_japanese = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")

FACT_LABELS = {
    "商品名": "Product name", "キャラクター": "Character", "サイズ": "Size",
    "素材・材質": "Material", "容量": "Capacity", "重さ": "Weight",
    "セット内容": "What's included", "内容量": "Quantity", "対象年齢": "Recommended age",
    "品番・型番": "Model number", "JANコード": "JAN code", "生産国": "Country of origin",
}


class CanonicalParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link":
            return
        values = {key.lower(): value for key, value in attrs if key}
        if "canonical" in (values.get("rel") or "").lower().split() and values.get("href"):
            self.urls.append(values["href"])


def translate_request(text):
    global _last_request
    protected = {}

    def replace_name(match):
        token = "ZZQCHAR%03dQXZ" % len(protected)
        protected[token] = CHARACTER_JA_EN[match.group(0)]
        return token

    source = _protected_names.sub(replace_name, str(text))
    query = urllib.parse.urlencode({"client": "gtx", "sl": "ja", "tl": "en", "dt": "t", "q": source})
    request = urllib.request.Request(
        TRANSLATE_ENDPOINT + "?" + query,
        headers={"User-Agent": "SanrioProductDetailEnglish/1.0"},
    )
    last_error = None
    for attempt in range(4):
        try:
            with _rate_lock:
                delay = 0.22 - (time.monotonic() - _last_request)
                if delay > 0:
                    time.sleep(delay)
                _last_request = time.monotonic()
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            translated = "".join(part[0] for part in data[0] if part and isinstance(part[0], str)).strip()
            for token, english in protected.items():
                if token not in translated:
                    raise RuntimeError("Translation service changed a protected character name token.")
                translated = translated.replace(token, english)
            if not translated:
                raise RuntimeError("Translation service returned an empty translation.")
            return translated
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError("Japanese-to-English translation failed: " + str(last_error))


def translate_unique(texts):
    unique = sorted({str(x).strip() for x in texts if str(x).strip()})
    result = {}

    def translate_one(value):
        return value, translate_request(value) if _japanese.search(value) else value

    with ThreadPoolExecutor(max_workers=3) as pool:
        for original, translated in pool.map(translate_one, unique):
            result[original] = translated
    return result


def select_records(records):
    eligible = []
    for item in records:
        facts = item.get("facts") or {}
        if not item.get("images") or len(facts) < 2:
            continue
        if not any(key in facts for key in ("サイズ", "素材・材質")):
            continue
        if d.duplicate_with(item, eligible):
            continue
        eligible.append(item)
    selected = d.choose(eligible, limit=TARGET)
    if len(selected) != TARGET:
        raise RuntimeError("Only %d distinct, photo-backed products with specifications qualified; 100 are required." % len(selected))
    if len({item["code"] for item in selected}) != TARGET:
        raise RuntimeError("Duplicate product codes in the English cohort.")
    return selected


def translated_entries(records):
    texts = []
    for item in records:
        texts.append(item["title"])
        texts.extend(str(value) for value in (item.get("facts") or {}).values())
        texts.extend(key for key in (item.get("facts") or {}) if key not in FACT_LABELS)
    translated = translate_unique(texts)
    entries = []
    for item in records:
        facts_en = {}
        for key, value in (item.get("facts") or {}).items():
            label = FACT_LABELS.get(key, translated.get(key, key))
            facts_en[label] = translated.get(str(value), str(value))
        title_en = translated.get(item["title"], item["title"])
        if not title_en.strip():
            raise RuntimeError("A product title translated to empty text: " + item["code"])
        entries.append({
            "code": item["code"],
            "pageSlug": "product-" + hashlib.sha256(item["code"].encode()).hexdigest()[:16] + "-en",
            "titleEn": title_en,
            "factsEn": facts_en,
            "pageId": None,
            "url": None,
        })
    return entries


def state_rows(wp):
    return wp.call("/wp/v2/pages?context=edit&status=draft&slug=" + STATE + "&_fields=id,slug,parent,status,content,link")


def read_english_state(wp):
    rows = state_rows(wp)
    if not rows:
        return None
    row = rows[0]
    if row.get("slug") != STATE or STATE_MARK not in row["content"]["raw"]:
        raise RuntimeError("Refusing an unmanaged English translation state page.")
    payload = json.loads(base64.b64decode(c.text_from(row["content"]["raw"])))
    entries = payload.get("entries") or []
    if len(entries) > TARGET or len({x.get("code") for x in entries}) != len(entries):
        raise RuntimeError("English translation state is invalid or exceeds 100 pages.")
    return {"id": row["id"], "payload": payload, "entries": entries, "raw": row["content"]["raw"]}


def write_english_state(wp, current, payload):
    encoded = base64.b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).decode()
    content = STATE_MARK + "\n<pre>" + encoded + "</pre>\n"
    if current:
        old = wp.call("/wp/v2/pages/%d?context=edit&_fields=content" % current["id"])["content"]["raw"]
        if old != current["raw"]:
            raise RuntimeError("Concurrent English translation state edit.")
        saved = wp.call("/wp/v2/pages/%d" % current["id"], {"content": content})
    else:
        saved = wp.call("/wp/v2/pages", {
            "slug": STATE, "status": "draft", "title": "Managed English product detail translation state", "content": content,
        })
    if saved.get("slug") != STATE or saved["content"]["raw"] != content:
        raise RuntimeError("English translation state was not saved exactly.")
    return {"id": saved["id"], "payload": payload, "entries": payload["entries"], "raw": content}


def pages_by_slug(wp, slug):
    encoded = urllib.parse.quote(slug, safe="")
    rows = []
    for status in ("publish", "draft"):
        rows.extend(wp.call("/wp/v2/pages?context=edit&status=" + status + "&slug=" + encoded + "&_fields=id,slug,parent,content,link,status"))
    unique = {row["id"]: row for row in rows}
    return [row for row in unique.values() if row.get("slug") == slug]


def get_or_save_page(wp, slug, parent, marker, title, content, excerpt, status="publish"):
    rows = pages_by_slug(wp, slug)
    row = next((x for x in rows if int(x.get("parent", 0)) == int(parent)), None)
    if row and marker not in row["content"]["raw"]:
        raise RuntimeError("Refusing to overwrite an unmanaged page: " + slug)
    data = {"slug": slug, "parent": parent, "status": status, "title": title, "content": content, "excerpt": excerpt}
    if row:
        before = row["content"]["raw"]
        path = "/wp/v2/pages/%d" % row["id"]
        if wp.call(path + "?context=edit&_fields=content")["content"]["raw"] != before:
            raise RuntimeError("Concurrent page edit: " + slug)
    else:
        path = "/wp/v2/pages"
    saved = wp.call(path, data)
    if saved.get("slug") != slug or int(saved.get("parent", 0)) != int(parent) or saved["content"]["raw"] != content:
        raise RuntimeError("English page did not save as requested: %s (saved slug=%s, parent=%s)" % (slug, saved.get("slug"), saved.get("parent")))
    return saved


def page_url(entry):
    return SITE + "/en/product-details/" + entry["pageSlug"] + "/"


def page_title(entry):
    return entry["titleEn"] + " | Size and Material"


def description(item, entry):
    return (
        "Photos and size, material and product information for " + entry["titleEn"] + ". "
        "Details are based on the Japanese retailer listing and may change."
    )


def render_product(item, entry):
    character = CHARACTER_EN.get(item["character"], item["character"].replace("-", " ").title())
    char_ja = c.CHARACTERS[item["character"]][2]
    ja_character_url = SITE + "/" + c.CHARACTERS[item["character"]][1] + "/"
    english_url = page_url(entry)
    rows = [
        '<tr><th scope="row">Product name</th><td>' + d.E(entry["titleEn"]) + '<br><small>Japanese: ' + d.E(item["title"]) + '</small></td></tr>',
        '<tr><th scope="row">Character</th><td>' + d.E(character) + '</td></tr>',
    ]
    rows.extend('<tr><th scope="row">' + d.E(key) + '</th><td>' + d.E(value) + '</td></tr>' for key, value in entry["factsEn"].items())
    gallery = "".join(
        '<img src="' + d.E(src) + '" alt="' + d.E(entry["titleEn"]) + (' product photo' if i == 0 else ' detail photo ' + str(i + 1)) + '" loading="' + ("eager" if i == 0 else "lazy") + '" decoding="async">'
        for i, src in enumerate(item["images"])
    )
    source_date = str(item.get("checkedAt", ""))[:10]
    shop = str(item.get("shop", "Rakuten Ichiba"))
    affiliate = d.E(item["affiliate"])
    ja_url = d.E(item["url"])
    breadcrumb = {
        "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/en/"},
            {"@type": "ListItem", "position": 2, "name": "Sanrio Product Details", "item": SITE + "/en/product-details/"},
            {"@type": "ListItem", "position": 3, "name": entry["titleEn"], "item": english_url},
        ],
    }
    jsonld = json.dumps(breadcrumb, ensure_ascii=False).replace("<", "\\u003c")
    return (
        PAGE_MARK + '\n<style>.sf-en-detail{max-width:960px;margin:0 auto}.sf-en-note{font-size:13px;color:#756879;line-height:1.7}.sf-en-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sf-en-gallery img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain;background:#fff;border:1px solid #eee2ed;border-radius:12px}.sf-en-detail table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.7}.sf-en-detail th,.sf-en-detail td{padding:10px;border:1px solid #e8dfe8;text-align:left;overflow-wrap:anywhere}.sf-en-detail th{width:30%;background:#fff5fa}.sf-en-buy{display:block;text-align:center;padding:14px;margin:16px 0;background:#e75c9a;color:#fff;border-radius:12px;font-weight:700;text-decoration:none}.sf-en-detail details{margin:18px 0}.sf-en-detail small{color:#665d66}</style>'
        '<section class="sf-en-detail" lang="en"><p class="sf-en-note">Unofficial Sanrio fan site. This page contains affiliate links.</p>'
        '<p><a href="/en/product-details/">All English product details</a> · <a href="' + d.E(ja_character_url) + '">' + d.E(char_ja) + ' products (Japanese)</a> · <a href="' + ja_url + '">Japanese product page</a></p>'
        '<p>This guide summarizes the product details shown in the retailer listing. Please confirm the selected type, size, set contents and shipping information before purchase.</p>'
        '<div class="sf-en-gallery">' + gallery + '</div>'
        '<a class="sf-en-buy" href="' + affiliate + '" target="_blank" rel="sponsored nofollow noopener">View the listing on Rakuten Ichiba (Japan)</a>'
        '<h2>Product details</h2><table><tbody>' + "".join(rows) + '</tbody></table>'
        '<p class="sf-en-note">Source: Rakuten Ichiba listing by ' + d.E(shop) + '. Checked ' + d.E(source_date) + '. Product details and availability may change; please check the retailer page.</p>'
        '<details><summary>Original Japanese product information</summary><p>' + d.E(item["title"]) + '</p><ul>'
        + "".join('<li>' + d.E(key) + ': ' + d.E(value) + '</li>' for key, value in item.get("facts", {}).items())
        + '</ul></details><p><a href="/en/product-details/">Browse more Sanrio product details in English</a></p></section>'
        '<script type="application/ld+json">' + jsonld + '</script>\n'
    )


def render_hub(entries, records_by_code):
    cards = []
    for entry in entries:
        item = records_by_code[entry["code"]]
        image = item["images"][0]
        cards.append('<a href="' + d.E(page_url(entry)) + '"><img src="' + d.E(image) + '" alt="' + d.E(entry["titleEn"]) + '" loading="lazy" decoding="async"><strong>' + d.E(entry["titleEn"]) + '</strong></a>')
    return (
        HUB_MARK + '\n<style>.sf-en-product-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.sf-en-product-grid a{display:block;min-width:0;padding:7px;border:1px solid #eee2ed;border-radius:12px;background:#fff;color:#312b34;text-decoration:none;font-size:12px;line-height:1.45;overflow-wrap:anywhere}.sf-en-product-grid img{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border-radius:8px;margin-bottom:6px}.sf-en-product-grid strong{display:block;font-weight:600}.sf-en-product-hub{max-width:1100px;margin:auto}</style>'
        '<section class="sf-en-product-hub" lang="en"><div class="sf-en-product-grid">' + "".join(cards) + '</div>'
        '<p>These product guides summarize size, material and other information that could be confirmed in the Japanese retailer listing. Product names and source details in Japanese are included on each page for reference. This is an unofficial fan site and contains affiliate links.</p>'
        '<p><a href="/product-details/">View the Japanese product detail directory</a></p></section>\n'
    )


def publish_records(wp, parent_id, records_by_code, entries, state):
    entry_by_code = {x["code"]: x for x in entries}
    completed = 0
    upserted = 0
    for start in range(0, TARGET, BATCH_SIZE):
        batch = entries[start:start + BATCH_SIZE]
        pending = [entry for entry in batch if not entry.get("pageId")]

        def publish_one(entry):
            item = records_by_code[entry["code"]]
            raw = render_product(item, entry)
            excerpt = description(item, entry)
            saved = get_or_save_page(wp, entry["pageSlug"], parent_id, PAGE_MARK, page_title(entry), raw, excerpt)
            expected = page_url(entry)
            if saved.get("link", "").rstrip("/") != expected.rstrip("/"):
                raise RuntimeError("Unexpected English product URL: " + str(saved.get("link")))
            return entry["code"], saved["id"], saved["link"]

        if pending:
            with ThreadPoolExecutor(max_workers=3) as pool:
                for code, page_id, url in pool.map(publish_one, pending):
                    entry_by_code[code]["pageId"] = page_id
                    entry_by_code[code]["url"] = url
            upserted += len(pending)
            state["payload"]["entries"] = entries
            current = {"id": state["id"], "raw": state["raw"], "entries": entries}
            state.update(write_english_state(wp, current, state["payload"]))
        completed += len(batch)
        print("ENGLISH PRODUCT DETAIL BATCH", json.dumps({"batch": start // BATCH_SIZE + 1, "target": len(batch), "total": completed}, ensure_ascii=False), flush=True)
    return upserted


def save_directory_pages(wp, entries, records_by_code):
    landing_content = LANDING_MARK + '\n<section lang="en"><h2>Sanrio product details in English</h2><p>Explore selected Sanrio products with photos and information about size, material and other specifications.</p><p><a href="/en/product-details/">Browse the English product detail directory</a></p><p><a href="/product-details/">日本語の商品詳細一覧</a></p></section>\n'
    landing = get_or_save_page(wp, "en", 0, LANDING_MARK, "Sanrio Product Details in English | Sanrio fan info JP", landing_content, "English-language product details for selected Sanrio goods.", "draft")
    hub_content = render_hub(entries, records_by_code)
    hub = get_or_save_page(wp, "product-details", landing["id"], HUB_MARK, "Sanrio Product Details in English | Size and Material Guide", hub_content, "Photos and English product information for selected Sanrio goods.", "draft")
    # Publish the directory only after all 100 child pages exist.
    landing = wp.call("/wp/v2/pages/%d" % landing["id"], {"status": "publish"})
    hub = wp.call("/wp/v2/pages/%d" % hub["id"], {"status": "publish"})
    if landing.get("slug") != "en" or hub.get("slug") != "product-details" or int(hub.get("parent", 0)) != int(landing["id"]):
        raise RuntimeError("English directory hierarchy did not publish as expected.")
    return landing, hub


def add_japanese_hub_link(wp):
    rows = wp.call("/wp/v2/pages?context=edit&slug=product-details&_fields=id,slug,parent,content")
    row = next((item for item in rows if item.get("slug") == "product-details"
                and int(item.get("parent", 0)) == 0 and d.MARK in item["content"]["raw"]), None)
    if not row:
        raise RuntimeError("Managed Japanese product detail directory was not found.")
    raw = row["content"]["raw"]
    block = JA_LINK_START + '<p><a href="/en/product-details/">English product details →</a></p>' + JA_LINK_END
    if JA_LINK_START in raw:
        updated = re.sub(re.escape(JA_LINK_START) + r".*?" + re.escape(JA_LINK_END), block, raw, count=1, flags=re.S)
    else:
        if raw.count("</section>") != 1:
            raise RuntimeError("Japanese product detail directory boundary changed.")
        updated = raw.replace("</section>", block + "</section>", 1)
    if updated == raw:
        return
    path = "/wp/v2/pages/%d" % row["id"]
    if wp.call(path + "?context=edit&_fields=content")["content"]["raw"] != raw:
        raise RuntimeError("Concurrent Japanese product detail directory edit.")
    saved = wp.call(path, {"content": updated})
    if saved["content"]["raw"] != updated:
        raise RuntimeError("English directory link was not added to the Japanese directory.")


def public_body(url):
    req = urllib.request.Request(url, headers={"User-Agent": "SanrioProductDetailEnglishVerification/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read().decode("utf-8")


def verify_page(url, marker):
    body = public_body(url)
    if marker not in body:
        raise RuntimeError("Published page marker is missing: " + url)
    if re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', body, re.I):
        raise RuntimeError("Published English page is noindex: " + url)
    parser = CanonicalParser()
    parser.feed(body)
    if not parser.urls:
        raise RuntimeError("Canonical tag missing: " + url)
    canonical_urls = [urllib.parse.urljoin(url, item) for item in parser.urls]
    if any(value.rstrip("/") != url.rstrip("/") for value in canonical_urls):
        raise RuntimeError("Unexpected canonical URL: " + url)
    return len(canonical_urls)


def sitemap_urls():
    robots = public_body(SITE + "/robots.txt")
    parser = robotparser.RobotFileParser()
    parser.parse(robots.splitlines())
    sitemap_queue = [line.split(":", 1)[1].strip() for line in robots.splitlines() if line.lower().startswith("sitemap:")]
    sitemap_queue += [SITE + "/sitemap.xml", SITE + "/wp-sitemap.xml", SITE + "/sitemap_index.xml"]
    seen_sitemaps, found = set(), set()
    for _ in range(100):
        if not sitemap_queue:
            break
        sitemap = sitemap_queue.pop(0)
        if sitemap in seen_sitemaps:
            continue
        seen_sitemaps.add(sitemap)
        try:
            xml = ET.fromstring(public_body(sitemap))
        except Exception:
            continue
        root_name = xml.tag.rsplit("}", 1)[-1].lower()
        locations = [node.text.strip() for node in xml.iter() if node.tag.rsplit("}", 1)[-1].lower() == "loc" and node.text]
        if root_name == "sitemapindex":
            sitemap_queue.extend(locations)
        elif root_name == "urlset":
            found.update(locations)
    return parser, found, len(seen_sitemaps)


def verify_all(entries, landing, hub):
    canonical_count = 0
    urls = [x["url"] for x in entries] + [landing["link"], hub["link"]]
    for url, marker in [(x["url"], PAGE_MARK) for x in entries] + [(landing["link"], LANDING_MARK), (hub["link"], HUB_MARK)]:
        canonical_count += verify_page(url, marker)
    parser, published_sitemap_urls, sitemap_count = sitemap_urls()
    if any(url.rstrip("/") not in {x.rstrip("/") for x in published_sitemap_urls} for url in urls):
        time.sleep(10)
        parser, published_sitemap_urls, sitemap_count = sitemap_urls()
    blocked = [url for url in urls if not parser.can_fetch("Googlebot", url)]
    missing = [url for url in urls if url.rstrip("/") not in {x.rstrip("/") for x in published_sitemap_urls}]
    if blocked:
        raise RuntimeError("Googlebot is blocked from %d English directory pages." % len(blocked))
    if missing:
        raise RuntimeError("English pages are not yet present in the published sitemap: %d" % len(missing))
    return {"publicPagesVerified": len(urls), "canonicalTagsObserved": canonical_count, "googlebotAllowed": True,
            "sitemapPagesFound": len(urls), "sitemapsChecked": sitemap_count}


def run():
    wp = c.WordPress()
    records, _ = d.read_state(wp)
    if len(records) != 1000:
        raise RuntimeError("English launch expects the verified 1,000-page Japanese cohort; found %d." % len(records))
    records_by_code = {item["code"]: item for item in records}
    state = read_english_state(wp)
    new_pages_upserted = 0
    if state:
        entries = state["entries"]
        payload = state["payload"]
        if len(entries) not in (0, TARGET):
            raise RuntimeError("English translation state must contain exactly 100 products or be empty.")
        if not entries:
            entries = translated_entries(select_records(records))
            payload["entries"] = entries
            state["payload"] = payload
            state = write_english_state(wp, {"id": state["id"], "raw": state["raw"], "entries": []}, payload)
    else:
        entries = translated_entries(select_records(records))
        payload = {"version": 1, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "entries": entries}
        state = write_english_state(wp, None, payload)
    if len(entries) != TARGET:
        raise RuntimeError("English translation cohort is incomplete.")
    for entry in entries:
        if entry["code"] not in records_by_code:
            raise RuntimeError("Japanese source product is missing from the verified cohort: " + entry["code"])
    if not all(x.get("pageId") for x in entries):
        landing = get_or_save_page(wp, "en", 0, LANDING_MARK,
            "Sanrio Product Details in English | Sanrio fan info JP",
            LANDING_MARK + '\n<section lang="en"><h2>Sanrio product details in English</h2><p>Explore selected Sanrio products with photos and information about size, material and other specifications.</p><p><a href="/en/product-details/">Browse the English product detail directory</a></p><p><a href="/product-details/">日本語の商品詳細一覧</a></p></section>\n',
            "English-language product details for selected Sanrio goods.", "draft")
        hub = get_or_save_page(wp, "product-details", landing["id"], HUB_MARK,
            "Sanrio Product Details in English | Size and Material Guide",
            render_hub([], records_by_code), "Photos and English product information for selected Sanrio goods.", "draft")
        new_pages_upserted = publish_records(wp, hub["id"], records_by_code, entries, state)
        landing, hub = save_directory_pages(wp, entries, records_by_code)
    else:
        landing_rows = pages_by_slug(wp, "en")
        landing = next((x for x in landing_rows if x.get("slug") == "en" and int(x.get("parent", 0)) == 0), None)
        if not landing or LANDING_MARK not in landing["content"]["raw"]:
            raise RuntimeError("Managed English landing page is missing.")
        hub_rows = pages_by_slug(wp, "product-details")
        hub = next((x for x in hub_rows if int(x.get("parent", 0)) == int(landing["id"])), None)
        if not hub or HUB_MARK not in hub["content"]["raw"]:
            raise RuntimeError("Managed English product directory is missing.")
        # Idempotent refresh of the English directory and its saved page links.
        hub_content = render_hub(entries, records_by_code)
        landing = wp.call("/wp/v2/pages/%d" % landing["id"], {"status": "publish"})
        saved = get_or_save_page(wp, "product-details", landing["id"], HUB_MARK,
            "Sanrio Product Details in English | Size and Material Guide", hub_content,
            "Photos and English product information for selected Sanrio goods.", "publish")
        hub = saved
    add_japanese_hub_link(wp)
    verification = verify_all(entries, landing, hub)
    report = {
        "japaneseProductDetails": len(records), "englishProductDetails": len(entries),
        "englishPagesUpsertedThisRun": new_pages_upserted,
        "englishHub": hub["link"], "englishLanding": landing["link"],
        "batches": [50, 50], "translatedFromVerifiedJapanesePages": True,
        "googleTranslate": "machine-translated; Japanese original product name and specifications retained for reference",
        **verification,
    }
    Path("product-detail-english-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("ENGLISH PRODUCT DETAILS COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish-first-100", action="store_true")
    args = parser.parse_args()
    if not args.publish_first_100:
        parser.error("Use --publish-first-100")
    run()


if __name__ == "__main__":
    main()
