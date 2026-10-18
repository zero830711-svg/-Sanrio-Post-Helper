"""Publish 18 missing Sanrio character landing pages through standard WP REST."""
import argparse, base64, html, json, os, re, sys
from urllib import error, parse, request

SITE = "https://sanrio-fan.site"
AMAZON_TAG = "ononbrothers2-22"
RAKUTEN_ID = "56386226.a6714b12.56386227.a1326022"
MARKER = "<!-- sf-character-search-page:v1 -->"
CHARACTERS = [
    ("KIRIMIちゃん.", "character-kirimi-chan", "kirimi-chan"),
    ("おさるのもんきち", "character-osaru-no-monkichi", "osaru-no-monkichi"),
    ("がおぱわるぅ", "character-gaopoweru", "gaopoweru"),
    ("コロコロクリリン", "character-corocorokuririn", "corocorokuririn"),
    ("ゴロピカドン", "character-goropikadon", "goropikadon"),
    ("ジュエルペット", "character-jewelpet", "jewelpet"),
    ("シュガーバニーズ", "character-sugar-bunnies", "sugar-bunnies"),
    ("チャーミーキティ", "character-charmmy-kitty", "charmmy-kitty"),
    ("チョコキャット", "character-chococat", "chococat"),
    ("ディアダニエル", "character-dear-daniel", "dear-daniel"),
    ("はなまるおばけ", "character-hanamaru-obake", "hanamaru-obake"),
    ("ぼんぼんりぼん", "character-bonbonribbon", "bonbonribbon"),
    ("マシュマロみたいなふわふわにゃんこ", "character-marshmallow-fuwafuwa-nyanko", "marshmallow-fuwafuwa-nyanko"),
    ("まるもふびより", "character-marumofubiyori", "marumofubiyori"),
    ("マロンクリーム", "character-marroncream", "marroncream"),
    ("みんなのたあ坊", "character-minna-no-taabou", "minna-no-taabou"),
    ("リトルフォレストフェロォ", "character-little-forest-fellow", "little-forest-fellow"),
    ("ルロロマニック", "character-ruroromannic", "ruroromannic"),
]

class WordPress:
    def __init__(self):
        user, password = os.getenv("SANRIO_WP_USER", ""), os.getenv("SANRIO_WP_APP_PASSWORD", "")
        if not user or not password:
            raise RuntimeError("WordPress Actions secrets are not configured.")
        self.auth = "Basic " + base64.b64encode((user + ":" + password).encode()).decode()
        self.opener = request.build_opener()
    def call(self, path, body=None):
        if not path.startswith("/wp/v2/"):
            raise ValueError("Only standard WordPress REST routes are allowed.")
        req = request.Request(SITE + "/wp-json" + path,
            data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
            headers={"Authorization": self.auth, "User-Agent": "SanrioCharacterPages/1.0",
                     **({"Content-Type": "application/json"} if body is not None else {})})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            raise RuntimeError("WordPress REST HTTP " + str(exc.code) + " at " +
                               path.split("?")[0] + ": " + detail) from None

def affiliate_links(name):
    amazon = "https://www.amazon.co.jp/s?" + parse.urlencode({"k": name + " グッズ", "tag": AMAZON_TAG})
    rakuten_search = "https://search.rakuten.co.jp/search/mall/" + parse.quote(name + " グッズ", safe="")
    rakuten = "https://hb.afl.rakuten.co.jp/hgc/" + RAKUTEN_ID + "/?pc=" + parse.quote(
        rakuten_search, safe="") + "&m=" + parse.quote(rakuten_search, safe="")
    return amazon, rakuten

