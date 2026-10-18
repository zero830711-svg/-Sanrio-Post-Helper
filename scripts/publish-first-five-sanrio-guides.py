"""Review and publish only the first five reviewed product guides via WP REST."""
import argparse
import json
import sys
from pathlib import Path

from publish_sanrio_products import ROOT, WordPress, run


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "draft", "publish"], default="check")
    args = parser.parse_args()
    try:
        source = ROOT / "blog/products-2026-10-18.json"
        products = json.loads(source.read_text(encoding="utf-8"))
        if len(products) != 5:
            raise RuntimeError("The reviewed first batch must contain exactly five products.")
        run(args.mode, WordPress(), products)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
