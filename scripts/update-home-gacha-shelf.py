"""Add a 3-column gacha shelf immediately above the existing books shelf."""
import argparse
import base64
import html
import json
import os
import re
import sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
PAGE_ID = 805
PAGE_SLUG = "shopping-home"
CATEGORY_SLUG = "gacha"
START = "<!-- sf-home-gacha-shelf:start -->"
END = "<!-- sf-home-gacha-shelf:end -->"
BOOKS_START = "<!-- sf-books-shelf:start -->"
BOOKS_END = "<!-- sf-books-shelf:end -->"


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("WordPress redirected a REST request; check the configured site URL.")


class WordPress:
    def __init__(self):
        user = os.environ.get("SANRIO_WP_USER", "").strip()
        password = "".join(os.environ.get("SANRIO_WP_APP_PASSWORD", "").split())
        if not user or not password:
            raise RuntimeError("WordPress REST credentials are not configured.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.auth = "Basic " + token
        self.opener = request.build_opener(NoRedirect)

    def call(self, path, data=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST API routes are allowed.")
        headers = {
            "Authorization": self.auth,
            "User-Agent": "SanrioHomeGachaShelf/1.0",
        }
        body = None
        if data is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(data, ensure_ascii=False).encode()
        req = request.Request(SITE + "/wp-json" + path, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s for %s." % (
                exc.code, path.split("?", 1)[0]
            )) from None


def plain_text(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(value)))).strip()


def first_attribute(tag, name):
    match = re.search(
        r"\b" + re.escape(name) + r"\s*=\s*([\"'])(.*?)\1",
        tag,
        flags=re.S | re.I,
    )
    return html.unescape(match.group(2)) if match else ""


def safe_image_url(value):
    parts = parse.urlsplit(html.unescape(str(value or "")))
    return (
        parts.scheme == "https"
        and parts.hostname in ("sanrio-fan.site", "www.sanrio-fan.site")
        and parts.path.startswith("/wp-content/uploads/")
        and not parts.username
        and not parts.password
        and not parts.port
        and not parts.fragment
    )


def photo_for_post(wp, post):
    rendered = post.get("content", {}).get("rendered", "")
    for tag in re.findall(r"<img\b[^>]*>", rendered, flags=re.I | re.S):
        for attr in ("src", "data-src", "data-lazy-src", "data-original"):
            src = first_attribute(tag, attr)
            if safe_image_url(src):
                return src, first_attribute(tag, "alt")

    media_id = post.get("featured_media")
    if media_id:
        media = wp.call("/wp/v2/media/%d?_fields=source_url,alt_text" % int(media_id))
        src = media.get("source_url", "")
        if safe_image_url(src):
            return src, media.get("alt_text", "")
    return "", ""


def load_gacha_posts(wp):
    categories = wp.call("/wp/v2/categories?" + parse.urlencode({
        "slug": CATEGORY_SLUG, "context": "edit", "_fields": "id,slug"
    }))
    if len(categories) != 1 or categories[0].get("slug") != CATEGORY_SLUG:
        raise RuntimeError("The gacha article category could not be resolved uniquely.")
    query = parse.urlencode({
        "categories": categories[0]["id"],
        "status": "publish",
        "context": "edit",
        "per_page": 30,
        "orderby": "date",
        "order": "desc",
        "_fields": "id,link,title,content,featured_media",
    })
    posts = wp.call("/wp/v2/posts?" + query)
    items = []
    for post in posts:
        title = plain_text(post.get("title", {}).get("rendered", ""))
        link = str(post.get("link", ""))
        parts = parse.urlsplit(link)
        if not title:
            continue
        if (parts.scheme != "https"
                or parts.hostname not in ("sanrio-fan.site", "www.sanrio-fan.site")
                or not parts.path.startswith("/")):
            raise RuntimeError("A gacha article link did not pass site validation.")
        image_url, alt = photo_for_post(wp, post)
        items.append({
            "title": title,
            "link": link,
            "image_url": image_url,
            "alt": alt or title,
            "icon": fallback_icon(title),
        })
    if not items:
        raise RuntimeError("No published articles are available in the gacha category.")
    return items


def fallback_icon(title):
    if "設置" in title or "場所" in title:
        return "📍"
    if "ダブり" in title or "予算" in title:
        return "🎲"
    if "新作" in title or "比較" in title:
        return "✨"
    return "🎁"


