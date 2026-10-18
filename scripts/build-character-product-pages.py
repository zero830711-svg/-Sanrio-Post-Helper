"""Refresh existing and create new Sanrio character landing pages via standard WP REST API."""
import base64
import html
import json
import os
import re
import sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
MARKER = "<!-- sanrio-character-products:v1 -->"
END = "<!-- /sanrio-character-products:v1 -->"
AMAZON_TAG = "ononbrothers2-22"
RAKUTEN_ID = "56386226.a6714b12.56386227.a1326022"
# Existing landing pages use verified WordPress page IDs. New pages are found by slug
# first, then created only when neither a matching page nor conflicting post exists.
CHARACTERS = [
    ("ポチャッコ", "pochacco", 800, None),
    ("クロミ", "kuromi", 797, None),
    ("マイメロディ", "my-melody", 798, None),
    ("シナモロール", "cinnamoroll", 796, None),
    ("ハローキティ", "hello-kitty", 801, None),
    ("ポムポムプリン", "pompompurin", 799, None),
    ("ハンギョドン", "hangyodon", 802, None),
    ("リトルツインスターズ", "little-twin-stars", 803, None),
    ("タキシードサム", "tuxedo-sam", None, "tuxedo-sam-goods"),
    ("あひるのペックル", "ahiru-no-pekkle", None, "ahiru-no-pekkle-goods"),
    ("バッドばつ丸", "bad-badtz-maru", None, "bad-badtz-maru-goods"),
    ("こぎみゅん", "cogimyun", None, "cogimyun-goods"),
    ("ウサハナ", "usahana", None, "usahana-goods"),
]
NEW_PAGE_SLUGS = {slug: page_slug for _, slug, page_id, page_slug in CHARACTERS if page_id is None}


class WordPress:
    def __init__(self):
        user, password = os.getenv("SANRIO_WP_USER", ""), os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("Set the WordPress Actions secrets first.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.auth = "Basic " + token

    def call(self, path, data=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        headers = {"Authorization": self.auth, "User-Agent": "SanrioCharacterPages/1.1"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(
            SITE + "/wp-json" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers,
        )
        try:
            with request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s." % exc.code) from None


def marketplace_links(name):
    query = name + " サンリオ グッズ"
    amazon = "https://www.amazon.co.jp/s?" + parse.urlencode({"k": query, "tag": AMAZON_TAG})
    target = "https://search.rakuten.co.jp/search/mall/" + parse.quote(query, safe="") + "/"
    rakuten = "https://hb.afl.rakuten.co.jp/hgc/" + RAKUTEN_ID + "/?" + parse.urlencode(
        {"pc": target, "m": target}
    )
    return amazon, rakuten


def cards_section(name, slug, posts):
    cards = []
    for post in posts:
        if not post.get("slug", "").startswith("goods-jan-"):
            continue
        link = post.get("link", "")
        if not link.startswith(SITE + "/"):
            raise RuntimeError("Unexpected product article URL.")
        raw = post.get("content", {}).get("raw", "")
        match = re.search(r"<img\b[^>]*\bsrc=['\"]([^'\"]+)", raw)
        image_url = match.group(1) if match else ""
        if not image_url.startswith(SITE + "/wp-content/uploads/"):
            raise RuntimeError("Could not verify a local product image.")
        post_title = post.get("title", "")
        title = post_title.get("rendered", post_title.get("raw", "")) if isinstance(post_title, dict) else post_title
        cards.append(
            '<article style="border:1px solid #eadde5;border-radius:16px;padding:14px;background:#fff">'
            '<a href="%s" style="display:flex;align-items:center;gap:14px;color:inherit;text-decoration:none">'
            '<img src="%s" alt="%s" loading="lazy" style="width:96px;height:96px;object-fit:contain;flex:none">'
            '<span><strong>%s</strong><br><span>仕様・Amazon・楽天の購入先を見る →</span></span></a></article>'
            % (html.escape(link, quote=True), html.escape(image_url, quote=True),
               html.escape(name + "の商品", quote=True), html.escape(title))
        )
    if not cards:
        cards.append('<p>掲載中の商品ガイドはまだありません。<a href="/goods/">商品一覧から探す</a>か、下の通販検索をご利用ください。</p>')
    return (
        MARKER + '<section aria-labelledby="sf-char-products-%s">'
        '<h2 id="sf-char-products-%s">%sのグッズ記事</h2>'
        '<p>商品の仕様や型番を確認して、Amazon・楽天市場の販売ページを探せます。</p>'
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%%,280px),1fr));gap:12px">%s</div>'
        '<p><a href="/tag/%s/">このキャラクターの商品記事をすべて見る →</a></p>'
        '</section>' % (slug, slug, html.escape(name), "".join(cards), slug) + END
    )


