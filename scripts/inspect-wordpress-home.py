"""Read-only inspection of the WordPress front page through the standard REST API."""
import base64
import html
import json
import os
import re
import sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
CHARACTERS = [
    "ハローキティ", "マイメロディ", "リトルツインスターズ", "ポムポムプリン",
    "シナモロール", "クロミ", "ポチャッコ", "ハンギョドン", "タキシードサム",
    "けろけろけろっぴ", "バッドばつ丸", "あひるのペックル", "ぐでたま",
    "マイスウィートピアノ", "ウィッシュミーメル", "こぎみゅん", "はなまるおばけ",
    "がおぱわるぅ", "ぼんぼんりぼん", "ディアダニエル", "チャーミーキティ",
    "まるもふびより", "コロコロクリリン", "マロンクリーム", "シュガーバニーズ",
    "ウサハナ", "マシュマロみたいなふわふわにゃんこ", "チョコキャット",
    "チアリステイルズ", "JOCHUM",
]


class WordPress:
    def __init__(self):
        user = os.getenv("SANRIO_WP_USER", "")
        password = os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("Set the WordPress Actions secrets first.")
        token = base64.b64encode((user + ":" + password).encode()).decode()
        self.auth = "Basic " + token

    def get(self, path):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        req = request.Request(
            SITE + "/wp-json" + path,
            headers={"Authorization": self.auth, "User-Agent": "SanrioHomeReadOnlyCheck/1.0"},
        )
        try:
            with request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError("WordPress REST returned HTTP %s." % exc.code) from None


def text_only(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def inspect(wp):
    wp.get("/wp/v2/users/me?context=edit&_fields=id")
    settings = wp.get("/wp/v2/settings?context=edit&_fields=show_on_front,page_on_front")
    print("FRONT_MODE: " + str(settings.get("show_on_front")))
    page_id = int(settings.get("page_on_front") or 0)
    if settings.get("show_on_front") != "page" or not page_id:
        print("FRONT_PAGE: posts index; no static page content to patch.")
        return
    page = wp.get("/wp/v2/pages/" + str(page_id) + "?context=edit&_fields=id,slug,title,content")
    title = page.get("title", {})
    title = title.get("rendered", title.get("raw", "")) if isinstance(title, dict) else title
    raw = page.get("content", {}).get("raw", "")
    print("FRONT_PAGE: id=%s slug=%s title=%s content_chars=%d" % (
        page_id, page.get("slug", ""), text_only(title), len(raw)))
    anchors = re.findall(r"<a\b[^>]*href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", raw, flags=re.I | re.S)
    printed = set()
    for href, body in anchors:
        label = text_only(body)
        if any(character in label for character in CHARACTERS) or "キャラクター" in label or "キャラから" in label:
            item = (html.unescape(href), label)
            if item not in printed:
                printed.add(item)
                print("FRONT_LINK: " + repr(item))
    for needle in ("好きなキャラクター", "キャラクターから探す", "36キャラクター"):
        pos = raw.find(needle)
        if pos >= 0:
            snippet = text_only(raw[max(0, pos - 100):pos + 350])
            print("FRONT_SECTION: " + needle + " => " + snippet)


if __name__ == "__main__":
    try:
        inspect(WordPress())
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
