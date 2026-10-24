"""Publish a compact Chinese, Korean and Spanish Sanrio character guide pilot."""
import argparse
import collections
import html
import importlib.util
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = __import__("pathlib").Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("detail_catalog", ROOT / "product-detail-pilot.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
c = d.c
spec = importlib.util.spec_from_file_location("english_detail", ROOT / "product-detail-english.py")
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)

SITE = c.SITE
PILOT_CHARACTERS = ("mymelody", "hellokitty", "hanamaru-obake")
INDEX_MARK = "<!-- sf-multilingual-character-index:v1 -->"
GUIDE_MARK = "<!-- sf-multilingual-character-guide:v1 -->"
JA_LINK_START = "<!-- sf-multilingual-ja-links:start -->"
JA_LINK_END = "<!-- sf-multilingual-ja-links:end -->"
EN_GUIDE_START = "<!-- sf-multilingual-en-guide-links:start -->"
EN_GUIDE_END = "<!-- sf-multilingual-en-guide-links:end -->"
EN_INDEX_START = "<!-- sf-multilingual-en-index:start -->"
EN_INDEX_END = "<!-- sf-multilingual-en-index:end -->"
GRID_CSS = (
    ".sf-multi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));"
    "gap:10px;margin:16px 0}.sf-multi-grid a{display:block;min-width:0;padding:7px;"
    "border:1px solid #eee2ed;border-radius:12px;background:#fff;color:#312b34;"
    "text-decoration:none;font-size:12px;line-height:1.55;overflow-wrap:anywhere}"
    ".sf-multi-grid img{display:block;width:100%;height:auto;aspect-ratio:1;"
    "object-fit:contain;background:#fff;border-radius:8px;margin-bottom:6px}"
    ".sf-multi-grid span{display:block}.sf-multi-note{font-size:13px;"
    "line-height:1.75;color:#756879}"
)
LANGUAGES = (
    {"slug": "zh-hans", "lang": "zh-Hans", "target": "zh-CN", "label": "简体中文",
     "product_english": "英文商品名"},
    {"slug": "zh-hant", "lang": "zh-Hant", "target": "zh-TW", "label": "繁體中文",
     "product_english": "英文商品名稱"},
    {"slug": "ko", "lang": "ko", "target": "ko", "label": "한국어",
     "product_english": "영어 상품명"},
    {"slug": "es", "lang": "es", "target": "es", "label": "Español",
     "product_english": "Nombre del producto en inglés"},
)
CHARACTER_NAMES = {
    "mymelody": {"zh-hans": "美乐蒂", "zh-hant": "美樂蒂", "ko": "마이멜로디", "es": "My Melody"},
    "hellokitty": {"zh-hans": "Hello Kitty", "zh-hant": "Hello Kitty", "ko": "헬로키티", "es": "Hello Kitty"},
    "hanamaru-obake": {"zh-hans": "Hanamaruobake", "zh-hant": "Hanamaruobake", "ko": "하나마루오바케", "es": "Hanamaruobake"},
}
PROTECTED_NAMES = {
    "mymelody": {"マイメロディ": CHARACTER_NAMES["mymelody"]},
    "hellokitty": {"ハローキティ": CHARACTER_NAMES["hellokitty"]},
    "hanamaru-obake": {"はなまるおばけ": CHARACTER_NAMES["hanamaru-obake"], "まるまる": {"zh-hans": "Marumaru", "zh-hant": "Marumaru", "ko": "마루마루", "es": "Marumaru"}},
}
SOURCE_PAGES = {
    "mymelody": ("https://www.sanrio.co.jp/characters/mymelody/",),
    "hellokitty": ("https://www.sanrio.co.jp/characters/hellokitty/",),
    "hanamaru-obake": (
        "https://www.sanrio.co.jp/characters/hanamaruobake/",
        "https://corporate.sanrio.co.jp/en/business-info/brands/hanamaruobake/",
    ),
}
PROFILES = {
    "mymelody": {
        "summary": "すなおで明るく、弟思いの女のコです。宝物は、おばあちゃんが作ってくれたかわいいずきん。お母さんとクッキーを焼くのが好きで、好きな食べ物はアーモンドパウンドケーキです。",
        "facts": ["誕生日：1月18日", "デビュー年：1975年", "将来の夢：お菓子屋さん", "趣味：クッキーを焼くこと"],
    },
    "hellokitty": {
        "summary": "ロンドン郊外生まれの明るくてやさしい女のコです。クッキー作りとピアノが好きで、夢はピアニストか詩人になること。好きな食べ物はママが作るアップルパイです。",
        "facts": ["誕生日：11月1日", "デビュー年：1974年", "身長：りんご5個分", "体重：りんご3個分"],
    },
    "hanamaru-obake": {
        "summary": "「まるまる」は、がんばったあなたにハナマルをくれる、はずかしがりやで不思議なおばけです。気づかれないうちに現れて、毎日の努力をそっとほめてくれます。正体は、夜空の星になった大切な人や思い出かもしれません。",
        "facts": ["誕生日：8月7日", "デビュー年：2023年", "性格：はずかしがりや", "特技：かくれんぼ", "好きな食べ物：あまいもの", "趣味：お昼寝"],
    },
}
COMMON_TEXT = (
    "キャラクター紹介",
    "プロフィール",
    "関連商品",
    "言語を選ぶ",
    "キャラクター一覧",
    "商品詳細を見る",
    "公式プロフィールを見る",
    "写真と、サイズや素材などの商品情報を確認できます。",
    "商品詳細は日本語または英語のページでご覧いただけます。価格、在庫、仕様は変更される場合があります。",
    "サンリオ公式プロフィールを参考に要約した、非公式ファンサイトの紹介です。サンリオ公式サイトではありません。",
    "一部の商品リンクにはアフィリエイトリンクが含まれる場合があります。",
    "キャラクターを選んで、プロフィールと関連商品をご覧ください。",
    "日本語のキャラクターページ",
    "英語の商品ガイド",
)
_translation_lock = threading.Lock()
_last_translation = 0.0
_translation_cache = {}


