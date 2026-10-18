"""Add character and product-kind tags plus affiliate buttons to /goods/."""
import argparse
import base64
import html
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://sanrio-fan.site'
MARKER = '<!-- sanrio-product-directory:v1 -->'
AMAZON_TAG = 'ononbrothers2-22'
RAKUTEN_AFFILIATE_ID = '56386226.a6714b12.56386227.a1326022'
CHARACTER_GUIDE_PAGE_IDS = {
    'pochacco': 800,
    'kuromi': 797,
    'my-melody': 798,
    'cinnamoroll': 796,
    'hello-kitty': 801,
    'pompompurin': 799,
    'hangyodon': 802,
    'little-twin-stars': 803,
}
CHARACTER_GUIDE_SLUGS = {
    'kirimi-chan': 'character-kirimi-chan',
    'osaru-no-monkichi': 'character-osaru-no-monkichi',
    'gaopoweru': 'character-gaopoweru',
    'corocorokuririn': 'character-corocorokuririn',
    'goropikadon': 'character-goropikadon',
    'jewelpet': 'character-jewelpet',
    'sugar-bunnies': 'character-sugar-bunnies',
    'charmmy-kitty': 'character-charmmy-kitty',
    'chococat': 'character-chococat',
    'dear-daniel': 'character-dear-daniel',
    'hanamaru-obake': 'character-hanamaru-obake',
    'bonbonribbon': 'character-bonbonribbon',
    'marshmallow-fuwafuwa-nyanko': 'character-marshmallow-fuwafuwa-nyanko',
    'marumofubiyori': 'character-marumofubiyori',
    'marroncream': 'character-marroncream',
    'minna-no-taabou': 'character-minna-no-taabou',
    'little-forest-fellow': 'character-little-forest-fellow',
    'ruroromannic': 'character-ruroromannic',
    'kerokerokeroppi': 'kerokerokeroppi-goods',
    'gudetama': 'gudetama-goods',
    'wish-me-mell': 'wish-me-mell-goods',
    'my-sweet-piano': 'my-sweet-piano-goods',
    'jochum': 'jochum-goods',
    'tuxedo-sam': 'tuxedo-sam-goods',
    'ahiru-no-pekkle': 'ahiru-no-pekkle-goods',
    'bad-badtz-maru': 'bad-badtz-maru-goods',
    'cogimyun': 'cogimyun-goods',
    'usahana': 'usahana-goods',
}

# Names follow the character categories on Sanrio's official online shop.
CHARACTER_CATALOG = [
    ('ハローキティ', 'hello-kitty'),
    ('マイメロディ', 'my-melody'),
    ('リトルツインスターズ', 'little-twin-stars'),
    ('ポムポムプリン', 'pompompurin'),
    ('シナモロール', 'cinnamoroll'),
    ('クロミ', 'kuromi'),
    ('ポチャッコ', 'pochacco'),
    ('ハンギョドン', 'hangyodon'),
    ('タキシードサム', 'tuxedo-sam'),
    ('けろけろけろっぴ', 'kerokerokeroppi'),
    ('バッドばつ丸', 'bad-badtz-maru'),
    ('あひるのペックル', 'ahiru-no-pekkle'),
    ('ぐでたま', 'gudetama'),
    ('マイスウィートピアノ', 'my-sweet-piano'),
    ('ウィッシュミーメル', 'wish-me-mell'),
    ('こぎみゅん', 'cogimyun'),
    ('はなまるおばけ', 'hanamaru-obake'),
    ('がおぱわるぅ', 'gaopoweru'),
    ('ぼんぼんりぼん', 'bonbonribbon'),
    ('ディアダニエル', 'dear-daniel'),
    ('チャーミーキティ', 'charmmy-kitty'),
    ('まるもふびより', 'marumofubiyori'),
    ('コロコロクリリン', 'corocorokuririn'),
    ('マロンクリーム', 'marroncream'),
    ('シュガーバニーズ', 'sugar-bunnies'),
    ('ウサハナ', 'usahana'),
    ('マシュマロみたいなふわふわにゃんこ', 'marshmallow-fuwafuwa-nyanko'),
    ('チョコキャット', 'chococat'),
    ('KIRIMIちゃん.', 'kirimi-chan'),
    ('おさるのもんきち', 'osaru-no-monkichi'),
    ('ゴロピカドン', 'goropikadon'),
    ('ジュエルペット', 'jewelpet'),
    ('みんなのたあ坊', 'minna-no-taabou'),
    ('リトルフォレストフェロォ', 'little-forest-fellow'),
    ('ルロロマニック', 'ruroromannic'),
    ('JOCHUM', 'jochum'),
]


