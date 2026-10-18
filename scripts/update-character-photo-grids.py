"""Apply the verified photo-first product grid to the seven other guide pages."""
import base64
import html
import json
import os
import re
import sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
START = "<!-- sf-character-product-guides:v1 -->"
END = "<!-- /sf-character-product-guides:v1 -->"
PAGES = {
    797: "character-kuromi",
    798: "character-mymelody",
    799: "character-pompompurin",
    800: "character-pochacco",
    801: "character-hellokitty",
    802: "character-hangyodon",
    803: "character-little-twin-stars",
}
OLD_SUBTITLE = "ぬいぐるみから毎日使う小物まで。用途を選んで、Amazon・楽天市場の検索結果を見比べられます。"


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
        headers = {"Authorization": self.auth, "User-Agent": "SanrioCharacterPhotoGrid/1.0"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(
            SITE + "/wp-json" + path,
            data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None,
            headers=headers,
        )
        try:
            with request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s for %s." % (exc.code, path.split("?")[0])) from None


def text_from(markup):
    return html.unescape(re.sub(r"<[^>]+>", "", markup)).strip()


def first_attribute(tag, name):
    match = re.search(r"\b" + re.escape(name) + r"\s*=\s*([\"'])(.*?)\1", tag, flags=re.S | re.I)
    return html.unescape(match.group(2)) if match else ""


def image_for_post(wp, slug):
    query = parse.urlencode({"slug": slug, "_fields": "slug,title,content,featured_media"})
    posts = wp.call("/wp/v2/posts?" + query)
    if not isinstance(posts, list) or len(posts) != 1 or posts[0].get("slug") != slug:
        raise RuntimeError("Could not uniquely resolve the existing article: " + slug)
    post = posts[0]
    content = post.get("content", {}).get("rendered", "")
    for tag in re.findall(r"<img\b[^>]*>", content, flags=re.I | re.S):
        src = first_attribute(tag, "src")
        if src.startswith(SITE + "/wp-content/uploads/"):
            alt = first_attribute(tag, "alt")
            return src, alt or text_from(post.get("title", {}).get("rendered", ""))
    media_id = post.get("featured_media")
    if media_id:
        media = wp.call("/wp/v2/media/%d?_fields=source_url,alt_text" % int(media_id))
        src = media.get("source_url", "")
        if src.startswith(SITE + "/wp-content/uploads/"):
            title = text_from(post.get("title", {}).get("rendered", ""))
            return src, media.get("alt_text") or title
    raise RuntimeError("No WordPress-hosted product photo exists for article: " + slug)


def build_grid(wp, old_section, character_name):
    articles = re.findall(r"<article\b.*?</article>", old_section, flags=re.S)
    if not articles:
        raise RuntimeError("No existing product article cards were found for " + character_name)
    cards = []
    for article in articles:
        title_match = re.search(r"<h3\b[^>]*>(.*?)</h3>", article, flags=re.S)
        link_match = re.search(r"<a\b[^>]*href\s*=\s*([\"'])(.*?)\1", article, flags=re.S | re.I)
        if not title_match or not link_match:
            raise RuntimeError("An existing card is missing its title or article link for " + character_name)
        title = text_from(title_match.group(1))
        href = html.unescape(link_match.group(2))
        if not href.startswith(SITE + "/"):
            raise RuntimeError("An existing card links outside the Sanrio site for " + character_name)
        # Keep the URL-encoded WordPress slug; the REST `slug` filter uses this form for Japanese slugs.
        path = parse.urlparse(href).path.strip("/")
        slug = path.rsplit("/", 1)[-1]
        image_url, alt = image_for_post(wp, slug)
        cards.append(
            '<article class="sf-character-photo-card" style="min-width:0;overflow:hidden;border:1px solid #eadde5;border-radius:16px;background:#fff">'
            '<a href="' + html.escape(href, quote=True) + '" style="display:flex;height:100%;flex-direction:column;color:#403547;text-decoration:none">'
            '<span style="display:grid;place-items:center;aspect-ratio:1/1;padding:6px;background:#fff">'
            '<img src="' + html.escape(image_url, quote=True) + '" alt="' + html.escape(alt, quote=True) + '" loading="lazy" decoding="async" '
            'style="display:block;width:100%;height:100%;object-fit:contain">'
            '</span><span style="display:flex;flex:1;flex-direction:column;gap:8px;padding:10px">'
            '<strong style="display:-webkit-box;overflow:hidden;font-size:clamp(12px,3.2vw,15px);line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow-wrap:anywhere">'
            + html.escape(title) +
            '</strong><span style="margin-top:auto;color:#805d76;font-size:12px;font-weight:700">商品ガイドを見る →</span>'
            '</span></a></article>'
        )
    heading = re.search(r"<h2\b[^>]*>.*?</h2>", old_section, flags=re.S)
    intro = re.search(r"<p\b[^>]*>.*?</p>", old_section[heading.end():] if heading else "", flags=re.S)
    heading_html = heading.group(0) if heading else '<h2 id="sf-character-product-guides-title">' + html.escape(character_name) + 'の商品ガイド</h2>'
    intro_html = intro.group(0) if intro else '<p>掲載商品の写真と記事を見比べて、気になるグッズを探せます。</p>'
    return (
        START + '<section class="sf-character-product-guides" aria-labelledby="sf-character-product-guides-title">'
        + heading_html + intro_html
        + '<div class="sf-character-photo-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,2vw,14px)">'
        + "".join(cards) + '</div></section>' + END,
        len(cards),
    )


def compact_top(content, character_name):
    """Reduce the guide intro height so products appear sooner on phones."""
    def replace_opening(pattern, style, label):
        nonlocal content
        found = False

        def apply(match):
            nonlocal found
            found = True
            opening = re.sub(r'\sstyle="[^"]*"', "", match.group(0))
            return opening[:-1] + ' style="' + style + '">'

        content = re.sub(pattern, apply, content, count=1)
        if not found:
            raise RuntimeError("Could not find " + character_name + " " + label + " element")

    replace_opening(r'<div class="sf-guide"[^>]*>', "padding-top:12px", "page wrapper")
    replace_opening(r'<a class="sf-back"[^>]*>', "display:inline-block;margin:0 0 6px", "back link")

    def compact_hero(match):
        original = match.group(0)
        color_match = re.search(r"--char\s*:\s*([^;\"']+)", original)
        color = color_match.group(1).strip() if color_match else "#d7c6ec"
        return '<header class="sf-hero" style="--char:' + html.escape(color, quote=True) + ';padding:16px 20px 14px;margin-bottom:8px">'

    content, count = re.subn(r'<header class="sf-hero"[^>]*>', compact_hero, content, count=1)
    if not count:
        raise RuntimeError("Could not find " + character_name + " hero")
    replace_opening(r'<span class="sf-eyebrow"[^>]*>', "font-size:10px;line-height:1.2;letter-spacing:.12em", "eyebrow")
    replace_opening(r'<h1 class="sf-title"[^>]*>', "font-size:clamp(25px,7vw,34px);line-height:1.25;margin:4px 0 8px", "title")
    replace_opening(r'<p class="sf-sub"[^>]*>', "font-size:14px;line-height:1.5;margin:4px 0 8px", "subtitle")
    content = content.replace(OLD_SUBTITLE, "用途から選んで、Amazon・楽天市場の商品を探せます。", 1)
    return content


def main():
    wp = WordPress()
    prepared = []
    skipped = []
    for page_id, expected_slug in PAGES.items():
        page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % page_id)
        if page.get("id") != page_id or page.get("slug") != expected_slug:
            raise RuntimeError("Page identity check failed for page " + str(page_id))
        content = page.get("content", {}).get("raw")
        if not isinstance(content, str):
            raise RuntimeError("Could not read editable content for " + expected_slug)
        marked = re.search(re.escape(START) + r".*?" + re.escape(END), content, flags=re.S)
        if not marked:
            skipped.append(expected_slug + " (no managed product-guide section)")
            continue
        h1 = re.search(r'<h1\b[^>]*>(.*?)</h1>', content, flags=re.S)
        character_name = text_from(h1.group(1)).replace("のグッズを探そう", "") if h1 else expected_slug
        new_section, count = build_grid(wp, marked.group(0), character_name)
        new_content = content[:marked.start()] + new_section + content[marked.end():]
        new_content = compact_top(new_content, character_name)
        prepared.append((page_id, expected_slug, character_name, new_content, count))

    if not prepared:
        raise RuntimeError("No eligible character pages with verified photos were found.")

    # Every article and image is resolved before the first write, avoiding partial changes on data errors.
    for page_id, slug, character_name, content, count in prepared:
        wp.call("/wp/v2/pages/%d" % page_id, {"content": content})
        verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % page_id)
        raw = verify.get("content", {}).get("raw", "")
        section = re.search(re.escape(START) + r".*?" + re.escape(END), raw, flags=re.S)
        if verify.get("id") != page_id or verify.get("slug") != slug or not section:
            raise RuntimeError("WordPress did not retain the saved section for " + slug)
        saved = section.group(0)
        if saved.count('class="sf-character-photo-card"') != count or saved.count("<img ") != count:
            raise RuntimeError("Photo-card verification failed for " + slug)
        if "grid-template-columns:repeat(3,minmax(0,1fr))" not in saved:
            raise RuntimeError("Three-column grid verification failed for " + slug)
        print("Updated %s (%s): %d existing articles, %d verified photos, 3 columns." % (character_name, slug, count, count))
    for item in skipped:
        print("Skipped " + item)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
