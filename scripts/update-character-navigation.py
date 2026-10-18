"""Connect home and full character directory links to guides or filtered goods."""
# Current navigation catalog follows all 36 entries in the site's directory.
import html
import importlib.util
import re
import sys
from pathlib import Path
from urllib import parse

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("directory", ROOT / "scripts/build-product-directory.py")
directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)
SITE = directory.SITE
NEW_GUIDES = directory.CHARACTER_GUIDE_SLUGS
HOME_ADDITIONS = [
    ("タキシードサム", "tuxedo-sam", "#b9e5ef"),
    ("あひるのペックル", "ahiru-no-pekkle", "#a9d4ec"),
    ("バッドばつ丸", "bad-badtz-maru", "#c5c5d6"),
    ("こぎみゅん", "cogimyun", "#f3cbd6"),
    ("ウサハナ", "usahana", "#f1bedc"),
]


def plain_text(value):
    return html.unescape(re.sub(r"<[^>]+>", " ", value)).strip()


def guide_urls(wp):
    urls = {slug: SITE + "/" + page_slug + "/" for slug, page_slug in NEW_GUIDES.items()}
    for slug, page_id in directory.CHARACTER_GUIDE_PAGE_IDS.items():
        page, _ = wp.call("/wp/v2/pages/" + str(page_id) + "?context=edit&_fields=id,slug")
        page_slug = page.get("slug", "")
        if page.get("id") != page_id or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", page_slug):
            raise RuntimeError("Could not verify guide page " + str(page_id))
        urls[slug] = SITE + "/" + page_slug + "/"
    for slug, page_slug in NEW_GUIDES.items():
        rows, _ = wp.call("/wp/v2/pages?" + parse.urlencode({"slug": page_slug, "_fields": "id,slug,status"}))
        if len(rows) != 1 or rows[0].get("slug") != page_slug or rows[0].get("status") != "publish":
            raise RuntimeError("Could not verify published guide " + page_slug)
    return urls


def link_for(name, slug_by_name, guides):
    slug = slug_by_name.get(name)
    if not slug:
        return None
    return guides.get(slug) or "/goods/?character=" + slug


def update_directory(raw, guides):
    slug_by_name = {name: slug for name, slug in directory.CHARACTER_CATALOG}
    found = set()
    anchor = re.compile(r"<a\b([^>]*?)href=(['\"])(.*?)\2([^>]*)>(.*?)</a>", re.I | re.S)
    def replace(match):
        name = plain_text(match.group(5))
        if name == "チアリステイルズ":
            return ""
        target = link_for(name, slug_by_name, guides)
        if target is None:
            return match.group(0)
        found.add(name)
        return "<a" + match.group(1) + "href=" + match.group(2) + html.escape(target, quote=True) + match.group(2) + match.group(4) + ">" + match.group(5) + "</a>"
    updated = anchor.sub(replace, raw)
    missing = set(slug_by_name) - found
    if missing:
        raise RuntimeError("Character directory is missing catalog entries: " + ", ".join(sorted(missing)))
    if found != set(slug_by_name):
        raise RuntimeError("Could not verify every catalog character link.")
    return updated, len(found)