class WordPress:
    def __init__(self):
        user, password = os.getenv('SANRIO_WP_USER', ''), os.getenv('SANRIO_WP_APP_PASSWORD', '')
        if not user or not password:
            raise RuntimeError('Set the WordPress Actions secrets first.')
        self.auth = 'Basic ' + base64.b64encode((user + ':' + password).encode()).decode()
        self.opener = request.build_opener()

    def call(self, path, data=None):
        if not path.startswith('/wp/v2/'):
            raise ValueError('Only standard WordPress REST routes are allowed.')
        req = request.Request(SITE + '/wp-json' + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Authorization': self.auth, 'User-Agent': 'SanrioProductDirectory/1.1',
                     **({'Content-Type':'application/json'} if data is not None else {})})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response), response.headers
        except error.HTTPError as exc:
            raise RuntimeError(f'WordPress REST returned HTTP {exc.code}.') from None


def tag_spec(product):
    character = product['character']
    character_slug = product.get('character_slug', '')
    kind = product['kind']
    kind_slug = product.get('kind_slug', '')
    for slug in (character_slug, kind_slug):
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
            raise RuntimeError('Every product needs an explicit, URL-safe character_slug and kind_slug.')
    return [(character, character_slug), (kind, kind_slug)]


def product_key(product):
    jan = str(product.get('jan', '')).strip()
    if jan:
        if not re.fullmatch(r'\d{8,14}', jan):
            raise RuntimeError('JAN must contain 8 to 14 digits.')
        return 'jan-' + jan
    asin = str(product.get('amazon_asin') or product.get('asin') or '').strip().upper()
    if asin:
        if not re.fullmatch(r'[A-Z0-9]{10}', asin):
            raise RuntimeError('Amazon ASIN must contain 10 letters or digits.')
        return 'amazon-' + asin.lower()
    item_code = str(product.get('rakuten_item_code') or product.get('itemCode') or product.get('item_code') or '').strip()
    if item_code:
        digest = hashlib.sha256(item_code.encode('utf-8')).hexdigest()[:20]
        return 'rakuten-' + digest
    catalog_id = str(product.get('catalog_id') or '').strip().lower()
    if catalog_id and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', catalog_id):
        return catalog_id
    raise RuntimeError('A product needs a JAN, Amazon ASIN, Rakuten item code, or catalog_id.')


def load_products(amazon_candidates=None, rakuten_candidates=None):
    by_key = {}
    for path in sorted((ROOT / 'blog').glob('products-*.json')):
        for product in json.loads(path.read_text()):
            key = product_key(product)
            by_key.setdefault(key, product)
    if not by_key:
        raise RuntimeError('No reviewed product data was found.')
    products = list(by_key.values())
    products = merge_amazon_candidates(products, amazon_candidates)
    return merge_rakuten_candidates(products, rakuten_candidates)



