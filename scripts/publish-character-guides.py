"""Publish five unique character guides with the standard WordPress REST API only."""
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
AMAZON_TAG = "ononbrothers2-22"
RAKUTEN_ID = "56386226.a6714b12.56386227.a1326022"
AFFILIATE_NOTICE = "この記事にはAmazon・楽天市場のアフィリエイトリンクを含みます。価格・在庫・販売条件は購入先でご確認ください。"


class WordPress:
    def __init__(self):
        user = os.getenv("SANRIO_WP_USER", "")
        password = os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("WordPress Actions secrets are not configured.")
        self.auth = "Basic " + base64.b64encode((user + ":" + password).encode()).decode()
        self.opener = request.build_opener()

    def call(self, path, body=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        req = request.Request(SITE + "/wp-json" + path,
            data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
            headers={"Authorization": self.auth, "User-Agent": "SanrioCharacterGuidePublisher/1.0",
                     **({"Content-Type": "application/json"} if body is not None else {})})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response), response.headers
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP " + str(exc.code) + ".") from None

    def all_posts(self):
        rows, page = [], 1
        while True:
            query = parse.urlencode({"context": "edit",
                "status": "publish,draft,pending,future,private,trash",
                "per_page": 100, "page": page,
                "_fields": "id,slug,status,title,content"})
            batch, headers = self.call("/wp/v2/posts?" + query)
            rows.extend(batch)
            if page >= int(headers.get("X-WP-TotalPages", "1")):
                return rows
            page += 1


def visible(value):
    if isinstance(value, dict):
        value = value.get("raw", value.get("rendered", ""))
    return html.unescape(re.sub(r"<[^>]*>", "", str(value))).strip()


def affiliate_links(item):
    query = item["search_query"]
    amazon = "https://www.amazon.co.jp/s?" + parse.urlencode({"k": query, "tag": AMAZON_TAG})
    rakuten_search = "https://search.rakuten.co.jp/search/mall/" + parse.quote(query, safe="")
    rakuten = "https://hb.afl.rakuten.co.jp/hgc/" + RAKUTEN_ID + "/?pc=" + parse.quote(rakuten_search, safe="") + "&m=" + parse.quote(rakuten_search, safe="")
    return amazon, rakuten


def render(item):
    amazon, rakuten = affiliate_links(item)
    source = html.escape(item["source"], quote=True)
    return (
        '<!-- sf-product-key: ' + item["key"] + ' -->'
        '<article class="sf-product-guide">'
        '<p><small>' + AFFILIATE_NOTICE + '</small></p>'
        '<p>' + html.escape(item["intro"]) + '</p>'
        '<h2>商品情報</h2><table><tbody>' +
        "".join("<tr><th>" + html.escape(label) + "</th><td>" + html.escape(value) + "</td></tr>"
                for label, value in item["specs"]) +
        '</tbody></table>'
        '<h2>選ぶ前に確認したいこと</h2><p>' + html.escape(item["advice"]) + '</p>'
        '<h2>購入先を探す</h2><p>販売状況や価格は変わる場合があります。キャラクター名・商品名・シリーズ名を照合し、販売元、サイズ、仕様を購入先で確認してください。</p>'
        '<p><a class="sf-amazon" href="' + html.escape(amazon, quote=True) + '" target="_blank" rel="sponsored nofollow noopener">Amazonで' + html.escape(item["character"]) + 'グッズを探す</a></p>'
        '<p><a class="sf-rakuten" href="' + html.escape(rakuten, quote=True) + '" target="_blank" rel="sponsored nofollow noopener">楽天市場で' + html.escape(item["character"]) + 'グッズを探す</a></p>'
        '<h2>公式情報</h2><p><a href="' + source + '" target="_blank" rel="noopener">' + html.escape(item["source_label"]) + '</a></p>'
        '</article>'
    )


def run():
    items = json.loads((ROOT / "blog" / "character-guides-2026-10-18.json").read_text(encoding="utf-8"))
    if len(items) != 5 or len({item["key"] for item in items}) != 5:
        raise RuntimeError("Candidate data must contain exactly five unique guides.")
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    posts = wp.all_posts()
    cats, _ = wp.call("/wp/v2/categories?" + parse.urlencode({"slug": "shopping-products", "_fields": "id"}))
    if not cats:
        raise RuntimeError("The shopping-products category is missing.")
    for item in items:
        key_marker = "sf-product-key: " + item["key"]
        hits = [p for p in posts if key_marker in str(p.get("content", {}).get("raw", ""))
                or p.get("slug") == item["slug"]
                or visible(p.get("title")) == item["title"]]
        if hits:
            print("SKIP duplicate:", item["key"], ",".join(str(p["id"]) for p in hits))
            continue
        tag_rows, _ = wp.call("/wp/v2/tags?" + parse.urlencode({"slug": item["character_slug"], "_fields": "id"}))
        if tag_rows:
            tag_id = tag_rows[0]["id"]
        else:
            tag, _ = wp.call("/wp/v2/tags", {"name": item["character"], "slug": item["character_slug"]})
            tag_id = tag["id"]
        draft, _ = wp.call("/wp/v2/posts", {
            "title": item["title"], "slug": item["slug"], "status": "draft",
            "excerpt": item["intro"], "content": render(item),
            "categories": [cats[0]["id"]], "tags": [tag_id]
        })
        check, _ = wp.call("/wp/v2/posts/" + str(draft["id"]) + "?context=edit")
        raw = check.get("content", {}).get("raw", "")
        if check.get("status") != "draft" or key_marker not in raw or tag_id not in check.get("tags", []):
            raise RuntimeError("Draft verification failed; article remains unpublished.")
        published, _ = wp.call("/wp/v2/posts/" + str(draft["id"]), {"status": "publish"})
        verify, _ = wp.call("/wp/v2/posts/" + str(draft["id"]) + "?_fields=id,status,link,tags")
        if verify.get("status") != "publish" or tag_id not in verify.get("tags", []):
            raise RuntimeError("Published article verification failed.")
        print("PUBLISHED:", item["key"], verify["link"])


if __name__ == "__main__":
    try:
        run()
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Operation failed; check site and product data.", file=sys.stderr)
        sys.exit(1)