def page_slug(character):
    if character not in PILOT_CHARACTERS:
        raise RuntimeError("Unsupported pilot character: " + str(character))
    return character


def locale_index_url(locale):
    return SITE + "/" + locale + "/"


def locale_guide_url(locale, character):
    return locale_index_url(locale) + page_slug(character) + "/"


def managed_block(raw, start, end, body):
    if (start in raw) != (end in raw):
        raise RuntimeError("A multilingual content marker is incomplete.")
    block = start + body + end
    if start in raw:
        if raw.count(start) != 1 or raw.count(end) != 1:
            raise RuntimeError("A multilingual content marker is duplicated.")
        return re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: block, raw, count=1, flags=re.S)
    return raw.rstrip() + "\n" + block + "\n"


def protected_source(source, locale, character):
    result = source
    replacements = {}
    names = PROTECTED_NAMES.get(character, {})
    for index, (japanese, localized) in enumerate(sorted(names.items(), key=lambda x: -len(x[0]))):
        token = "ZZQCHAR%03dQXZ" % index
        result = result.replace(japanese, token)
        replacements[token] = localized[locale]
    return result, replacements


def translate_one(source, language, character=None):
    key = (language["slug"], source, character)
    if key in _translation_cache:
        return _translation_cache[key]
    safe_source, replacements = protected_source(source, language["slug"], character) if character else (source, {})
    query = urllib.parse.urlencode({"client": "gtx", "sl": "ja", "tl": language["target"], "dt": "t", "q": safe_source})
    request = urllib.request.Request(
        "https://translate.googleapis.com/translate_a/single?" + query,
        headers={"User-Agent": "SanrioMultilingualCharacterGuides/1.0"},
    )
    last_error = None
    global _last_translation
    for attempt in range(4):
        try:
            with _translation_lock:
                delay = 0.23 - (time.monotonic() - _last_translation)
                if delay > 0:
                    time.sleep(delay)
                _last_translation = time.monotonic()
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            value = "".join(part[0] for part in data[0] if part and isinstance(part[0], str)).strip()
            for token, localized in replacements.items():
                if token not in value:
                    raise RuntimeError("Translation service changed a protected character-name token.")
                value = value.replace(token, localized)
            if not value:
                raise RuntimeError("Translation service returned an empty translation.")
            _translation_cache[key] = value
            return value
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError("Translation failed for " + language["slug"] + ": " + str(last_error))


def translate_many(values, language, character_by_value=None):
    character_by_value = character_by_value or {}
    unique = sorted(set(str(value).strip() for value in values if str(value).strip()))
    def translate(value):
        return value, translate_one(value, language, character_by_value.get(value))
    with ThreadPoolExecutor(max_workers=3) as pool:
        return dict(pool.map(translate, unique))


