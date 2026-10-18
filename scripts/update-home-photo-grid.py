"""Make the home page compact and show its existing products as a three-column photo grid."""
import base64
import html
import json
import os
import re
import sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
PAGE_ID = 805
EXPECTED_SLUG = "shopping-home"
SECTION_TITLE = "新しく掲載したグッズ"
STYLE_START = '<style id="sf-home-photo-grid">'
STYLE_END = "</style>"


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
            "User-Agent": "SanrioHomePhotoGrid/1.0",
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
            raise RuntimeError(
                "WordPress REST returned HTTP %s for %s."
                % (exc.code, path.split("?")[0])
            ) from None


def first_attribute(tag, name):
    match = re.search(
        r"\b" + re.escape(name) + r"\s*=\s*([\"'])(.*?)\1",
        tag,
        flags=re.S | re.I,
    )
    return html.unescape(match.group(2)) if match else ""


def plain_text(markup):
    return html.unescape(re.sub(r"<[^>]+>", "", markup)).strip()


def article_for_slug(wp, slug):
    query = parse.urlencode({"slug": slug, "_fields": "id,slug,title,content,featured_media"})
    for post_type in ("posts", "pages"):
        items = wp.call("/wp/v2/%s?%s" % (post_type, query))
        if isinstance(items, list):
            exact = [item for item in items if item.get("slug") == slug]
            if len(exact) == 1:
                return exact[0]
    raise RuntimeError("Could not uniquely resolve the existing article: " + slug)


def photo_for_article(wp, slug):
    post = article_for_slug(wp, slug)
    content = post.get("content", {}).get("rendered", "")
    for tag in re.findall(r"<img\b[^>]*>", content, flags=re.I | re.S):
        for attr in ("src", "data-src", "data-lazy-src", "data-original"):
            src = first_attribute(tag, attr)
            if src.startswith(SITE + "/wp-content/uploads/"):
                alt = first_attribute(tag, "alt") or plain_text(
                    post.get("title", {}).get("rendered", "")
                )
                return src, alt
    media_id = post.get("featured_media")
    if media_id:
        media = wp.call("/wp/v2/media/%d?_fields=source_url,alt_text" % int(media_id))
        src = media.get("source_url", "")
        if src.startswith(SITE + "/wp-content/uploads/"):
            return src, media.get("alt_text") or plain_text(
                post.get("title", {}).get("rendered", "")
            )
    raise RuntimeError("No verified WordPress-hosted photo for article: " + slug)


def latest_section(content):
    pattern = (
        r'<section\b[^>]*>'
        r'(?:(?!<section\b).)*?'
        r'<h2\b[^>]*>\s*' + re.escape(SECTION_TITLE) + r'\s*</h2>'
        r'.*?</section>'
    )
    match = re.search(pattern, content, flags=re.S | re.I)
    if not match:
        raise RuntimeError("Could not find the existing latest-products section.")
    return match


