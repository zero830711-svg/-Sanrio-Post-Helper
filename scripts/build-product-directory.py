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
    for filename in ('blog/products-2026-10-18.json', 'blog/products-2026-10-18-batch2.json'):
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


def make_section(products, posts, terms):
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
        buttons = (
            '<div class="sf-directory-buy" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">'
            '<a href="'+html.escape(amazon_url,quote=True)+'" target="_blank" rel="sponsored nofollow noopener" '
            'style="display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;border-radius:10px;background:#ffbd35;color:#202124;font-weight:700;text-align:center;text-decoration:none">Amazonで探す</a>'
            '<a href="'+html.escape(rakuten_url,quote=True)+'" target="_blank" rel="sponsored nofollow noopener" '
            'style="display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px;border-radius:10px;background:#bf0000;color:#fff;font-weight:700;text-align:center;text-decoration:none">楽天で探す</a>'
            '</div><small style="display:block;margin-top:8px;color:#777">JAN・型番で検索。価格・在庫・販売元は購入先でご確認ください。</small>')
        cards.append('<article class="sf-directory-card" style="min-width:0;border:1px solid #eadde5;border-radius:18px;padding:12px;background:#fff"><a class="sf-directory-product" style="display:flex;flex-direction:column;gap:10px;color:inherit;text-decoration:none" href="'+html.escape(link,quote=True)+'"><img loading="lazy" style="width:100%;height:160px;object-fit:contain" src="'+image+'" alt="'+html.escape(p['character']+' '+p['name'],quote=True)+'"><strong>'+html.escape(title)+'</strong><span>商品情報・仕様を見る →</span></a>'+buttons+'<nav aria-label="分類" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">'+chips+'</nav></article>')
    return MARKER+'<section class="sf-directory" aria-labelledby="sf-directory-title"><h2 id="sf-directory-title">新着サンリオグッズ</h2><p>商品仕様を確認して、Amazon・楽天市場の検索結果から購入先を選べます。</p><div class="sf-directory-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px">'+''.join(cards)+'</div></section>'


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
    content=page.get('content',{}).get('raw')
    if not isinstance(content,str): raise RuntimeError('Could not read editable /goods/ page content.')
    make_section(products,posts,terms)  # Validate article, image, and outbound links before any write.
    if mode=='check':
        print('READY: '+str(len(products))+' published products; /goods/ page '+page['slug']+'; '+str(len(terms))+' character/kind tags and affiliate links checked.')
        return
    for p,post in zip(products,posts):
        ids=set(post.get('tags') or [])
        for _,slug in tag_spec(p): ids.add(int(terms[slug]['id']))
        wp.call('/wp/v2/posts/'+str(post['id']),{'tags':sorted(ids)})
    section=make_section(products,posts,terms)
    if MARKER in content:
        start=content.index(MARKER)
        end=content.find('</section>',start)
        if end>=0: content=content[:start]+content[end+len('</section>'):]
        else: content=content.replace(MARKER,'')
    updated,_=wp.call('/wp/v2/pages/804',{'content':section+'\n'+content})
    if MARKER not in updated.get('content',{}).get('raw','') or '楽天で探す' not in updated.get('content',{}).get('raw',''):
        raise RuntimeError('Product directory insertion verification failed.')
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
