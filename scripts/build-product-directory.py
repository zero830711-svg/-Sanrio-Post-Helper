"""Add character and product-kind tags plus affiliate buttons to /goods/."""
import argparse
import base64
import html
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
    ('チアリステイルズ', 'cheeristales'),
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


def load_products():
    products = []
    for filename in ('blog/products-2026-10-18.json', 'blog/products-2026-10-18-batch2.json', 'blog/products-2026-10-18-batch3.json'):
        path = ROOT / filename
        if path.exists():
            products.extend(json.loads(path.read_text()))
    if not products:
        raise RuntimeError('No reviewed product data was found.')
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
        availability = '記事 ' + str(count) + '件' if count else '通販検索'
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
        '<script>(function(){var root=document.currentScript.closest(".sf-directory");if(!root)return;var cards=Array.prototype.slice.call(root.querySelectorAll(".sf-directory-card"));var search=root.querySelector("[data-sf-search]");var character=root.querySelector("[data-sf-character]");var kind=root.querySelector("[data-sf-kind]");var count=root.querySelector("[data-sf-count]");var empty=root.querySelector("[data-sf-empty]");var reset=root.querySelector("[data-sf-reset]");var marketplace=root.querySelector("[data-sf-marketplace]");var marketLabel=root.querySelector("[data-sf-marketplace-label]");var amazon=root.querySelector("[data-sf-amazon]");var rakuten=root.querySelector("[data-sf-rakuten]");var pageLink=root.querySelector("[data-sf-character-page]");function apply(){var q=(search.value||"").trim().toLocaleLowerCase("ja");var visible=0;cards.forEach(function(card){var matchesText=!q||(card.getAttribute("data-search")||"").toLocaleLowerCase("ja").indexOf(q)!==-1;var matchesCharacter=!character.value||card.getAttribute("data-character")===character.value;var matchesKind=!kind.value||card.getAttribute("data-kind")===kind.value;var show=matchesText&&matchesCharacter&&matchesKind;card.hidden=!show;if(show)visible++;});count.textContent=visible+"件を表示";var selected=character.options[character.selectedIndex];marketplace.style.display=character.value?"flex":"none";if(character.value){marketLabel.textContent=selected.dataset.characterName+"の商品を通販で探す";amazon.href=selected.dataset.amazonUrl;rakuten.href=selected.dataset.rakutenUrl;pageLink.href=selected.dataset.characterPageUrl||"#";pageLink.hidden=!selected.dataset.characterPageUrl;pageLink.style.display=selected.dataset.characterPageUrl?"inline-flex":"none";}if(visible===0&&character.value&&selected.dataset.articleCount==="0"){empty.textContent=selected.dataset.characterName+"の商品ガイドはまだありません。下のボタンから通販商品を探せます。";}else{empty.textContent="条件に合う商品がありません。検索語や絞り込み条件を変えてください。";}empty.hidden=visible!==0;}search.addEventListener("input",apply);character.addEventListener("change",apply);kind.addEventListener("change",apply);reset.addEventListener("click",function(){search.value="";character.value="";kind.value="";apply();search.focus();});var params=new URLSearchParams(window.location.search);var initialQuery=params.get("q")||"";var initialCharacter=params.get("character")||"";if(initialQuery)search.value=initialQuery;if(initialCharacter&&Array.prototype.some.call(character.options,function(option){return option.value===initialCharacter;})){character.value=initialCharacter;}apply();})();</script>'
    )


