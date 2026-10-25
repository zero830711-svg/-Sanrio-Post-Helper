"""Add character-specific gacha navigation from explicit published lineups."""
import argparse
import html
import importlib.util
import json
import re
import ast
from pathlib import Path
from urllib.parse import urlencode, urlsplit

SITE = 'https://sanrio-fan.site'
START = '<!-- sf-character-gacha:start -->'
END = '<!-- sf-character-gacha:end -->'
ANCHOR = '<!-- sf-character-product-guides:v1 -->'


def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value))).strip()


def character_map(path):
    for node in ast.parse(Path(path).read_text(encoding='utf-8')).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'CHARACTERS' for t in node.targets):
            return ast.literal_eval(node.value)
    raise RuntimeError('Character map not found.')


def product(post):
    content = post['content']['rendered']
    match = re.search(r'<h[23][^>]*>[^<]*ラインナップ[^<]*</h[23]>\s*(<ul>.*?</ul>)', content, re.S)
    if not match:
        return None
    lineup = [plain(x) for x in re.findall(r'<li[^>]*>(.*?)</li>', match[1], re.S)]
    rows = re.findall(r'<tr[^>]*>\s*<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>\s*</tr>', content, re.S)
    facts = {plain(k): plain(v) for k,v in rows}
    name = facts.get('商品名', '')
    price = facts.get('カプセル販売価格', facts.get('価格', ''))
    release = next((v for k,v in facts.items() if '発売' in k), '')
    # Do not treat purchase links, related articles, or merchant descriptions as a lineup.
    if not name or not lineup or not re.fullmatch(r'1回[0-9,]+円(?:（税込）)?', price) or not re.search(r'20\d{2}年\d{1,2}月', release):
        return None
    date = re.search(r'(20\d{2})年(\d{1,2})月', release)
    if urlsplit(post['link']).hostname != 'sanrio-fan.site':
        raise RuntimeError('Unexpected article domain.')
    return {'id':post['id'], 'title':name, 'price':price, 'release':release,
            'link':post['link'], 'lineup':lineup,
            'sort':(int(date[1]),int(date[2]),post['id'])}


def matches(item, name):
    aliases = {'リトルツインスターズ':['リトルツインスターズ','キキ＆ララ','キキララ'],
               'KIRIMIちゃん.':['KIRIMIちゃん.','KIRIMIちゃん'],
               'ハローキティ':['ハローキティ','HELLO KITTY','HELLOKITTY']}.get(name,[name])
    return any(alias.casefold() in value.casefold() for alias in aliases for value in [item['title']]+item['lineup'])


def render(name, items):
    esc = lambda v: html.escape(str(v), quote=True)
    cards=[]
    for item in items:
        cards.append('<article class="sf-character-gacha-card"><h3><a href="'+esc(item['link'])+'">'+esc(item['title'])+'</a></h3>'
                     '<p><strong>'+esc(item['price'])+'</strong><br><span>メーカー掲載の発売時期：'+esc(item['release'])+'</span></p>'
                     '<a class="sf-character-gacha-detail" href="'+esc(item['link'])+'">ラインナップを見る →</a></article>')
    grid=lambda group:'<div class="sf-character-gacha-grid">'+''.join(group)+'</div>'
    more=('<details><summary>ほかの掲載ガチャも見る（'+str(len(cards)-9)+'件）</summary>'+grid(cards[9:])+'</details>') if len(cards)>9 else ''
    return START+'''<style>
.sf-character-gacha{margin:18px 0;padding:16px;border-radius:16px;background:#fff7fb;text-align:left;color:#403547}
.sf-character-gacha h2{font-size:22px;line-height:1.4;margin:0 0 10px}
.sf-character-gacha>p{font-size:13px;line-height:1.7;margin:8px 0}
.sf-character-gacha-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.sf-character-gacha-card{display:flex;flex-direction:column;min-width:0;padding:10px;border:1px solid #eadde5;border-radius:12px;background:#fff}
.sf-character-gacha-card h3{margin:0 0 8px;font-size:clamp(12px,3vw,15px);line-height:1.5;overflow-wrap:anywhere}
.sf-character-gacha-card p{font-size:12px;line-height:1.6;margin:0 0 8px}.sf-character-gacha-card span{font-size:11px}
.sf-character-gacha a{color:#674e72;text-decoration:underline;white-space:normal}
.sf-character-gacha-detail{display:block;margin-top:auto;font-size:12px;padding:8px 0;line-height:1.5}
.sf-character-gacha details{margin-top:12px}.sf-character-gacha summary{cursor:pointer;padding:10px 0;font-size:14px}
</style><section class="sf-character-gacha" aria-labelledby="sf-character-gacha-title"><h2 id="sf-character-gacha-title">'''+esc(name)+'が登場するガチャ</h2><p>記事のラインナップや商品名から確認できた'+str(len(items))+'商品を掲載。メーカー掲載の発売年月が新しい順です。新発売・店頭在庫を保証する一覧ではありません。</p>'+grid(cards[:9])+more+'<p>価格はカプセル販売時の案内です。通販のセット価格とは異なります。中身はランダムで、希望のキャラクターが必ず出るものではありません。発売時期・取扱店・在庫は各記事と公式案内をご確認ください。</p><p><a href="/category/gacha/">サンリオのガチャ記事をすべて見る →</a></p></section>'+END


