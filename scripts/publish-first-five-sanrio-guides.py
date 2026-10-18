"""Review and publish only the first five reviewed product guides via WP REST."""
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "draft", "publish"], default="check")
    args = parser.parse_args()
    try:
        source = ROOT / "blog/products-2026-10-18.json"
        products = json.loads(source.read_text(encoding="utf-8"))
        if len(products) != 5:
            raise RuntimeError("The reviewed first batch must contain exactly five products.")
        publisher.run(args.mode, publisher.WordPress(), products)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
