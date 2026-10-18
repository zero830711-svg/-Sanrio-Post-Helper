"""Read-only inspect the current homepage product-card HTML using WP REST."""
import sys
from urllib import error
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("directory", ROOT / "scripts/build-product-directory.py")
directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)


def main():
    wp = directory.WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    home, _ = wp.call("/wp/v2/pages/805?context=edit&_fields=id,slug,title,content")
    goods, _ = wp.call("/wp/v2/pages/804?context=edit&_fields=id,slug,title,content")
    raw = home.get("content", {}).get("raw", "")
    print("HOME", home.get("id"), home.get("slug"), "chars", len(raw))
    print("GOODS", goods.get("id"), goods.get("slug"), "Amazon buttons", raw_count(goods, "Amazonで探す"), "Rakuten buttons", raw_count(goods, "楽天で探す"))
    needle = "新しく掲載したグッズ"
    pos = raw.find(needle)
    if pos < 0:
        print("HOME_PRODUCT_HEADING_NOT_FOUND")
        return
    snippet = raw[max(0, pos - 1000):min(len(raw), pos + 9500)]
    print("HOME_PRODUCT_SECTION_START")
    print(snippet)
    print("HOME_PRODUCT_SECTION_END")


def raw_count(page, text):
    return page.get("content", {}).get("raw", "").count(text)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Inspection failed: " + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