def make_section(products, posts, terms, page_urls=None):
    by_jan = {post.get('slug','').removeprefix('goods-jan-'): post for post in posts}
    cards=[]
    for p in products:
        post=by_jan.get(p['jan'])
        if not post: raise RuntimeError('Could not locate published product ' + p['jan'])
        title=post['title'].get('rendered','') if isinstance(post['title'],dict) else post['title']
        link=post.get('link','')
        if not link.startswith(SITE+'/'): raise RuntimeError('Unexpected article URL.')
        image_match=re.search(r'<img\b[^>]*\bsrc=["\']([^"\']+)',post.get('content',{}).get('raw',''))
        image_url=image_match.group(1) if image_match else ''
        if not image_url.startswith(SITE+'/wp-content/uploads/'):
            raise RuntimeError('Could not verify the local featured image for JAN '+p['jan'])
        image=html.escape(image_url,quote=True)
        chips=''.join('<a class="sf-directory-chip" href="/tag/'+html.escape(slug,quote=True)+'/">'+html.escape(name)+'</a>' for name,slug in tag_spec(p))
        amazon_url, rakuten_url = marketplace_links(p)
        search_text = ' '.join((p['character'], p['kind'], p['name'], p['title'], p['model'], p['jan']))
        data_attrs = (
            ' data-character="' + html.escape(p['character_slug'], quote=True) + '"'
            ' data-kind="' + html.escape(p['kind_slug'], quote=True) + '"'
            ' data-search="' + html.escape(search_text, quote=True) + '"')
        buttons = (
            '<div class="sf-directory-buy" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">'
            '<a href="'+html.escape(amazon_url,quote=True)+'" target="_blank" rel="sponsored nofollow noopener" '
            'style="display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;border-radius:10px;background:#ffbd35;color:#202124;font-weight:700;text-align:center;text-decoration:none">Amazonで探す</a>'
            '<a href="'+html.escape(rakuten_url,quote=True)+'" target="_blank" rel="sponsored nofollow noopener" '
            'style="display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;border-radius:10px;background:#bf0000;color:#fff;font-weight:700;text-align:center;text-decoration:none">楽天で探す</a>'
            '</div><small style="display:block;margin-top:8px;color:#777">JAN・型番で検索。価格・在庫・販売元は購入先でご確認ください。</small>')
        cards.append('<article class="sf-directory-card"'+data_attrs+' style="min-width:0;border:1px solid #eadde5;border-radius:18px;padding:12px;background:#fff"><a class="sf-directory-product" style="display:flex;flex-direction:column;gap:10px;color:inherit;text-decoration:none" href="'+html.escape(link,quote=True)+'"><img loading="lazy" style="width:100%;height:160px;object-fit:contain" src="'+image+'" alt="'+html.escape(p['character']+' '+p['name'],quote=True)+'"><strong>'+html.escape(title)+'</strong><span>商品情報・仕様を見る →</span></a>'+buttons+'<nav aria-label="分類" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">'+chips+'</nav></article>')
    controls = filter_controls(products, page_urls)
    return MARKER+'<section class="sf-directory" aria-labelledby="sf-directory-title"><h2 id="sf-directory-title">新着サンリオグッズ</h2><p>商品仕様を確認して、Amazon・楽天市場の検索結果から購入先を選べます。</p>'+controls+'<div class="sf-directory-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px">'+''.join(cards)+'</div></section>'


def run(mode, wp, products):
    wp.call('/wp/v2/users/me?context=edit&_fields=id')
    posts=[]
    for p in products:
        query=parse.urlencode({'slug':'goods-jan-'+p['jan'],'context':'edit','_fields':'id,slug,title,link,content,status,tags,categories'})
        rows,_=wp.call('/wp/v2/posts?'+query)
        if len(rows)!=1 or rows[0].get('status')!='publish':
            raise RuntimeError('Expected one published product post for JAN '+p['jan'])
        if p['jan'] not in rows[0].get('content',{}).get('raw',''):
            raise RuntimeError('JAN verification failed: '+p['jan'])
        posts.append(rows[0])
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
        print('READY: '+str(len(products))+' published products; /goods/ page '+page['slug']+'; '+str(len(terms))+' character/kind tags and affiliate links checked.')
        return
    for p,post in zip(products,posts):
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
    required=('data-sf-search','data-sf-character','data-sf-kind','card.hidden=!show','楽天で探す')
    if MARKER not in saved_content or any(token not in saved_content for token in required):
        raise RuntimeError('Product directory insertion or filter verification failed.')
    print('UPDATED: /goods/ now has '+str(len(products))+' product cards with article, Amazon, and Rakuten buttons.')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['check','apply'],default='check')
    args=parser.parse_args()
    try:
        products=load_products()
        run(args.mode,WordPress(),products)
    except (RuntimeError,error.URLError,ValueError,KeyError) as exc:
        print(str(exc) if isinstance(exc,RuntimeError) else 'Operation failed; check site and secret settings.',file=sys.stderr)
        sys.exit(1)