def diversified_records(records, limit=12):
    groups = collections.OrderedDict()
    for item in records:
        groups.setdefault(item.get("kind") or "Sanrio goods", []).append(item)
    selected = []
    while groups and len(selected) < limit:
        empty = []
        for key, values in groups.items():
            if values and len(selected) < limit:
                selected.append(values.pop(0))
            if not values:
                empty.append(key)
        for key in empty:
            del groups[key]
    return selected


def find_page(wp, slug, parent_id):
    rows = e.pages_by_slug(wp, slug)
    return next((row for row in rows if int(row.get("parent", 0)) == int(parent_id)), None)


def rest_page(wp, page_id):
    return wp.call("/wp/v2/pages/" + str(page_id) + "?context=edit&_fields=id,slug,parent,status,content,link")


def publish_page(wp, page):
    if page.get("status") == "publish":
        return page
    saved = wp.call("/wp/v2/pages/" + str(page["id"]), {"status": "publish"})
    if saved.get("status") != "publish" or saved.get("slug") != page.get("slug"):
        raise RuntimeError("Could not publish multilingual page: " + str(page.get("slug")))
    return saved


def preflight_existing(wp, records, entries_by_code, en_directory_id):
    ja_pages = {}
    for key in PILOT_CHARACTERS:
        page_id, slug, _ = c.CHARACTERS[key]
        page = rest_page(wp, page_id)
        if page.get("slug") != slug or page.get("status") != "publish":
            raise RuntimeError("Japanese character page identity changed: " + slug)
        ja_pages[key] = page
        guide = find_page(wp, key, en_directory_id)
        if not guide or guide.get("status") != "publish" or GUIDE_MARK not in guide["content"]["raw"] and "<!-- sf-bilingual-character-guide:v1 -->" not in guide["content"]["raw"]:
            raise RuntimeError("Existing English character guide is missing or unmanaged: " + key)
    # Verify selected cards are backed by exact paired Japanese and English pages before writing.
    selected = {}
    for key in PILOT_CHARACTERS:
        rows = diversified_records([item for item in records if item["character"] == key], 12)
        if len(rows) != 12:
            raise RuntimeError("Not enough confirmed products for multilingual guide: " + key)
        for item in rows:
            entry = entries_by_code[item["code"]]
            if not item.get("pageId") or not entry.get("pageId") or not item.get("images"):
                raise RuntimeError("A localized product card is missing source data: " + item["code"])
            if item["url"].rstrip("/") != d.detail_url(item["code"]).rstrip("/") or entry["url"].rstrip("/") != e.page_url(entry).rstrip("/"):
                raise RuntimeError("A localized product card has an unexpected paired URL: " + item["code"])
        selected[key] = rows
    return ja_pages, selected


def validate_cohorts(records, entries):
    if len(records) != 1000 or len(entries) != 1000:
        raise RuntimeError("Expected 1,000 Japanese and English product details.")
    records_by_code = {item["code"]: item for item in records}
    entries_by_code = {item["code"]: item for item in entries}
    if len(records_by_code) != 1000 or len(entries_by_code) != 1000 or set(records_by_code) != set(entries_by_code):
        raise RuntimeError("Japanese and English product detail cohorts do not match exactly.")
    return records_by_code, entries_by_code


def language_switch(locale, character, language_text):
    links = []
    ja = c.CHARACTERS[character]
    for item in LANGUAGES:
        if item["slug"] == locale:
            links.append('<span aria-current="page">' + html.escape(item["label"]) + "</span>")
        else:
            links.append('<a href="' + html.escape(locale_guide_url(item["slug"], character), quote=True) + '">' + html.escape(item["label"]) + "</a>")
    en_url = SITE + "/en/characters/" + character + "/"
    links.append('<a href="' + html.escape(en_url, quote=True) + '">English</a>')
    links.append('<a href="/' + html.escape(ja[1], quote=True) + '/">日本語</a>')
    return '<p class="sf-multi-languages"><strong>' + html.escape(language_text) + ":</strong> " + " · ".join(links) + "</p>"


