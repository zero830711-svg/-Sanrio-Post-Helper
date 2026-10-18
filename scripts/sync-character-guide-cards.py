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
TARGETS = {
    "gudetama-goods": {"name": "ぐでたま", "products": ["gudetama-calendar-2027-guide", "gudetama-my-number-card-case-guide"]},
    "wish-me-mell-goods": {"name": "ウィッシュミーメル", "products": ["wish-me-mell-cheer-mascot-holder-guide"]},
    "my-sweet-piano-goods": {"name": "マイスウィートピアノ", "products": ["my-sweet-piano-white-frill-mascot-holder-guide"]},
    "jochum-goods": {"name": "JOCHUM", "products": ["jochum-candy-drawstring-pouch-guide"]},
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

def run(mode):
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    if mode == "audit":
        print("AUDIT_STEP: pages")
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
        print("AUDIT_PAGES:", len(pages))
        print("AUDIT_STEP: tags")
        tags = {}
        tag_no = 1
        while tag_no <= 10:
            batch = wp.call("/wp/v2/tags?" + parse.urlencode({
                "per_page": 100, "page": tag_no, "_fields": "id,slug,name"}))
            if not batch:
                break
            tags.update({tag["id"]: {"slug": tag["slug"], "name": tag["name"]} for tag in batch})
            if len(batch) < 100:
                break
            tag_no += 1
        print("AUDIT_TAGS:", len(tags))
        print("AUDIT_STEP: product-posts")
        cats = wp.call("/wp/v2/categories?" + parse.urlencode({"slug": "shopping-products", "_fields": "id"}))
        products, post_no = [], 1
        if cats:
            while post_no <= 10:
                batch = wp.call("/wp/v2/posts?" + parse.urlencode({
                    "context": "edit", "status": "publish", "categories": cats[0]["id"],
                    "per_page": 100, "page": post_no, "_fields": "id,slug,status,title,tags"}))
                if not batch:
                    break
                products.extend(batch)
                if len(batch) < 100:
                    break
                post_no += 1
        page_rows = [{
            "id": page["id"], "slug": page["slug"], "title": plain(page.get("title", "")),
            "guide_marker": START in (page.get("content", {}).get("raw", page.get("content", {}).get("rendered", "")))
        } for page in pages]
        product_rows = [{
            "slug": post["slug"], "title": plain(post.get("title", "")),
            "tags": [tags[tag_id] for tag_id in post.get("tags", []) if tag_id in tags]
        } for post in products]
        print("PAGE_AUDIT:", json.dumps(page_rows, ensure_ascii=False))
        print("PRODUCT_TAG_AUDIT:", json.dumps(product_rows, ensure_ascii=False))
        print("AUDIT_TOTALS:", json.dumps({"pages": len(page_rows), "shopping_products": len(product_rows)}, ensure_ascii=False))
        return
    plans = []
    # Preflight every target before making any page changes.
    for page_slug, target in TARGETS.items():
        pages = wp.call("/wp/v2/pages?" + parse.urlencode({
            "slug": page_slug, "context": "edit", "_fields": "id,slug,status,content,title"}))
        if len(pages) != 1 or pages[0].get("slug") != page_slug or pages[0].get("status") != "publish":
            raise RuntimeError("Could not verify published character page " + page_slug)
        page = pages[0]
        posts = []
        for post_slug in target["products"]:
            rows = wp.call("/wp/v2/posts?" + parse.urlencode({
                "slug": post_slug, "context": "edit", "_fields": "id,slug,status,title,link,excerpt"}))
            if len(rows) != 1 or rows[0].get("status") != "publish":
                raise RuntimeError("Expected one published product guide " + post_slug)
            posts.append(rows[0])
        raw = page.get("content", {}).get("raw", "")
        if not isinstance(raw, str):
            raise RuntimeError("Could not read editable page content " + page_slug)
        section = article_section(target["name"], posts)
        updated, kind = update_content(raw, section)
        plans.append((page, target, posts, updated, kind))
        print("PAGE:", page_slug, "guides:", len(posts), "anchor:", kind, "marker:", START in raw)
    if mode == "check":
        # Report exact duplicate page copy/CTA labels before changing the legacy Cinnamoroll page.
        cinna = wp.call("/wp/v2/pages/796?context=edit&_fields=id,slug,content")
        if cinna.get("slug") != "character-cinnamoroll":
            raise RuntimeError("Cinnamoroll page identity verification failed.")
        visible = plain(cinna.get("content", {}).get("raw", ""))
        phrases = {
            "guide_intro": "シナモロールのサンリオグッズを、商品ガイドと通販検索から探せるページです。",
            "disclosure": "当サイトは非公式ファンサイトです。記事にアフィリエイト広告を含みます。",
            "amazon_cta": "Amazonでシナモロールを探す",
            "rakuten_cta": "楽天でシナモロールを探す",
            "all_goods_cta": "全商品一覧を見る",
        }
        print("CINNAMOROLL_DUPLICATE_COUNTS:", json.dumps(
            {key: visible.count(value) for key, value in phrases.items()}, ensure_ascii=False))
    if mode != "apply":
        return
    for page, target, posts, updated, kind in plans:
        saved = wp.call("/wp/v2/pages/" + str(page["id"]), {"content": updated})
        if saved.get("id") != page["id"]:
            raise RuntimeError("Page update returned an unexpected identity.")
        verify = wp.call("/wp/v2/pages/" + str(page["id"]) + "?context=edit&_fields=id,content")
        verify_raw = verify.get("content", {}).get("raw", "")
        if START not in verify_raw or END not in verify_raw or any(p["link"] not in verify_raw for p in posts):
            raise RuntimeError("Page content verification failed for " + page["slug"])
        print("UPDATED:", page["slug"], "cards:", len(posts))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "apply", "audit"], default="check")
    args = parser.parse_args()
    try:
        run(args.mode)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Operation failed; check WordPress REST configuration.", file=sys.stderr)
        sys.exit(1)
