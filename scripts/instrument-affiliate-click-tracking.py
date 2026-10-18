"""Instrument published Amazon/Rakuten affiliate links for GA4 via WordPress REST API."""
import argparse
import base64
import html
import json
import os
import re
import sys
from html.parser import HTMLParser
from urllib import error, request, parse

SITE = "https://sanrio-fan.site"
MARKER = "data-sf-ga4-event"
OPEN_TAG_RE = re.compile(r"<a\b[^>]*>", re.I)
ATTR_RE = lambda name: re.compile(r"\b" + re.escape(name) + r"\s*=\s*([\"'])(.*?)\1", re.I)
EVENTS = {"amazon": "amazon_affiliate_click", "rakuten": "rakuten_affiliate_click"}


def attr(tag, name):
    match = ATTR_RE(name).search(tag)
    return html.unescape(match.group(2)) if match else ""


def marketplace(href, classes):
    host = parse.urlsplit(href).hostname or ""
    if host == "amazon.co.jp" or host.endswith(".amazon.co.jp") or "sf-amazon" in classes:
        return "amazon"
    if host == "hb.afl.rakuten.co.jp" or host == "a.r10.to" or "sf-rakuten" in classes:
        return "rakuten"
    return ""


def tracked_anchor(tag):
    href = attr(tag, "href")
    store = marketplace(href, attr(tag, "class").split())
    if not store:
        return tag, ""
    event = EVENTS[store]
    handler = (
        "if(typeof window.gtag==='function'){"
        "window.gtag('event','" + event + "',{"
        "link_url:this.href,"
        "link_text:(this.innerText||this.textContent||'').trim(),"
        "transport_type:'beacon'"
        "});}"
    )
    marker_re = re.compile(r"\s+" + MARKER + r"\s*=\s*([\"'])(.*?)\1", re.I)
    onclick_re = ATTR_RE("onclick")
    existing_marker = marker_re.search(tag)
    existing_onclick = onclick_re.search(tag)
    if existing_marker and existing_onclick and event in existing_onclick.group(2):
        return tag, store
    if existing_onclick:
        merged = existing_onclick.group(2).rstrip(";") + ";" + handler
        tag = tag[:existing_onclick.start()] + 'onclick="' + html.escape(merged, quote=True) + '"' + tag[existing_onclick.end():]
    else:
        tag = tag[:-1] + ' onclick="' + html.escape(handler, quote=True) + '">'
    existing_marker = marker_re.search(tag)
    if existing_marker:
        tag = tag[:existing_marker.start()] + ' ' + MARKER + '="' + event + '"' + tag[existing_marker.end():]
    else:
        tag = tag[:-1] + ' ' + MARKER + '="' + event + '">'
    return tag, store


def instrument(content):
    counts = {"amazon": 0, "rakuten": 0}
    def replace(match):
        tag, store = tracked_anchor(match.group(0))
        if store:
            counts[store] += 1
        return tag
    return OPEN_TAG_RE.sub(replace, content), counts


class WordPress:
    def __init__(self):
        user = os.getenv("SANRIO_WP_USER", "")
        password = os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("WordPress REST credentials are missing from GitHub Actions secrets.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "User-Agent": "SanrioGA4AffiliateTracking/1.0"}
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


def get_published(wp, route):
    records = []
    page_num = 1
    while True:
        query = parse.urlencode({
            "status": "publish", "per_page": 100, "page": page_num,
            "context": "edit", "_fields": "id,slug,status,content"
        })
        rows, headers = wp.call("/wp/v2/" + route + "?" + query)
        if not isinstance(rows, list):
            raise RuntimeError("WordPress REST did not return a published " + route + " list.")
        records.extend(rows)
        if len(rows) < 100:
            break
        page_num += 1
        if page_num > 100:
            raise RuntimeError("Pagination safety limit reached.")
    return records


def self_test():
    tag = '<a class="sf-amazon" href="https://www.amazon.co.jp/s?k=test&amp;tag=ononbrothers2-22">Amazon</a>'
    tracked, store = tracked_anchor(tag)
    assert store == "amazon" and "amazon_affiliate_click" in tracked and MARKER in tracked
    assert tracked_anchor(tracked)[0] == tracked
    rakuten, store = tracked_anchor('<a class="sf-rakuten" href="https://hb.afl.rakuten.co.jp/hgc/test/">楽天市場</a>')
    assert store == "rakuten" and "rakuten_affiliate_click" in rakuten
    untouched, store = tracked_anchor('<a href="https://example.com/">外部</a>')
    assert not store and untouched.endswith(">")
    print("Affiliate click tracking self-tests passed.")


def run(mode):
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    items = [(route, row) for route in ("posts", "pages") for row in get_published(wp, route)]
    matched = 0
    tracked_total = {"amazon": 0, "rakuten": 0}
    for route, row in items:
        content = row.get("content", {}).get("raw", "")
        if not content:
            continue
        updated, counts = instrument(content)
        if not sum(counts.values()):
            continue
        matched += 1
        for store in EVENTS:
            tracked_total[store] += counts[store]
        if mode == "check" or updated == content:
            continue
        wp.call("/wp/v2/" + route + "/" + str(row["id"]), {"content": updated})
        saved, _ = wp.call("/wp/v2/" + route + "/" + str(row["id"]) + "?context=edit&_fields=id,slug,content")
        saved_content = saved.get("content", {}).get("raw", "")
        if saved.get("id") != row["id"] or saved_content != updated:
            raise RuntimeError("REST readback verification failed for " + route + "/" + str(row["id"]) + ".")
    if not matched:
        raise RuntimeError("No published Amazon/Rakuten affiliate links were found.")
    print("MODE: " + mode)
    print("PAGES_WITH_AFFILIATE_LINKS: " + str(matched))
    print("AMAZON_LINKS: " + str(tracked_total["amazon"]))
    print("RAKUTEN_LINKS: " + str(tracked_total["rakuten"]))
    if mode == "check":
        print("READY: affiliate links can be instrumented through GA4 events.")
    else:
        print("UPDATED: affiliate click events added and verified by REST readback.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("check", "apply"), default="check")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
        else:
            run(args.mode)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
