"""Add a small, reversible Japanese/English discovery pilot via WordPress REST."""
import argparse
import collections
import importlib.util
import json
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


d = load_script("product_detail_pilot", "product-detail-pilot.py")
e = load_script("product_detail_english", "product-detail-english.py")
c = d.c
E = d.E
SITE = c.SITE
PILOT_SIZE = 3
DIRECTORY_MARK = "<!-- sf-bilingual-character-directory:v1 -->"
GUIDE_MARK = "<!-- sf-bilingual-character-guide:v1 -->"
HUB_NAV_START = "<!-- sf-bilingual-hub-nav:start -->"
HUB_NAV_END = "<!-- sf-bilingual-hub-nav:end -->"
EN_GUIDE_START = "<!-- sf-bilingual-en-guide-link:start -->"
EN_GUIDE_END = "<!-- sf-bilingual-en-guide-link:end -->"
JA_PAIR_START = "<!-- sf-bilingual-ja-pair-link:start -->"
JA_PAIR_END = "<!-- sf-bilingual-ja-pair-link:end -->"
JA_CHARACTER_START = "<!-- sf-bilingual-ja-character-link:start -->"
JA_CHARACTER_END = "<!-- sf-bilingual-ja-character-link:end -->"
LANGUAGE_LINK_CSS = (
    ".sf-bilingual-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));"
    "gap:10px;margin:16px 0}.sf-bilingual-grid a{display:block;min-width:0;padding:7px;"
    "border:1px solid #eee2ed;border-radius:12px;background:#fff;color:#312b34;"
    "text-decoration:none;font-size:12px;line-height:1.5;overflow-wrap:anywhere}"
    ".sf-bilingual-grid img{display:block;width:100%;height:auto;aspect-ratio:1;"
    "object-fit:contain;background:#fff;border-radius:8px;margin-bottom:6px}"
    ".sf-bilingual-grid span{display:block}.sf-bilingual-note{font-size:13px;"
    "line-height:1.7;color:#756879}"
)


def character_english_slug(character):
    if character not in c.CHARACTERS:
        raise RuntimeError("Unknown character key: " + str(character))
    return character


def character_english_url(character):
    return SITE + "/en/characters/" + character_english_slug(character) + "/"


def choose_pilot_characters(records, limit=PILOT_SIZE):
    counts = collections.Counter(item.get("character") for item in records)
    order = {key: index for index, key in enumerate(c.CHARACTERS)}
    unknown = sorted(set(counts) - set(c.CHARACTERS))
    if unknown:
        raise RuntimeError("The source cohort contains unknown characters: " + ", ".join(unknown))
    ranked = sorted(
        (key for key, count in counts.items() if count > 0),
        key=lambda key: (-counts[key], order[key]),
    )
    chosen = ranked[:limit]
    if len(chosen) != limit or any(counts[key] < 6 for key in chosen):
        raise RuntimeError("Not enough complete product details for a useful character pilot.")
    # Keep the established character order in every displayed navigation block.
    chosen.sort(key=lambda key: order[key])
    return chosen, {key: counts[key] for key in chosen}


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


def managed_block(raw, start, end, body, insert_before=None):
    if (start in raw) != (end in raw):
        raise RuntimeError("A bilingual content marker is incomplete.")
    block = start + body + end
    if start in raw:
        if raw.count(start) != 1 or raw.count(end) != 1:
            raise RuntimeError("Bilingual content marker is duplicated.")
        return re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: block, raw, count=1, flags=re.S)
    if insert_before is None:
        return raw.rstrip() + "\n" + block + "\n"
    if raw.count(insert_before) != 1:
        raise RuntimeError("Expected bilingual insertion point was not unique.")
    return raw.replace(insert_before, block + insert_before, 1)


