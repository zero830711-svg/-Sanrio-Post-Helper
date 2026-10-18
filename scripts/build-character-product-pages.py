"""Refresh product cards on the five existing character landing pages via WP REST API."""
import base64, html, json, os, re, sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
MARKER = "<!-- sanrio-character-products:v1 -->"
END = "<!-- /sanrio-character-products:v1 -->"
CHARACTERS = [
    ("ポチャッコ", "pochacco", 800),
    ("クロミ", "kuromi", 797),
    ("マイメロディ", "my-melody", 798),
    ("シナモロール", "cinnamoroll", 796),
    ("ハローキティ", "hello-kitty", 801),
]

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
        headers = {"Authorization": self.auth, "User-Agent": "SanrioCharacterPages/1.0"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(SITE + "/wp-json" + path,
                              data=json.dumps(data).encode() if data is not None else None,
                              headers=headers)
        try:
            with request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s." % exc.code) from None

def cards_section(name, slug, posts):
    cards = []
    for post in posts:
        if not post.get("slug", "").startswith("goods-jan-"):
            continue
        link = post.get("link", "")
        if not link.startswith(SITE + "/"):
            raise RuntimeError("Unexpected product article URL.")
        raw = post.get("content", {}).get("raw", "")
        match = re.search(r'<img\b[^>]*\bsrc=["\']([^"\']+)', raw)
        image_url = match.group(1) if match else ""
        if not image_url.startswith(SITE + "/wp-content/uploads/"):
            raise RuntimeError("Could not verify a local product image.")
        title = post.get("title", {}).get("rendered", "")
        cards.append(
            '<article style="border:1px solid #eadde5;border-radius:16px;padding:14px;background:#fff">'
            '<a href="%s" style="display:flex;align-items:center;gap:14px;color:inherit;text-decoration:none">'
            '<img src="%s" alt="%s" loading="lazy" style="width:96px;height:96px;object-fit:contain;flex:none">'
            '<span><strong>%s</strong><br><span>仕様・Amazon・楽天の購入先を見る →</span></span></a></article>' %
            (html.escape(link, quote=True), html.escape(image_url, quote=True),
             html.escape(name + "の商品", quote=True), html.escape(title)))
    return (MARKER + '<section aria-labelledby="sf-char-products-%s">'
            '<h2 id="sf-char-products-%s">%sのグッズ記事</h2>'
            '<p>商品の仕様や型番を確認して、Amazon・楽天市場の販売ページを探せます。</p>'
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%%,280px),1fr));gap:12px">%s</div>'
            '<p><a href="/tag/%s/">このキャラクターの商品記事をすべて見る →</a></p>'
            '</section>' % (slug, slug, html.escape(name), "".join(cards), slug) + END)

def refresh(wp):
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    updated = []
    for name, slug, page_id in CHARACTERS:
        terms = wp.call("/wp/v2/tags?" + parse.urlencode({"slug": slug, "_fields": "id,slug"}))
        if len(terms) != 1:
            raise RuntimeError("Expected one character tag: " + slug)
        page = wp.call("/wp/v2/pages/%d?context=edit&_fields=id,slug,content" % page_id)
        if page.get("slug") != slug:
            raise RuntimeError("Character page ID/slug mismatch: " + slug)
        query = parse.urlencode({"tags": terms[0]["id"], "status": "publish",
                                 "per_page": 100, "context": "edit",
                                 "_fields": "slug,title,link,content"})
        posts = wp.call("/wp/v2/posts?" + query)
        section = cards_section(name, slug, posts)
        content = page.get("content", {}).get("raw")
        if not isinstance(content, str):
            raise RuntimeError("Could not read editable character page: " + slug)
        pattern = re.escape(MARKER) + r".*?" + re.escape(END)
        content = re.sub(pattern, "", content, flags=re.S).rstrip()
        new_content = content + "\n\n" + section
        wp.call("/wp/v2/pages/%d" % page_id, {"content": new_content})
        verify = wp.call("/wp/v2/pages/%d?context=edit&_fields=slug,content" % page_id)
        raw = verify.get("content", {}).get("raw", "")
        if verify.get("slug") != slug or MARKER not in raw or END not in raw:
            raise RuntimeError("Character page update verification failed: " + slug)
        updated.append((name, len(cards_section(name, slug, posts))))
    print("UPDATED: " + ", ".join(name for name, _ in updated) + " character pages.")

if __name__ == "__main__":
    try:
        refresh(WordPress())
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