def merge_amazon_candidates(products, candidate_path):
    if not candidate_path:
        return products
    payload = json.loads(Path(candidate_path).read_text(encoding='utf-8'))
    if not isinstance(payload, list):
        raise RuntimeError('Amazon candidate export must be a list.')
    known = {product_key(p) for p in products}
    now = __import__('time').time()
    chars = sorted(CHARACTER_CATALOG, key=lambda item: len(item[0]), reverse=True)
    aliases = [('キキララ', 'リトルツインスターズ', 'little-twin-stars')]
    kinds = [
        (r'ぬいぐるみ|マスコット| plush', 'ぬいぐるみ', 'plush'),
        (r'バッグ|ポーチ|ショルダー', 'バッグ・ポーチ', 'bags-pouches'),
        (r'文房具|ペン|ノート|シール|ステッカー', '文具・シール', 'stationery-stickers'),
        (r'キーホルダー|チャーム', 'キーホルダー', 'keychains'),
        (r'食器|マグ|生活雑貨|タオル|収納', '生活雑貨', 'daily-goods'),
        (r'推し活|カード|トレカ|アクスタ', '推し活・収納', 'oshi-storage'),
        (r'おもちゃ|玩具|ガチャ|フィギュア', 'おもちゃ', 'toys'),
        (r'ファッション|靴下|服|アパレル', 'ファッション', 'fashion'),
        (r'本|絵本|カレンダー|ブック', '本・カレンダー', 'books-calendar'),
    ]
    for item in payload:
        if not isinstance(item, dict):
            continue
        asin = str(item.get('asin', '')).upper()
        title = str(item.get('title', '')).strip()
        query = str(item.get('query', '')).strip()
        url = str(item.get('url', ''))
        fetched = int(item.get('fetchedAt', 0) or 0)
        if not re.fullmatch(r'[A-Z0-9]{10}', asin) or not title or fetched > now or now - fetched >= 86400:
            continue
        parsed = parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'www.amazon.co.jp' or not re.search(r'/(?:dp|gp/product)/' + asin + r'(?:/|$)', parsed.path, re.I):
            continue
        key = 'amazon-' + asin.lower()
        if key in known:
            continue
        search_source = query + ' ' + title
        character = None
        for name, slug in chars:
            if re.search(re.escape(name), query, re.I) or re.search(re.escape(name), title, re.I):
                character = (name, slug)
                break
        if character is None:
            for alias, name, slug in aliases:
                if alias in query or alias in title:
                    character = (name, slug)
                    break
        if character is None:
            character = ('サンリオキャラクターズ', 'sanrio-characters')
        kind = next(((name, slug) for pattern, name, slug in kinds
                     if re.search(pattern, search_source, re.I)), ('サンリオグッズ', 'sanrio-goods'))
        products.append({
            'amazon_asin': asin, 'name': title, 'title': title,
            'query': title, 'character': character[0], 'character_slug': character[1],
            'kind': kind[0], 'kind_slug': kind[1], 'source': 'Amazon Creators API',
            'fetched_at': fetched, 'catalog_candidate': True,
        })
        known.add(key)
    return products


