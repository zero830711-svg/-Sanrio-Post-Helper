"""Link reviewed product guides from their dedicated character pages through WP REST."""
import argparse
import base64
import html
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://sanrio-fan.site"
START = "<!-- sf-character-product-guides:v1 -->"
END = "<!-- /sf-character-product-guides:v1 -->"
CHARACTERS = {
    "gudetama-goods": "ぐでたま",
    "wish-me-mell-goods": "ウィッシュミーメル",
    "my-sweet-piano-goods": "マイスウィートピアノ",
    "jochum-goods": "JOCHUM",
    "kerokerokeroppi-goods": "けろけろけろっぴ",
    "usahana-goods": "ウサハナ",
    "cogimyun-goods": "こぎみゅん",
    "bad-badtz-maru-goods": "バッドばつ丸",
    "ahiru-no-pekkle-goods": "あひるのペックル",
    "tuxedo-sam-goods": "タキシードサム",
    "character-little-twin-stars": "リトルツインスターズ",
    "character-hangyodon": "ハンギョドン",
    "character-hellokitty": "ハローキティ",
    "character-pochacco": "ポチャッコ",
    "character-pompompurin": "ポムポムプリン",
    "character-mymelody": "マイメロディ",
    "character-kuromi": "クロミ",
    "character-cinnamoroll": "シナモロール",
}



