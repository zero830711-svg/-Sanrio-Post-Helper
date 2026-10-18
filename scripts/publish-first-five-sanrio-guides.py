"""Publish five reviewed, unique Sanrio product guides via the standard WP REST API."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
module_path = ROOT / "scripts" / "publish-sanrio-products.py"
spec = importlib.util.spec_from_file_location("publish_sanrio_products", module_path)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def load_candidates():
    products = json.loads((ROOT / "blog" / "products-2026-10-18-batch4.json").read_text(encoding="utf-8"))
    if len(products) != 5:
        raise RuntimeError("The reviewed batch must contain exactly five candidates.")
    return products


def unique_candidates(wp, products):
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    existing = wp.posts()
    ready = []
    for product in products:
        hits = publisher.duplicates(product, existing)
        if hits:
            print("SKIP existing:", product["jan"], ",".join(str(p["id"]) for p in hits))
        else:
            print("READY:", product["jan"], product["title"])
            ready.append(product)
    return ready


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "publish"], default="check")
    args = parser.parse_args()
    try:
        products = load_candidates()
        wp = publisher.WordPress()
        ready = unique_candidates(wp, products)
        if len(ready) != 5:
            raise RuntimeError(f"Expected five unique products; found {len(ready)}. No article was published.")
        print("READY_COUNT:", len(ready))\n        print("SOURCE_BATCH: 2026-10-18-batch4")
        if args.mode == "publish":
            publisher.run("publish", wp, ready)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
