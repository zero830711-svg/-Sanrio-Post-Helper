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
            raise RuntimeError("WordPress REST returned HTTP " + str(exc.code) + ".") from None


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
    # Place guide cards directly before the existing marketplace CTA section.
    for marker in ("購入先から探す", "Amazon・楽天市場で探す", "Amazonで関連商品を探す"):
        pos = raw.find(marker)
        if pos >= 0:
            heading = raw.rfind("<h2", 0, pos)
            if heading >= 0:
                return heading, "before-store-search-heading"
            return pos, "before-store-search-label"
    # Legacy character pages may use a section wrapper around the hero.
    for marker in ("CHARACTER GUIDE", "キャラクターガイド"):
        pos = raw.find(marker)
        if pos >= 0:
            close = raw.find("</section>", pos)
            if close >= 0:
                return close + len("</section>"), "hero-section"
    h1 = re.search(r"<h1\b[^>]*>.*?</h1>", raw, re.I | re.S)
    if h1:
        close = raw.find("</section>", h1.end())
        if close >= 0:
            return close + len("</section>"), "first-section-after-h1"
    return len(raw), "content-end"

def update_content(raw, section):
    if START in raw and END in raw:
        begin = raw.index(START)
        finish = raw.index(END, begin) + len(END)
        return raw[:begin] + section + raw[finish:]
    point, kind = insertion_point(raw)
    if point is None:
        raise RuntimeError("Could not find a safe hero-section insertion point.")
    return raw[:point] + "\n" + section + "\n" + raw[point:], kind


def run(mode):
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
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
        if START in raw and END in raw:
            point, kind = None, "existing-marker"
            updated = update_content(raw, section)
        else:
            point, kind = insertion_point(raw)
            if point is None:
                raise RuntimeError("Could not find a safe insertion point on " + page_slug)
            updated = raw[:point] + "\\n" + section + "\\n" + raw[point:]
        plans.append((page, target, posts, updated, kind))
        print("PAGE:", page_slug, "guides:", len(posts), "anchor:", kind, "marker:", START in raw)
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
    parser.add_argument("--mode", choices=["check", "apply"], default="check")
    args = parser.parse_args()
    try:
        run(args.mode)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Operation failed; check WordPress REST configuration.", file=sys.stderr)
        sys.exit(1)