def product_cards(character, records, entries_by_code):
    rows = diversified_records([x for x in records if x["character"] == character])
    cards = []
    for item in rows:
        entry = entries_by_code[item["code"]]
        cards.append(
            '<a href="' + E(e.page_url(entry)) + '"><img src="' + E(item["images"][0])
            + '" alt="' + E(entry["titleEn"]) + '" loading="lazy" decoding="async"><span>'
            + E(entry["titleEn"]) + "</span></a>"
        )
    return "".join(cards), rows


def character_label(character):
    return e.CHARACTER_EN.get(character, character.replace("-", " ").title())


def render_character_directory(characters, character_rows, entries_by_code):
    cards = []
    for character in characters:
        rows = character_rows[character]
        if not rows:
            raise RuntimeError("A selected character has no English product details: " + character)
        item = rows[0]
        entry = entries_by_code[item["code"]]
        cards.append(
            '<a href="' + E(character_english_url(character)) + '"><img src="'
            + E(item["images"][0]) + '" alt="' + E(character_label(character))
            + '" loading="lazy" decoding="async"><span>' + E(character_label(character))
            + " product details</span></a>"
        )
    return (
        DIRECTORY_MARK + '<style>' + LANGUAGE_LINK_CSS + '</style>'
        '<section lang="en"><h2>Browse English product details by character</h2>'
        '<div class="sf-bilingual-grid">' + "".join(cards) + '</div>'
        '<p class="sf-bilingual-note">Choose a character to explore product pages with photos, '
        'size and material details confirmed from Japanese retailer listings.</p>'
        '<p><a href="/en/product-details/">Browse all English product details →</a></p></section>'
    )


def render_character_guide(character, rows, records, entries_by_code):
    char_name = character_label(character)
    cards, selected = product_cards(character, records, entries_by_code)
    if len(selected) < 6:
        raise RuntimeError("A selected character guide has too few products: " + character)
    ja_page = c.CHARACTERS[character]
    return (
        GUIDE_MARK + '<style>' + LANGUAGE_LINK_CSS + '</style>'
        '<section lang="en"><p class="sf-bilingual-note">Unofficial Sanrio fan site. '
        'Product details are summarized from Japanese retailer listings; prices, stock, '
        'shipping and available variations may change.</p>'
        '<p><a href="/en/characters/">All English character guides</a> · '
        '<a href="/' + E(ja_page[1]) + '/">View ' + E(ja_page[2]) + ' products in Japanese</a></p>'
        '<h2>' + E(char_name) + ' product details</h2>'
        '<div class="sf-bilingual-grid">' + cards + '</div>'
        '<p>Browse selected ' + E(char_name) + ' products with photos and information such as '
        'size and material. Each product page includes the original Japanese product name '
        'and a link to its Japanese details.</p>'
        '<p><a href="/en/product-details/">See all English product details →</a></p></section>'
    )


def render_hub_nav(characters, character_rows, entries_by_code):
    cards = []
    for character in characters:
        item = character_rows[character][0]
        entry = entries_by_code[item["code"]]
        cards.append(
            '<a href="' + E(character_english_url(character)) + '"><img src="'
            + E(item["images"][0]) + '" alt="' + E(character_label(character))
            + '" loading="lazy" decoding="async"><span>' + E(character_label(character))
            + '</span></a>'
        )
    return (
        HUB_NAV_START + '<style>' + LANGUAGE_LINK_CSS + '</style>'
        '<section lang="en"><h2>Browse by character</h2><div class="sf-bilingual-grid">'
        + "".join(cards) + '</div><p><a href="/en/characters/">View all character guides →</a></p></section>'
        + HUB_NAV_END
    )


def english_detail_link(entry):
    return (
        '<section class="sf-bilingual-language-link" lang="ja"><p><a href="'
        + E(e.page_url(entry)) + '">この商品詳細を英語で見る →</a></p></section>'
    )


def english_character_link(character):
    return (
        '<section class="sf-bilingual-character-link" lang="en"><p><a href="'
        + E(character_english_url(character)) + '">More ' + E(character_label(character))
        + ' product details in English →</a></p></section>'
    )


