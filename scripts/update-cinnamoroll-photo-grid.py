"""Build a photo-first, three-column product guide for the Cinnamoroll page only."""
import base64
import html
import json
import os
import re
import sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
PAGE_ID = 796
START = "<!-- sf-character-product-guides:v1 -->"
END = "<!-- /sf-character-product-guides:v1 -->"
IMAGES = {
    "goods-jan-4973307729003": (
        SITE + "/wp-content/uploads/2026/10/sanrio-4973307729003.jpg",
        "シナモロール ステンレスストローマグ 350mL",
    ),
    "goods-jan-4973307643958": (
        SITE + "/wp-content/uploads/2026/10/sanrio-4973307643958.jpg",
        "シナモロール 星空のベルト付き保冷剤",
    ),
    "ホイップる-サンリオキャラクターズ-スイーツパー": (
        SITE + "/wp-content/uploads/2026/09/95ccd2059b53ad931c9c5a12e3558db1.jpg",
        "ホイップる サンリオキャラクターズ スイーツパーティーセット",
    ),
}


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
            "User-Agent": "SanrioCinnamorollPhotoGrid/1.0",
        }
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
            raise RuntimeError("WordPress REST returned HTTP %s." % exc.code) from None


def text_from(tagged):
    return html.unescape(re.sub(r"<[^>]+>", "", tagged)).strip()


def build_grid(old_section):
    articles = re.findall(r"<article\b.*?</article>", old_section, flags=re.S)
    if len(articles) != 3:
        raise RuntimeError("Expected exactly the three existing Cinnamoroll guide cards.")
    cards = []
    for article in articles:
        title_match = re.search(r"<h3\b[^>]*>(.*?)</h3>", article, flags=re.S) or re.search(r"<strong\b[^>]*>(.*?)</strong>", article, flags=re.S)
        link_match = re.search(r"""<a\b[^>]*href=["']([^"']+)["']""", article, flags=re.S)
        if not title_match or not link_match:
            raise RuntimeError("A current product card is missing its title or article link.")
        title = text_from(title_match.group(1))
        href = html.unescape(link_match.group(1))
        path = parse.unquote(parse.urlparse(href).path).strip("/")
        slug = path.rsplit("/", 1)[-1]
        image_data = IMAGES.get(slug)
        if not image_data:
            raise RuntimeError("No verified product photo is mapped for " + slug)
        image_url, alt = image_data
        if not href.startswith(SITE + "/") or not image_url.startswith(SITE + "/wp-content/uploads/"):
            raise RuntimeError("A product card URL failed the local-site check.")
        cards.append(
            '<article class="sf-cinna-photo-card" style="min-width:0;overflow:hidden;border:1px solid #eadde5;border-radius:16px;background:#fff">'
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
    heading_html = heading.group(0) if heading else '<h2 id="sf-character-product-guides-title">シナモロールの商品ガイド</h2>'
    intro_html = intro.group(0) if intro else '<p>掲載商品の写真と記事を見比べて、気になるグッズを探せます。</p>'
    return (
        START + '<section class="sf-character-product-guides" aria-labelledby="sf-character-product-guides-title">'
        + heading_html + intro_html
        + '<div class="sf-cinna-photo-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,2vw,14px)">'
        + "".join(cards) + '</div></section>' + END
    )



def compact_top(content):
    """Tighten only the Cinnamoroll guide intro and product heading."""
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
            raise RuntimeError("Could not find the Cinnamoroll " + label + " element.")

    replace_opening(r'<div class="sf-guide"[^>]*>', "padding-top:12px", "page wrapper")
    replace_opening(r'<a class="sf-back"[^>]*>', "display:inline-block;margin:0 0 6px", "back link")
    replace_opening(r'<header class="sf-hero"[^>]*>', "--char:#bee6f5;padding:16px 20px 14px;margin-bottom:8px", "hero")
    replace_opening(r'<span class="sf-eyebrow"[^>]*>', "font-size:10px;line-height:1.2;letter-spacing:.12em", "eyebrow")
    replace_opening(r'<h1 class="sf-title"[^>]*>', "font-size:clamp(25px,7vw,34px);line-height:1.25;margin:4px 0 8px", "title")
    replace_opening(r'<p class="sf-sub"[^>]*>', "font-size:14px;line-height:1.5;margin:4px 0 8px", "subtitle")
    content = content.replace(
        "ぬいぐるみから毎日使う小物まで。用途を選んで、Amazon・楽天市場の検索結果を見比べられます。",
        "用途から選んで、Amazon・楽天市場の商品を探せます。",
        1,
    )
    start = content.find(START)
    end = content.find(END, start)
    if start < 0 or end < 0:
        raise RuntimeError("Could not find the Cinnamoroll product guide markers.")
    section = content[start:end + len(END)]

    def set_style_on_first(pattern, style, label):
        nonlocal section
        found = False

        def apply(match):
            nonlocal found
            found = True
            opening = re.sub(r'\sstyle="[^"]*"', "", match.group(0))
            return opening[:-1] + ' style="' + style + '">'

        section = re.sub(pattern, apply, section, count=1)
        if not found:
            raise RuntimeError("Could not find the product " + label + " element.")

    set_style_on_first(r"<h2\b[^>]*>", "margin:12px 0 6px;font-size:20px;line-height:1.35", "heading")
    set_style_on_first(r"<p\b[^>]*>", "font-size:14px;line-height:1.5;margin:4px 0 10px", "description")
    return content[:start] + section + content[end + len(END):]


def main():
    wp = WordPress()
    page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID)
    if page.get("id") != PAGE_ID or page.get("slug") != "character-cinnamoroll":
        raise RuntimeError("The target page is not the verified Cinnamoroll page.")
    content = page.get("content", {}).get("raw")
    if not isinstance(content, str):
        raise RuntimeError("Could not read the editable page content.")
    match = re.search(re.escape(START) + r".*?" + re.escape(END), content, flags=re.S)
    if not match:
        raise RuntimeError("The existing product guide section markers were not found.")
    new_section = build_grid(match.group(0))
    updated_content = compact_top(content[:match.start()] + new_section + content[match.end():])
    wp.call("/wp/v2/pages/%d" % PAGE_ID, {"content": updated_content})
    verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID)
    raw = verify.get("content", {}).get("raw", "")
    verified_section = re.search(re.escape(START) + r".*?" + re.escape(END), raw, flags=re.S)
    if verify.get("id") != PAGE_ID or verify.get("slug") != "character-cinnamoroll" or not verified_section:
        raise RuntimeError("WordPress did not retain the updated Cinnamoroll guide section.")
    section = verified_section.group(0)
    if section.count('class="sf-cinna-photo-card"') != 3 or section.count("<img ") != 3:
        raise RuntimeError("The saved section does not contain three photo cards.")
    print("Updated and verified only Cinnamoroll page 796: 3 cards, 3 verified local product photos.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
