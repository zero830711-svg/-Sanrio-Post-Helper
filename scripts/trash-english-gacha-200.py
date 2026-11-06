#!/usr/bin/env python3
"""Move exactly the 200 Gacha in English batch posts to WordPress Trash.

This is intentionally narrow and never uses force=true. It validates every
live target against its original fixed WordPress ID before moving it to Trash.
A retry accepts an absent target only when that same ID is already in Trash.
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
FIRST_POST_ID = 7639
BATCH_FILES = (
    "blog/reviewed-gacha/100-english-products-2026-10-batch-01.json",
    "blog/reviewed-gacha/100-english-products-2026-10-batch-02.json",
)


def fail(message: str) -> None:
    raise SystemExit(f"STOP: {message}")


def load_expected() -> dict[str, int]:
    slugs: list[str] = []
    for filename in BATCH_FILES:
        payload = json.loads(Path(filename).read_text(encoding="utf-8"))
        if payload.get("expected_count") != 100 or payload.get("category_slug") != CATEGORY_SLUG:
            fail(f"{filename}: unexpected source-batch metadata")
        articles = payload.get("articles")
        if not isinstance(articles, list) or len(articles) != 100:
            fail(f"{filename}: articles are not exactly 100")
        slugs.extend(item.get("slug", "") for item in articles)
    if len(slugs) != EXPECTED_COUNT or len(set(slugs)) != EXPECTED_COUNT or any(not slug for slug in slugs):
        fail("the source batches do not produce 200 unique slugs")
    return {slug: FIRST_POST_ID + offset for offset, slug in enumerate(slugs)}


def get_json(session: requests.Session, path: str, **params) -> requests.Response:
    response = session.get(f"{SITE}{path}", params=params, timeout=30)
    response.raise_for_status()
    return response


def category_and_published(session: requests.Session) -> tuple[int, list[dict]]:
    category_response = get_json(session, "/wp-json/wp/v2/categories", slug=CATEGORY_SLUG, per_page=10)
    categories = category_response.json()
    if len(categories) != 1:
        fail("the English category cannot be identified uniquely")
    category_id = categories[0]["id"]

    first = get_json(
        session, "/wp-json/wp/v2/posts", categories=category_id, status="publish",
        per_page=100, page=1, orderby="id", order="asc",
    )
    total = int(first.headers.get("X-WP-Total", "0"))
    total_pages = int(first.headers.get("X-WP-TotalPages", "0"))
    if total < 0 or total > EXPECTED_COUNT or total_pages > 2:
        fail(f"live English category count is unsafe to process: {total} posts across {total_pages} pages")

    posts = first.json()
    if total_pages == 2:
        second = get_json(
            session, "/wp-json/wp/v2/posts", categories=category_id, status="publish",
            per_page=100, page=2, orderby="id", order="asc",
        )
        posts.extend(second.json())
    if len(posts) != total:
        fail(f"category returned {len(posts)} records but reported {total}")
    return category_id, posts


def confirm_in_trash(session: requests.Session, missing: dict[str, int]) -> None:
    if not missing:
        return
    if session.auth is None:
        fail(f"{len(missing)} expected posts are missing; credentials are required to confirm Trash")
    for slug, post_id in sorted(missing.items(), key=lambda item: item[1]):
        trashed = get_json(session, f"/wp-json/wp/v2/posts/{post_id}", context="edit").json()
        # WordPress may append __trashed to the slug, so status and immutable ID are used here.
        if trashed.get("id") != post_id or trashed.get("status") != "trash":
            fail(f"missing target is not confirmed in WordPress Trash: {slug} (ID {post_id})")


def preflight(session: requests.Session) -> tuple[int, list[dict], int]:
    expected = load_expected()
    category_id, posts = category_and_published(session)
    actual = {post["slug"]: post for post in posts}
    unexpected = set(actual) - set(expected)
    if unexpected:
        fail(f"live English category has {len(unexpected)} unapproved post(s)")
    for slug, post in actual.items():
        if post.get("id") != expected[slug]:
            fail(f"live target ID changed: {slug}")
        if post.get("status") != "publish" or category_id not in post.get("categories", []):
            fail(f"live target has an unsafe state: {slug}")
    missing = {slug: post_id for slug, post_id in expected.items() if slug not in actual}
    confirm_in_trash(session, missing)
    return category_id, sorted(posts, key=lambda post: post["id"]), len(missing)


def main() -> None:
    apply = sys.argv[1:] == ["--apply"]
    if not apply and len(sys.argv) != 1:
        fail("usage: trash-english-gacha-200.py [--apply]")

    user = os.environ.get("SANRIO_WP_USER")
    password = os.environ.get("SANRIO_WP_APP_PASSWORD")
    if apply and (not user or not password):
        fail("WordPress credentials are not configured")

    session = requests.Session()
    if user and password:
        session.auth = (user, password)

    category_id, posts, already_trashed = preflight(session)
    print(
        f"PRECHECK OK: {len(posts)} published targets have the expected IDs; "
        f"{already_trashed} target(s) are already in WordPress Trash."
    )
    if not apply:
        print("DRY RUN ONLY: no WordPress content was changed.")
        return

    category_id, posts, already_trashed = preflight(session)
    trashed_ids: list[int] = []
    for post in posts:
        current = get_json(session, f"/wp-json/wp/v2/posts/{post['id']}", context="edit").json()
        if current.get("id") != post["id"] or current.get("status") != "publish" or current.get("slug") != post["slug"]:
            fail(f"target changed before trashing: {post['id']}")
        response = session.delete(
            f"{SITE}/wp-json/wp/v2/posts/{post['id']}",
            params={"force": "false"},
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        if result.get("deleted") is not True:
            fail(f"WordPress did not confirm trashing post {post['id']}")
        after = get_json(session, f"/wp-json/wp/v2/posts/{post['id']}", context="edit").json()
        if after.get("id") != post["id"] or after.get("status") != "trash":
            fail(f"post was not confirmed in Trash: {post['id']}")
        trashed_ids.append(post["id"])

    remaining_response = get_json(
        session, "/wp-json/wp/v2/posts", categories=category_id, status="publish",
        per_page=1, page=1,
    )
    remaining_count = int(remaining_response.headers.get("X-WP-Total", "0"))
    if remaining_count != 0:
        fail(f"{remaining_count} published posts still remain in the English category")
    print(
        f"APPLY OK: moved {len(trashed_ids)} posts in this run; "
        f"{already_trashed + len(trashed_ids)} of 200 targets are in WordPress Trash."
    )
    print("No post was permanently deleted.")


if __name__ == "__main__":
    main()
