"""Refresh the home carousel from the verified unified catalog via standard WP REST."""
import html
import re
from pathlib import Path
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parent
START='<!-- sf-home-live-catalog:start -->'
END='<!-- sf-home-live-catalog:end -->'
def choose(items,limit=24):
    pool=[x for x in items if x['type']=='product' and x.get('image')]
    pool.sort(key=lambda x:x.get('addedAt') or '',reverse=True)
    dated=[x for x in pool if x.get('addedAt')]
    pool=dated or pool
    chars={};kinds={};chosen=[]
    while pool and len(chosen)<limit:
        rank={x['id']:i for i,x in enumerate(pool)}
        item=min(pool,key=lambda x:sum(chars.get(k,0) for k in x['characters'])*4+kinds.get(x['kind'],0)*3+rank[x['id']]/len(pool))
        pool.remove(item);chosen.append(item)
        for k in item['characters']:chars[k]=chars.get(k,0)+1
        kinds[item['kind']]=kinds.get(item['kind'],0)+1
    return chosen

def render(index):
    esc=lambda s:html.escape(str(s),quote=True)
    selected=choose(index['items'])
    if len(selected)<6:raise RuntimeError('Too few verified home products')
    themes=[]
    for label,kinds in [('ぬい・マスコット',['ぬいぐるみ']),('バッグ・ポーチ',['バッグ・ポーチ']),('お洋服・アクセサリー',['ファッション'])]:
        item=next((x for x in sorted(index['items'],key=lambda x:x.get('addedAt') or '',reverse=True) if x['type']=='product' and x['kind'] in kinds),None)
        if item:themes.append('<a href="/goods/?'+esc(urlencode({'kind':item['kind'],'type':'product'}))+'"><img src="'+esc(item['image'])+'" alt="" loading="lazy"><strong>'+label+'</strong></a>')
    pages=[]
    for n in range(0,len(selected),6):
        cards=[]
        for x in selected[n:n+6]:
            link='/goods/?'+urlencode({'q':x['title'],'type':'product'})
            title=x.get('displayTitle') or re.sub(r'【[^】]*(?:SALE|送料無料|クーポン)[^】]*】','',x['title']).strip()
            cards.append('<article class="sf-live-card" data-product-id="'+esc(x['id'])+'"><a class="sf-live-photo" href="'+esc(x['rakuten'])+'" target="_blank" rel="sponsored nofollow noopener"><img src="'+esc(x['image'])+'" alt="'+esc(title)+'" loading="lazy" decoding="async"></a><button class="sf-save sf-live-save" type="button" aria-label="'+esc(title)+'を保存" aria-pressed="false" data-save-url="https://sanrio-fan.site'+esc(link)+'" data-save-title="'+esc(title)+'" data-save-image="'+esc(x['image'])+'">🔖</button><div class="sf-live-title"><a href="'+esc(link)+'" title="'+esc(title)+'">'+esc(title)+'</a></div><a class="sf-live-buy" href="'+esc(x['rakuten'])+'" target="_blank" rel="sponsored nofollow noopener">楽天で見る</a></article>')
        pages.append('<div class="sf-live-page" role="group" aria-label="'+str(n//6+1)+'ページ">'+''.join(cards)+'</div>')
    dots=''.join('<button type="button" data-home-page="'+str(i)+'" aria-label="'+str(i+1)+'ページへ" aria-current="'+('true' if i==0 else 'false')+'">●</button>' for i in range(len(pages)))
    return START+'<style>'+ (ROOT/'home-catalog.css').read_text()+'</style><section id="sf-home-themes"><h2>写真から見つける、お気に入り</h2><div class="sf-live-themes">'+''.join(themes)+'</div></section><section id="sf-home-live"><h2>最近追加したグッズ</h2><p class="sf-live-note">当サイトに最近掲載した商品からピックアップ。新発売順ではありません。</p><div class="sf-live-track" tabindex="0" aria-label="商品一覧。横にスワイプできます">'+''.join(pages)+'</div><div class="sf-live-controls"><button type="button" data-home-prev aria-label="前のページ">‹</button><div class="sf-live-dots">'+dots+'</div><span data-home-count aria-live="polite">1 / '+str(len(pages))+'</span><button type="button" data-home-next aria-label="次のページ">›</button></div><a class="sf-live-all" href="/goods/?type=product&amp;sort=recent">すべての商品を見る →</a></section><script>'+(ROOT/'home-catalog.js').read_text()+'</script>'+END

def sync(wp,index):
    page=wp.call('/wp/v2/pages/805?context=edit&_fields=id,slug,content')
    if page['slug']!='shopping-home':raise RuntimeError('Home page identity mismatch')
    raw=page['content']['raw'];markup=render(index)
    if START in raw:
        updated=re.sub(re.escape(START)+'.*?'+re.escape(END),lambda _:markup,raw,count=1,flags=re.S)
    else:
        pattern=r'<section\b[^>]*>(?:(?!<section\b).)*?<h2[^>]*>新しく掲載したグッズ</h2>.*?</section>'
        updated,n=re.subn(pattern,lambda _:markup,raw,count=1,flags=re.S)
        if n!=1:raise RuntimeError('Existing home products section not found')
    if wp.call('/wp/v2/pages/805?context=edit&_fields=content')['content']['raw']!=raw:raise RuntimeError('Home changed during preparation')
    if updated!=raw:wp.call('/wp/v2/pages/805',{'content':updated})
    saved=wp.call('/wp/v2/pages/805?context=edit&_fields=content')['content']
    for form in ('raw','rendered'):
        if saved[form].count('class="sf-live-card"')!=len(choose(index['items'])):raise RuntimeError('Home cards verification failed')
        oldchars=re.search(r'<section id="characters">.*?</section>',raw,re.S)
        if oldchars and oldchars.group() not in saved['raw']:raise RuntimeError('Character section changed')
    # Existing favorites code canonicalizes URLs to paths; retain product search URLs on removal.
    favorites=wp.call('/wp/v2/pages?context=edit&slug=favorites&_fields=id,content')
    if favorites:
        favorite=favorites[0];source=favorite['content']['raw']
        tag='<script id="sf-product-favorite-support">'+(ROOT/'home-catalog.js').read_text()+'</script>'
        pattern=r'<script id="sf-product-favorite-support">.*?</script>'
        changed=re.sub(pattern,lambda _:tag,source,flags=re.S) if 'id="sf-product-favorite-support"' in source else source+tag
        if changed!=source:wp.call('/wp/v2/pages/'+str(favorite['id']),{'content':changed})
    print('HOME catalog refreshed:',len(choose(index['items'])),'cards',flush=True)
