"""Resume publishing five reviewed Sanrio product guides via the standard WP REST API."""
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


def pending_candidates(wp, products):
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    existing = wp.posts()
    pending = []
    for product in products:
        hits = publisher.duplicates(product, existing)
        slug = "goods-jan-" + product["jan"]
        if not hits:
            print("READY:", product["jan"], product["title"])
            pending.append(product)
        elif len(hits) == 1 and hits[0]["slug"] == slug and hits[0]["status"] == "draft":
            print("RESUME_DRAFT:", product["jan"], hits[0]["id"])
            pending.append(product)
        elif len(hits) == 1 and hits[0]["slug"] == slug and hits[0]["status"] == "publish":
            print("ALREADY_PUBLISHED:", product["jan"], hits[0]["id"])
        else:
            raise RuntimeError("Unexpected duplicate state for JAN " + product["jan"] + "; no further posts were changed.")
    return pending


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "publish"], default="check")
    args = parser.parse_args()
    try:
        products = load_candidates()
        wp = publisher.WordPress()
        pending = pending_candidates(wp, products)
        print("PENDING_COUNT:", len(pending))
        if args.mode == "publish" and pending:
            publisher.run("publish", wp, pending)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
