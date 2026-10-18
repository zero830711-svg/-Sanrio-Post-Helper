"""Add character and product-kind tags plus a compact featured index to /goods/."""
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
            headers={'Authorization': self.auth, 'User-Agent': 'SanrioProductDirectory/1.0',
                     **({'Content-Type':'application/json'} if data is not None else {})})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response), response.headers
        except error.HTTPError as exc:
            raise RuntimeError(f'WordPress REST returned HTTP {exc.code}.') from None


def tag_spec(product):
    character = product['character']
    slug = {'ポチャッコ':'pochacco','クロミ':'kuromi','マイメロディ':'my-melody',
            'シナモロール':'cinnamoroll','ハローキティ':'hello-kitty'}[character]
    kind = product['kind']
    kind_slug = {'ボトルケース':'bottle-cases','ミラー':'mirrors','ランチバッグ':'lunch-bags',
                 '保冷剤':'ice-packs','ストローホッパーキャップ':'straw-bottle-caps'}[kind]
    return [(character, slug), (kind, kind_slug)]


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
        cards.append('<article class="sf-directory-card" style="min-width:0;border:1px solid #eadde5;border-radius:18px;padding:12px;background:#fff"><a class="sf-directory-product" style="display:flex;flex-direction:column;gap:10px;color:inherit;text-decoration:none" href="'+html.escape(link,quote=True)+'"><img loading="lazy" style="width:100%;height:160px;object-fit:contain" src="'+image+'" alt="'+html.escape(p['character']+' '+p['name'],quote=True)+'"><strong>'+html.escape(title)+'</strong><span>商品情報・購入先を見る →</span></a><nav aria-label="分類" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">'+chips+'</nav></article>')
    return MARKER+'<section class="sf-directory" aria-labelledby="sf-directory-title"><h2 id="sf-directory-title">新着サンリオグッズ</h2><p>キャラクター・商品の種類から選べます。商品仕様を確認して、Amazon・楽天市場の購入先へ。</p><div class="sf-directory-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px">'+''.join(cards)+'</div></section>'


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
    if mode=='check':
        print('READY: five published products; /goods/ page '+page['slug']+'; '+str(len(terms))+' character/kind tags checked.')
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
    if MARKER not in updated.get('content',{}).get('raw',''):
        raise RuntimeError('Product directory insertion verification failed.')
    print('UPDATED: /goods/ now lists five articles with character and product-kind tag archives.')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['check','apply'],default='check')
    args=parser.parse_args()
    try:
        products=json.loads((ROOT/'blog/products-2026-10-18.json').read_text())
        for item in products:
            item['kind']={'4973307730078':'ボトルケース','4973307729553':'ミラー',
                '4973307730160':'ランチバッグ','4973307643958':'保冷剤',
                '4973307250705':'ストローホッパーキャップ'}[item['jan']]
        run(args.mode,WordPress(),products)
    except (RuntimeError,error.URLError,ValueError,KeyError) as exc:
        print(str(exc) if isinstance(exc,RuntimeError) else 'Operation failed; check site and secret settings.',file=sys.stderr)
        sys.exit(1)