def page_content(name):
    amazon, rakuten = affiliate_links(name)
    safe = html.escape(name)
    return (
        MARKER + '<section class="sf-character-search-guide" style="max-width:980px;margin:0 auto">'
        + '<p><a href="' + SITE + '/characters/">キャラクター一覧に戻る</a></p>'
        + '<div style="box-sizing:border-box;border-radius:26px;padding:30px;background:linear-gradient(120deg,#fff0f6,#edf8f5)">'
        + '<p style="margin:0 0 10px;color:#805d76;font-weight:700;letter-spacing:.12em">CHARACTER GUIDE</p>'
        + '<h2 style="margin:0 0 14px;font-size:clamp(1.6rem,5vw,2.4rem);line-height:1.45">' + safe + 'のグッズを探そう</h2>'
        + '<p style="margin:0;color:#6d6676;line-height:1.9">' + safe
        + 'のグッズを、Amazon・楽天市場の検索結果から探せます。商品名やキャラクター、販売元を確認してお選びください。</p></div>'
        + '<h2 style="margin:32px 0 16px">購入先から探す</h2>'
        + '<p style="margin:0 0 14px;color:#726d7b;line-height:1.8">検索結果の商品・価格・在庫・配送条件は変わります。商品ページで最新情報をご確認ください。</p>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px">'
        + '<a href="' + html.escape(amazon, quote=True) + '" target="_blank" rel="sponsored nofollow noopener" style="box-sizing:border-box;display:block;text-align:center;border-radius:16px;background:#ffbf29;padding:17px 14px;color:#171717;font-weight:700;text-decoration:none">Amazonで'
        + safe + 'のグッズを探す</a>'
        + '<a href="' + html.escape(rakuten, quote=True) + '" target="_blank" rel="sponsored nofollow noopener" style="box-sizing:border-box;display:block;text-align:center;border-radius:16px;background:#bf001b;padding:17px 14px;color:#fff;font-weight:700;text-decoration:none">楽天市場で'
        + safe + 'のグッズを探す</a></div>'
        + '<aside style="margin-top:20px;border-radius:16px;background:#fff;padding:16px;color:#726d7b;line-height:1.8">'
        + '<p style="margin:0 0 8px">当サイトは非公式ファンサイトです。この記事にはAmazon・楽天市場のアフィリエイトリンクを含みます。</p>'
        + '<p style="margin:0">このページは検索案内です。すべての商品や在庫を網羅する一覧ではありません。検索結果のキャラクター・シリーズ・販売元をご確認ください。</p>'
        + '</aside><p style="margin:24px 0 0"><a href="' + SITE + '/goods/">キャラクター・ジャンルからグッズを探す →</a></p></section>'
    )

