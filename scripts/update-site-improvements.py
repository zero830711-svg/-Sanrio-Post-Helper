"""Apply one reviewed set of WordPress content updates through the standard REST API."""
import base64
import json
import os
import sys
from pathlib import Path
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
EXPECTED_POSTS = {
    359: "sanrio-gashapon-2026-10",
    320: "%e3%82%a2%e3%82%b8%e3%82%a2%e5%a4%a7%e4%bc%9ax%e3%82%b5%e3%83%b3%e3%83%aa%e3%82%aa%e5%85%ac%e5%bc%8f%e3%82%b0%e3%83%83%e3%82%ba%ef%bd%9c%e5%90%8d%e5%8f%a4%e5%b1%8b%e3%81%a7%e8%b2%b7%e3%81%88",
}
EXPECTED_LINKS = {
    359: "https://sanrio-fan.site/sanrio-gashapon-2026-10/",
    320: "https://sanrio-fan.site/%e3%82%a2%e3%82%b8%e3%82%a2%e5%a4%a7%e4%bc%9ax%e3%82%b5%e3%83%b3%e3%83%aa%e3%82%aa%e5%85%ac%e5%bc%8f%e3%82%b0%e3%83%83%e3%82%ba%ef%bd%9c%e5%90%8d%e5%8f%a4%e5%b1%8b%e3%81%a7%e8%b2%b7%e3%81%88/",
}
EXPECTED_CATEGORY = {8: "gacha"}


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("WordPress REST redirects are refused.")


class WordPress:
    def __init__(self):
        user = os.environ.get("SANRIO_WP_USER", "")
        password = os.environ.get("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("Required WordPress Action secrets are missing.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.headers = {
            "Authorization": "Basic " + token,
            "User-Agent": "SanrioSiteImprovement/1.0",
            "Accept": "application/json",
        }
        self.opener = request.build_opener(NoRedirect)

    def call(self, path, data=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        route, separator, query = path.partition("?")
        url = SITE + "/?rest_route=" + parse.quote(route, safe="/")
        if separator:
            url += "&" + query
        body = json.dumps(data, ensure_ascii=False).encode() if data is not None else None
        headers = dict(self.headers)
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError(f"WordPress returned HTTP {exc.code} for {route}.") from None


def raw_field(obj, key):
    value = obj.get(key, "")
    if isinstance(value, dict):
        return value.get("raw", value.get("rendered", ""))
    return value or ""


def update_post(wp, item):
    post_id = item.get("id")
    if post_id not in EXPECTED_POSTS or item.get("slug") != EXPECTED_POSTS[post_id]:
        raise RuntimeError("A post did not match the fixed ID and slug allowlist.")
    if item.get("link") != EXPECTED_LINKS[post_id]:
        raise RuntimeError("A post link did not match the fixed URL allowlist.")
    for key in ("expected_old_title", "title", "excerpt", "content"):
        if not item.get(key):
            raise RuntimeError("A reviewed post update is incomplete.")
    if "ガチャガチャアイランド" in item["content"]:
        raise RuntimeError("A prohibited source name was found in the article body.")
    if any(marker not in item["content"] for marker in item.get("required_content", [])):
        raise RuntimeError("A required source-grounded content marker is missing.")

    path = "/wp/v2/posts/" + str(post_id)
    current = wp.call(path + "?context=edit")
    if (current.get("id") != post_id or current.get("slug") != item["slug"]
            or current.get("status") != "publish" or current.get("link") != item["link"]
            or raw_field(current, "title") != item["expected_old_title"]):
        raise RuntimeError("The live post changed since review; refusing to overwrite it.")
    before = {
        "featured_media": current.get("featured_media"),
        "categories": current.get("categories"),
        "status": current.get("status"),
        "link": current.get("link"),
    }

    wp.call(path, data={
        "title": item["title"],
        "excerpt": item["excerpt"],
        "content": item["content"],
    })
    saved = wp.call(path + "?context=edit")
    saved_content = raw_field(saved, "content")
    if (saved.get("id") != post_id or saved.get("slug") != item["slug"]
            or saved.get("status") != before["status"] or saved.get("link") != before["link"]
            or saved.get("featured_media") != before["featured_media"]
            or saved.get("categories") != before["categories"]
            or raw_field(saved, "title") != item["title"]
            or raw_field(saved, "excerpt") != item["excerpt"]
            or any(marker not in saved_content for marker in item.get("required_content", []))):
        raise RuntimeError("The saved post did not pass identity and content verification.")
    print("UPDATED post", post_id, saved["link"], flush=True)


def update_category(wp, item):
    category_id = item.get("id")
    if category_id not in EXPECTED_CATEGORY or item.get("slug") != EXPECTED_CATEGORY[category_id]:
        raise RuntimeError("A category did not match the fixed ID and slug allowlist.")
    if not item.get("description") or not item.get("required_description"):
        raise RuntimeError("The category update is incomplete.")
    path = "/wp/v2/categories/" + str(category_id)
    current = wp.call(path + "?context=edit")
    if current.get("id") != category_id or current.get("slug") != item["slug"]:
        raise RuntimeError("The live category identity did not match the review.")
    current_description = raw_field(current, "description")
    if any(marker not in current_description for marker in item.get("expected_description_markers", [])):
        raise RuntimeError("The category hub changed since review; refusing to overwrite it.")

    wp.call(path, data={"description": item["description"]})
    saved = wp.call(path + "?context=edit")
    description = raw_field(saved, "description")
    if (saved.get("id") != category_id or saved.get("slug") != item["slug"]
            or any(marker not in description for marker in item["required_description"])):
        raise RuntimeError("The saved category hub did not pass verification.")
    print("UPDATED category", category_id, SITE + "/category/gacha/", flush=True)


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: update-site-improvements.py UPDATE_JSON")
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    posts = data.get("posts")
    category = data.get("category")
    if not isinstance(posts, list) or {item.get("id") for item in posts} != set(EXPECTED_POSTS):
        raise RuntimeError("The update must contain exactly the two approved post IDs.")
    if not isinstance(category, dict) or category.get("id") != 8:
        raise RuntimeError("The update must contain exactly the approved gacha category.")
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    for item in posts:
        update_post(wp, item)
    update_category(wp, category)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