def add_product_photos(wp, section):
    articles = re.findall(r"<article\b.*?</article>", section, flags=re.S | re.I)
    if not articles:
        raise RuntimeError("The home page has no existing product cards.")

    prepared = []
    for article in articles:
        title_match = re.search(r"<h3\b[^>]*>(.*?)</h3>", article, flags=re.S | re.I)
        if not title_match:
            raise RuntimeError("An existing home product card has no title.")
        title = plain_text(title_match.group(1))
        link_match = re.search(
            r'<h3\b[^>]*>.*?<a\b[^>]*href\s*=\s*(["\'])(.*?)\1',
            article,
            flags=re.S | re.I,
        )
        if not link_match:
            raise RuntimeError("A home product card has no article link: " + title)
        href = html.unescape(link_match.group(2))
        parsed = parse.urlparse(href)
        if parsed.netloc not in ("sanrio-fan.site", "www.sanrio-fan.site"):
            raise RuntimeError("A product card points outside the Sanrio site: " + title)
        slug = parsed.path.strip("/").rsplit("/", 1)[-1]
        if not slug:
            raise RuntimeError("Could not resolve a product article slug: " + title)
        image_url, alt = photo_for_article(wp, slug)
        image_link = (
            '<a class="sf-home-product-photo" href="' + html.escape(href, quote=True)
            + '" aria-label="' + html.escape(title + " の商品ガイドを見る", quote=True) + '">'
            '<img class="sf-home-product-image" src="' + html.escape(image_url, quote=True)
            + '" alt="' + html.escape(alt, quote=True)
            + '" loading="lazy" decoding="async"></a>'
        )
        image_tag = re.compile(r"<img\b[^>]*>", flags=re.S | re.I)
        if image_tag.search(article):
            new_article = image_tag.sub(lambda _: image_link, article, count=1)
        else:
            body_match = re.search(r'<div\b[^>]*class=["\'][^"\']*\bsf-card-body\b[^"\']*["\'][^>]*>', article, flags=re.I)
            if body_match:
                new_article = article[:body_match.start()] + image_link + article[body_match.start():]
            else:
                article_open = re.search(r"<article\b[^>]*>", article, flags=re.I)
                if not article_open:
                    raise RuntimeError("Could not insert a product photo: " + title)
                new_article = article[:article_open.end()] + image_link + article[article_open.end():]
        prepared.append((new_article, title, image_url, href))

    if len(prepared) != len(articles):
        raise RuntimeError("Some home product cards were not prepared.")
    updated = section
    for old, (new, _, _, _) in zip(articles, prepared):
        updated = updated.replace(old, new, 1)
    if updated.count('class="sf-home-product-image"') != len(prepared):
        raise RuntimeError("Not every current product card received a photo.")
    return updated, prepared


CSS = """<style id="sf-home-photo-grid">
/* Keep the character shortcuts at four columns; make the product cards three columns. */
#sf-latest-products{
  display:grid!important;
  grid-template-columns:repeat(3,minmax(0,1fr))!important;
  gap:10px!important;
  align-items:stretch;
}
#sf-latest-products>.sf-card{
  display:flex!important;
  min-width:0!important;
  flex-direction:column!important;
  overflow:hidden!important;
}
#sf-latest-products .sf-home-product-photo{
  display:grid!important;
  width:100%;
  aspect-ratio:1/1;
  place-items:center;
  overflow:hidden;
  background:#fff;
}
#sf-latest-products .sf-home-product-image{
  display:block!important;
  width:100%!important;
  height:100%!important;
  object-fit:contain!important;
}
#sf-latest-products .sf-card-body{
  display:flex;
  min-width:0;
  flex:1;
  flex-direction:column;
  gap:8px;
  padding:10px!important;
}
#sf-latest-products .sf-card-body h3{
  margin:0;
  font-size:clamp(12px,3.1vw,15px)!important;
  line-height:1.45;
  overflow-wrap:anywhere;
}
#sf-latest-products .sf-card-body p{
  font-size:12px!important;
  line-height:1.45;
}
@media(max-width:640px){
  .sf-guide{padding-top:8px!important}
  .sf-guide>.sf-hero{
    margin:12px 14px 10px!important;
    padding:18px 18px 16px!important;
    border-radius:22px!important;
  }
  .sf-hero .sf-eyebrow{
    margin:0 0 6px!important;
    font-size:10px!important;
    line-height:1.2!important;
    letter-spacing:.12em!important;
  }
  .sf-hero .sf-title{
    margin:4px 0 8px!important;
    font-size:clamp(26px,7vw,32px)!important;
    line-height:1.2!important;
  }
  .sf-hero .sf-sub{
    margin:0 0 10px!important;
    font-size:14px!important;
    line-height:1.45!important;
  }
  .sf-hero .sf-search{gap:8px!important}
  .sf-hero .sf-search input,
  .sf-hero .sf-search button{
    min-height:48px!important;
    padding:10px 12px!important;
    font-size:14px!important;
  }
  .sf-guide>section{margin-top:16px!important;margin-bottom:18px!important}
  #characters>h2,
  #sf-latest-products-title{margin-bottom:10px!important}
  .sf-directory-actions{gap:8px!important;margin-bottom:10px!important}
  #sf-latest-products{gap:8px!important}
  #sf-latest-products .sf-card{border-radius:14px!important}
  #sf-latest-products .sf-card-body{gap:6px;padding:8px!important}
  #sf-latest-products .sf-card-body h3{font-size:12px!important;line-height:1.4}
  #sf-latest-products .sf-card-body p{font-size:11px!important}
  #sf-latest-products .sf-detail{
    display:flex;
    min-height:36px;
    align-items:center;
    justify-content:center;
    padding:6px 4px!important;
    font-size:11px!important;
    line-height:1.25;
    text-align:center;
  }
  #sf-latest-products .sf-home-marketplace{
    grid-template-columns:1fr!important;
    gap:5px!important;
    margin-top:7px!important;
  }
  #sf-latest-products .sf-home-marketplace-button{
    min-height:34px!important;
    padding:5px 3px!important;
    font-size:10px!important;
    line-height:1.2;
  }
  #sf-latest-products .sf-home-marketplace-note{font-size:10px!important}
}
</style>"""