def rest_page(wp, page_id):
    return wp.call(
        "/wp/v2/pages/" + str(page_id)
        + "?context=edit&_fields=id,slug,parent,status,content,link"
    )


def section_count_without_managed_block(raw, start, end):
    if (start in raw) != (end in raw):
        raise RuntimeError("A bilingual content marker is incomplete.")
    if start in raw:
        if raw.count(start) != 1 or raw.count(end) != 1:
            raise RuntimeError("Bilingual content marker is duplicated.")
        raw = re.sub(re.escape(start) + r".*?" + re.escape(end), "", raw, count=1, flags=re.S)
    return raw.count("</section>")


def preflight_detail_pair(wp, item, entry):
    ja_page = rest_page(wp, item["pageId"])
    en_page = rest_page(wp, entry["pageId"])
    if ja_page.get("slug") != d.slug(item["code"]) or en_page.get("slug") != entry["pageSlug"]:
        raise RuntimeError("Product detail page identity changed: " + item["code"])
    if ja_page.get("status") != "publish" or en_page.get("status") != "publish":
        raise RuntimeError("A paired product detail page is not published: " + item["code"])
    ja_raw = ja_page["content"]["raw"]
    en_raw = en_page["content"]["raw"]
    if d.MARK not in ja_raw or e.PAGE_MARK not in en_raw:
        raise RuntimeError("Refusing to edit an unmanaged product detail pair: " + item["code"])
    ja_sections = section_count_without_managed_block(ja_raw, JA_PAIR_START, JA_PAIR_END)
    en_sections = section_count_without_managed_block(en_raw, EN_GUIDE_START, EN_GUIDE_END)
    if ja_sections != 1 or en_sections != 1:
        raise RuntimeError("Product detail section boundary changed: " + item["code"])
    if 'href="' + E(item["url"]) + '"' not in en_raw:
        raise RuntimeError("English product page lost its existing Japanese product link: " + item["code"])
    return ja_page, en_page


def preflight_character_page(wp, character):
    page_id, slug, _ = c.CHARACTERS[character]
    page = rest_page(wp, page_id)
    if page.get("slug") != slug or page.get("status") != "publish" or not page["content"]["raw"].strip():
        raise RuntimeError("Japanese character page identity changed: " + slug)
    return page


def find_child_by_slug(wp, slug, parent_id):
    rows = e.pages_by_slug(wp, slug)
    return next((row for row in rows if int(row.get("parent", 0)) == int(parent_id)), None)


def managed_page_status(existing_page):
    return (existing_page or {}).get("status", "draft")


def publish_managed_page(wp, page):
    if page.get("status") == "publish":
        return page
    saved = wp.call("/wp/v2/pages/" + str(page["id"]), {"status": "publish"})
    if saved.get("status") != "publish" or saved.get("slug") != page.get("slug"):
        raise RuntimeError("Managed English guide did not publish: " + str(page.get("slug")))
    return saved


def update_japanese_character_page(wp, character):
    page_id, slug, _ = c.CHARACTERS[character]
    page = rest_page(wp, page_id)
    if page.get("slug") != slug or page.get("status") != "publish":
        raise RuntimeError("Japanese character page identity changed: " + slug)
    body = (
        '<section lang="ja"><h2>English product guide</h2>'
        '<p>このキャラクターの商品詳細を英語で確認できます。</p><p><a href="'
        + E(character_english_url(character)) + '">English product guide: '
        + E(character_label(character)) + ' →</a></p></section>'
    )
    raw = page["content"]["raw"]
    updated = managed_block(raw, JA_CHARACTER_START, JA_CHARACTER_END, body)
    if raw != updated:
        d.update_existing_content(wp, "/wp/v2/pages/" + str(page_id), raw, updated)
    saved = rest_page(wp, page_id)
    if saved["content"]["raw"] != updated:
        raise RuntimeError("Japanese character page link was not saved: " + slug)
    return saved, raw != updated