def merge_rakuten_candidates(products, candidate_path):
    if not candidate_path:
        return products
    payload = json.loads(Path(candidate_path).read_text(encoding='utf-8'))
    if not isinstance(payload, list):
        raise RuntimeError('Rakuten candidate export must be a list.')
    known = {product_key(p) for p in products}
    now = __import__('time').time()
    chars = sorted(CHARACTER_CATALOG, key=lambda item: len(item[0]), reverse=True)
    aliases = [('キキララ', 'リトルツインスターズ', 'little-twin-stars')]
    kinds = [
        (r'ぬいぐるみ|マスコット|plush', 'ぬいぐるみ', 'plush'),
        (r'バッグ|ポーチ|ショルダー', 'バッグ・ポーチ', 'bags-pouches'),
        (r'文房具|ペン|ノート|シール|ステッカー|文具', '文具・シール', 'stationery-stickers'),
        (r'キーホルダー|チャーム', 'キーホルダー', 'keychains'),
        (r'食器|マグ|生活雑貨|タオル|収納', '生活雑貨', 'daily-goods'),
        (r'推し活|カード|トレカ|アクスタ', '推し活・収納', 'oshi-storage'),
        (r'おもちゃ|玩具|ガチャ|フィギュア', 'おもちゃ', 'toys'),
        (r'ファッション|靴下|服|アパレル', 'ファッション', 'fashion'),
        (r'本|絵本|カレンダー|ブック|ISBN', '本・カレンダー', 'books-calendar'),
    ]
    accepted = []
    seen = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        code = str(item.get('code', '')).strip()
        title = str(item.get('title', '')).strip()
        service = str(item.get('service', '')).strip()
        fetched = int(item.get('sourceAt', 0) or 0)
        if (not re.fullmatch(r'[A-Za-z0-9._:-]{1,200}', code)
                or service not in ('market', 'books') or not title
                or fetched > now or now - fetched >= 14 * 86400):
            continue
        key = product_key({'rakuten_item_code': code})
        if key in known or key in seen:
            continue
        character = None
        for name, slug in chars:
            if name in title:
                character = (name, slug)
                break
        if character is None:
            for alias, name, slug in aliases:
                if alias in title:
                    character = (name, slug)
                    break
        if character is None:
            character = ('サンリオキャラクターズ', 'sanrio-characters')
        kind = next(((name, slug) for pattern, name, slug in kinds
                     if re.search(pattern, title, re.I)),
                    ('本・カレンダー', 'books-calendar') if service == 'books'
                    else ('サンリオグッズ', 'sanrio-goods'))
        accepted.append({
            'rakuten_item_code': code, 'name': title, 'title': title,
            'query': title, 'character': character[0], 'character_slug': character[1],
            'kind': kind[0], 'kind_slug': kind[1], 'source': '楽天ウェブサービス',
            'fetched_at': fetched, 'catalog_candidate': True,
        })
        seen.add(key)
    # Keep the most recently refreshed candidates when the remote source pool is large.
    accepted.sort(key=lambda product: product['fetched_at'], reverse=True)
    products.extend(accepted[:3000])
    return products

def marketplace_links(product):
    query = product['query']
    amazon_url = 'https://www.amazon.co.jp/s?k=' + parse.quote(query, safe='') + '&tag=' + AMAZON_TAG
    rakuten_target = 'https://search.rakuten.co.jp/search/mall/' + parse.quote(query, safe='') + '/'
    rakuten_url = 'https://hb.afl.rakuten.co.jp/hgc/' + RAKUTEN_AFFILIATE_ID + '/?' + parse.urlencode(
        {'pc': rakuten_target, 'm': rakuten_target})
    return amazon_url, rakuten_url


def character_page_urls(wp):
    urls = {
        slug: SITE + '/' + page_slug + '/'
        for slug, page_slug in CHARACTER_GUIDE_SLUGS.items()
    }
    for character_slug, page_id in CHARACTER_GUIDE_PAGE_IDS.items():
        page, _ = wp.call('/wp/v2/pages/' + str(page_id) + '?context=edit&_fields=id,slug')
        page_slug = page.get('slug', '')
        if page.get('id') != page_id or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', page_slug):
            raise RuntimeError('Could not verify character page ID ' + str(page_id))
        urls[character_slug] = SITE + '/' + page_slug + '/'
    return urls