def landing_content(name, slug, posts):
    amazon, rakuten = marketplace_links(name)
    intro = (
        '<p>' + html.escape(name) + 'のサンリオグッズを、商品ガイドと通販検索から探せるページです。'
        '型番やサイズなどを確認してから、購入先の最新情報をご確認ください。</p>'
        '<nav aria-label="通販サイト" style="display:flex;flex-wrap:wrap;gap:10px;margin:18px 0">'
        '<a href="' + html.escape(amazon, quote=True) + '" target="_blank" rel="sponsored nofollow noopener" '
        'style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 16px;border-radius:10px;background:#ffbd35;color:#202124;font-weight:700;text-decoration:none">Amazonで' + html.escape(name) + 'を探す</a>'
        '<a href="' + html.escape(rakuten, quote=True) + '" target="_blank" rel="sponsored nofollow noopener" '
        'style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 16px;border-radius:10px;background:#bf0000;color:#fff;font-weight:700;text-decoration:none">楽天で' + html.escape(name) + 'を探す</a>'
        '<a href="/goods/" style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 16px;border:1px solid #eadde5;border-radius:10px;color:#46374b;font-weight:700;text-decoration:none">全商品一覧を見る</a>'
        '</nav>'
    )
    disclosure = (
        '<p style="font-size:14px;color:#766b78">当サイトは非公式ファンサイトです。記事にアフィリエイト広告を含みます。'
        '価格・在庫・販売元・配送条件は購入先でご確認ください。</p>'
    )
    return intro + cards_section(name, slug, posts) + disclosure


def page_identity(page, name, slug):
    title = page.get("title", "")
    title_text = title.get("rendered", title.get("raw", "")) if isinstance(title, dict) else title
    content = page.get("content", {}).get("raw", "")
    return page.get("slug") == NEW_PAGE_SLUGS[slug] and (name in title_text or name in content)


def refresh(wp):
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    updated, created = [], []
    for name, slug, page_id, page_slug in CHARACTERS:
        terms = wp.call("/wp/v2/tags?" + parse.urlencode({"slug": slug, "_fields": "id,slug"}))
        if len(terms) != 1:
            raise RuntimeError("Expected one character tag: " + slug)
        query = parse.urlencode({
            "tags": terms[0]["id"], "status": "publish", "per_page": 100,
            "context": "edit", "_fields": "slug,title,link,content"
        })
        posts = wp.call("/wp/v2/posts?" + query)
        section_content = landing_content(name, slug, posts)

        if page_id is not None:
            page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,title,content" % page_id)
            if page.get("id") != page_id:
                raise RuntimeError("Character page ID mismatch: " + slug)
            content = page.get("content", {}).get("raw")
            page_title = page.get("title", "")
            title_text = page_title.get("rendered", page_title.get("raw", "")) if isinstance(page_title, dict) else page_title
            if not isinstance(content, str) or (name not in content and name not in title_text):
                raise RuntimeError("Character identity could not be verified for page ID %d." % page_id)
            pattern = re.escape(MARKER) + r".*?" + re.escape(END)
            content = re.sub(pattern, "", content, flags=re.S).rstrip()
            new_content = content + "\n\n" + section_content
            wp.call("/wp/v2/pages/%d" % page_id, {"content": new_content})
            verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,content" % page_id)
            raw = verify.get("content", {}).get("raw", "")
            if verify.get("id") != page_id or MARKER not in raw or END not in raw:
                raise RuntimeError("Character page update verification failed: " + slug)
            updated.append(name)
            continue

        page_query = parse.urlencode({"slug": page_slug, "context": "edit", "_fields": "id,slug,title,content,status"})
        matches = wp.call("/wp/v2/pages?" + page_query)
        if len(matches) > 1:
            raise RuntimeError("Multiple pages use character slug: " + page_slug)
        if matches:
            page = matches[0]
            if not page_identity(page, name, slug):
                raise RuntimeError("Character page slug is already used by another page: " + page_slug)
            page_id = page["id"]
            page_title = page.get("title", "")
            title_text = page_title.get("rendered", page_title.get("raw", "")) if isinstance(page_title, dict) else page_title
            content = page.get("content", {}).get("raw", "")
            pattern = re.escape(MARKER) + r".*?" + re.escape(END)
            content = re.sub(pattern, "", content, flags=re.S).rstrip()
            new_content = content if section_content in content else content + "\n\n" + section_content
            wp.call("/wp/v2/pages/%d" % page_id, {
                "title": title_text or (name + "のグッズ・通販ガイド"),
                "content": new_content, "status": "publish"
            })
            created.append(name + "（既存ページを再利用）")
        else:
            post_conflicts = wp.call("/wp/v2/posts?" + parse.urlencode({
                "slug": page_slug, "context": "edit", "_fields": "id,slug,title"
            }))
            if post_conflicts:
                raise RuntimeError("Character page slug conflicts with an existing post: " + page_slug)
            page = wp.call("/wp/v2/pages", {
                "title": name + "のグッズ・通販ガイド",
                "slug": page_slug,
                "status": "publish",
                "content": section_content,
            })
            page_id = page.get("id")
            created.append(name)
        verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,title,content,status" % page_id)
        if verify.get("id") != page_id or verify.get("slug") != page_slug or MARKER not in verify.get("content", {}).get("raw", ""):
            raise RuntimeError("Character page creation verification failed: " + page_slug)

    print("UPDATED existing character pages: " + ", ".join(updated) + ".")
    print("CREATED/reused new character pages: " + ", ".join(created) + ".")


if __name__ == "__main__":
    try:
        refresh(WordPress())
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
