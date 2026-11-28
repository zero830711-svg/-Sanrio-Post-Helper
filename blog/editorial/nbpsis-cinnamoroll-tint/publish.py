import base64
import html
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = "https://sanrio-fan.site/wp-json/wp/v2"
SLUG = "nbpsis-cinnamoroll-keyring-lip-tint"
TITLE = "シナモロールのキーリング型リップティント｜韓国NBPSISの全9色を紹介"
DESCRIPTION = "韓国コスメNBPSISのシナモロール型リップティント。頭がキャップになる仕掛けやバッグへの取り付け例、全9色と韓国オリーブヤングでの案内を紹介します。"
ASSETS = {
    "figure": ("雲の上に立つシナモロールのフィギュア型リップティント", "水色の目とピンクのほっぺがかわいいシナモロール型の容器"),
    "applicator": ("シナモロールの頭のキャップを外して見えるリップティントのアプリケーター", "頭のキャップを開けると出てくるアプリケーター"),
    "front-back": ("シナモロールのリップ容器の正面としっぽのある背面", "正面と背面を並べたリップ容器"),
    "bag": ("水色のストラップでバッグに付けたシナモロールのティント", "バッグの持ち手に付けたキーリング型ティント"),
    "makeup": ("シナモロール型のリップティントを手に持つメイクモデル", "ツヤのあるリップメイクのイメージ"),
}


def api(path, data=None, binary=None, headers=None):
    user = os.environ["SANRIO_WP_USER"]
    password = os.environ["SANRIO_WP_APP_PASSWORD"]
    if not user or not password:
        raise RuntimeError("WordPress credentials are missing")
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    request_headers = {"Authorization": f"Basic {auth}", "User-Agent": "SanrioEditorialPublisher/1.0"}
    body = binary
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode()
        request_headers["Content-Type"] = "application/json"
    request_headers.update(headers or {})
    with urlopen(Request(ROOT + path, data=body, headers=request_headers), timeout=60) as response:
        return json.load(response)


def main():
    folder = Path(__file__).parent
    content = (folder / "article.html").read_text()
    originals = {name: (folder / f"{name}.jpg").read_bytes() for name in ASSETS}
    if any(content.count(f"<!-- {name} -->") != 1 for name in ASSETS):
        raise RuntimeError("Article image placeholders are missing or duplicated")

    posts = api("/posts?" + urlencode({"slug": SLUG, "context": "edit", "status": "draft,publish,pending,private,future"}))
    if posts:
        post = posts[0]
        if post["status"] == "publish":
            print("ALREADY PUBLISHED", post["link"])
            return
        if post["status"] != "draft" or post["title"]["raw"] != TITLE:
            raise RuntimeError("Existing post requires review")
    else:
        post = api("/posts", {"slug": SLUG, "title": TITLE, "status": "draft"})
    post_id = post["id"]
    if post["slug"] != SLUG:
        raise RuntimeError("Unexpected WordPress slug")

    image_ids = []
    image_urls = []
    existing = api("/media?" + urlencode({"parent": post_id, "context": "edit", "per_page": 50}))
    for name, (alt, caption) in ASSETS.items():
        asset_slug = f"nbpsis-cinnamoroll-tint-{name}"
        file = next((item for item in existing if item["slug"] == asset_slug), None)
        if file is None:
            file = api(f"/media?post={post_id}", binary=originals[name], headers={
                "Content-Type": "image/jpeg",
                "Content-Disposition": f'attachment; filename="{asset_slug}.jpg"',
            })
        credit = f"{caption}｜画像出典：サンリオ韓国公式Instagram（@sanrio_kr）"
        api(f"/media/{file['id']}", {"alt_text": alt, "caption": credit})
        image_ids.append(file["id"])
        image_urls.append(file["source_url"])
        content = content.replace(
            f"<!-- {name} -->",
            f'<figure class="wp-block-image size-large"><img src="{html.escape(file["source_url"])}" '
            f'alt="{html.escape(alt)}"><figcaption>{html.escape(credit)}</figcaption></figure>',
        )
    draft = api(f"/posts/{post_id}", {"content": content, "excerpt": DESCRIPTION, "featured_media": image_ids[0]})
    if any(html.escape(url) not in draft["content"]["raw"] for url in image_urls):
        raise RuntimeError("Draft verification failed")
    published = api(f"/posts/{post_id}", {"status": "publish"})
    if published["status"] != "publish":
        raise RuntimeError("Publication failed")
    print("PUBLISHED", published["id"], published["link"], "IMAGE_IDS", image_ids)


if __name__ == "__main__":
    main()
