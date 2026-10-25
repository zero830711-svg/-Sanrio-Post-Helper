"""Publish only the reviewed crystal accessory using existing Rakuten and REST helpers."""
import importlib.util
import json
import html
import sys
from pathlib import Path

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(path))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

batch = module("gacha_batch", "publish-rakuten-gacha-batch.py")
editorial = module("editorial", "publish-editorial-article.py")
article = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["candidates"]
matches = [row for row in rows if batch.eligible(row)
           and batch.normalized_product_name("クリスタルめじるしアクセサリー") in batch.normalized_product_name(row["title"])
           and "サンリオ" in row["title"]
           and not any(word in row["title"] for word in ("くじ", "アクセサリー2", "アクセササリー"))]
if not matches:
    raise RuntimeError("No exact Rakuten API product found; nothing published.")
item = matches[0]
wp = editorial.WordPress()
existing = wp.call("/wp/v2/posts?" + batch.parse.urlencode({
    "search": "クリスタルめじるし", "context": "edit", "per_page": 100,
    "_fields": "id,slug,title,status,link"}))
if any(p["slug"] != article["slug"] for p in existing):
    raise RuntimeError("A possible duplicate article already exists; nothing published.")
content = article["content"]
for token, value in {
    "{{rakuten_affiliate_url}}": item["affiliate"],
    "{{amazon_affiliate_url}}": batch.amazon_url(article["product_names"][0]),
    "{{rakuten_title}}": item["title"],
    "{{rakuten_attribution}}": batch.RAKUTEN_ATTRIBUTION,
}.items():
    content = content.replace(token, value if token == "{{rakuten_attribution}}" else html.escape(value, quote=True))
if "ガチャガチャアイランド" in content:
    raise RuntimeError("Unexpected external source name.")
article["content"] = content
article["image_base64"] = batch.download_jpeg(item["image"])
print("Verified Rakuten API product:", item["title"], item["url"], flush=True)
editorial.publish(article, wp)
