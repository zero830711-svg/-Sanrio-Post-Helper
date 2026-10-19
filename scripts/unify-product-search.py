"""Build /goods/ from live character catalogs and existing guide cards, via WP REST."""
import collections
import base64
import gzip
import html
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


c = load('search_catalog', 'import-rakuten-character-catalog.py')
d = load('search_directory', 'build-product-directory.py')
DATA_ID = 'sf-unified-search-data'
MARKER = d.MARKER
SLUGS = {'mymelody': 'my-melody', 'hellokitty': 'hello-kitty'}


def attrs(tag):
    return {k: html.unescape(v) for k, v in re.findall(r'''([\w-]+)=["']([^"']*)["']''', tag)}


def existing_guides(raw):
    stored = read_index(raw)
    if stored is not None:
        return [x for x in stored['items'] if x['type'] != 'product']
    result = []
    labels = {html.unescape(key):c.text_from(label) for key,label in re.findall(r'<option value="([^"]+)">(.*?)</option>',raw,re.S)}
    for block in re.findall(r'<article\b[^>]*class="sf-directory-card"[^>]*>.*?</article>', raw, re.S):
        a = attrs(block.split('>')[0])
        title = re.search(r'<strong\b[^>]*>(.*?)</strong>', block, re.S)
        if not title:
            raise RuntimeError('Existing directory card has no title.')
        links = [(html.unescape(url), c.text_from(label)) for url, label in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)]
        internal = next((url for url, _ in links if url.startswith(c.SITE+'/') and '/tag/' not in url), '')
        image = re.search(r'<img\b[^>]*src="([^"]+)"', block)
        title = c.text_from(title.group(1))
        result.append({'id': 'guide:'+internal if internal else 'candidate:'+c.canonical_text(title),
                       'type': 'guide' if internal else 'candidate', 'title': title,
                       'image': html.unescape(image.group(1)) if image else '', 'url': internal,
                       'characters': [a.get('data-character', 'sanrio-characters')],
                       'kind': a.get('data-kind', 'sanrio-goods'),
                       'kindLabel': labels.get(a.get('data-kind', ''), 'サンリオグッズ'),
                       'search': a.get('data-search', title),
                       'amazon': next((url for url, label in links if label=='Amazonで探す'), ''),
                       'rakuten': next((url for url, label in links if label=='楽天で探す'), '')})
    if not result:
        raise RuntimeError('No existing guide/candidate cards found; refusing to overwrite /goods/.')
    return result


def build_index(pages, guides):
    by_id = {p['id']: p for p in pages}
    products = {}
    characters = []
    kinds = {}
    memberships = collections.Counter()
    for key, (pid, slug, name) in c.CHARACTERS.items():
        page = by_id.get(pid, {})
        if page.get('slug') != slug:
            raise RuntimeError('Character page identity mismatch: '+key)
        directory_key = SLUGS.get(key, key)
        cards = c.extract_existing_cards(page['content'].get('raw', page['content'].get('rendered', '')))
        if not cards:
            raise RuntimeError('Missing live character catalog: '+key)
        characters.append({'key': directory_key, 'name': name, 'url': c.SITE+'/'+slug+'/'})
        for card in cards:
            if not c.matches_character(card['title'], key):
                raise RuntimeError('Character mismatch: '+key)
            item = c.clean_candidate(card)
            if not item:
                raise RuntimeError('Invalid catalog product: '+key)
            memberships[directory_key] += 1
            kind = card['category'] or item['category']
            kinds[kind] = kind
            identity = 'rakuten:'+item['code']
            if identity not in products:
                products[identity] = {'id': identity, 'type': 'product', 'title': item['title'],
                                      'image': item['image'], 'rakuten': item['affiliate'],
                                      'url': '',
                                      'characters': [], 'kind': kind, 'shop': item['shop'],
                                      }
            if directory_key not in products[identity]['characters']:
                products[identity]['characters'].append(directory_key)
    # Keep guide cards and purchase-search candidates distinct from photo products.
    seen = set(products)
    for guide in guides:
        if guide['id'] in seen:
            continue
        products[guide['id']] = guide
        seen.add(guide['id'])
    for item in products.values():
        kinds.setdefault(item['kind'], item.get('kindLabel', item['kind']))
    return {'version': 1, 'amazonTag': c.AMAZON_TAG, 'items': list(products.values()), 'characters': characters,
            'kinds': kinds, 'photoMemberships': dict(memberships)}


def safe_json(data):
    # Prevent WordPress text filters and HTML script termination from changing data.
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')


def read_index(raw):
    match = re.search(r'(<script\b[^>]*id="'+DATA_ID+r'"[^>]*>)(.*?)</script>',raw,re.S)
    if not match:
        return None
    payload = match.group(2)
    if 'data-encoding="gzip-base64"' in match.group(1):
        payload = gzip.decompress(base64.b64decode(payload)).decode()
    return json.loads(payload)


