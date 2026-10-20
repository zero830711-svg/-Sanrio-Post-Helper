"""Maintain direct product positions and curated use-case features via WP REST."""
import collections
import hashlib
import html
import importlib.util
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
c=load('catalog','import-rakuten-character-catalog.py')
MARK='<!-- sf-product-positions:v1 -->';END='<!-- /sf-product-positions:v1 -->'
FEATURE_MARK='<!-- sf-use-features:v1 -->';FEATURE_END='<!-- /sf-use-features:v1 -->'
FEATURES=[
 ('sanrio-nui-bags','ぬい活バッグ・ポーチ','バッグ・ポーチ',r'ぬい|推し活|マスコット','ぬい活や小物整理の候補を写真から探せるバッグ・ポーチ特集です。ぬいぐるみを入れる場合は、身長だけでなく頭や体の幅、本体の内寸、開閉口を購入先で確認してください。すべての商品がぬいぐるみの持ち運びに対応するとは限りません。'),
 ('sanrio-towels','タオル・ハンカチ','タオル',None,'持ち歩き用やお部屋用に選べる、サンリオのタオル・ハンカチを写真で紹介します。ハンカチ、ループ付きタオルなどの種類、サイズ、素材、洗濯表示を購入先で確認し、使う場面に合うものを選んでください。'),
 ('sanrio-stationery','文具・シール','文具・シール',None,'ノートやシールなど、サンリオの文具を写真から探せる特集です。商品写真に複数種類が写っていても、セット販売とは限りません。内容量、選べる柄、サイズ、セット内容を購入先で確認してください。')]

def position(code):return 'sf-product-'+hashlib.sha256(code.encode()).hexdigest()[:16]

def direct_links(raw):
 raw=re.sub(re.escape(MARK)+'.*?'+re.escape(END),'',raw,flags=re.S)
 def card(m):
  tag,body=m[1],m[2];code=re.search(r'data-code="([^"]+)"',tag)
  if not code:return m[0]
  anchor=position(html.unescape(code[1]))
  tag=re.sub(r'\s+id="sf-product-[^"]*"','',tag)
  tag=tag[:-1]+' id="'+anchor+'">'
  body=re.sub(r'<a class="sf-product-position"[^>]*>.*?</a>','',body,flags=re.S)
  return tag+body+'<a class="sf-product-position" href="#'+anchor+'">商品リンクを共有</a></article>'
 updated=re.sub(r'(<article\b[^>]*class="[^"]*sf-rakuten-product-card[^"]*"[^>]*>)(.*?)(</article>)',card,raw,flags=re.S)
 if 'sf-rakuten-product-card' not in updated:return updated
 return updated+MARK+'<style>.sf-rakuten-product-card{scroll-margin-top:24px}.sf-rakuten-product-card:target{outline:3px solid #b67aad;outline-offset:2px}.sf-product-position{display:block;text-align:center;padding:5px 2px;font-size:10px!important;line-height:1.5;color:#65546a}</style><script>'+ (ROOT/'catalog-positions.js').read_text()+'</script>'+END

def select(pool,category,pattern=None):
 buckets=collections.defaultdict(list);seen=set()
 for key,items in pool.items():
  for item in items:
   if item['category']!=category:continue
   if pattern and not re.search(pattern,item['title']):continue
   if pattern and category=='バッグ・ポーチ':
    title=item['title']
    if not re.search(r'ポーチ|バッグ|リュック|バックパック|デイパック',title):continue
    if 'ポーチ' not in title and re.search(r'キーホルダー|マスコットホルダー|ブローチ|チャーム|キーリング',title):continue
   identities=c.identity_keys(item)
   if seen & identities:continue
   seen.update(identities);buckets[key].append(item)
 chosen=[]
 while any(buckets.values()) and len(chosen)<24:
  for items in buckets.values():
   if items and len(chosen)<24:chosen.append(items.pop(0))
 return chosen

def feature_page(title,intro,items):
 esc=lambda x:html.escape(x,quote=True)
 raw=FEATURE_MARK+'<section class="sf-use-feature"><p>非公式ファンサイト・アフィリエイト広告を含みます。</p><p>'+esc(intro)+'</p><p>当サイトの写真付きカタログから'+str(len(items))+'件を掲載。人気順・新発売順ではありません。価格・在庫・配送条件は購入先でご確認ください。</p><h2>'+esc(title)+'を写真から探す</h2><div class="sf-seo-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">'+''.join(c.photo_card(x) for x in items)+'</div><p><a href="/characters/">キャラクターから探す</a> ／ <a href="/goods/?type=product">すべての商品を探す</a></p></section>'+FEATURE_END
 # Keep detailed guidance after the photos, matching the character catalogs.
 intro_block='<p>'+esc(intro)+'</p>'
 raw=raw.replace(intro_block,'',1)
 raw=raw.replace('<p><a href="/characters/">','<h2>選ぶ前に確認したいこと</h2>'+intro_block+'<p><a href="/characters/">',1)
 return direct_links(c.compact_page(load('feature_seo','catalog-seo.py').CSS+raw,title))

