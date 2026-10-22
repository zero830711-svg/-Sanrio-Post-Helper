"""Add crawlable, photo-led paths to existing product details via WP REST."""
import collections
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('detail_links', ROOT / 'product-detail-pilot.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
START = '<!-- sf-detail-discovery:start -->'
END = '<!-- sf-detail-discovery:end -->'
CSS = '''.sf-detail-discovery{margin:28px 0}.sf-detail-discovery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sf-detail-discovery-grid a{display:block;min-width:0;background:#fff;border:1px solid #ece0eb;border-radius:12px;padding:8px;text-decoration:none;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.sf-detail-discovery-grid img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain}.sf-detail-discovery-grid span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px}.sf-detail-discovery p{font-size:14px;line-height:1.7}@media(max-width:480px){.sf-detail-discovery-grid{gap:7px}.sf-detail-discovery-grid a{padding:6px;font-size:12px}}'''

def section(records, name=None):
    title = (name + 'の' if name else '') + 'サイズ・素材から選べる商品'
    cards = ''.join('<a href="' + d.E(x['url']) + '"><img src="' + d.E(x['images'][0]) + '" alt="' + d.E(x['title']) + '" loading="lazy" decoding="async"><span>' + d.E(x['title']) + '</span></a>' for x in records)
    return START + '<style>' + CSS + '</style><section class="sf-detail-discovery"><h2>' + d.E(title) + '</h2><p>写真を押すと、サイズ・素材などの商品情報を確認できます。</p><div class="sf-detail-discovery-grid">' + cards + '</div><p><a href="/product-details/">詳しい商品情報をすべて見る →</a></p></section>' + END

def replace_section(raw, markup):
    if START in raw or END in raw:
        if raw.count(START) != 1 or raw.count(END) != 1:
            raise RuntimeError('Discovery section boundary mismatch')
        return re.sub(re.escape(START) + '.*?' + re.escape(END), lambda _: markup, raw, count=1, flags=re.S)
    return raw + '\n' + markup

def update(wp, page_id, expected_slug, markup, records):
    path = '/wp/v2/pages/' + str(page_id)
    page = wp.call(path + '?context=edit&_fields=id,slug,content')
    if page['slug'] != expected_slug:
        raise RuntimeError('Page identity mismatch: ' + expected_slug)
    raw = page['content']['raw']
    updated = replace_section(raw, markup)
    d.update_existing_content(wp, path, raw, updated)
    saved = wp.call(path + '?context=edit&_fields=content')['content']
    for form in ('raw', 'rendered'):
        for x in records:
            if 'href="' + d.E(x['url']) + '"' not in saved[form]:
                raise RuntimeError('Missing saved product link: ' + x['url'])
    return updated != raw

def run():
    wp = d.c.WordPress()
    records, state_id = d.read_state(wp)
    if not state_id or not records:
        raise RuntimeError('Existing product details are required')
    grouped = collections.defaultdict(list)
    for x in records:
        grouped[x['character']].append(x)
    # Publish the detail-aware search labels and home photo/title destinations.
    d.load_unified().sync(wp)
    changed = 0
    linked = set()
    for character, rows in grouped.items():
        page_id, slug, name = d.c.CHARACTERS[character]
        changed += update(wp, page_id, slug, section(rows, name), rows)
        linked.update(x['url'] for x in rows)
    # Keep these blocks compact; character pages provide access to the full cohort.
    picks = []
    for n in range(max(map(len, grouped.values()))):
        for rows in grouped.values():
            if n < len(rows):
                picks.append(rows[n])
    changed += update(wp, 805, 'shopping-home', section(picks[:12]), picks[:12])
    changed += update(wp, 804, 'goods', section(picks[:24]), picks[:24])
    report = {'detailPages': len(records), 'characterPages': len(grouped), 'uniqueCharacterDetailLinks': len(linked), 'homePhotoCards': 12, 'searchPhotoCards': 24, 'changedPages': changed}
    if len(linked) != len(records):
        raise RuntimeError('Not all details were linked')
    Path('product-links-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('PRODUCT LINKS VERIFIED', json.dumps(report, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    run()
