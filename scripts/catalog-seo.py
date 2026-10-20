"""Publish crawlable character/category entry pages using only standard WP REST."""
import collections
import html
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('seo_catalog',ROOT/'import-rakuten-character-catalog.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
MARK='<!-- sf-seo-entry:v1 -->';END='<!-- /sf-seo-entry:v1 -->'
GENRES={
 'bags':('バッグ・ポーチ','バッグ・ポーチ','使い方を決めてから選ぶと、候補を絞りやすくなります。持ち歩き用なら本体の大きさ・持ち手・開閉方法を、整理用のポーチなら入れたい物と内寸を確認しましょう。','財布やスマートフォン、ぬいぐるみなど、入れる物の寸法と商品のサイズを比べてください。商品写真の小物が付属するとは限らないため、セット内容も購入先で確認してください。'),
 'plush':('ぬいぐるみ','ぬいぐるみ・マスコット','お部屋に飾るぬいぐるみと、バッグに付けるマスコットでは、選びたい大きさや仕様が異なります。使う場所を決めてから、サイズ・ボールチェーンなどの付属品・対象年齢を確認しましょう。','ぬい服と合わせたい場合は、身長だけでなく頭まわり・胴まわりなども照合してください。洗濯の可否やお手入れ方法は、各商品の表示・メーカー案内を優先してください。'),
 'fashion':('ファッション','服・ファッション雑貨','キャラクターの柄だけでなく、普段の服と合わせやすい色や、着用する場面から選べます。大人用・子ども用の区分と、サイズ表の実寸を確認してから購入先へ進みましょう。','画像に複数の色・サイズが写っている場合でも、購入できる種類は販売ページごとに異なります。素材・洗濯表示・サイズ・配送予定と、購入先の返品条件を確認してください。')}
CSS='<style>.sf-seo-links{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.sf-seo-links a{padding:8px 12px;border:1px solid #e4d9e9;border-radius:20px;text-decoration:none}.sf-seo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sf-seo-entry p{line-height:1.8}.sf-seo-grid article{min-width:0}.sf-seo-note{font-size:13px;color:#6c6170}@media(max-width:767px){.entry-content .sf-rakuten-product-card>div>div{grid-template-columns:1fr!important;gap:5px!important}.entry-content .sf-rakuten-product-card a{min-height:32px!important;padding:5px 2px!important;font-size:11px!important;line-height:1.4!important;white-space:nowrap!important}.entry-content .sf-rakuten-product-card>div{min-height:0!important}} </style>'
def esc(x):return html.escape(str(x),quote=True)
def replace_block(raw,block):
 # Never locate an insertion point by a non-balanced HTML regex: the match can
 # end inside a product card. Keep the detailed introduction after the entire
 # existing document fragment, outside every card/grid/container.
 clean=re.sub(re.escape(MARK)+'.*?'+re.escape(END),'',raw,flags=re.S)
 return clean+block
def describe(name):return f'{name}のグッズを写真付きで探せる非公式ファンガイド。ぬいぐるみ、バッグ・ポーチ、文具、ファッションなどを用途から探し、Amazon・楽天市場で種類やサイズ、最新の価格・在庫を確認できます。'
def seo_payload(description):return {'excerpt':description,'aioseo_meta_data':{'description':description,'og_description':description,'twitter_description':description}}
def landing(name,key,g,products,related):
 category,label,intro,check=GENRES[g]
 # Pick across shops before repeating a shop, with stable source order.
 buckets=collections.defaultdict(list)
 for x in products:buckets[x.get('shop','')].append(x)
 selected=[]
 while any(buckets.values()) and len(selected)<24:
  for bucket in buckets.values():
   if bucket and len(selected)<24:selected.append(bucket.pop(0))
 back=c.SITE+'/'+c.CHARACTERS[key][1]+'/'
 links=''.join('<a href="'+esc(url)+'">'+esc(text)+'</a>' for text,url in related)
 text=(f'<p>{esc(name)}の{esc(label)}を探している方向けに、当サイトの写真付き商品カタログから該当する商品をまとめました。掲載中の{len(products)}件から最大24件を表示しています。</p>'
       f'<h2>{esc(name)}の{esc(label)}を選ぶときの確認ポイント</h2><p>{intro}</p><p>{check}</p>'
       '<p class="sf-seo-note">非公式ファンサイトです。アフィリエイト広告を含みます。新発売順・人気順ではありません。価格・在庫・販売元・送料は購入先でご確認ください。Amazonのボタンは商品名などによる検索です。</p>'
       '<h2>写真から商品を探す</h2><div class="sf-seo-grid">'+''.join(c.photo_card(x) for x in selected)+'</div>'
       '<p><a href="'+esc(back)+'">'+esc(name)+'の全ジャンルの商品を見る →</a></p>'
       '<h2>ほかのジャンルから探す</h2><nav class="sf-seo-links">'+links+'</nav>')
 return MARK+CSS+'<div class="sf-seo-entry">'+text+'</div>'+END

def run(wp=None,index=None):
 wp=wp or c.WordPress();ids=','.join(str(v[0]) for v in c.CHARACTERS.values())
 pages=wp.call('/wp/v2/pages?context=edit&per_page=100&include='+ids+'&_fields=id,slug,title,content,excerpt,aioseo_meta_data')
 byid={p['id']:p for p in pages};catalog={}
 for key,(pid,slug,name) in c.CHARACTERS.items():
  page=byid[pid]
  if page['slug']!=slug:raise RuntimeError('Character identity mismatch')
  catalog[key]=c.extract_existing_cards(page['content']['raw'])
  if not catalog[key]:raise RuntimeError('Missing photos: '+key)
 plans=[];skipped=0
 for key,products in catalog.items():
  for g,(category,label,_,_) in GENRES.items():
   pool=[x for x in products if x['category']==category]
   if len(pool)<8:skipped+=1;continue
   plans.append((key,g,pool))
 slugs=[f'{key}-{g}-goods' for key,g,_ in plans]
 existing={}
 for n in range(0,len(slugs),60):
  rows=wp.call('/wp/v2/pages?context=edit&per_page=100&slug='+','.join(slugs[n:n+60])+'&_fields=id,slug,content,title,status,excerpt,aioseo_meta_data')
  existing.update({p['slug']:p for p in rows})
 links=collections.defaultdict(list)
 for key,g,_ in plans:
  links[key].append((GENRES[g][1],c.SITE+'/'+f'{key}-{g}-goods/'))
 published=[]
 for key,g,pool in plans:
  name=c.CHARACTERS[key][2];slug=f'{key}-{g}-goods';label=GENRES[g][1]
  raw=landing(name,key,g,pool,links[key]);description=f'{name}の{label}を写真で比較できるグッズ一覧。使い方やサイズを確認するポイントと、Amazon・楽天市場の購入先をまとめました。最新の価格・在庫・種類は販売ページでご確認ください。'
  payload=seo_payload(description);payload.update(title=f'{name}の{label}｜写真で探すグッズ・通販ガイド',slug=slug,content=raw,status='publish')
  old=existing.get(slug)
  if old and MARK not in old['content']['raw']:raise RuntimeError('Unmanaged existing slug: '+slug)
  if old:
   if old['content']['raw']==raw and old.get('aioseo_meta_data',{}).get('description')==description:published.append((old['id'],slug));continue
   saved=wp.call('/wp/v2/pages/'+str(old['id']),payload)
  else:saved=wp.call('/wp/v2/pages',payload)
  if saved['slug']!=slug or saved['status']!='publish':raise RuntimeError('Landing publish mismatch')
  if saved.get('aioseo_meta_data',{}).get('description')!=description:raise RuntimeError('Landing description not saved')
  published.append((saved['id'],slug));print('SEO LANDING',slug,'matched',len(pool),'shown',min(24,len(pool)),flush=True)
 for key,(pid,slug,name) in c.CHARACTERS.items():
  old=byid[pid];raw=old['content']['raw'];products=catalog[key];counts=collections.Counter(x['category'] for x in products)
  intro=f'<p>{esc(name)}のグッズを用途・ジャンルから探せるページです。ぬいぐるみやバッグ、文具などの写真付き商品をまとめ、Amazon・楽天市場の購入先へご案内します。</p>'
  chips=''.join('<a href="'+esc(url)+'">'+esc(name+'の'+text)+'</a>' for text,url in links[key])
  summary='、'.join(esc(k)+' '+str(v)+'件' for k,v in counts.items() if v)
  block=MARK+CSS+'<section class="sf-seo-entry"><h2>'+esc(name)+'のグッズをジャンルから探す</h2>'+intro+'<p>掲載中の写真付き商品：'+str(len(products))+'件（'+summary+'）。</p><div class="sf-seo-links">'+chips+'</div><p>持ち歩き用・お部屋用・プレゼントなど、使う場面から選んでみてください。購入前に商品サイズ、色や種類、付属品、販売元、送料をご確認ください。</p></section>'+END
  updated=replace_block(raw,block)
  description=describe(name);payload=seo_payload(description);payload['content']=updated
  # A clean manual excerpt also prevents the theme from deriving descriptions from inline CSS.
  if updated!=raw or old.get('aioseo_meta_data',{}).get('description')!=description:
   current=wp.call('/wp/v2/pages/'+str(pid)+'?context=edit&_fields=content')
   if current['content']['raw']!=raw:raise RuntimeError('Concurrent character edit: '+key)
   saved=wp.call('/wp/v2/pages/'+str(pid),payload)
   if [x['code'] for x in c.extract_existing_cards(saved['content']['raw'])]!=[x['code'] for x in products]:raise RuntimeError('Existing products changed')
   if saved.get('aioseo_meta_data',{}).get('description')!=description:raise RuntimeError('Character description not saved')
  print('SEO CHARACTER',slug,'preserved',len(products),flush=True)
 for pid,description in [(805,'サンリオグッズをキャラクターや用途から探せる非公式ファンサイト。写真付きの商品カタログ、バッグ・ぬいぐるみ・ファッションのジャンル別ガイド、韓国カフェの訪問記を掲載しています。'),(804,'サンリオ関連商品をキャラクター・ジャンル・商品名から検索できる写真付きカタログ。バッグ、ぬいぐるみ、文具、ファッションなどを探し、Amazon・楽天市場で最新の価格や在庫をご確認いただけます。')]:
  wp.call('/wp/v2/pages/'+str(pid),seo_payload(description))
 report={'landings':len(published),'characters':len(catalog),'skippedSparsePairs':skipped,'photosPreserved':sum(len(x) for x in catalog.values()),'pages':published}
 print('SEO SUMMARY',json.dumps(report,ensure_ascii=False),flush=True)
 return report
if __name__=='__main__':run()
