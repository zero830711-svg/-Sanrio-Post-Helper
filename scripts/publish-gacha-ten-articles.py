"""Preflight and publish exactly ten reviewed, source-linked gacha articles."""
import argparse
import base64
import html
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
USER_AGENT = "SanrioReviewedGachaTen/1.0"


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("WordPress redirected a REST request; verify the configured site URL.")


class WordPress:
    def __init__(self):
        user = os.environ.get("SANRIO_WP_USER", "").strip()
        password = "".join(os.environ.get("SANRIO_WP_APP_PASSWORD", "").split())
        if not user or not password:
            raise RuntimeError("WordPress REST credentials are not configured.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "User-Agent": USER_AGENT}
        self.opener = request.build_opener(NoRedirect)

    def call(self, method, path, data=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST API routes are allowed.")
        body = json.dumps(data, ensure_ascii=False).encode() if data is not None else None
        headers = dict(self.headers)
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(SITE + "/wp-json" + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s for %s." %
                               (exc.code, path.split("?", 1)[0])) from None


def plain(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))).strip()


def field(post, key):
    value = post.get(key, "")
    if isinstance(value, dict):
        return value.get("raw", value.get("rendered", ""))
    return value


def load_data(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    articles = data.get("articles")
    if data.get("schema_version") != 1 or data.get("expected_count") != 10:
        raise RuntimeError("The reviewed batch must declare schema version 1 and exactly ten posts.")
    if data.get("category_slug") != "gacha" or not isinstance(articles, list) or len(articles) != 10:
        raise RuntimeError("The reviewed batch must contain exactly ten gacha posts.")
    slugs, titles = set(), set()
    for article in articles:
        required = ("slug", "title", "excerpt", "content", "source_url")
        if any(not isinstance(article.get(key), str) or not article[key].strip() for key in required):
            raise RuntimeError("Every article needs a slug, title, excerpt, content, and official source.")
        slug = article["slug"]
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise RuntimeError("An article slug is invalid.")
        if slug in slugs or plain(article["title"]) in titles:
            raise RuntimeError("The reviewed batch contains duplicate slugs or titles.")
        slugs.add(slug)
        titles.add(plain(article["title"]))
        source = parse.urlsplit(article["source_url"])
        if source.scheme != "https" or not source.hostname:
            raise RuntimeError("An official source URL must use HTTPS.")
        if article["source_url"] not in article["content"]:
            raise RuntimeError("An article is missing its official source link.")
        if len(plain(article["content"])) < 300:
            raise RuntimeError("An article is too short to publish.")
        if "楽天市場API" in article["content"] or "ガチャガチャアイランド" in article["content"]:
            raise RuntimeError("An unapproved source reference was found.")
    return data


def resolve_category(wp, slug):
    rows = wp.call("GET", "/wp/v2/categories?" + parse.urlencode({
        "slug": slug, "context": "edit", "_fields": "id,slug"
    }))
    if len(rows) != 1 or rows[0].get("slug") != slug:
        raise RuntimeError("The gacha category could not be resolved uniquely.")
    return int(rows[0]["id"])


def lookup_slug(wp, slug):
    return wp.call("GET", "/wp/v2/posts?" + parse.urlencode({
        "slug": slug, "context": "edit", "per_page": 20,
        "_fields": "id,slug,status,link,title,content,categories"
    }))


def possible_title_duplicates(wp, title):
    rows = wp.call("GET", "/wp/v2/posts?" + parse.urlencode({
        "search": title, "context": "edit", "per_page": 20,
        "_fields": "id,slug,status,link,title"
    }))
    wanted = re.sub(r"[\W_]+", "", plain(title), flags=re.UNICODE).casefold()
    return [post for post in rows
            if re.sub(r"[\W_]+", "", plain(field(post, "title")), flags=re.UNICODE).casefold() == wanted]


def public_check(url, title):
    req = request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with request.urlopen(req, timeout=35) as response:
            body = response.read(2_000_000).decode("utf-8", "replace")
            if response.status != 200 or plain(title) not in plain(body):
                raise RuntimeError("A public article page did not pass its HTTP/title check: " + url)
    except error.HTTPError as exc:
        raise RuntimeError("A public article page returned HTTP %s: %s" % (exc.code, url)) from None


def preflight(data, wp):
    category_id = resolve_category(wp, data["category_slug"])
    plans = []
    for article in data["articles"]:
        existing = lookup_slug(wp, article["slug"])
        if len(existing) > 1:
            raise RuntimeError("More than one post uses a planned slug: " + article["slug"])
        if existing:
            post = existing[0]
            saved_title = plain(field(post, "title"))
            saved_content = field(post, "content")
            if (post.get("status") != "publish" or saved_title != plain(article["title"])
                    or article["source_url"] not in saved_content or category_id not in post.get("categories", [])):
                raise RuntimeError("An existing post conflicts with the planned article: " + article["slug"])
            plans.append((article, post, "already published"))
            continue
        duplicates = possible_title_duplicates(wp, article["title"])
        if duplicates:
            raise RuntimeError("A possible duplicate title already exists: " + article["title"])
        plans.append((article, None, "new"))
    print("Preflight passed: exactly %d reviewed gacha posts; %d new, %d already published." %
          (len(plans), sum(1 for _, _, state in plans if state == "new"),
           sum(1 for _, _, state in plans if state == "already published")), flush=True)
    for article, post, state in plans:
        print("%s | %s | %s" % (state, article["title"], post.get("link", "")), flush=True)
    return category_id, plans


def publish(data, wp, category_id, plans):
    results = []
    for article, existing, state in plans:
        if state == "already published":
            post = existing
        else:
            post = wp.call("POST", "/wp/v2/posts", {
                "title": article["title"],
                "slug": article["slug"],
                "status": "publish",
                "excerpt": article["excerpt"],
                "content": article["content"],
                "categories": [category_id],
                "comment_status": "closed",
                "ping_status": "closed",
            })
            if post.get("status") != "publish" or post.get("slug") != article["slug"]:
                raise RuntimeError("WordPress did not publish the planned post: " + article["slug"])
            verified = wp.call("GET", "/wp/v2/posts/%d?context=edit" % int(post["id"]))
            if (verified.get("status") != "publish" or verified.get("slug") != article["slug"]
                    or category_id not in verified.get("categories", [])
                    or article["source_url"] not in field(verified, "content")
                    or plain(field(verified, "title")) != plain(article["title"])):
                raise RuntimeError("A published post failed the WordPress REST verification: " + article["slug"])
            post = verified
        public_check(post["link"], article["title"])
        results.append(post)
        print("Verified public article: %s | %s" % (post["link"], article["title"]), flush=True)
    if len(results) != 10:
        raise RuntimeError("The exact-ten publication batch did not finish all ten posts.")
    print("Verified all ten public article pages.", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("json_file")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-only", action="store_true")
    mode.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    data = load_data(args.json_file)
    wp = WordPress()
    category_id, plans = preflight(data, wp)
    if args.publish:
        publish(data, wp, category_id, plans)


if __name__ == "__main__":
    main()