def filter_controls(products, page_urls=None):
    page_urls = dict(page_urls or {})
    for slug, page_slug in CHARACTER_GUIDE_SLUGS.items():
        page_urls.setdefault(slug, SITE + '/' + page_slug + '/')
    characters = list(CHARACTER_CATALOG)
    known = {slug for _, slug in characters}
    for p in products:
        if p['character_slug'] not in known:
            characters.append((p['character'], p['character_slug']))
            known.add(p['character_slug'])
    article_counts = {}
    for p in products:
        article_counts[p['character_slug']] = article_counts.get(p['character_slug'], 0) + 1
    character_options = []
    for name, slug in characters:
        amazon_url, rakuten_url = marketplace_links({'query': name})
        count = article_counts.get(slug, 0)
        page_url = page_urls.get(slug, '')
        availability = '商品 ' + str(count) + '件' if count else '通販検索'
        character_options.append(
            '<option value="' + html.escape(slug, quote=True) + '"'
            ' data-character-name="' + html.escape(name, quote=True) + '"'
            ' data-article-count="' + str(count) + '"'
            ' data-amazon-url="' + html.escape(amazon_url, quote=True) + '"'
            ' data-rakuten-url="' + html.escape(rakuten_url, quote=True) + '"'
            ' data-character-page-url="' + html.escape(page_url, quote=True) + '">' 
            + html.escape(name + '（' + availability + '）') + '</option>')
    kinds = sorted({(p['kind'], p['kind_slug']) for p in products})
    kind_options = ''.join(
        '<option value="' + html.escape(slug, quote=True) + '">' + html.escape(name) + '</option>'
        for name, slug in kinds)
    return (
        '<div class="sf-directory-filters" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:10px;margin:20px 0;padding:14px;border:1px solid #eadde5;border-radius:16px;background:#fff">'
        '<label style="display:flex;flex-direction:column;gap:6px;font-weight:700">キーワードで検索'
        '<input type="search" data-sf-search placeholder="商品名・型番・JANなど" aria-label="商品名、型番、JANで検索" style="box-sizing:border-box;width:100%;min-height:48px;padding:10px 12px;border:1px solid #d9cbd5;border-radius:10px;font-size:16px"></label>'
        '<label style="display:flex;flex-direction:column;gap:6px;font-weight:700">キャラクター'
        '<select data-sf-character aria-label="キャラクターで絞り込む" style="box-sizing:border-box;width:100%;min-height:48px;padding:10px 12px;border:1px solid #d9cbd5;border-radius:10px;background:#fff;font-size:16px"><option value="">すべてのキャラクター</option>' + ''.join(character_options) + '</select></label>'
        '<label style="display:flex;flex-direction:column;gap:6px;font-weight:700">商品カテゴリ'
        '<select data-sf-kind aria-label="商品カテゴリで絞り込む" style="box-sizing:border-box;width:100%;min-height:48px;padding:10px 12px;border:1px solid #d9cbd5;border-radius:10px;background:#fff;font-size:16px"><option value="">すべての商品カテゴリ</option>' + kind_options + '</select></label>'
        '<button type="button" data-sf-reset style="align-self:end;min-height:48px;padding:10px 14px;border:1px solid #d9cbd5;border-radius:10px;background:#faf7f9;color:#46374b;font-size:16px;font-weight:700">条件をクリア</button>'
        '</div><p data-sf-count aria-live="polite" style="margin:8px 0 14px;font-weight:700">全' + str(len(products)) + '件を表示</p>'
        '<p data-sf-marketplace style="display:none;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0 14px"><strong data-sf-marketplace-label></strong>'
        '<a data-sf-amazon target="_blank" rel="sponsored nofollow noopener" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border-radius:10px;background:#ffbd35;color:#202124;font-weight:700;text-decoration:none">Amazonでこのキャラを探す</a>'
        '<a data-sf-rakuten target="_blank" rel="sponsored nofollow noopener" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border-radius:10px;background:#bf0000;color:#fff;font-weight:700;text-decoration:none">楽天でこのキャラを探す</a>'
        '<a data-sf-character-page hidden style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border:1px solid #eadde5;border-radius:10px;color:#46374b;font-weight:700;text-decoration:none">キャラクター別ガイドを読む →</a></p>'
        '<p data-sf-empty hidden style="padding:18px;border-radius:12px;background:#fff;color:#65546a">条件に合う商品がありません。検索語や絞り込み条件を変えてください。</p>'
        '<p style="font-size:13px;color:#766b78">キャラクター名は<a href="https://shop.sanrio.co.jp/character" target="_blank" rel="noopener">サンリオオンラインショップの掲載一覧</a>を参考にしています。通販の掲載状況は検索先でご確認ください。</p>'
        '<script>(function(){var root=document.currentScript.closest(".sf-directory");if(!root)return;function init(){var cards=Array.prototype.slice.call(root.querySelectorAll(".sf-directory-card"));var search=root.querySelector("[data-sf-search]");var character=root.querySelector("[data-sf-character]");var kind=root.querySelector("[data-sf-kind]");var count=root.querySelector("[data-sf-count]");var empty=root.querySelector("[data-sf-empty]");var reset=root.querySelector("[data-sf-reset]");var marketplace=root.querySelector("[data-sf-marketplace]");var marketLabel=root.querySelector("[data-sf-marketplace-label]");var amazon=root.querySelector("[data-sf-amazon]");var rakuten=root.querySelector("[data-sf-rakuten]");var pageLink=root.querySelector("[data-sf-character-page]");var loadMore=root.querySelector("[data-sf-load-more]");var limit=48;function apply(){var q=(search.value||"").trim().toLocaleLowerCase("ja");var matches=[];cards.forEach(function(card){var matchesText=!q||(card.getAttribute("data-search")||"").toLocaleLowerCase("ja").indexOf(q)!==-1;var matchesCharacter=!character.value||card.getAttribute("data-character")===character.value;var matchesKind=!kind.value||card.getAttribute("data-kind")===kind.value;if(matchesText&&matchesCharacter&&matchesKind)matches.push(card);});var shown=Math.min(limit,matches.length);cards.forEach(function(card){card.hidden=true;});matches.slice(0,shown).forEach(function(card){card.hidden=false;});count.textContent=matches.length+"件中 "+shown+"件を表示";loadMore.hidden=matches.length<=shown;loadMore.textContent="次の48件を表示（残り"+(matches.length-shown)+"件）";var selected=character.options[character.selectedIndex];marketplace.style.display=character.value?"flex":"none";if(character.value){marketLabel.textContent=selected.dataset.characterName+"の商品を通販で探す";amazon.href=selected.dataset.amazonUrl;rakuten.href=selected.dataset.rakutenUrl;pageLink.href=selected.dataset.characterPageUrl||"#";pageLink.hidden=!selected.dataset.characterPageUrl;pageLink.style.display=selected.dataset.characterPageUrl?"inline-flex":"none";}if(matches.length===0&&character.value&&selected.dataset.articleCount==="0"){empty.textContent=selected.dataset.characterName+"の写真付き商品一覧は、専用ページからご覧ください。";}else{empty.textContent="条件に合う商品がありません。検索語や絞り込み条件を変えてください。";}empty.hidden=matches.length!==0;}function resetLimit(){limit=48;apply();}search.addEventListener("input",resetLimit);character.addEventListener("change",resetLimit);kind.addEventListener("change",resetLimit);loadMore.addEventListener("click",function(){limit+=48;apply();});reset.addEventListener("click",function(){search.value="";character.value="";kind.value="";resetLimit();search.focus();});var params=new URLSearchParams(window.location.search);var initialQuery=params.get("q")||"";var initialCharacter=params.get("character")||"";if(initialQuery)search.value=initialQuery;if(initialCharacter&&Array.prototype.some.call(character.options,function(option){return option.value===initialCharacter;})){character.value=initialCharacter;}apply();}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();})();</script>'
    )