CSS = """<style id="sf-home-gacha-shelf-style">
#sf-home-gacha-shelf{margin:28px 0;padding:20px 16px;border-radius:22px;background:#fff7fb}
#sf-home-gacha-shelf h2{margin:0 0 8px;color:#39333f;font-size:clamp(20px,5vw,27px);line-height:1.35}
#sf-home-gacha-shelf .sf-home-gacha-intro{margin:0 0 10px;color:#706776;font-size:14px;line-height:1.6}
#sf-home-gacha-shelf .sf-home-gacha-swipe{margin:0 0 10px;color:#827489;font-size:12px}
#sf-home-gacha-shelf .sf-home-gacha-track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}
#sf-home-gacha-shelf .sf-home-gacha-track::-webkit-scrollbar{display:none}
#sf-home-gacha-shelf .sf-home-gacha-page{display:grid;flex:0 0 100%;min-width:0;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-content:start;scroll-snap-align:start;scroll-snap-stop:always}
#sf-home-gacha-shelf .sf-home-gacha-card{display:flex;min-width:0;flex-direction:column;overflow:hidden;border:1px solid #ece2eb;border-radius:14px;background:#fff}
#sf-home-gacha-shelf .sf-home-gacha-photo{display:grid;width:100%;aspect-ratio:1/1;place-items:center;overflow:hidden;background:#fff}
#sf-home-gacha-shelf .sf-home-gacha-photo img{display:block;width:100%;height:100%;margin:0;object-fit:contain}
#sf-home-gacha-shelf .sf-home-gacha-placeholder{display:grid;width:100%;height:100%;place-items:center;background:linear-gradient(145deg,#f8eaf5,#eaf6f5);color:#715c78;font-size:clamp(27px,8vw,46px)}
#sf-home-gacha-shelf .sf-home-gacha-title{display:-webkit-box;min-height:3.9em;margin:8px 7px 5px;overflow:hidden;color:#39333f;font-size:clamp(11px,2.9vw,14px);font-weight:700;line-height:1.4;text-decoration:none;-webkit-box-orient:vertical;-webkit-line-clamp:3}
#sf-home-gacha-shelf .sf-home-gacha-link{display:flex;min-height:34px;align-items:center;justify-content:center;margin:0 6px 7px;padding:5px 3px;border-radius:8px;background:#f5eff7;color:#674e72;font-size:11px;line-height:1.25;text-align:center;text-decoration:none}
#sf-home-gacha-shelf .sf-home-gacha-all{display:block;margin-top:12px;padding:11px;border-radius:10px;background:#f5eff7;color:#674e72;font-size:14px;text-align:center;text-decoration:none}
@media(min-width:768px){#sf-home-gacha-shelf{padding:24px}#sf-home-gacha-shelf .sf-home-gacha-title{font-size:16px}#sf-home-gacha-shelf .sf-home-gacha-link{font-size:13px}}
@media(prefers-reduced-motion:reduce){#sf-home-gacha-shelf .sf-home-gacha-track{scroll-behavior:auto}}
</style>"""


def render(items):
    cards = []
    for item in items:
        esc = lambda value: html.escape(str(value), quote=True)
        title = esc(item["title"])
        href = esc(item["link"])
        image_url = item.get("image_url", "")
        if image_url:
            photo = (
                '<img src="' + esc(image_url) + '" alt="' + esc(item.get("alt") or item["title"])
                + '" loading="lazy" decoding="async">'
            )
        else:
            photo = '<span class="sf-home-gacha-placeholder" aria-hidden="true">' + esc(item.get("icon", "🎁")) + "</span>"
        cards.append(
            '<article class="sf-home-gacha-card">'
            '<a class="sf-home-gacha-photo" href="' + href + '" aria-label="' + title + 'の記事を見る">'
            + photo + '</a>'
            '<a class="sf-home-gacha-title" href="' + href + '">' + title + '</a>'
            '<a class="sf-home-gacha-link" href="' + href + '">記事を見る →</a>'
            '</article>'
        )

    pages = []
    for start in range(0, len(cards), 3):
        number = start // 3 + 1
        page_cards = "".join(cards[start:start + 3])
        pages.append(
            '<div class="sf-home-gacha-page" role="group" aria-label="%dページ">%s</div>'
            % (number, page_cards)
        )
    count = len(cards)
    return (
        START + CSS
        + '<section id="sf-home-gacha-shelf" aria-labelledby="sf-home-gacha-heading">'
        + '<h2 id="sf-home-gacha-heading">サンリオのガチャガチャ・カプセルトイ</h2>'
        + '<div class="sf-home-gacha-track" tabindex="0" aria-label="ガチャ・カプセルトイの記事。横にスワイプできます">'
        + "".join(pages)
        + '</div><p class="sf-home-gacha-swipe">横にスワイプして見る →</p>'
        + '<p class="sf-home-gacha-intro">新作商品やガチャの楽しみ方をまとめています。発売時期や設置・在庫は、各記事と店舗の最新情報をご確認ください。</p>'
        + '<a class="sf-home-gacha-all" href="/category/gacha/">ガチャ・カプセルトイの記事をすべて見る →</a>'
        + '</section>' + END
    )


