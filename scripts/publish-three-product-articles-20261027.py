import importlib.util,json,sys,hashlib,html,re,os
from pathlib import Path
from urllib import parse

def load(name,path):
 s=importlib.util.spec_from_file_location(name,Path('scripts')/path); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
batch=load('batch','publish-rakuten-gacha-batch.py'); ed=load('ed','publish-editorial-article.py')
batch.IMAGE_HOSTS.add('thumbnail.image.rakuten.co.jp')
wp=ed.WordPress(); failures=[]
for spec in json.loads(Path('blog/three-product-articles-20261027.json').read_text()):
 if os.environ.get('ONLY_SLUG') and spec['slug'] != os.environ['ONLY_SLUG']: continue
 try:
  path=Path(sys.argv[1]+'-'+hashlib.md5(spec['query'].encode()).hexdigest()+'.json')
  rows=json.loads(path.read_text())['candidates']; candidates=[]
  for r in rows:
   title=r.get('title',''); norm=batch.normalized_product_name(title)
   if not all(batch.normalized_product_name(w) in norm for w in spec['words']): continue
   if spec['slug']=='sanrio-two-piece-acrylic-stand-20' and not re.search(r'(全|完全)?20種', title): continue
   if spec['slug']=='sanrio-chimapote-plush-shop-3' and '第3弾' not in title and '第３弾' not in title: continue
   if batch.valid_affiliate(r.get('url')):
    q=parse.parse_qs(parse.urlsplit(r['url']).query);r['url']=q.get('pc',[''])[0]
   u=parse.urlsplit(r.get('image',''))
   if u.hostname=='thumbnail.image.rakuten.co.jp':r['image']=parse.urlunsplit(u._replace(query='_ex=600x600'))
   if not (batch.valid_product_url(r.get('url')) and batch.valid_affiliate(r.get('affiliate')) and batch.valid_image_url(r.get('image'))):continue
   candidates.append(r)
  if not candidates: raise RuntimeError('No exact affiliate product with image')
  item=candidates[0]
  if spec['slug']=='sanrio-chimapote-plush-shop-3': item=next((x for x in candidates if x['url'].startswith('https://item.rakuten.co.jp/sanrio/')),candidates[0])
  if spec['slug']=='kurahashirei-sanrio-can-memo': item=next((x for x in candidates if 'ハローキティ' in x['title'] and ('赤' in x['title'] or 'レッド' in x['title'])),candidates[0])
  pic=batch.download_jpeg(item['image'])
  from PIL import Image
  import io,base64
  img=Image.open(io.BytesIO(base64.b64decode(pic)))
  if min(img.size)<500: raise RuntimeError('Photo is smaller than 500 px')
  print('MATCH',spec['slug'],item['title'],item['url'],'image',img.size,flush=True)
  content='<p>※この記事にはアフィリエイト広告が含まれます。</p><figure class="wp-block-image size-large"><img src="{{image_url}}" alt="'+html.escape(item['title'],quote=True)+'"/><figcaption>楽天市場の商品掲載画像。'+html.escape(item['title'])+'の例です。販売単位はリンク先をご確認ください。</figcaption></figure>'+spec['body']
  content+='<h2>通販で確認する</h2><p>写真は掲載商品の例です。選択する商品・セット内容・価格・送料・在庫は販売ページで確認してください。</p><p><a href="'+html.escape(item['affiliate'],quote=True)+'" rel="sponsored nofollow noopener noreferrer" target="_blank">楽天市場で掲載商品を見る</a></p><p>関連情報：<a href="'+html.escape(spec['internal'],quote=True)+'">サイト内の関連ページを見る</a></p><p>商品情報出典：<a href="'+html.escape(spec['source'],quote=True)+'">メーカー・公式の商品案内</a>。2026年10月27日確認。情報は変更される場合があります。</p>'+batch.RAKUTEN_ATTRIBUTION
  article={'title':spec['title'],'slug':spec['slug'],'status':'publish','category_slug':'shopping-products','image_filename':spec['slug']+'.jpg','alt_text':item['title'],'image_base64':pic,'excerpt':spec['heading']+'。特徴・ラインナップ・購入前に確認したいことを紹介。','content':content}
  ed.publish(article,wp)
 except Exception as e:
  print('FAILED',spec['slug'],str(e),flush=True);failures.append(spec['slug'])
if failures: raise SystemExit('Not published: '+', '.join(failures))