def run(mode):
    wp = WordPress()
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    rows = wp.call("/wp/v2/pages?" + parse.urlencode({
        "slug": "characters", "context": "edit", "_fields": "id,slug,status,content"}))
    if len(rows) != 1 or rows[0].get("status") != "publish":
        raise RuntimeError("Could not verify the published character directory.")
    directory = rows[0]
    raw = directory.get("content", {}).get("raw", "")
    if not isinstance(raw, str):
        raise RuntimeError("Could not read editable character directory content.")
    plans = []
    for name, slug, query_slug in CHARACTERS:
        rows = wp.call("/wp/v2/pages?" + parse.urlencode({
            "slug": slug, "context": "edit", "_fields": "id,slug,status,content"}))
        target_url = SITE + "/" + slug + "/"
        if len(rows) > 1:
            raise RuntimeError("Duplicate page slug found: " + slug)
        page = rows[0] if rows else None
        create = page is None
        if page and MARKER not in page.get("content", {}).get("raw", ""):
            raise RuntimeError("A page already uses the planned slug; refusing to overwrite " + slug)
        old_href = "/goods/?character=" + query_slug
        if old_href not in raw and old_href.replace("&", "&amp;") not in raw and target_url not in raw:
            raise RuntimeError("Directory link is missing for " + name)
        plans.append((name, slug, query_slug, page, create, target_url))
    print("PREFLIGHT:", json.dumps({
        "missing_pages_to_create": sum(p[4] for p in plans),
        "existing_owned_pages": sum(not p[4] for p in plans),
        "directory_links": len(plans)
    }, ensure_ascii=False))
    if mode == "check":
        return
    if mode != "publish":
        raise RuntimeError("Unsupported execution mode.")
    for name, slug, query_slug, page, create, target_url in plans:
        if create:
            draft = wp.call("/wp/v2/pages", {
                "title": name + "のグッズを探す｜Amazon・楽天市場の商品検索",
                "slug": slug, "status": "draft", "content": page_content(name)})
            page_id = draft.get("id")
            if not page_id or draft.get("slug") != slug or draft.get("status") != "draft":
                raise RuntimeError("Draft creation verification failed for " + slug)
            draft_check = wp.call("/wp/v2/pages/" + str(page_id) + "?context=edit&_fields=id,slug,status,content")
            if draft_check.get("status") != "draft" or MARKER not in draft_check.get("content", {}).get("raw", ""):
                raise RuntimeError("Draft content verification failed for " + slug)
            draft = wp.call("/wp/v2/pages/" + str(page_id), {"status": "publish"})
            if draft.get("status") != "publish":
                raise RuntimeError("Page publication verification failed for " + slug)
        else:
            page_id = page["id"]
            if page.get("status") != "publish":
                draft = wp.call("/wp/v2/pages/" + str(page_id), {"status": "publish"})
                if draft.get("status") != "publish":
                    raise RuntimeError("Existing page publication verification failed for " + slug)
        verify = wp.call("/wp/v2/pages/" + str(page_id) + "?context=edit&_fields=id,slug,status,content,link")
        verify_raw = verify.get("content", {}).get("raw", "")
        if verify.get("slug") != slug or verify.get("status") != "publish" or MARKER not in verify_raw:
            raise RuntimeError("Published page verification failed for " + slug)
        print("PUBLISHED:", slug, verify.get("link", target_url))
    updated = raw
    for name, slug, query_slug, page, create, target_url in plans:
        pattern = re.compile(r"""href=(["'])((?:https?://sanrio-fan\.site)?/goods/\?character=)""" +
                             re.escape(query_slug) + r"""(["'])""", re.I)
        updated, count = pattern.subn('href="{}"'.format(target_url), updated)
        if count == 0 and target_url not in updated:
            old = "/goods/?character=" + query_slug
            old_amp = old.replace("&", "&amp;")
            if old_amp not in updated and old not in updated:
                raise RuntimeError("Could not update directory link for " + name)
            updated = updated.replace(old_amp if old_amp in updated else old, target_url, 1)
        elif count > 1:
            raise RuntimeError("Multiple directory links matched " + name)
    if updated != raw:
        saved = wp.call("/wp/v2/pages/" + str(directory["id"]), {"content": updated})
        if saved.get("id") != directory["id"]:
            raise RuntimeError("Directory update returned an unexpected identity.")
    verify = wp.call("/wp/v2/pages/" + str(directory["id"]) + "?context=edit&_fields=id,content")
    verify_raw = verify.get("content", {}).get("raw", "")
    if any(target_url not in verify_raw for *_, target_url in plans):
        raise RuntimeError("Character directory link verification failed.")
    still_search_links = [
        name for name, slug, query_slug, page, create, target_url in plans
        if ("/goods/?character=" + query_slug) in verify_raw
        or ("/goods/?character=" + query_slug).replace("&", "&amp;") in verify_raw
    ]
    if still_search_links:
        raise RuntimeError("Directory still points to generic search for: " + ", ".join(still_search_links))
    print("DIRECTORY_UPDATED_AND_VERIFIED:", len(plans), "character links")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["check", "publish"], default="check")
    args = parser.parse_args()
    try:
        run(args.mode)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else "Operation failed; check WordPress REST configuration.", file=sys.stderr)
        sys.exit(1)