def public_verify(url, marker):
    body = e.public_body(url)
    if marker not in body:
        raise RuntimeError("Published bilingual marker is missing: " + url)
    if re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', body, re.I):
        raise RuntimeError("A bilingual page is noindex: " + url)
    parser = e.CanonicalParser()
    parser.feed(body)
    parser.close()
    canonical_urls = [urllib.parse.urljoin(url, value) for value in parser.urls]
    if not canonical_urls:
        raise RuntimeError("Canonical tag is missing: " + url)
    if any(value.rstrip("/") != url.rstrip("/") for value in canonical_urls):
        raise RuntimeError("Unexpected canonical URL: " + url)
    return len(canonical_urls)


def validate_cohorts(records, entries):
    if len(records) != 1000 or len(entries) != 1000:
        raise RuntimeError("Expected 1,000 Japanese and 1,000 English product details.")
    records_by_code = {item["code"]: item for item in records}
    entries_by_code = {item["code"]: item for item in entries}
    if len(records_by_code) != 1000 or len(entries_by_code) != 1000:
        raise RuntimeError("A product detail cohort contains duplicate item codes.")
    if set(records_by_code) != set(entries_by_code):
        raise RuntimeError("Japanese and English product cohorts are not exact pairs.")
    for code, item in records_by_code.items():
        entry = entries_by_code[code]
        if not item.get("pageId") or not item.get("url") or not entry.get("pageId") or not entry.get("url"):
            raise RuntimeError("A paired product page is missing its published WordPress identity: " + code)
        if item["url"].rstrip("/") != d.detail_url(code).rstrip("/"):
            raise RuntimeError("Unexpected Japanese product URL: " + str(item["url"]))
        if entry["url"].rstrip("/") != e.page_url(entry).rstrip("/"):
            raise RuntimeError("Unexpected English product URL: " + str(entry["url"]))
    return records_by_code, entries_by_code


def update_detail_pair(wp, item, entry, character, prefetched_pages=None):
    ja_page, en_page = prefetched_pages or preflight_detail_pair(wp, item, entry)
    ja_raw = ja_page["content"]["raw"]
    en_raw = en_page["content"]["raw"]
    ja_href = 'href="' + E(e.page_url(entry)) + '"'
    en_href = 'href="' + E(item["url"]) + '"'
    ja_updated = managed_block(
        ja_raw, JA_PAIR_START, JA_PAIR_END, english_detail_link(entry), "</section>"
    )
    en_updated = managed_block(
        en_raw, EN_GUIDE_START, EN_GUIDE_END, english_character_link(character), "</section>"
    )
    if ja_updated != ja_raw:
        d.update_existing_content(wp, "/wp/v2/pages/" + str(item["pageId"]), ja_raw, ja_updated)
    if en_updated != en_raw:
        d.update_existing_content(wp, "/wp/v2/pages/" + str(entry["pageId"]), en_raw, en_updated)
    ja_saved = rest_page(wp, item["pageId"])["content"]
    en_saved = rest_page(wp, entry["pageId"])["content"]
    for form in ("raw", "rendered"):
        if ja_href not in ja_saved[form]:
            raise RuntimeError("Japanese product page is missing its paired English link: " + item["code"])
        if en_href not in en_saved[form]:
            raise RuntimeError("English product page is missing its paired Japanese link: " + item["code"])
        if 'href="' + E(character_english_url(character)) + '"' not in en_saved[form]:
            raise RuntimeError("English product page is missing its character guide link: " + item["code"])
    return ja_updated != ja_raw, en_updated != en_raw


def report_checkpoint(done, total):
    if done == total or done % 25 == 0:
        print("BILINGUAL DETAILS CHECKPOINT", json.dumps({"done": done, "total": total}), flush=True)