def render_index(language, translations, selected):
    cards = []
    for key in PILOT_CHARACTERS:
        item = selected[key][0]
        name = CHARACTER_NAMES[key][language["slug"]]
        cards.append(
            '<a href="' + html.escape(locale_guide_url(language["slug"], key), quote=True) + '">'
            '<img src="' + html.escape(item["images"][0], quote=True) + '" alt="' + html.escape(name + " product photo", quote=True) + '" loading="lazy" decoding="async">'
            "<span>" + html.escape(name) + "</span></a>"
        )
    intro = translations["キャラクターを選んで、プロフィールと関連商品をご覧ください。"]
    return (
        INDEX_MARK + "<style>" + GRID_CSS + "</style>"
        '<section lang="' + html.escape(language["lang"], quote=True) + '">'
        "<h2>" + html.escape(translations["キャラクター一覧"]) + "</h2>"
        '<p class="sf-multi-note">' + html.escape(intro) + "</p>"
        '<div class="sf-multi-grid">' + "".join(cards) + "</div>"
        '<p><a href="/en/characters/">English character guides</a> · <a href="/">日本語</a></p>'
        "</section>"
    )


def render_guide(character, language, translated, selected, entries_by_code):
    char_name = CHARACTER_NAMES[character][language["slug"]]
    facts = "".join("<li>" + html.escape(translated[item]) + "</li>" for item in PROFILES[character]["facts"])
    products = []
    for item in selected[character]:
        entry = entries_by_code[item["code"]]
        title = translated[item["title"]]
        products.append(
            '<a href="' + html.escape(e.page_url(entry), quote=True) + '">'
            '<img src="' + html.escape(item["images"][0], quote=True) + '" alt="' + html.escape(char_name + " " + title, quote=True) + '" loading="lazy" decoding="async">'
            "<span>" + html.escape(title) + "</span>"
            "<small>" + html.escape(language["product_english"] + ": " + entry["titleEn"]) + "</small></a>"
        )
    summary = translated[PROFILES[character]["summary"]]
    unoff = translated[COMMON_TEXT[9]]
    goods = translated[COMMON_TEXT[2]]
    product_note = translated[COMMON_TEXT[8]]
    affiliate_note = translated[COMMON_TEXT[10]]
    source_links = " · ".join(
        '<a href="' + html.escape(url, quote=True) + '" target="_blank" rel="noopener noreferrer">'
        + html.escape(translated[COMMON_TEXT[6]]) + "</a>"
        for url in SOURCE_PAGES[character]
    )
    ja = c.CHARACTERS[character]
    return (
        GUIDE_MARK + "<style>" + GRID_CSS + "</style>"
        '<section lang="' + html.escape(language["lang"], quote=True) + '">'
        '<p class="sf-multi-note">' + html.escape(unoff) + "</p>"
        + language_switch(language["slug"], character, translated[COMMON_TEXT[3]])
        + "<h2>" + html.escape(char_name) + " — " + html.escape(translated[COMMON_TEXT[1]]) + "</h2>"
        "<p>" + html.escape(summary) + "</p>"
        "<ul>" + facts + "</ul>"
        "<p>" + source_links + "</p>"
        "<p><a href='/" + html.escape(ja[1], quote=True) + "/'>" + html.escape(translated[COMMON_TEXT[12]]) + "</a> · "
        "<a href='/en/characters/" + html.escape(character, quote=True) + "/'>" + html.escape(translated[COMMON_TEXT[13]]) + "</a></p>"
        "<h2>" + html.escape(goods) + "</h2>"
        '<div class="sf-multi-grid">' + "".join(products) + "</div>"
        '<p class="sf-multi-note">' + html.escape(translated[COMMON_TEXT[7]]) + " "
        + html.escape(product_note) + " " + html.escape(affiliate_note) + "</p>"
        "</section>"
    )


def public_verify(url, marker):
    body = e.public_body(url)
    if marker not in body:
        raise RuntimeError("Multilingual page marker missing: " + url)
    if re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', body, re.I):
        raise RuntimeError("A multilingual page is noindex: " + url)
    parser = e.CanonicalParser()
    parser.feed(body)
    parser.close()
    canonical_urls = [urllib.parse.urljoin(url, value) for value in parser.urls]
    if not canonical_urls or any(value.rstrip("/") != url.rstrip("/") for value in canonical_urls):
        raise RuntimeError("Missing or unexpected canonical URL: " + url)
    return len(canonical_urls)


def update_content(wp, page_id, marker_start, marker_end, body):
    current = rest_page(wp, page_id)
    raw = current["content"]["raw"]
    updated = managed_block(raw, marker_start, marker_end, body)
    if updated != raw:
        d.update_existing_content(wp, "/wp/v2/pages/" + str(page_id), raw, updated)
    saved = rest_page(wp, page_id)
    if marker_start not in saved["content"]["raw"] or saved["content"]["raw"] != updated:
        raise RuntimeError("Language links were not saved: " + current.get("slug", str(page_id)))
    return saved, updated != raw