def make_section(products, posts, terms, page_urls=None):
    by_key = {
        post.get('slug', '').removeprefix('goods-'): post
        for post in posts if post
    }
    cards = []
    for p in products:
        post = by_key.get(product_key(p))
        chips = []
        for name, slug in tag_spec(p):
            if post:
                chips.append('<a class="sf-directory-chip" href="/tag/' + html.escape(slug, quote=True) + '/">' + html.escape(name) + '</a>')
            else:
                chips.append('<span class="sf-directory-chip">' + html.escape(name) + '</span>')
        if post:
            title = post['title'].get('rendered', '') if isinstance(post['title'], dict) else post['title']
            link = post.get('link', '')
            if not link.startswith(SITE + '/'):
                raise RuntimeError('Unexpected article URL.')
            image_match = re.search(r'<img\b[^>]*\bsrc=["\']([^"\']+)', post.get('content', {}).get('raw', ''))
            image_url = image_match.group(1) if image_match else ''
            if not image_url.startswith(SITE + '/wp-content/uploads/'):
                raise RuntimeError('Could not verify the local featured image for ' + product_key(p))
            product_visual = '<img loading="lazy" style="width:100%;height:160px;object-fit:contain" src="' + html.escape(image_url, quote=True) + '" alt="' + html.escape(p['character'] + ' ' + p['name'], quote=True) + '">'
            detail = '<a class="sf-directory-product" style="display:flex;flex-direction:column;gap:10px;color:inherit;text-decoration:none" href="' + html.escape(link, quote=True) + '">' + product_visual + '<strong>' + html.escape(title) + '</strong><span>商品情報・仕様を見る →</span></a>'
        else:
            title = p.get('name') or p['title']
            product_visual = '<div aria-hidden="true" style="display:grid;place-items:center;width:100%;height:160px;border-radius:12px;background:linear-gradient(135deg,#fdf1f6,#eff9f6);color:#8b7184;font-size:38px">♡</div>'
            detail = '<div class="sf-directory-product" style="display:flex;flex-direction:column;gap:10px;color:inherit">' + product_visual + '<strong>' + html.escape(title) + '</strong><span>型番・JANを手がかりに購入先を探せます</span></div>'
        amazon_url, rakuten_url = marketplace_links(p)
        search_text = ' '.join(str(p.get(key, '')) for key in ('character', 'kind', 'name', 'title', 'model', 'jan'))
        data_attrs = (
            ' data-character="' + html.escape(p['character_slug'], quote=True) + '"'
            ' data-kind="' + html.escape(p['kind_slug'], quote=True) + '"'
            ' data-search="' + html.escape(search_text, quote=True) + '"')
        buttons = (
            '<div class="sf-directory-buy" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">'
            '<a href="' + html.escape(amazon_url, quote=True) + '" target="_blank" rel="sponsored nofollow noopener" '
            'style="display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;border-radius:10px;background:#ffbd35;color:#202124;font-weight:700;text-align:center;text-decoration:none">Amazonで探す</a>'
            '<a href="' + html.escape(rakuten_url, quote=True) + '" target="_blank" rel="sponsored nofollow noopener" '
            'style="display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;border-radius:10px;background:#bf0000;color:#fff;font-weight:700;text-align:center;text-decoration:none">楽天で探す</a>'
            '</div><small style="display:block;margin-top:8px;color:#777">JAN・型番で検索。価格・在庫・販売元は購入先でご確認ください。</small>')
        cards.append('<article class="sf-directory-card"' + data_attrs + ' style="min-width:0;border:1px solid #eadde5;border-radius:18px;padding:12px;background:#fff">' + detail + buttons + '<nav aria-label="分類" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' + ''.join(chips) + '</nav></article>')
    controls = filter_controls(products, page_urls)
    return MARKER + '<section class="sf-directory" aria-labelledby="sf-directory-title"><h2 id="sf-directory-title">サンリオグッズカタログ</h2><p>キャラクター・商品カテゴリ・JANから探せます。購入先で最新の販売状況をご確認ください。</p>' + controls + '<div class="sf-directory-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px">' + ''.join(cards) + '</div><button type="button" data-sf-load-more hidden style="width:100%;min-height:50px;margin:18px 0;padding:12px;border:1px solid #d9cbd5;border-radius:12px;background:#fff;color:#46374b;font-size:16px;font-weight:700">次の商品を表示</button></section>'