def render(index):
    counts = {x['key']: collections.Counter() for x in index['characters']}
    for item in index['items']:
        for key in item['characters']:
            counts.setdefault(key, collections.Counter())[item['type']] += 1
    options = []
    characters = list(index['characters'])
    if 'sanrio-characters' in counts:
        characters.append({'key':'sanrio-characters', 'name':'サンリオキャラクターズ', 'url':''})
    # Reuse the existing character selector order.
    order = {key:i for i, (_,key) in enumerate(d.CHARACTER_CATALOG)}
    characters.sort(key=lambda x:order.get(x['key'],999))
    for char in characters:
        n = counts[char['key']]
        label = char['name']+'（商品'+str(n['product'])+'・ガイド'+str(n['guide'])+('・候補'+str(n['candidate']) if n['candidate'] else '')+'件）'
        options.append('<option value="'+html.escape(char['key'],quote=True)+'">'+html.escape(label)+'</option>')
    kinds = '<option value="">すべての商品カテゴリ</option>'+''.join('<option value="'+html.escape(key,quote=True)+'">'+html.escape(label)+'</option>' for key,label in sorted(index['kinds'].items()))
    controls = '<div class="sf-directory-filters">'
    controls += '<label>キーワードで検索<input type="search" data-sf-search aria-label="商品名、型番、JANで検索" placeholder="商品名・ブランド・型番・JANなど"></label>'
    controls += '<label>キャラクター<select data-sf-character aria-label="キャラクターで絞り込む"><option value="">すべてのキャラクター</option>'+''.join(options)+'</select></label>'
    controls += '<label>商品カテゴリ<select data-sf-kind aria-label="商品カテゴリで絞り込む">'+kinds+'</select></label>'
    controls += '<label>表示対象<select data-sf-type aria-label="表示対象"><option value="">すべて</option><option value="product">写真付き商品</option><option value="guide">商品ガイド</option><option value="candidate">通販検索候補</option></select></label>'
    controls += '<button type="button" data-sf-reset>条件をクリア</button></div>'
    style = (ROOT / 'unified-product-search.css').read_text()
    script = (ROOT / 'unified-product-search.js').read_text()
    return (MARKER+'<style>'+style+'</style><section class="sf-directory sf-unified-directory" aria-labelledby="sf-directory-title">'
            '<h2 id="sf-directory-title">サンリオグッズカタログ</h2><p>キャラクター別の写真付き商品と、詳しい商品ガイドをまとめて検索できます。リンクにはアフィリエイト広告を含みます。</p>'
            +controls+'<p data-sf-count aria-live="polite">商品を読み込んでいます。</p><p data-sf-character-links hidden></p>'
            '<div class="sf-directory-grid" data-sf-results></div><p data-sf-empty hidden>条件に合う商品がありません。検索語や絞り込み条件を変えてください。</p>'
            '<button type="button" data-sf-load-more hidden>次の商品を表示</button><p><small>価格・在庫・種類・配送条件は購入先でご確認ください。Amazonのボタンは商品名などによる検索です。</small></p>'
            '<noscript>検索にはJavaScriptを使用します。<a href="'+c.SITE+'/characters/">キャラクター別の商品一覧はこちら</a></noscript>'
            '<script type="application/octet-stream" data-encoding="gzip-base64" id="'+DATA_ID+'">'+base64.b64encode(gzip.compress(safe_json(index).encode(),mtime=0)).decode()+'</script><script>'+script+'</script></section>')


def sync(wp=None):
    wp = wp or c.WordPress()
    goods = wp.call('/wp/v2/pages/804?context=edit&_fields=id,slug,content')
    if goods.get('slug') != 'goods':
        raise RuntimeError('Goods page identity mismatch.')
    raw = goods['content']['raw']
    guides = existing_guides(raw)
    ids = ','.join(str(v[0]) for v in c.CHARACTERS.values())
    pages = wp.call('/wp/v2/pages?context=edit&per_page=100&include='+ids+'&_fields=id,slug,content')
    index = build_index(pages, guides)
    start = raw.find(MARKER)
    end = raw.find('</section>', start)
    if start < 0 or end < 0:
        raise RuntimeError('Managed directory boundary missing.')
    updated = raw[:start]+render(index)+raw[end+len('</section>'):]
    if wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']['raw'] != raw:
        raise RuntimeError('Goods page changed during indexing; retry safely.')
    if updated != raw:
        wp.call('/wp/v2/pages/804', {'content':updated})
    saved = wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']
    for form in ('raw','rendered'):
        if read_index(saved[form]) != index:
            raise RuntimeError('Saved search index verification failed: '+form)
    totals = collections.Counter(x['type'] for x in index['items'])
    print('UNIFIED',json.dumps({'uniqueItems':len(index['items']),'types':dict(totals),'photoCards':sum(index['photoMemberships'].values()),'characterCounts':index['photoMemberships']},ensure_ascii=False),flush=True)
    return index


if __name__ == '__main__':
    sync()
