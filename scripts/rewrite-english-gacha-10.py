"""Safely rewrite exactly ten existing English gacha pages after a manual preflight."""
import argparse, base64, html, json, os, re, sys, time
from pathlib import Path
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
UA = "SanrioEnglishRewrite/1.0"
RETRY = {429, 500, 502, 503, 504}

def plain(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))).strip()

class WP:
    def __init__(self):
        user = os.environ.get("SANRIO_WP_USER", "").strip()
        password = "".join(os.environ.get("SANRIO_WP_APP_PASSWORD", "").split())
        if not user or not password:
            raise RuntimeError("WordPress REST credentials are not configured.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "User-Agent": UA}
    def call(self, method, path, payload=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only WordPress standard REST routes are allowed.")
        body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        headers = dict(self.headers)
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(SITE + "/wp-json" + path, data=body, headers=headers, method=method)
        for attempt in range(4):
            try:
                with request.urlopen(req, timeout=45) as response:
                    return json.load(response)
            except error.HTTPError as exc:
                if exc.code not in RETRY or attempt == 3:
                    raise RuntimeError(f"WordPress REST returned HTTP {exc.code} for {path.split('?', 1)[0]}.") from None
                time.sleep(2 ** attempt)
            except (error.URLError, TimeoutError, OSError):
                if attempt == 3:
                    raise RuntimeError(f"WordPress REST did not respond for {path.split('?', 1)[0]}.") from None
                time.sleep(2 ** attempt)

def load(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = data.get("articles")
    if data.get("schema_version") != 1 or data.get("expected_count") != 10 or not isinstance(rows, list) or len(rows) != 10:
        raise RuntimeError("Review data must contain exactly ten approved rewrites.")
    ids, slugs = set(), set()
    for row in rows:
        required = ("id", "slug", "title", "source_url", "excerpt", "content", "marker")
        if any(not row.get(key) for key in required):
            raise RuntimeError("Each rewrite needs id, slug, title, source, excerpt, content, and marker.")
        if row["id"] in ids or row["slug"] in slugs:
            raise RuntimeError("Duplicate post ID or slug in rewrite data.")
        ids.add(row["id"]); slugs.add(row["slug"])
        source = parse.urlsplit(row["source_url"])
        if source.scheme != "https" or source.hostname not in {"tokyo-yumeya.co.jp", "gashapon.jp"}:
            raise RuntimeError("A rewrite source is not an allowed official manufacturer URL.")
        if row["source_url"] not in row["content"] or row["marker"] not in plain(row["content"]):
            raise RuntimeError("A rewrite is missing its official source or its verification marker.")
    return rows

def check_current(wp, row):
    post = wp.call("GET", f"/wp/v2/posts/{int(row['id'])}?context=edit")
    title = post.get("title", {}).get("raw", post.get("title", {}).get("rendered", ""))
    content = post.get("content", {}).get("raw", post.get("content", {}).get("rendered", ""))
    if post.get("status") != "publish" or post.get("slug") != row["slug"] or plain(title) != plain(row["title"]):
        raise RuntimeError("Post identity changed and cannot be rewritten safely: " + row["slug"])
    if row["source_url"] not in content:
        raise RuntimeError("Expected official source is absent from current content: " + row["slug"])
    return post

def public_check(link, marker):
    for attempt in range(6):
        try:
            url = link + ("&" if "?" in link else "?") + "_rewrite_verify=" + str(time.time_ns())
            req = request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
            with request.urlopen(req, timeout=35) as response:
                body = response.read(2_000_000).decode("utf-8", "replace")
                if response.status == 200 and marker in plain(body):
                    return
        except (error.HTTPError, error.URLError, TimeoutError, OSError):
            pass
        time.sleep(2)
    raise RuntimeError("Public page did not show rewritten marker: " + link)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("json_file")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    rows = load(args.json_file)
    wp = WP()
    planned = []
    for row in rows:
        planned.append((row, check_current(wp, row)))
        print("Preflight passed: " + row["slug"], flush=True)
    print("All 10 existing pages passed identity and source checks.", flush=True)
    if not args.apply:
        return
    for row, prior in planned:
        updated = wp.call("POST", f"/wp/v2/posts/{int(row['id'])}", {"content": row["content"], "excerpt": row["excerpt"]})
        saved = wp.call("GET", f"/wp/v2/posts/{int(row['id'])}?context=edit")
        content = saved.get("content", {}).get("raw", saved.get("content", {}).get("rendered", ""))
        if saved.get("slug") != row["slug"] or row["source_url"] not in content or row["marker"] not in plain(content):
            raise RuntimeError("REST verification failed after rewrite: " + row["slug"])
        public_check(saved["link"], row["marker"])
        print("Rewritten and publicly verified: " + saved["link"], flush=True)
    print("All 10 English pages were rewritten and publicly verified.", flush=True)

if __name__ == "__main__":
    main()
