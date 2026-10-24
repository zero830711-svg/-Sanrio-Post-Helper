"""Prepare one gacha article with an official product image and verified affiliate links."""
import argparse
import base64
import io
import json
import re
import sys
from pathlib import Path
from urllib import error, parse, request

from PIL import Image, ImageOps

OFFICIAL_IMAGE = "https://kitan.jp/wp-content/uploads/2026/10/260824_sanriowatch4_DP.jpg"
AMAZON_TAG = "ononbrothers2-22"
MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024
MAX_UPLOAD_BYTES = 4 * 1024 * 1024


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("The product image redirected; verify its official source URL.")


def official_jpeg():
    if not OFFICIAL_IMAGE.startswith("https://kitan.jp/wp-content/uploads/2026/10/"):
        raise RuntimeError("The product image source is not allow-listed.")
    opener = request.build_opener(NoRedirect)
    req = request.Request(
        OFFICIAL_IMAGE,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; SanrioGachaPublisher/1.0)",
            "Accept": "image/jpeg",
        },
    )
    try:
        with opener.open(req, timeout=45) as response:
            if response.status != 200 or response.geturl() != OFFICIAL_IMAGE:
                raise RuntimeError("The official product image could not be verified.")
            raw = response.read(MAX_DOWNLOAD_BYTES + 1)
    except (error.URLError, OSError) as exc:
        raise RuntimeError("The official product image could not be downloaded.") from exc
    if not raw or len(raw) > MAX_DOWNLOAD_BYTES:
        raise RuntimeError("The official product image is empty or too large.")
    try:
        with Image.open(io.BytesIO(raw)) as original:
            original.load()
            image = ImageOps.exif_transpose(original).convert("RGB")
    except Exception as exc:
        raise RuntimeError("The official product image is not a readable bitmap.") from exc
    image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
    for quality in (88, 82, 76, 70):
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
        data = output.getvalue()
        if len(data) <= MAX_UPLOAD_BYTES:
            return data
    raise RuntimeError("The optimized product image exceeds the WordPress upload limit.")


def verified_rakuten_url(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    value = str(data.get("rakuten_affiliate_url", ""))
    parts = parse.urlsplit(value)
    if (
        parts.scheme != "https"
        or parts.hostname != "hb.afl.rakuten.co.jp"
        or not re.fullmatch(r"/hgc/[a-zA-Z0-9._-]{8,128}/?", parts.path)
        or parts.username
        or parts.password
        or parts.port
        or parts.fragment
    ):
        raise RuntimeError("The Rakuten affiliate link did not pass validation.")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("article_json")
    parser.add_argument("affiliate_json")
    args = parser.parse_args()

    path = Path(args.article_json)
    article = json.loads(path.read_text(encoding="utf-8"))
    if article.get("image_source_url") != OFFICIAL_IMAGE:
        raise RuntimeError("The article image source does not match the reviewed official asset.")
    query = str(article.get("amazon_search_query", "")).strip()
    if len(query) < 3 or len(query) > 120:
        raise RuntimeError("The Amazon product search phrase is missing or invalid.")

    amazon_url = (
        "https://www.amazon.co.jp/s?k="
        + parse.quote(query, safe="")
        + "&tag="
        + AMAZON_TAG
    )
    rakuten_url = verified_rakuten_url(args.affiliate_json)
    content = str(article.get("content", ""))
    replacements = {
        "{{amazon_affiliate_url}}": amazon_url,
        "{{rakuten_affiliate_url}}": rakuten_url,
    }
    for marker, value in replacements.items():
        if content.count(marker) != 1:
            raise RuntimeError("The article must contain each affiliate link placeholder exactly once.")
        content = content.replace(marker, value)
    if "{{image_url}}" not in content or "{{post_id}}" not in content:
        raise RuntimeError("The article is missing its image or share-style placeholder.")

    article["content"] = content
    article["image_base64"] = base64.b64encode(official_jpeg()).decode("ascii")
    path.write_text(json.dumps(article, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Prepared one product image and validated the two affiliate destinations.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        message = str(exc) if isinstance(exc, RuntimeError) else "Article preparation failed."
        print(message, file=sys.stderr)
        sys.exit(1)