def compact_top_and_prioritize_products(content, product_markup):
    content = product_markup
    # Replace a previous version of this page-specific style block, if present.
    style_pattern = re.compile(re.escape(STYLE_START) + r".*?" + re.escape(STYLE_END), re.S)
    if style_pattern.search(content):
        content = style_pattern.sub(CSS, content, count=1)
    else:
        wrapper = re.search(r'<div class=["\']sf-guide["\']', content, flags=re.I)
        if not wrapper:
            raise RuntimeError("Could not find the home-page guide wrapper.")
        content = content[:wrapper.start()] + CSS + content[wrapper.start():]

    # Put the already-existing products immediately after the compact search hero.
    section_match = latest_section(content)
    section = section_match.group(0)
    content = content[:section_match.start()] + content[section_match.end():]
    hero_end = re.search(r"</header>", content, flags=re.I)
    if not hero_end:
        raise RuntimeError("Could not find the home-page search hero.")
    insert_at = hero_end.end()
    content = content[:insert_at] + section + content[insert_at:]
    if content.find('<header class="sf-hero"') > content.find('id="sf-latest-products"'):
        raise RuntimeError("Latest product cards were not placed after the hero.")
    return content


def main():
    wp = WordPress()
    page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID)
    if page.get("id") != PAGE_ID or page.get("slug") != EXPECTED_SLUG:
        raise RuntimeError("Home page identity check failed.")
    content = page.get("content", {}).get("raw")
    if not isinstance(content, str):
        raise RuntimeError("Could not read the editable home-page content.")

    section_match = latest_section(content)
    updated_section, cards = add_product_photos(wp, section_match.group(0))
    prepared_content = (
        content[:section_match.start()]
        + updated_section
        + content[section_match.end():]
    )
    prepared_content = compact_top_and_prioritize_products(prepared_content, updated_section)

    # Perform one REST update only after all six article photos were resolved.
    wp.call("/wp/v2/pages/%d" % PAGE_ID, {"content": prepared_content})
    saved = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID)
    raw = saved.get("content", {}).get("raw", "")
    verify_section = latest_section(raw).group(0)
    expected_count = len(cards)
    if saved.get("id") != PAGE_ID or saved.get("slug") != EXPECTED_SLUG:
        raise RuntimeError("Home page identity changed during save verification.")
    if verify_section.count('class="sf-home-product-image"') != expected_count:
        raise RuntimeError("Home page photo-card verification failed.")
    if verify_section.count('🔖') < expected_count:
        raise RuntimeError("Home page saved-item controls were not retained.")
    if "grid-template-columns:repeat(3,minmax(0,1fr))" not in raw:
        raise RuntimeError("Three-column product-grid verification failed.")
    if raw.find("</header>") > raw.find(SECTION_TITLE):
        raise RuntimeError("The latest-products section is no longer after the hero.")
    for _, title, image_url, href in cards:
        if image_url not in verify_section or href not in verify_section:
            raise RuntimeError("A saved product photo or article link is missing: " + title)
    print("Updated home page through WordPress REST API.")
    print("%d existing product cards now have verified photos and saved controls." % expected_count)
    print("Product section is directly below the search hero; cards are 3 columns on mobile.")
    for _, title, image_url, _ in cards:
        print("Verified photo: %s — %s" % (title, image_url))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