def run(mode, wp, products):
    wp.call('/wp/v2/users/me?context=edit&_fields=id')
    posts=[]
    for p in products:
        if p.get('catalog_candidate'):
            posts.append(None)
            continue
        key = product_key(p)
        query=parse.urlencode({'slug':'goods-'+key,'context':'edit','_fields':'id,slug,title,link,content,status,tags,categories'})
        rows,_=wp.call('/wp/v2/posts?'+query)
        if len(rows) > 1:
            raise RuntimeError('Multiple published product posts found for ' + key)
        post = rows[0] if rows else None
        if post and post.get('status') != 'publish':
            raise RuntimeError('Unexpected product article status for ' + key)
        if post and p.get('jan') and p['jan'] not in post.get('content', {}).get('raw', ''):
            raise RuntimeError('JAN verification failed: ' + p['jan'])
        posts.append(post)
    specs={}
    for p in products:
        for name,slug in tag_spec(p): specs[slug]=name
    terms={}
    for slug,name in specs.items():
        rows,_=wp.call('/wp/v2/tags?'+parse.urlencode({'slug':slug,'_fields':'id,name,slug'}))
        if rows:
            terms[slug]=rows[0]
        elif mode=='apply':
            term,_=wp.call('/wp/v2/tags',{'name':name,'slug':slug})
            terms[slug]=term
        else:
            terms[slug]={'id':None,'slug':slug,'name':name}
    page,_=wp.call('/wp/v2/pages/804?context=edit&_fields=id,slug,title,content')
    page_urls = character_page_urls(wp)
    content=page.get('content',{}).get('raw')
    if not isinstance(content,str): raise RuntimeError('Could not read editable /goods/ page content.')
    make_section(products,posts,terms,page_urls)  # Validate article, image, and outbound links before any write.
    if mode=='check':
        print('READY: '+str(len(products))+' catalog products; /goods/ page '+page['slug']+'; '+str(len(terms))+' character/kind tags and affiliate links checked.')
        return
    for p,post in zip(products,posts):
        if not post:
            continue
        ids=set(post.get('tags') or [])
        for _,slug in tag_spec(p): ids.add(int(terms[slug]['id']))
        wp.call('/wp/v2/posts/'+str(post['id']),{'tags':sorted(ids)})
    section=make_section(products,posts,terms,page_urls)
    if MARKER in content:
        start=content.index(MARKER)
        end=content.find('</section>',start)
        if end>=0: content=content[:start]+content[end+len('</section>'):]
        else: content=content.replace(MARKER,'')
    updated,_=wp.call('/wp/v2/pages/804',{'content':section+'\n'+content})
    saved_content=updated.get('content',{}).get('raw','')
    required=('data-sf-search','data-sf-character','data-sf-kind','data-sf-count','楽天で探す')
    if MARKER not in saved_content or any(token not in saved_content for token in required):
        raise RuntimeError('Product directory insertion or filter verification failed.')
    print('UPDATED: /goods/ now has '+str(len(products))+' catalog cards with Amazon and Rakuten buttons.')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['check','apply'],default='check')
    parser.add_argument('--amazon-candidates', help='Temporary, under-24-hour Amazon API results; never committed.')
    parser.add_argument('--rakuten-candidates', help='Temporary, 14-day Rakuten API titles; never committed.')
    args=parser.parse_args()
    try:
        products=load_products(args.amazon_candidates, args.rakuten_candidates)
        run(args.mode,WordPress(),products)
    except (RuntimeError,error.URLError,ValueError,KeyError) as exc:
        print(str(exc) if isinstance(exc,RuntimeError) else 'Operation failed; check site and secret settings.',file=sys.stderr)
        sys.exit(1)