def replace_section(raw, markup):
    if START in raw or END in raw:
        if raw.count(START) != 1 or raw.count(END) != 1:
            raise RuntimeError("Duplicate or incomplete gacha shelf markers.")
        return re.sub(
            re.escape(START) + r".*?" + re.escape(END),
            lambda _: markup,
            raw,
            count=1,
            flags=re.S,
        )
    if raw.count(BOOKS_START) != 1 or raw.count(BOOKS_END) != 1:
        raise RuntimeError("The existing books shelf markers were not found uniquely.")
    return raw.replace(BOOKS_START, markup + BOOKS_START, 1)


def without_our_section(value):
    return re.sub(
        re.escape(START) + r".*?" + re.escape(END),
        "",
        value,
        count=1,
        flags=re.S,
    )


def verify(raw, expected):
    if raw.count(START) != 1 or raw.count(END) != 1:
        raise RuntimeError("The saved home page does not have one gacha shelf.")
    if raw.count('class="sf-home-gacha-card"') != expected:
        raise RuntimeError("The saved gacha shelf card count did not match.")
    if raw.count('grid-template-columns:repeat(3,minmax(0,1fr))') < 1:
        raise RuntimeError("The gacha shelf is not configured for three columns.")
    if raw.find(START) > raw.find(BOOKS_START):
        raise RuntimeError("The gacha shelf is not above the books shelf.")


def sync(wp):
    page_path = "/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % PAGE_ID
    page = wp.call(page_path)
    if page.get("id") != PAGE_ID or page.get("slug") != PAGE_SLUG:
        raise RuntimeError("The homepage identity did not match the expected page.")
    raw = page.get("content", {}).get("raw")
    if not isinstance(raw, str):
        raise RuntimeError("The homepage editable content could not be read.")

    items = load_gacha_posts(wp)
    markup = render(items)
    updated = replace_section(raw, markup)
    if without_our_section(raw) != without_our_section(updated):
        raise RuntimeError("Existing homepage content would change outside the gacha shelf.")

    current = wp.call(page_path)
    if current.get("content", {}).get("raw") != raw:
        raise RuntimeError("The homepage changed during preparation.")
    if updated != raw:
        wp.call("/wp/v2/pages/%d" % PAGE_ID, {"content": updated})

    saved = wp.call(page_path)
    saved_raw = saved.get("content", {}).get("raw", "")
    if saved.get("id") != PAGE_ID or saved.get("slug") != PAGE_SLUG:
        raise RuntimeError("The homepage identity changed during save verification.")
    verify(saved_raw, len(items))
    for item in items:
        if item["link"] not in saved_raw:
            raise RuntimeError("A gacha article link is missing after save verification.")
        if item["image_url"] and item["image_url"] not in saved_raw:
            raise RuntimeError("A gacha article photo is missing after save verification.")
    print("Updated the homepage through WordPress REST API.")
    print("Verified %d gacha article cards in three-column, swipeable pages above the books shelf." % len(items))


def self_test():
    items = [
        {"title": "ガチャ商品1", "link": SITE + "/gacha-1/", "image_url": SITE + "/wp-content/uploads/1.jpg", "alt": "商品1"},
        {"title": "ガチャ商品2", "link": SITE + "/gacha-2/", "image_url": "", "alt": "商品2", "icon": "🎲"},
        {"title": "ガチャ商品3", "link": SITE + "/gacha-3/", "image_url": "", "alt": "商品3", "icon": "✨"},
        {"title": "ガチャ商品4", "link": SITE + "/gacha-4/", "image_url": "", "alt": "商品4", "icon": "🎁"},
    ]
    markup = render(items)
    raw = "<main>" + BOOKS_START + "<section>books</section>" + BOOKS_END + "</main>"
    updated = replace_section(raw, markup)
    verify(updated, len(items))
    if without_our_section(updated) != raw:
        raise RuntimeError("Self-test changed content outside the gacha shelf.")
    if updated.count('class="sf-home-gacha-page"') != 2:
        raise RuntimeError("Self-test did not create swipe pages of three cards.")
    if "ガチャガチャ・カプセルトイ" not in updated:
        raise RuntimeError("Self-test shelf heading is missing.")
    print("Home gacha shelf self-test passed.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    sync(WordPress())


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, error.URLError, ValueError, KeyError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
