"""Resolve owner affiliate search links before publishing one capsule-toy roundup."""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib import parse

AMAZON_TAG = "ononbrothers2-22"
TOKEN_RE = re.compile(r"\{\{(amazon|rakuten):([a-z0-9-]+)\}\}")


def amazon_search_url(query):
    query = str(query or "").strip()
    if len(query) < 3 or len(query) > 120:
        raise RuntimeError("An Amazon search phrase is missing or invalid.")
    return "https://www.amazon.co.jp/s?" + parse.urlencode({"k": query, "tag": AMAZON_TAG})


def resolve_rakuten(query, config_path, work_dir, index):
    mini_path = work_dir / f"rakuten-query-{index}.json"
    output_path = work_dir / f"rakuten-result-{index}.json"
    mini_path.write_text(json.dumps({"rakuten_search_query": query}, ensure_ascii=False), encoding="utf-8")
    result = subprocess.run(
        ["php", "scripts/resolve-gacha-affiliate.php", str(config_path), str(mini_path), str(output_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not output_path.exists():
        raise RuntimeError("A Rakuten affiliate search link could not be resolved.")
    value = json.loads(output_path.read_text(encoding="utf-8")).get("rakuten_affiliate_url", "")
    parts = parse.urlsplit(value)
    if (parts.scheme != "https" or parts.hostname != "hb.afl.rakuten.co.jp"
            or not re.fullmatch(r"/hgc/[a-zA-Z0-9._-]{8,128}/?", parts.path)
            or parts.username or parts.password or parts.port or parts.fragment):
        raise RuntimeError("A Rakuten affiliate URL failed validation.")
    return value


def main():
    if len(sys.argv) != 3:
        raise RuntimeError("Usage: prepare-gacha-roundup.py ARTICLE_JSON CONFIG_PHP")
    article_path = Path(sys.argv[1])
    config_path = Path(sys.argv[2])
    article = json.loads(article_path.read_text(encoding="utf-8"))
    products = article.get("affiliate_products")
    if not isinstance(products, list) or len(products) != 5:
        raise RuntimeError("The October roundup must include exactly five affiliate products.")
    slugs = [str(product.get("slug", "")) for product in products]
    if len(set(slugs)) != len(slugs) or any(not re.fullmatch(r"[a-z0-9-]{3,60}", slug) for slug in slugs):
        raise RuntimeError("The roundup product identifiers are invalid or duplicated.")
    content = article.get("content", "")
    if content.count("{{image_url}}") != 1:
        raise RuntimeError("The roundup must contain one featured-image placeholder.")

    with tempfile.TemporaryDirectory(prefix="gacha-roundup-affiliates-") as temp:
        work_dir = Path(temp)
        for index, product in enumerate(products, start=1):
            slug = product["slug"]
            urls = {
                f"{{{{amazon:{slug}}}}}": amazon_search_url(product.get("amazon_search_query")),
                f"{{{{rakuten:{slug}}}}}": resolve_rakuten(
                    product.get("rakuten_search_query"), config_path, work_dir, index
                ),
            }
            for marker, url in urls.items():
                if content.count(marker) != 1:
                    raise RuntimeError("Each product must contain one Amazon and one Rakuten link placeholder.")
                content = content.replace(marker, url)
    if TOKEN_RE.search(content):
        raise RuntimeError("An affiliate placeholder was not resolved.")

    article["content"] = content
    article_path.write_text(json.dumps(article, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Resolved and validated affiliate search links for five products.")
    result = subprocess.run([sys.executable, "scripts/publish-editorial-article.py", str(article_path)], check=False)
    if result.returncode != 0:
        raise RuntimeError("The WordPress REST publisher did not complete successfully.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Roundup publication failed.", file=sys.stderr)
        sys.exit(1)
