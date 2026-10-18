"""Publish five unlisted guides from the reviewed candidate batches via WP REST."""
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
    products = []
    for filename in ("products-2026-10-18-batch2.json", "products-2026-10-18-batch3.json"):
        products.extend(json.loads((ROOT / "blog" / filename).read_text(encoding="utf-8")))
    if len(products) != 10:
        raise RuntimeError("The reviewed candidate batches must contain exactly ten products.")
    return products


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "publish"], default="check")
    args = parser.parse_args()
    try:
        products = load_candidates()
        wp = publisher.WordPress()
        if args.mode == "check":
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
            if len(ready) < 5:
                raise RuntimeError("Fewer than five unlisted candidates remain.")
            print("READY_COUNT:", len(ready))
        else:
            wp.call("/wp/v2/users/me?context=edit&_fields=id")
            existing = wp.posts()
            ready = [p for p in products if not publisher.duplicates(p, existing)]
            if len(ready) < 5:
                raise RuntimeError("Fewer than five unlisted candidates remain.")
            selected = ready[:5]
            print("SELECTED:", " | ".join(p["title"] for p in selected))
            publisher.run("publish", wp, selected)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
