"""Append independently verified discovery candidates, retaining every existing product."""
import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('import-rakuten-character-catalog.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def additions(raw, old, character, limit, image_cache):
    seen = set().union(*(c.identity_keys(item, character) for item in old)) if old else set()
    result = []
    rejected = duplicates = 0
    for raw_item in raw:
        item = c.clean_candidate(raw_item)
        if not item or not c.matches_character(item['title'], character):
            continue
        identities = c.identity_keys(item, character)
        if identities & seen:
            duplicates += 1
            continue
        if not image_cache.get(item['image']):
            rejected += 1
            continue
        if item['category'] == '生活雑貨' and re.search(r'ワンピース|スウェット|パーカー|シュシュ|ヘア|ソックス|レギンス|スカート|ネックレス|ピアス|リング|ブーツ|シャツ|ニット|カーディガン|パンツ', item['title']):
            item['category'] = 'ファッション'
        seen.update(identities)
        result.append(item)
        if len(result) >= limit:
            break
    return result, rejected, duplicates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidates', required=True)
    parser.add_argument('--limit', type=int, default=10000)
    args = parser.parse_args()
    if not 1 <= args.limit <= 10000:
        raise ValueError('Incremental batch must be between 1 and 10000 cards.')
    raw = json.loads(Path(args.candidates).read_text())
    if not isinstance(raw, list):
        raise ValueError('Candidates must be a list.')
    candidates = [c.clean_candidate(x) for x in raw]
    candidates = [x for x in candidates if x]
    wp = c.WordPress()
    ids = ','.join(str(v[0]) for v in c.CHARACTERS.values())
    pages = wp.call('/wp/v2/pages?context=edit&per_page=100&include='+ids+'&_fields=id,slug,content')
    pages = {p['id']: p for p in pages}
    # Check only candidates that can be attributed to an existing character.
    images = sorted({x['image'] for x in candidates if any(c.matches_character(x['title'], key) for key in c.CHARACTERS)})
    with ThreadPoolExecutor(max_workers=4) as executor:
        image_cache = dict(zip(images, executor.map(c.verify_image, images)))
    plans = []
    remaining = args.limit
    totals = collections.Counter()
    # Round-robin selection keeps a popular character from taking the whole batch.
    available = {}
    for key, (pid, slug, name) in c.CHARACTERS.items():
        page = pages[pid]
        if page['slug'] != slug:
            raise RuntimeError('Page identity mismatch: '+key)
        content = page['content']['raw']
        match = re.search(re.escape(c.START)+r'.*?'+re.escape(c.END), content, re.S)
        if not match:
            raise RuntimeError('Managed section missing: '+key)
        old = c.extract_existing_cards(match.group())
        extra, rejected, duplicates = additions(candidates, old, key, args.limit, image_cache)
        available[key] = extra
        plans.append((key, pid, name, content, match, old, []))
    while remaining and any(available.values()):
        for key, pid, name, content, match, old, chosen in plans:
            if remaining and available[key]:
                chosen.append(available[key].pop(0))
                remaining -= 1
    for key, pid, name, content, match, old, chosen in plans:
        if not chosen:
            continue
        # Refresh the page immediately before saving to avoid overwriting concurrent edits.
        current = wp.call('/wp/v2/pages/%d?context=edit&_fields=id,slug,content' % pid)
        if current['content']['raw'] != content:
            raise RuntimeError('Page changed during import; retry safely: '+key)
        products = old + chosen
        section = c.section_html(match.group(), products, c.extract_guide_cards(match.group()), name)
        updated = content[:match.start()] + section + content[match.end():]
        wp.call('/wp/v2/pages/%d' % pid, {'content': updated})
        saved = wp.call('/wp/v2/pages/%d?context=edit&_fields=content' % pid)
        cards = c.extract_existing_cards(saved['content']['raw'])
        if [x['code'] for x in cards] != [x['code'] for x in products]:
            raise RuntimeError('Saved product list did not match: '+key)
        totals.update(x['category'] for x in chosen)
        print('ADDED', key, len(chosen), 'TOTAL', len(cards), flush=True)
    print('SUMMARY added_cards=%d updated_pages=%d verified_images=%d rejected_images=%d unassigned_candidates=%d genres=%s' % (
        args.limit-remaining, sum(bool(p[-1]) for p in plans), sum(bool(x) for x in image_cache.values()), sum(not x for x in image_cache.values()),
        sum(not any(c.matches_character(x['title'], key) for key in c.CHARACTERS) for x in candidates), dict(totals)), flush=True)
    before_codes = {x['code'] for p in plans for x in p[5]}
    added_codes = {x['code'] for p in plans for x in p[-1]} - before_codes
    report = {'newUniqueOffers': len(added_codes), 'newCharacterPlacements': args.limit-remaining,
              'updatedPages': sum(bool(p[-1]) for p in plans), 'rejectedImages': sum(not x for x in image_cache.values()), 'genres':dict(totals)}
    Path('lovely-import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('DISCOVERY IMPORT',json.dumps(report,ensure_ascii=False),flush=True)
    goods = wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']['raw']
    if 'id="sf-unified-search-data"' in goods:
        unified_spec = importlib.util.spec_from_file_location('unified_search', Path(__file__).with_name('unify-product-search.py'))
        unified = importlib.util.module_from_spec(unified_spec)
        unified_spec.loader.exec_module(unified)
        unified.sync(wp)


if __name__ == '__main__':
    main()