def run():
    wp = c.WordPress()
    records, _ = d.read_state(wp)
    english_state = e.read_english_state(wp)
    if not english_state:
        raise RuntimeError("The verified English product detail state is missing.")
    records_by_code, entries_by_code = validate_cohorts(records, english_state["entries"])
    en_landing, en_product_hub = e.managed_directory(wp)
    en_directory = find_page(wp, "characters", en_landing["id"])
    if not en_directory or "<!-- sf-bilingual-character-directory:v1 -->" not in en_directory["content"]["raw"]:
        raise RuntimeError("The managed English character directory is missing.")
    ja_pages, selected = preflight_existing(wp, records, entries_by_code, en_directory["id"])

    existing_indexes = {}
    existing_guides = {}
    for language in LANGUAGES:
        root = find_page(wp, language["slug"], 0)
        if root and INDEX_MARK not in root["content"]["raw"]:
            raise RuntimeError("Refusing to overwrite an unmanaged language index: " + language["slug"])
        existing_indexes[language["slug"]] = root
        parent_id = root["id"] if root else None
        existing_guides[language["slug"]] = {}
        if parent_id:
            for character in PILOT_CHARACTERS:
                page = find_page(wp, character, parent_id)
                if page and GUIDE_MARK not in page["content"]["raw"]:
                    raise RuntimeError("Refusing to overwrite an unmanaged multilingual character page.")
                existing_guides[language["slug"]][character] = page

    # Prepare all translations before the first WordPress write.
    common_sources = list(COMMON_TEXT)
    for character in PILOT_CHARACTERS:
        common_sources.append(PROFILES[character]["summary"])
        common_sources.extend(PROFILES[character]["facts"])
        for item in selected[character]:
            common_sources.append(item["title"])
    translated_by_locale = {}
    for language in LANGUAGES:
        char_for_value = {}
        for character in PILOT_CHARACTERS:
            char_for_value[PROFILES[character]["summary"]] = character
            for item in selected[character]:
                char_for_value[item["title"]] = character
        translated_by_locale[language["slug"]] = translate_many(common_sources, language, char_for_value)

    index_pages = {}
    guide_pages = {}
    changed_ja_links = 0
    changed_en_links = 0
    for language in LANGUAGES:
        locale = language["slug"]
        translated = translated_by_locale[locale]
        index_body = render_index(language, translated, selected)
        old_index = existing_indexes[locale]
        index_page = e.get_or_save_page(
            wp, locale, 0, INDEX_MARK,
            CHARACTER_NAMES["mymelody"][locale] + " | Sanrio Character Guides",
            index_body, translated[COMMON_TEXT[11]],
            old_index.get("status", "draft") if old_index else "draft",
        )
        if int(index_page.get("parent", 0)) != 0:
            raise RuntimeError("Language index is not a root page: " + locale)
        index_pages[locale] = index_page
        guide_pages[locale] = {}
        for character in PILOT_CHARACTERS:
            body = render_guide(character, language, translated, selected, entries_by_code)
            old = existing_guides[locale].get(character)
            title = CHARACTER_NAMES[character][locale] + " | " + translated[COMMON_TEXT[1]]
            page = e.get_or_save_page(
                wp, character, index_page["id"], GUIDE_MARK, title, body,
                translated[PROFILES[character]["summary"]],
                (old or {}).get("status", "draft"),
            )
            guide_pages[locale][character] = page

    # Publish parents first so WordPress creates stable hierarchical URLs.
    published_indexes = {}
    published_guides = {}
    for language in LANGUAGES:
        locale = language["slug"]
        published_indexes[locale] = publish_page(wp, index_pages[locale])
        expected_index = locale_index_url(locale)
        if published_indexes[locale].get("link", "").rstrip("/") != expected_index.rstrip("/"):
            raise RuntimeError("Unexpected language index URL: " + str(published_indexes[locale].get("link")))
        published_guides[locale] = {}
        for character in PILOT_CHARACTERS:
            published = publish_page(wp, guide_pages[locale][character])
            expected_guide = locale_guide_url(locale, character)
            if published.get("link", "").rstrip("/") != expected_guide.rstrip("/"):
                raise RuntimeError("Unexpected localized guide URL: " + str(published.get("link")))
            published_guides[locale][character] = published

    # Link the new locale guides from the matching Japanese and English pages.
    for character in PILOT_CHARACTERS:
        ja = c.CHARACTERS[character]
        body = (
            '<section lang="ja"><h2>他の言語のキャラクター紹介</h2><p>'
            + " · ".join('<a href="' + html.escape(locale_guide_url(x["slug"], character), quote=True) + '">' + html.escape(x["label"]) + "</a>" for x in LANGUAGES)
            + "</p></section>"
        )
        _, changed = update_content(wp, ja[0], JA_LINK_START, JA_LINK_END, body)
        changed_ja_links += int(changed)
        en_guide = find_page(wp, character, en_directory["id"])
        en_body = (
            '<section lang="en"><h2>Character guides in other languages</h2><p>'
            + " · ".join('<a href="' + html.escape(locale_guide_url(x["slug"], character), quote=True) + '">' + html.escape(x["label"]) + "</a>" for x in LANGUAGES)
            + "</p></section>"
        )
        saved, changed = update_content(wp, en_guide["id"], EN_GUIDE_START, EN_GUIDE_END, en_body)
        changed_en_links += int(changed)

    en_index_body = (
        '<section lang="en"><h2>Character guides in Chinese, Korean and Spanish</h2><p>'
        + " · ".join('<a href="' + html.escape(locale_index_url(x["slug"]), quote=True) + '">' + html.escape(x["label"]) + "</a>" for x in LANGUAGES)
        + "</p></section>"
    )
    _, en_index_changed = update_content(wp, en_directory["id"], EN_INDEX_START, EN_INDEX_END, en_index_body)

    verify_targets = []
    for language in LANGUAGES:
        locale = language["slug"]
        verify_targets.append((published_indexes[locale]["link"], INDEX_MARK))
        for character in PILOT_CHARACTERS:
            verify_targets.append((published_guides[locale][character]["link"], GUIDE_MARK))
    for character in PILOT_CHARACTERS:
        verify_targets.append((ja_pages[character]["link"], JA_LINK_START))
        en_guide = find_page(wp, character, en_directory["id"])
        verify_targets.append((en_guide["link"], EN_GUIDE_START))
    verify_targets.append((rest_page(wp, en_directory["id"])["link"], EN_INDEX_START))

    with ThreadPoolExecutor(max_workers=8) as pool:
        canonical_counts = list(pool.map(lambda pair: public_verify(*pair), verify_targets))
    googlebot, urls, sitemap_count = e.sitemap_urls()
    url_set = {item.rstrip("/") for item in urls}
    missing = [url for url, _ in verify_targets if url.rstrip("/") not in url_set]
    if missing:
        time.sleep(10)
        googlebot, urls, sitemap_count = e.sitemap_urls()
        url_set = {item.rstrip("/") for item in urls}
        missing = [url for url, _ in verify_targets if url.rstrip("/") not in url_set]
    if missing:
        raise RuntimeError("Multilingual pages are missing from the published sitemap: " + str(len(missing)))
    blocked = [url for url, _ in verify_targets if not googlebot.can_fetch("Googlebot", url)]
    if blocked:
        raise RuntimeError("Googlebot is blocked from %d multilingual pages." % len(blocked))

    report = {
        "japaneseAndEnglishProducts": 1000,
        "pilotCharacters": list(PILOT_CHARACTERS),
        "languages": [x["slug"] for x in LANGUAGES],
        "languageIndexesPublished": len(published_indexes),
        "characterGuidesPublished": sum(len(x) for x in published_guides.values()),
        "japaneseCharacterPagesUpdated": changed_ja_links,
        "englishCharacterGuidesUpdated": changed_en_links,
        "englishDirectoryUpdated": int(en_index_changed),
        "publishedPagesVerified": len(verify_targets),
        "canonicalTagsObserved": sum(canonical_counts),
        "pagesWithDuplicateCanonicalTags": sum(1 for count in canonical_counts if count > 1),
        "googlebotAllowed": True,
        "sitemapPagesFound": len(urls),
        "sitemapsChecked": sitemap_count,
        "hreflangHeadMarkup": "not managed by page content REST",
    }
    __import__("pathlib").Path("multilingual-character-guides-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print("MULTILINGUAL CHARACTER GUIDES COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main():
    argparse.ArgumentParser().parse_args()
    run()


if __name__ == "__main__":
    main()