def update_home(raw, guides):
    # Resolve the eight existing featured characters by their visible labels.
    slug_by_name = {name: slug for name, slug in directory.CHARACTER_CATALOG}
    anchor = re.compile(r"<a\b([^>]*?)href=(['\"])(.*?)\2([^>]*)>(.*?)</a>", re.I | re.S)
    found = set()
    def replace(match):
        name = plain_text(match.group(5))
        target = link_for(name, slug_by_name, guides)
        if name not in {"シナモロール", "クロミ", "マイメロディ", "ポムポムプリン", "ポチャッコ", "ハローキティ", "ハンギョドン", "リトルツインスターズ"}:
            return match.group(0)
        if target is None:
            raise RuntimeError("No route for homepage character: " + name)
        found.add(name)
        return "<a" + match.group(1) + "href=" + match.group(2) + html.escape(target, quote=True) + match.group(2) + match.group(4) + ">" + match.group(5) + "</a>"
    updated = anchor.sub(replace, raw)
    if len(found) != 8:
        raise RuntimeError("Could not verify all eight featured homepage characters.")
    block = re.search(r'(<div\s+class=["\']sf-chars["\'][^>]*>)(.*?)(</div>)', updated, re.I | re.S)
    if not block:
        raise RuntimeError("Homepage character grid was not found.")
    additions = []
    for name, slug, color in HOME_ADDITIONS:
        href = guides.get(slug)
        if not href:
            raise RuntimeError("Missing character guide for " + slug)
        additions.append('<a class="sf-char" href="' + html.escape(href, quote=True) + '" style="--char:' + color + '"><span class="sf-dot" aria-hidden="true"></span>' + html.escape(name) + '</a>')
    inner = block.group(2)
    for name, slug, _ in HOME_ADDITIONS:
        href = guides[slug]
        if name not in inner:
            inner += additions[[item[0] for item in HOME_ADDITIONS].index(name)]
        elif href not in inner:
            raise RuntimeError("Homepage addition exists with an unexpected destination: " + name)
    updated = updated[:block.start(2)] + inner + updated[block.end(2):]
    style = """<style id="sf-character-grid-mobile">
.sf-chars{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:14px!important}
.sf-chars .sf-char{box-sizing:border-box}
@media(max-width:640px){
  .sf-chars{grid-template-columns:minmax(0,1fr)!important;gap:8px!important}
  .sf-chars .sf-char{display:flex;min-height:68px;padding:12px 16px;flex-direction:row;align-items:center;justify-content:flex-start;gap:14px;text-align:left;font-size:17px;line-height:1.4}
  .sf-chars .sf-char .sf-dot{flex:none;width:32px;height:32px}
}
</style>"""
    updated = re.sub(r'<style id="sf-character-grid-mobile">.*?</style>', '', updated, flags=re.I | re.S)
    updated = style + updated
    return updated, 13


def run(mode, wp):
    wp.call("/wp/v2/users/me?context=edit&_fields=id")
    guides = guide_urls(wp)
    home, _ = wp.call("/wp/v2/pages/805?context=edit&_fields=id,slug,content")
    if home.get("id") != 805 or home.get("slug") != "shopping-home":
        raise RuntimeError("Homepage identity verification failed.")
    home_raw = home.get("content", {}).get("raw", "")
    updated_home, home_count = update_home(home_raw, guides)
    dirs, _ = wp.call("/wp/v2/pages?" + parse.urlencode({"slug": "characters", "context": "edit", "_fields": "id,slug,content"}))
    if len(dirs) != 1 or dirs[0].get("slug") != "characters":
        raise RuntimeError("Character directory page identity verification failed.")
    directory_page = dirs[0]
    directory_raw = directory_page.get("content", {}).get("raw", "")
    updated_directory, directory_count = update_directory(directory_raw, guides)
    if mode == "check":
        print("READY: homepage has %d direct character guide links; directory has %d routed character links." % (home_count, directory_count))
        return
    home_saved, _ = wp.call("/wp/v2/pages/805", {"content": updated_home})
    dir_saved, _ = wp.call("/wp/v2/pages/" + str(directory_page["id"]), {"content": updated_directory})
    if home_saved.get("id") != 805 or dir_saved.get("id") != directory_page.get("id"):
        raise RuntimeError("WordPress REST update verification failed.")
    home_verify, _ = wp.call("/wp/v2/pages/805?context=edit&_fields=id,content")
    dir_verify, _ = wp.call("/wp/v2/pages/" + str(directory_page["id"]) + "?context=edit&_fields=id,content")
    if sum(home_verify["content"]["raw"].count(url) for url in guides.values()) < 13:
        raise RuntimeError("Homepage guide links were not saved as expected.")
    directory_saved = dir_verify["content"]["raw"]
    for slug, url in guides.items():
        if slug in {"cinnamoroll", "kuromi", "my-melody", "pompompurin", "pochacco", "hello-kitty", "hangyodon", "little-twin-stars", *NEW_GUIDES.keys()}:
            if url not in directory_saved:
                raise RuntimeError("Directory guide link missing after save: " + slug)
    if directory_saved.count("/goods/?character=") < directory_count - len(guides):
        raise RuntimeError("Filtered goods links were not saved as expected.")
    print("UPDATED: homepage has %d guide links; /characters/ routes all %d characters to guides or prefiltered goods." % (home_count, directory_count))


if __name__ == "__main__":
    parser = __import__("argparse").ArgumentParser()
    parser.add_argument("--mode", choices=["check", "apply"], default="check")
    args = parser.parse_args()
    try:
        run(args.mode, directory.WordPress())
    except (RuntimeError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
