"""Adjust only the homepage typography and spacing through WordPress REST."""
import base64
import html
import json
import os
import re
from urllib import request
SITE = "https://sanrio-fan.site"
STYLE = "<style id=\"sf-home-top-spacing\">\n/* Home-only typography and spacing. Section order and product data are unchanged. */\nbody.page-id-805 #content{margin-top:8px!important}\nbody.page-id-805 #main{padding-top:10px!important}\nbody.page-id-805 .sf-guide>.sf-hero{padding:20px 24px!important;margin:0 0 20px!important}\nbody.page-id-805 .sf-hero .sf-title{font-size:28px!important;line-height:1.25!important;margin:0 0 8px!important}\nbody.page-id-805 .sf-hero .sf-sub{margin:0 0 10px!important}\nbody.page-id-805 .sf-search{margin:10px 0 0!important}\nbody.page-id-805 .sf-guide>section{margin:0 0 20px!important}\nbody.page-id-805 .sf-guide>section>h2{font-size:21px;line-height:1.4;margin:0 0 12px!important}\nbody.page-id-805 .sf-char-name{display:block}\n@media(max-width:767px){\n  body.page-id-805 #header,\n  body.page-id-805 #header-in{min-height:0!important;height:auto!important}\n  body.page-id-805 #header .logo{font-size:16px!important;line-height:1.3!important;padding:10px 12px!important;margin:0!important}\n  body.page-id-805 #header .site-name{padding:0!important;line-height:1.3!important}\n  body.page-id-805 #content{margin-top:0!important}\n  body.page-id-805 #main{padding:8px 12px 0!important}\n  body.page-id-805 .sf-guide{padding-top:0!important;font-size:14px;line-height:1.5}\n  body.page-id-805 .sf-guide>.sf-hero{padding:14px!important;margin:0 0 16px!important;border-radius:18px!important}\n  body.page-id-805 .sf-hero .sf-title{font-size:22px!important;line-height:1.25!important;margin:0 0 6px!important;letter-spacing:.01em}\n  body.page-id-805 .sf-hero .sf-sub{font-size:12px!important;line-height:1.5!important;margin:0 0 8px!important}\n  body.page-id-805 .sf-search{margin:8px 0 0!important;gap:8px!important;align-items:stretch}\n  body.page-id-805 .sf-search input{min-height:44px!important;height:44px!important;padding:9px 10px!important;font-size:16px!important;line-height:1.4}\n  body.page-id-805 .sf-search button{min-height:44px!important;height:44px!important;padding:8px 12px!important;font-size:13px!important;line-height:1.3}\n  body.page-id-805 .sf-guide>section{margin:0 0 16px!important;padding:0!important}\n  body.page-id-805 .sf-guide>section>h2{font-size:18px!important;line-height:1.4!important;margin:0 0 10px!important}\n  body.page-id-805 .sf-directory-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px!important;margin:0 0 10px!important}\n  body.page-id-805 .sf-directory-actions .sf-pill{display:flex;justify-content:center;min-width:0;min-height:38px!important;padding:6px 7px!important;font-size:11px!important;line-height:1.35!important;text-align:center}\n  body.page-id-805 .sf-chars{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important}\n  body.page-id-805 .sf-chars .sf-char{min-width:0;min-height:72px!important;height:72px!important;padding:7px 3px!important;gap:6px!important;border-radius:15px!important;font-size:clamp(9px,2.7vw,11px)!important;line-height:1.25!important}\n  body.page-id-805 .sf-chars .sf-dot{width:22px!important;height:22px!important;margin:0!important;flex:none}\n  body.page-id-805 .sf-chars .sf-char-name{max-width:100%;word-break:keep-all;overflow-wrap:normal;white-space:nowrap}\n  body.page-id-805 .sf-chars .sf-char-name.sf-wrap-name{white-space:normal}\n  body.page-id-805 .sf-cats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}\n  body.page-id-805 .sf-cats .sf-pill{display:flex;justify-content:center;min-width:0;min-height:38px;padding:7px 4px;font-size:12px;line-height:1.3;text-align:center}\n}\n</style>"
def api(path, data=None):
    user = os.environ["SANRIO_WP_USER"].strip()
    password = "".join(os.environ["SANRIO_WP_APP_PASSWORD"].split())
    token = base64.b64encode((user + ":" + password).encode()).decode()
    req = request.Request(SITE + "/wp-json/wp/v2/" + path,
        data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None,
        headers={"Authorization": "Basic " + token, "Content-Type": "application/json", "User-Agent": "SanrioHomeSpacing/1.0"})
    with request.urlopen(req, timeout=45) as response:
        return json.load(response)
def main():
    page = api("pages/805?context=edit&_fields=id,slug,content")
    assert page["id"] == 805 and page["slug"] == "shopping-home", "Home identity mismatch."
    before = page["content"]["raw"]
    pattern = r'<style id="sf-home-top-spacing">.*?</style>'
    clean = re.sub(pattern, "", before, flags=re.S)
    # Wrap labels so long names can break at a deliberate phrase boundary.
    def label(match):
        opening, dot, name, closing = match.groups()
        if "sf-char-name" in name:
            return match.group(0)
        actual = html.unescape(name).strip()
        assert "<" not in name, "Unexpected character label markup."
        extra = " sf-wrap-name" if actual == "あひるのペックル" else ""
        displayed = html.escape(actual)
        if extra:
            displayed = "あひるの<wbr>ペックル"
        return opening + dot + '<span class="sf-char-name' + extra + '">' + displayed + '</span>' + closing
    updated = re.sub(r'(<a\b[^>]*class="sf-char"[^>]*>)(<span\b[^>]*class="sf-dot"[^>]*></span>)(.*?)(</a>)', label, clean, flags=re.S)
    # Confirm all pre-existing sections and link destinations are kept in the same order.
    headings = lambda value: re.findall(r'<h[1-3]\b[^>]*>.*?</h[1-3]>', value, flags=re.S)
    hrefs = lambda value: re.findall(r'\bhref=["\']([^"\']+)', value)
    assert headings(updated) == headings(clean), "Heading order changed."
    assert hrefs(updated) == hrefs(clean), "A link changed."
    assert updated.count('sf-home-product-image') == clean.count('sf-home-product-image'), "Product photos changed."
    content = STYLE + updated
    api("pages/805", {"content": content})
    saved = api("pages/805?context=edit&_fields=content")["content"]["raw"]
    assert saved == content, "WordPress did not retain the exact layout update."
    print("Homepage spacing and label layout saved through REST. All headings, links, photos and section order preserved.")
if __name__ == "__main__":
    main()
