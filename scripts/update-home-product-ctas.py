"""Add direct Amazon/Rakuten buttons to homepage product cards via standard WP REST."""
import argparse
import base64
import html
import json
import os
import re
import sys
from html.parser import HTMLParser
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
AMAZON_TAG = "ononbrothers2-22"
RAKUTEN_ID = "56386226.a6714b12.56386227.a1326022"
MARKER = "<!-- sf-home-marketplace-ctas:v1 -->"
CARD_RE = re.compile(r'<article\b[^>]*class=["\'][^"\']*\bsf-card\b[^"\']*["\'][^>]*>[\s\S]*?</article\s*>', re.I)
ANCHOR_RE = re.compile(r'<a\b[^>]*>[\s\S]*?</a\s*>', re.I)
TAG_RE = re.compile(r'<a\b[^>]*>', re.I)
ATTR_RE = lambda name: re.compile(r'\b' + re.escape(name) + r'\s*=\s*(["\'])(.*?)\1', re.I)


def get_attr(tag, name):
    match = ATTR_RE(name).search(tag)
    return html.unescape(match.group(2)) if match else ""


def plain(value):
    return html.unescape(re.sub(r"<[^>]+>", " ", value)).strip()


def link_data(raw):
    amazon = rakuten = ""
    for match in ANCHOR_RE.finditer(raw):
        anchor = match.group(0)
        tag_match = TAG_RE.match(anchor)
        if not tag_match:
            continue
        tag = tag_match.group(0)
        href = get_attr(tag, "href")
        host = parse.urlsplit(href).hostname or ""
        classes = get_attr(tag, "class").split()
        label = plain(anchor)
        if not amazon and (host.endswith("amazon.co.jp") and ("sf-amazon" in classes or "Amazon" in label)):
            amazon = href
        if not rakuten and host == "hb.afl.rakuten.co.jp" and ("sf-rakuten" in classes or "楽天" in label):
            rakuten = href
    return amazon, rakuten


def rakuten_search_url(amazon_url):
    parts = parse.urlsplit(amazon_url)
    query = parse.parse_qs(parts.query).get("k", [""])[0].strip()
    if not query:
        return ""
    target = "https://search.rakuten.co.jp/search/mall/" + parse.quote(query, safe="") + "/"
    return "https://hb.afl.rakuten.co.jp/hgc/" + RAKUTEN_ID + "/?" + parse.urlencode({"pc": target, "m": target})


def buttons_html(amazon, rakuten):
    return (
        MARKER
        + '<div class="sf-home-marketplace" aria-label="通販で商品を探す" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">'
        + '<a class="sf-amazon sf-marketplace-button" href="' + html.escape(amazon, quote=True)
        + '" target="_blank" rel="sponsored nofollow noopener" style="display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;padding:8px;border:1px solid #f0b800;border-radius:8px;background:#ffd814;color:#0f1111;font-size:14px;font-weight:700;text-align:center;text-decoration:none">Amazonで探す</a>'
        + '<a class="sf-rakuten sf-marketplace-button" href="' + html.escape(rakuten, quote=True)
        + '" target="_blank" rel="sponsored nofollow noopener" style="display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;padding:8px;border:1px solid #bf0000;border-radius:8px;background:#bf0000;color:#fff;font-size:14px;font-weight:700;text-align:center;text-decoration:none">楽天市場で探す</a>'
        + '</div><small class="sf-home-marketplace-note" style="display:block;margin-top:7px;color:#766b78;font-size:12px">価格・在庫・販売元は購入先でご確認ください。</small>'
    )


def source_post(wp, href):
    slug = parse.unquote(parse.urlsplit(href).path).strip("/").rsplit("/", 1)[-1]
    if not slug:
        raise RuntimeError("A homepage product card has no article slug.")
    query = parse.urlencode({"slug": slug, "context": "edit", "_fields": "id,slug,status,title,content,link"})
    for route in ("posts", "pages"):
        rows, _ = wp.call("/wp/v2/" + route + "?" + query)
        rows = [row for row in rows if row.get("status") == "publish"]
        if len(rows) == 1:
            return rows[0]
    raise RuntimeError("Could not resolve a published product guide for a homepage card.")