def save(wp,page,updated):
 raw=page['content']['raw']
 if raw==updated:return
 if wp.call('/wp/v2/pages/'+str(page['id'])+'?context=edit&_fields=content')['content']['raw']!=raw:raise RuntimeError('Concurrent edit: '+page['slug'])
 saved=wp.call('/wp/v2/pages/'+str(page['id']),{'content':updated})
 if saved['content']['raw']!=updated:raise RuntimeError('Saved content mismatch')
 if c.extract_existing_cards(raw)!=c.extract_existing_cards(updated):raise RuntimeError('Products changed while adding direct links')

def run():
 wp=c.WordPress()
 # Rebuild the existing compressed search index, preserving first-seen dates.
 unified=load('unified','unify-product-search.py')
 goods=wp.call('/wp/v2/pages/804?context=edit&_fields=content')
 index=unified.read_index(goods['content']['raw'])
 if index is None or any(not x.get('url') for x in index['items'] if x['type']=='product'):
  unified.sync(wp)
 ids=','.join(str(v[0]) for v in c.CHARACTERS.values())
 chars=wp.call('/wp/v2/pages?context=edit&per_page=100&include='+ids+'&_fields=id,slug,content')
 byid={p['id']:p for p in chars};pool={k:c.extract_existing_cards(byid[v[0]]['content']['raw']) for k,v in c.CHARACTERS.items()}
 feature_links=[]
 for slug,title,category,pattern,intro in FEATURES:
  items=select(pool,category,pattern)
  if len(items)<8:print('FEATURE SKIPPED',slug,len(items),flush=True);continue
  old=wp.call('/wp/v2/pages?context=edit&slug='+slug+'&_fields=id,slug,content')
  if old and FEATURE_MARK not in old[0]['content']['raw']:raise RuntimeError('Unmanaged feature slug')
  raw=feature_page(title,intro,items);desc='サンリオの'+title+'を写真で探せる特集。サイズやセット内容を確認するポイントと、楽天市場・Amazonの購入先をご案内します。'
  if not old or old[0]['content']['raw']!=raw:
   saved=wp.call('/wp/v2/pages'+('/'+str(old[0]['id']) if old else ''),{'title':'サンリオの'+title+'｜写真で探すグッズ特集','slug':slug,'status':'publish','content':raw,'excerpt':desc,'aioseo_meta_data':{'description':desc,'og_description':desc,'twitter_description':desc}})
   if saved['slug']!=slug or len(c.extract_existing_cards(saved['content']['raw']))!=len(items):raise RuntimeError('Feature verification failed')
  feature_links.append((slug,title,items[0]['image']))
  print('FEATURE',slug,'photos',len(items),flush=True)
 # Add positions to all static product catalogs, including genre entry pages.
 pages=[]
 for n in range(1,20):
  batch=wp.call('/wp/v2/pages?context=edit&status=publish&per_page=100&page='+str(n)+'&_fields=id,slug,content')
  pages+=batch
  if len(batch)<100:break
 count=0;photos=0
 for page in pages:
  raw=page['content']['raw']
  if 'sf-rakuten-product-card' not in raw:continue
  save(wp,page,direct_links(raw));count+=1;photos+=len(c.extract_existing_cards(raw))
 home=wp.call('/wp/v2/pages/805?context=edit&_fields=id,slug,content')
 if home['slug']!='shopping-home':raise RuntimeError('Home identity mismatch')
 raw=home['content']['raw'];clean=re.sub(re.escape(FEATURE_MARK)+'.*?'+re.escape(FEATURE_END),'',raw,flags=re.S)
 block=FEATURE_MARK+'<section id="sf-use-features"><h2>使い方から見つけるグッズ特集</h2><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">'
 for slug,title,image in feature_links:
  block+='<a href="/'+slug+'/" style="min-width:0;text-align:center;font-size:12px"><img src="'+html.escape(image,quote=True)+'" alt="" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border-radius:12px"><span>'+title+'</span></a>'
 block+='</div></section>'+FEATURE_END
 target='<section id="sf-home-live">'
 if target not in clean:raise RuntimeError('Home product section missing')
 updated=clean.replace(target,block+target,1)
 # The original character list and product order are untouched.
 save(wp,home,updated)
 print('EXPERIENCE VERIFIED',count,'static catalogs;',photos,'photo placements;',len(feature_links),'features',flush=True)
if __name__=='__main__':run()