def replace(raw, section):
    if START in raw or END in raw:
        if raw.count(START)!=1 or raw.count(END)!=1:raise RuntimeError('Invalid section markers.')
        return re.sub(re.escape(START)+r'.*?'+re.escape(END),lambda _:section,raw,flags=re.S)
    if raw.count(ANCHOR)!=1:raise RuntimeError('Character product section anchor missing.')
    return raw.replace(ANCHOR,section+ANCHOR,1)


def without_section(raw):
    return re.sub(re.escape(START)+r'.*?'+re.escape(END),'',raw,flags=re.S)


def sync(wp):
    categories=wp.call('/wp/v2/categories?slug=gacha&_fields=id,slug')
    if len(categories)!=1:raise RuntimeError('Ambiguous category.')
    posts=[]
    for page_no in range(1,21):
        batch=wp.call('/wp/v2/posts?'+urlencode({'categories':categories[0]['id'],'status':'publish','per_page':100,'page':page_no,'_fields':'id,link,title,content'}))
        posts.extend(batch)
        if len(batch)<100:break
    else:raise RuntimeError('Gacha pagination limit reached.')
    products=[item for p in posts if (item:=product(p))]
    products.sort(key=lambda x:x['sort'],reverse=True)
    prepared=[]
    for slug,name in character_map('scripts/sync-character-guide-cards.py').items():
        items=[p for p in products if matches(p,name)]
        if not items:continue
        pages=wp.call('/wp/v2/pages?'+urlencode({'slug':slug,'context':'edit','_fields':'id,slug,status,content,modified_gmt'}))
        if len(pages)!=1 or pages[0]['slug']!=slug or pages[0]['status']!='publish':raise RuntimeError('Page identity mismatch: '+slug)
        page=pages[0];raw=page['content']['raw'];section=render(name,items);updated=replace(raw,section)
        if without_section(raw)!=without_section(updated):raise RuntimeError('Unrelated content changed.')
        prepared.append((page,updated,len(items)))
    if not prepared:raise RuntimeError('No eligible character pages.')
    for page,updated,count in prepared:
        path='/wp/v2/pages/'+str(page['id'])
        latest=wp.call(path+'?context=edit')
        if latest['content']['raw']!=page['content']['raw']:raise RuntimeError('Concurrent page edit.')
        if updated!=page['content']['raw']:wp.call(path,data={'content':updated})
        saved=wp.call(path+'?context=edit')
        if saved['content']['raw']!=updated or saved['slug']!=page['slug'] or saved['status']!='publish':raise RuntimeError('Save verification failed.')
        print('VERIFIED',page['slug'],count,'gacha articles')


def self_test():
    sample={'title':'サンリオのおもちゃ','lineup':['マイメロディ','シナモロール']}
    assert not matches(sample,'クロミ')
    assert matches(sample,'マイメロディ')
    sample['lineup']=['クロミ（紫）'];assert matches(sample,'クロミ')
    text=render('クロミ',[dict(sample,link=SITE+'/gacha/',price='1回300円（税込）',release='2026年10月')]*12)
    raw='<header><p>intro</p>'+ANCHOR+'catalog</header>'
    updated=replace(raw,text)
    assert without_section(updated)==raw and replace(updated,text)==updated
    assert text.count('class="sf-character-gacha-card"')==12 and 'ほかの掲載ガチャも見る（3件）' in text
    print('Character matching, preserved catalog and idempotent section tests passed.')


if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('--self-test',action='store_true');config=args.parse_args()
    if config.self_test:self_test()
    else:
        spec=importlib.util.spec_from_file_location('publisher','scripts/publish-editorial-article.py')
        publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
        sync(publisher.WordPress())