def update_cards(raw, wp):
    section = re.search(r'<div\b[^>]*id=["\']sf-latest-products["\'][^>]*>[\s\S]*?</div>\s*</section>', raw, re.I)
    if not section:
        raise RuntimeError("Homepage product-card section was not found.")
    block = section.group(0)
    cards = list(CARD_RE.finditer(block))
    if not cards:
        raise RuntimeError("No homepage product cards were found.")
    updated_cards = []
    for match in cards:
        card = match.group(0)
        links = [get_attr(TAG_RE.match(a).group(0), "href") for a in ANCHOR_RE.findall(card) if TAG_RE.match(a)]
        article_href = next((href for href in links if href.startswith(SITE + "/")), "")
        if not article_href:
            raise RuntimeError("A homepage product card has no internal product-guide link.")
        post = source_post(wp, article_href)
        post_raw = post.get("content", {}).get("raw", "")
        amazon, rakuten = link_data(post_raw)
        if not amazon:
            raise RuntimeError("The linked guide has no identifiable Amazon affiliate URL.")
        if not rakuten:
            rakuten = rakuten_search_url(amazon)
        if not rakuten or RAKUTEN_ID not in rakuten:
            raise RuntimeError("The linked guide has no Rakuten URL or usable Amazon search query.")
        if AMAZON_TAG not in amazon:
            raise RuntimeError("The linked guide's Amazon URL did not contain the configured affiliate tag.")
        if MARKER in card:
            if amazon not in card and 'href="' + html.escape(amazon, quote=True) + '"' not in card:
                raise RuntimeError("An existing homepage CTA has a different Amazon destination.")
            if rakuten not in card and 'href="' + html.escape(rakuten, quote=True) + '"' not in card:
                raise RuntimeError("An existing homepage CTA has a different Rakuten destination.")
            updated_cards.append(card)
            continue
        detail = next((m for m in ANCHOR_RE.finditer(card) if "sf-detail" in get_attr(TAG_RE.match(m.group(0)).group(0), "class").split()), None)
        if not detail:
            raise RuntimeError("A homepage product card has no 商品を見る guide link.")
        card = card[:detail.end()] + buttons_html(amazon, rakuten) + card[detail.end():]
        updated_cards.append(card)
    if len(cards) != 3:
        raise RuntimeError("Expected the three reviewed homepage product cards.")
    for match, card in reversed(list(zip(cards, updated_cards))):
        block = block[:match.start()] + card + block[match.end():]
    return raw[:section.start()] + block + raw[section.end():], len(cards)


class WordPress:
    def __init__(self):
        user = os.getenv("SANRIO_WP_USER", "")
        password = os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("Set the WordPress REST credentials in GitHub Actions secrets.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "User-Agent": "SanrioHomepageCTAs/1.0"}
        self.opener = request.build_opener(NoRedirect())

    def call(self, path, data=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        body = json.dumps(data).encode() if data is not None else None
        headers = {**self.headers, **({"Content-Type": "application/json"} if data is not None else {})}
        req = request.Request(SITE + "/wp-json" + path, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response), response.headers
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP " + str(exc.code) + ".") from None


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("WordPress REST redirected; stopped without writing.")


def self_test():
    amazon = "https://www.amazon.co.jp/s?k=%E3%82%B7%E3%83%8A%E3%83%A2%E3%83%AD%E3%83%BC%E3%83%AB+263323&tag=" + AMAZON_TAG
    rakuten = rakuten_search_url(amazon)
    assert "シナモロール" in parse.unquote(rakuten)
    generated = buttons_html(amazon, rakuten)
    assert MARKER in generated and "#ffd814" in generated and "#bf0000" in generated
    assert 'rel="sponsored nofollow noopener"' in generated
    sample = '<a class="sf-amazon" href="' + html.escape(amazon, quote=True) + '">Amazonで探す</a>'
    assert link_data(sample) == (amazon, "")
    print("Homepage product CTA self-tests passed.")


def run(mode):
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    page, _ = wp.call("/wp/v2/pages/805?context=edit&_fields=id,slug,content")
    if page.get("id") != 805 or page.get("slug") != "shopping-home":
        raise RuntimeError("Homepage identity verification failed.")
    raw = page.get("content", {}).get("raw", "")
    updated, count = update_cards(raw, wp)
    if mode == "check":
        print("READY: " + str(count) + " homepage cards have verified Amazon/Rakuten affiliate links.")
        return
    if updated == raw:
        print("NO CHANGE: all three homepage cards already have both retailer buttons.")
        return
    wp.call("/wp/v2/pages/805", {"content": updated})
    saved, _ = wp.call("/wp/v2/pages/805?context=edit&_fields=id,slug,content")
    verify = saved.get("content", {}).get("raw", "")
    if saved.get("id") != 805 or verify != updated or verify.count(MARKER) != count:
        raise RuntimeError("Homepage REST write/readback verification failed.")
    print("UPDATED: added Amazon and Rakuten buttons to " + str(count) + " homepage product cards.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("check", "apply"), default="check")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        self_test() if args.self_test else run(args.mode)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
