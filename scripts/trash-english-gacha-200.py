#!/usr/bin/env python3
"""Move exactly the 200 published Gacha in English batch posts to WordPress trash.

This is intentionally narrow and never uses force=true.  It refuses to act
unless the live category is exactly the two known 100-post English batches.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

SITE = "https://sanrio-fan.site"
CATEGORY_SLUG = "gacha-in-english"
EXPECTED_COUNT = 200
BATCH_FILES = (
    "blog/reviewed-gacha/100-english-products-2026-10-batch-01.json",
    "blog/reviewed-gacha/100-english-products-2026-10-batch-02.json",
)


def fail(message: str) -> None:
    raise SystemExit(f"STOP: {message}")


def load_expected() -> set[str]:
    slugs: list[str] = []
    for filename in BATCH_FILES:
        payload = json.loads(Path(filename).read_text(encoding="utf-8"))
        if payload.get("expected_count") != 100:
            fail(f"{filename}: expected_count is not 100")
        if payload.get("category_slug") != CATEGORY_SLUG:
            fail(f"{filename}: category slug does not match")
        articles = payload.get("articles")
        if not isinstance(articles, list) or len(articles) != 100:
            fail(f"{filename}: articles are not exactly 100")
        slugs.extend(item.get("slug", "") for item in articles)
    if len(slugs) != EXPECTED_COUNT or len(set(slugs)) != EXPECTED_COUNT or any(not slug for slug in slugs):
        fail("the two source batches do not produce 200 unique slugs")
    return set(slugs)


def get_json(session: requests.Session, path: str, **params):
    response = session.get(f"{SITE}{path}", params=params, timeout=30)
    response.raise_for_status()
    return response


def live_category(session: requests.Session) -> tuple[int, list[dict]]:
    category_response = get_json(session, "/wp-json/wp/v2/categories", slug=CATEGORY_SLUG, per_page=10)
    categories = category_response.json()
    if len(categories) != 1:
        fail("the English category cannot be identified uniquely")
    category_id = categories[0]["id"]

    first = get_json(
        session,
        "/wp-json/wp/v2/posts",
        categories=category_id,
        status="publish",
        per_page=100,
        page=1,
        orderby="id",
        order="asc",
    )
    total = int(first.headers.get("X-WP-Total", "0"))
    total_pages = int(first.headers.get("X-WP-TotalPages", "0"))
    if total != EXPECTED_COUNT or total_pages != 2:
        fail(f"live category count is {total} posts across {total_pages} pages, not exactly 200")

    posts = first.json()
    second = get_json(
        session,
        "/wp-json/wp/v2/posts",
        categories=category_id,
        status="publish",
        per_page=100,
        page=2,
        orderby="id",
        order="asc",
    )
    posts.extend(second.json())
    if len(posts) != EXPECTED_COUNT:
        fail(f"category returned {len(posts)} records, not 200")
    return category_id, posts


def preflight(session: requests.Session) -> list[dict]:
    expected = load_expected()
    category_id, posts = live_category(session)
    actual = {post["slug"] for post in posts}
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        fail(
            "live category differs from the exact English batches "
            f"(missing={len(missing)}, unexpected={len(unexpected)})"
        )
    if any(post.get("status") != "publish" for post in posts):
        fail("a target is not published")
    if any(category_id not in post.get("categories", []) for post in posts):
        fail("a fetched post does not belong to the target category")
    return sorted(posts, key=lambda post: post["id"])


def main() -> None:
    apply = sys.argv[1:] == ["--apply"]
    if not apply and len(sys.argv) != 1:
        fail("usage: trash-english-gacha-200.py [--apply]")

    session = requests.Session()
    posts = preflight(session)
    print(f"PRECHECK OK: exactly {len(posts)} published Gacha in English posts match the two approved batches.")
    if not apply:
        print("DRY RUN ONLY: no WordPress content was changed.")
        return

    user = os.environ.get("SANRIO_WP_USER")
    password = os.environ.get("SANRIO_WP_APP_PASSWORD")
    if not user or not password:
        fail("WordPress credentials are not configured")
    session.auth = (user, password)

    # Re-check immediately before mutation, then move each exact post to Trash.
    posts = preflight(session)
    trashed_ids: list[int] = []
    for post in posts:
        current = get_json(session, f"/wp-json/wp/v2/posts/{post['id']}", context="edit").json()
        if current.get("status") != "publish" or current.get("slug") != post["slug"]:
            fail(f"target changed before trashing: {post['id']}")
        response = session.delete(
            f"{SITE}/wp-json/wp/v2/posts/{post['id']}",
            params={"force": "false"},
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        if not result.get("deleted") or result.get("previous", {}).get("id") != post["id"]:
            fail(f"WordPress did not confirm trashing post {post['id']}")
        trashed_ids.append(post["id"])

    _, remaining = live_category(session)
    if remaining:
        fail(f"{len(remaining)} published posts still remain in the English category")
    print(f"APPLY OK: moved {len(trashed_ids)} exact English posts to the WordPress Trash.")
    print("No post was permanently deleted.")


if __name__ == "__main__":
    main()