class WordPress:
    def __init__(self):
        user, password = os.getenv("SANRIO_WP_USER", ""), os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("WordPress Actions secrets are not configured.")
        self.auth = "Basic " + base64.b64encode((user + ":" + password).encode()).decode()
        self.opener = request.build_opener()

    def call(self, path, body=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        req = request.Request(SITE + "/wp-json" + path,
            data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
            headers={"Authorization": self.auth, "User-Agent": "SanrioCharacterPageLinks/1.0",
                     **({"Content-Type": "application/json"} if body is not None else {})})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            raise RuntimeError("WordPress REST returned HTTP " + str(exc.code) + " for " + path.split("?")[0] + ": " + detail) from None


def plain(value):
    if isinstance(value, dict):
        value = value.get("raw", value.get("rendered", ""))
    return html.unescape(re.sub(r"<[^>]+>", " ", str(value))).strip()


def article_section(name, posts):
    cards = []
    for post in posts:
        title = plain(post.get("title", ""))
        excerpt = plain(post.get("excerpt", ""))
        link = post.get("link", "")
        if not link.startswith(SITE + "/"):
            raise RuntimeError("Unexpected article URL.")
        cards.append(
            '<article class="sf-character-product-card" style="box-sizing:border-box;min-width:0;border:1px solid #eadde5;border-radius:18px;background:#fff;padding:20px;display:flex;flex-direction:column;gap:12px">'
            '<span style="align-self:flex-start;border-radius:999px;background:#fff0f5;padding:5px 10px;color:#805d76;font-size:.85em">商品ガイド</span>'
            '<h3 style="margin:0;font-size:1.1em;line-height:1.6">' + html.escape(title) + '</h3>'
            + ('<p style="margin:0;color:#726d7b;line-height:1.8">' + html.escape(excerpt) + '</p>' if excerpt else '')
            + '<a href="' + html.escape(link, quote=True) + '" style="margin-top:auto;display:block;text-align:center;border-radius:12px;background:#f3edf3;padding:13px;color:#403547;font-weight:700;text-decoration:none">仕様と購入先を見る →</a></article>'
        )
    return (
        START + '<section class="sf-character-product-guides" aria-labelledby="sf-character-product-guides-title">'
        '<h2 id="sf-character-product-guides-title">' + html.escape(name) + 'の商品ガイド</h2>'
        '<p>掲載商品ごとの仕様や、Amazon・楽天市場で探すときの確認点をまとめています。</p>'
        '<div class="sf-character-product-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px">'
        + "".join(cards) + '</div></section>' + END
    )


def insertion_point(raw):
    # Put guides immediately after the first introductory paragraph. If the page
    # has no paragraph, place them before its first section heading.
    intro = re.search(r"</p\s*>", raw, re.I)
    if intro:
        return intro.end(), "after-intro-paragraph"
    heading = re.search(r"<h2\b[^>]*>", raw, re.I)
    if heading:
        return heading.start(), "before-first-content-heading"
    block_heading = re.search(r"<!--\s*wp:heading\b", raw, re.I)
    if block_heading:
        return block_heading.start(), "before-first-heading-block"
    return None, "no-safe-intro-anchor"

def update_content(raw, section):
    # Remove any previous copy first, then insert the single canonical section
    # at the new position. This also relocates cards already appended to the page.
    clean = raw
    if START in clean and END in clean:
        begin = clean.index(START)
        finish = clean.index(END, begin) + len(END)
        clean = clean[:begin] + clean[finish:]
    point, kind = insertion_point(clean)
    if point is None:
        raise RuntimeError("Could not find a safe introductory insertion point.")
    return clean[:point] + "\n" + section + "\n" + clean[point:], kind

def list_pages(wp):
    pages, page_no = [], 1
    while page_no <= 10:
        batch = wp.call("/wp/v2/pages?" + parse.urlencode({
            "per_page": 100, "page": page_no,
            "_fields": "id,slug,status,title,content"}))
        if not batch:
            break
        pages.extend(batch)
        if len(batch) < 100:
            break
        page_no += 1
    return pages


def list_tags(wp):
    tags, page_no = {}, 1
    while page_no <= 10:
        batch = wp.call("/wp/v2/tags?" + parse.urlencode({
            "per_page": 100, "page": page_no, "_fields": "id,slug,name"}))
        if not batch:
            break
        tags.update({tag["id"]: tag for tag in batch})
        if len(batch) < 100:
            break
        page_no += 1
    return tags


def list_product_posts(wp, category_id):
    posts, page_no = [], 1
    while page_no <= 10:
        batch = wp.call("/wp/v2/posts?" + parse.urlencode({
            "context": "edit", "status": "publish", "categories": category_id,
            "per_page": 100, "page": page_no,
            "_fields": "id,slug,status,title,link,excerpt,tags"}))
        if not batch:
            break
        posts.extend(batch)
        if len(batch) < 100:
            break
        page_no += 1
    return posts


def matching_posts(character, posts, tags):
    matches = []
    for post in posts:
        tag_names = [tags[tag_id]["name"] for tag_id in post.get("tags", []) if tag_id in tags]
        title = plain(post.get("title", ""))
        if character in tag_names or (not tag_names and character in title):
            matches.append(post)
    return matches


def run(mode):
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    pages = list_pages(wp)
    tags = list_tags(wp)
    categories = wp.call("/wp/v2/categories?" + parse.urlencode({
        "slug": "shopping-products", "_fields": "id"}))
    if not categories:
        raise RuntimeError("The shopping-products category is missing.")
    posts = list_product_posts(wp, categories[0]["id"])
    page_by_slug = {page["slug"]: page for page in pages}
    if mode == "audit":
        relevant_pages = [{
            "slug": page["slug"], "title": plain(page.get("title", "")),
            "character": CHARACTERS[page["slug"]],
            "related_published_guides": len(matching_posts(CHARACTERS[page["slug"]], posts, tags)),
            "has_guide_marker": START in page.get("content", {}).get("rendered", "")
        } for page in pages if page["slug"] in CHARACTERS]
        print("CHARACTER_PAGE_AUDIT:", json.dumps(relevant_pages, ensure_ascii=False))
        print("AUDIT_TOTALS:", json.dumps({
            "published_pages": len(pages), "dedicated_character_pages": len(relevant_pages),
            "shopping_products": len(posts),
            "character_pages_with_guides": sum(row["related_published_guides"] > 0 for row in relevant_pages)
        }, ensure_ascii=False))
        return

    plans = []
    for slug, character in CHARACTERS.items():
        page = page_by_slug.get(slug)
        if not page or page.get("status") != "publish":
            print("PAGE_MISSING:", slug)
            continue
        related = matching_posts(character, posts, tags)
        if not related:
            print("NO_MATCHING_GUIDES:", slug, "character:", character)
            continue
        editable = wp.call("/wp/v2/pages/" + str(page["id"]) + "?context=edit&_fields=id,slug,status,content")
        raw = editable.get("content", {}).get("raw", "")
        if editable.get("slug") != slug or editable.get("status") != "publish" or not isinstance(raw, str):
            raise RuntimeError("Could not verify editable character page " + slug)
        section = article_section(character, related)
        updated, anchor = update_content(raw, section)
        plans.append((editable, related, updated, anchor))
        print("PAGE_PLAN:", slug, "character:", character, "guides:", len(related),
              "anchor:", anchor, "existing_marker:", START in raw)
    if len(plans) != len(CHARACTERS):
        raise RuntimeError("Preflight did not find a safe guide plan for every dedicated character page.")
    if mode == "check":
        print("CHECK_TOTALS:", json.dumps({
            "pages_to_update": len(plans),
            "guide_cards": sum(len(related) for _, related, _, _ in plans)
        }, ensure_ascii=False))
        return
    if mode != "apply":
        raise RuntimeError("Unsupported execution mode.")
    # Every page and related article is validated before the first write.
    for page, related, updated, anchor in plans:
        saved = wp.call("/wp/v2/pages/" + str(page["id"]), {"content": updated})
        if saved.get("id") != page["id"]:
            raise RuntimeError("Page update returned an unexpected identity.")
        verify = wp.call("/wp/v2/pages/" + str(page["id"]) + "?context=edit&_fields=id,content")
        verify_raw = verify.get("content", {}).get("raw", "")
        if START not in verify_raw or END not in verify_raw or any(
                post["link"] not in verify_raw for post in related):
            raise RuntimeError("Page content verification failed for " + page["slug"])
        print("UPDATED:", page["slug"], "cards:", len(related), "anchor:", anchor)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "apply", "audit"], default="check")
    args = parser.parse_args()
    try:
        run(args.mode)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Operation failed; check WordPress REST configuration.", file=sys.stderr)
        sys.exit(1)