def run(pilot_size=PILOT_SIZE):
    wp = c.WordPress()
    records, japanese_state_id = d.read_state(wp)
    english_state = e.read_english_state(wp)
    if not japanese_state_id or not english_state:
        raise RuntimeError("Managed Japanese or English product detail state is missing.")
    records_by_code, entries_by_code = validate_cohorts(records, english_state["entries"])
    characters, character_counts = choose_pilot_characters(records, limit=pilot_size)
    selected_codes = {
        code for code, item in records_by_code.items() if item["character"] in characters
    }
    if not selected_codes:
        raise RuntimeError("No paired products matched the selected characters.")
    rows_by_character = {
        character: [item for item in records if item["character"] == character]
        for character in characters
    }

    landing, _ = e.managed_directory(wp)
    directory_existing = find_child_by_slug(wp, "characters", landing["id"])
    if directory_existing and DIRECTORY_MARK not in directory_existing["content"]["raw"]:
        raise RuntimeError("Refusing to overwrite an unmanaged /en/characters/ page.")
    directory_parent_id = directory_existing["id"] if directory_existing else None
    existing_guides = {}
    if directory_parent_id:
        for character in characters:
            row = find_child_by_slug(wp, character_english_slug(character), directory_parent_id)
            if row and GUIDE_MARK not in row["content"]["raw"]:
                raise RuntimeError("Refusing to overwrite an unmanaged English character page: " + character)
            existing_guides[character] = row

    # Complete every identity and content-boundary check before the first WordPress write.
    for character in characters:
        preflight_character_page(wp, character)
    targets = [
        (records_by_code[code], entries_by_code[code])
        for code in records_by_code
        if code in selected_codes
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        pair_pages = list(pool.map(lambda pair: preflight_detail_pair(wp, *pair), targets))

    hub_page = rest_page(wp, e.managed_directory(wp)[1]["id"])
    if e.HUB_MARK not in hub_page["content"]["raw"] or hub_page["content"]["raw"].count('<div class="sf-en-product-grid">') != 1:
        raise RuntimeError("English product directory boundary changed.")

    directory_status = directory_existing.get("status", "draft") if directory_existing else "draft"
    directory_body = render_character_directory(characters, rows_by_character, entries_by_code)
    directory = e.get_or_save_page(
        wp, "characters", landing["id"], DIRECTORY_MARK,
        "Sanrio Character Product Guides in English | Sanrio fan info JP",
        directory_body,
        "Browse selected Sanrio character product details in English, with links to Japanese product information.",
        directory_status,
    )
    if int(directory.get("parent", 0)) != int(landing["id"]):
        raise RuntimeError("English character directory is outside the /en/ section.")

    guide_pages = {}
    for character in characters:
        guide_status = managed_page_status(existing_guides.get(character))
        page = e.get_or_save_page(
            wp, character_english_slug(character), directory["id"], GUIDE_MARK,
            character_label(character) + " Sanrio Products | Sanrio fan info JP",
            render_character_guide(character, rows_by_character[character], records, entries_by_code),
            "Photos and product details for selected " + character_label(character) + " goods, with Japanese source information.",
            guide_status,
        )
        guide_pages[character] = page

    # Publish the parent first; WordPress returns preview URLs for draft children.
    directory = publish_managed_page(wp, directory)
    expected_directory_url = SITE + "/en/characters/"
    if directory.get("link", "").rstrip("/") != expected_directory_url.rstrip("/"):
        raise RuntimeError("Unexpected English character directory URL: " + str(directory.get("link")))

    # Make every guide live before adding public links that point to it.
    published_guides = {}
    for character in characters:
        published_guides[character] = publish_managed_page(wp, guide_pages[character])
        expected_url = character_english_url(character)
        if published_guides[character].get("link", "").rstrip("/") != expected_url.rstrip("/"):
            raise RuntimeError("Unexpected English character guide URL: " + str(published_guides[character].get("link")))

    changed_character_pages = 0
    japanese_character_pages = {}
    for character in characters:
        page, changed = update_japanese_character_page(wp, character)
        japanese_character_pages[character] = page
        changed_character_pages += int(changed)

    changed_japanese_details = 0
    changed_english_details = 0
    total = len(targets)
    for done, ((item, entry), (ja_page, en_page)) in enumerate(zip(targets, pair_pages), 1):
        ja_changed, en_changed = update_detail_pair(
            wp, item, entry, item["character"], prefetched_pages=(ja_page, en_page)
        )
        changed_japanese_details += int(ja_changed)
        changed_english_details += int(en_changed)
        report_checkpoint(done, total)

    hub = rest_page(wp, e.managed_directory(wp)[1]["id"])
    hub_raw = hub["content"]["raw"]
    nav = render_hub_nav(characters, rows_by_character, entries_by_code)
    hub_updated = managed_block(
        hub_raw, HUB_NAV_START, HUB_NAV_END, nav, '<div class="sf-en-product-grid">'
    )
    if hub_updated != hub_raw:
        d.update_existing_content(wp, "/wp/v2/pages/" + str(hub["id"]), hub_raw, hub_updated)
    hub_saved = rest_page(wp, hub["id"])
    if hub_saved["content"]["raw"] != hub_updated:
        raise RuntimeError("Character navigation was not saved to the English directory.")

    verification_targets = []
    for character in characters:
        verification_targets.append((published_guides[character]["link"], GUIDE_MARK))
        verification_targets.append((japanese_character_pages[character]["link"], JA_CHARACTER_START))
    verification_targets.append((directory["link"], DIRECTORY_MARK))
    verification_targets.append((hub_saved["link"], e.HUB_MARK))
    for item, entry in targets:
        verification_targets.extend(((item["url"], d.MARK), (entry["url"], e.PAGE_MARK)))
    canonical_counts = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for count in pool.map(lambda target: public_verify(*target), verification_targets):
            canonical_counts.append(count)

    googlebot, sitemap_urls, sitemaps_checked = e.sitemap_urls()
    missing_sitemap = [
        url for url, marker in verification_targets
        if url.rstrip("/") not in {item.rstrip("/") for item in sitemap_urls}
    ]
    if missing_sitemap:
        time.sleep(10)
        googlebot, sitemap_urls, sitemaps_checked = e.sitemap_urls()
        missing_sitemap = [
            url for url, marker in verification_targets
            if url.rstrip("/") not in {item.rstrip("/") for item in sitemap_urls}
        ]
    if missing_sitemap:
        raise RuntimeError("Bilingual pages are missing from the published sitemap: " + str(len(missing_sitemap)))
    blocked = [url for url, marker in verification_targets if not googlebot.can_fetch("Googlebot", url)]
    if blocked:
        raise RuntimeError("Googlebot is blocked from %d bilingual pages." % len(blocked))

    report = {
        "japaneseProductDetails": len(records),
        "englishProductDetails": len(english_state["entries"]),
        "pilotCharacters": [
            {"key": key, "englishName": character_label(key), "pairedProducts": character_counts[key]}
            for key in characters
        ],
        "englishCharacterDirectory": directory["link"],
        "englishCharacterGuides": {key: published_guides[key]["link"] for key in characters},
        "japaneseCharacterPagesUpdated": changed_character_pages,
        "japaneseDetailPagesUpdated": changed_japanese_details,
        "englishDetailPagesUpdated": changed_english_details,
        "pairedProductsChecked": total,
        "publicPagesVerified": len(verification_targets),
        "canonicalTagsObserved": sum(canonical_counts),
        "pagesWithDuplicateCanonicalTags": sum(1 for count in canonical_counts if count > 1),
        "googlebotAllowed": True,
        "sitemapPagesFound": len(sitemap_urls),
        "sitemapsChecked": sitemaps_checked,
    }
    Path("bilingual-product-discovery-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print("BILINGUAL PRODUCT DISCOVERY COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot-characters", type=int, choices=(3,), default=PILOT_SIZE)
    args = parser.parse_args()
    run(args.pilot_characters)


if __name__ == "__main__":
    main()
