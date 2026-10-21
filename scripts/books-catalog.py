"""Separate Rakuten Books shelves; existing goods markup and index remain untouched."""
import argparse,base64,hashlib,html,importlib.util,io,json,re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from pathlib import Path
from urllib import request,parse
from PIL import Image
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('books_shared',ROOT/'import-rakuten-character-catalog.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
START='<!-- sf-books-shelf:start -->';END='<!-- sf-books-shelf:end -->'
STATE='sf-books-catalog-state';SLUG='sanrio-books'
E=lambda x:html.escape(str(x),quote=True)

def normalize(row):
 title=str(row.get('title','')).strip();genre=str(row.get('booksGenreId',''))
 if not any(g.startswith(('001','007')) for g in genre.split('/')):return None
 chars=[key for key in c.CHARACTERS if c.matches_character(title,key)]
 if not chars and not re.search('サンリオ|sanrio',title,re.I):return None
 code=str(row.get('isbn') or row.get('jan') or '')
 if not re.fullmatch(r'\d{13}',code):return None
 url=str(row.get('itemUrl',''));affiliate=str(row.get('affiliateUrl',''));image=str(row.get('largeImageUrl',''))
 if parse.urlsplit(url).hostname!='books.rakuten.co.jp' or not url.startswith('https://'):return None
 if parse.urlsplit(affiliate).hostname!='hb.afl.rakuten.co.jp' or not affiliate.startswith('https://'):return None
 if parse.urlsplit(image).hostname not in {'thumbnail.image.rakuten.co.jp','image.books.rakuten.co.jp','image.rakuten.co.jp'} or not image.startswith('https://'):return None
 availability=str(row.get('availability',''))
 if availability not in {'1','2','3','4','5','6'}:return None
 return dict(id=code,title=title,url=url,affiliate=affiliate,image=image,characters=chars,kind='magazine' if genre.startswith('007') else 'book',salesDate=str(row.get('salesDate','')),availability=availability,publisher=str(row.get('publisherName','')))

def image_ok(item):
 if re.search(r'no[-_]?image|no[-_]?photo|nowprinting',parse.urlsplit(item['image']).path,re.I):return False
 try:
  req=request.Request(item['image'],headers={'User-Agent':'Mozilla/5.0 (SanrioBooksCatalog/1.0)'})
  with request.urlopen(req,timeout=20) as r:
   if parse.urlsplit(r.geturl()).hostname not in {'thumbnail.image.rakuten.co.jp','image.books.rakuten.co.jp','image.rakuten.co.jp'}:return False
   data=r.read(3000001)
  if len(data)>3000000:return False
  with Image.open(io.BytesIO(data)) as im:
   w,h=im.size;im.verify()
  return min(w,h)>=140 and max(w,h)>=190
 except Exception:return False

def card(x):
 status={'1':'','2':'','3':'','4':'取り寄せ','5':'予約受付中','6':'在庫確認が必要'}[x['availability']]
 meta=('発売日：'+x['salesDate'] if x['salesDate'] else '')
 if status:meta+=' ／ '+status
 return '<article class="sf-books-card" data-books-id="'+E(x['id'])+'" data-characters="'+E(' '.join(x['characters']))+'" data-kind="'+x['kind']+'"><a href="'+E(x['affiliate'])+'" target="_blank" rel="sponsored nofollow noopener"><img src="'+E(x['image'])+'" alt="'+E(x['title'])+'" loading="lazy" decoding="async" width="200" height="200"></a><h3 class="sf-books-title">'+E(x['title'])+'</h3><p class="sf-books-meta">'+E(meta)+'</p><a class="sf-books-buy" href="'+E(x['affiliate'])+'" target="_blank" rel="sponsored nofollow noopener">楽天ブックスで見る</a></article>\n'

def render(items,name='',directory=False):
 heading=(name+'の' if name else 'サンリオの')+'本・雑誌・付録'
 s=START+'<style>'+(ROOT/'books-catalog.css').read_text()+'</style><section class="sf-books"'+(' data-books-directory' if directory else '')+'><h2>'+E(heading)+'</h2><p class="sf-books-note">本・雑誌・ムックを集めました。付録・特典の有無や内容、価格・在庫は楽天ブックスの商品ページでご確認ください。</p>'
 if directory:
  s+='<div class="sf-books-filters"><label>種類 <select name="kind"><option value="">すべて</option><option value="book">本・ムック</option><option value="magazine">雑誌</option></select></label><label>キャラクター <select name="character"><option value="">すべて</option>'
  s+=''.join('<option value="'+key+'">'+E(info[2])+'</option>' for key,info in c.CHARACTERS.items() if any(key in x['characters'] for x in items))+'</select></label></div><p data-books-count>'+str(len(items))+'件</p><div class="sf-books-directory">'+''.join(card(x) for x in items)+'</div>'
 else:
  selected=items[:24];s+='<p class="sf-books-scroll">横にスワイプして見る →</p><div class="sf-books-track" tabindex="0" aria-label="本・雑誌。横にスワイプできます">'
  for n in range(0,len(selected),6):s+='<div class="sf-books-page" role="group" aria-label="'+str(n//6+1)+'ページ">'+''.join(card(x) for x in selected[n:n+6])+'</div>'
  s+='</div><a class="sf-books-browse" href="/sanrio-books/">本・雑誌をすべて見る →</a>'
 s+='<p class="sf-books-note">商品情報の確認日：'+datetime.now(timezone.utc).astimezone(__import__('zoneinfo').ZoneInfo('Asia/Tokyo')).strftime('%Y/%m/%d')+'。発売日と当サイトへの掲載日は異なります。</p></section>'
 if directory:s+='<script>'+(ROOT/'books-catalog.js').read_text()+'</script>'
 return s+END

def replace_shelf(raw,markup,home=False):
 if START in raw:
  if raw.count(START)!=1 or raw.count(END)!=1:raise RuntimeError('Duplicate shelf markers')
  return re.sub(re.escape(START)+'.*?'+re.escape(END),lambda _:markup,raw,flags=re.S)
 if home:
  marker='<!-- sf-home-live-catalog:end -->'
  if raw.count(marker)!=1:raise RuntimeError('Home catalog marker missing')
  return raw.replace(marker,marker+markup,1)
 return raw+'\n'+markup

def sync_page(wp,page,markup,home=False):
 raw=page['content']['raw'];updated=replace_shelf(raw,markup,home)
 # Removing only our new shelf must leave every byte of existing content intact.
 clean=lambda s:re.sub(re.escape(START)+'.*?'+re.escape(END),'',s,flags=re.S).strip()
 if clean(raw)!=clean(updated):raise RuntimeError('Existing content changed')
 path='/wp/v2/pages/'+str(page['id'])
 if wp.call(path+'?context=edit&_fields=content')['content']['raw']!=raw:raise RuntimeError('Concurrent page edit')
 if raw!=updated:wp.call(path,{'content':updated})
 saved=wp.call(path+'?context=edit&_fields=content')['content']
 if saved['raw']!=updated or saved['rendered'].count('class="sf-books-card"')!=markup.count('class="sf-books-card"'):raise RuntimeError('Shelf verification failed')

def public_check(url,expected):
 req=request.Request(url,headers={'User-Agent':'SanrioBooksPublicCheck/1.0','Cache-Control':'no-cache'})
 with request.urlopen(req,timeout=60) as r:body=r.read().decode('utf-8')
 if body.count('class="sf-books-card"')!=expected:raise RuntimeError('Public shelf mismatch: '+url)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--queries');ap.add_argument('--input');args=ap.parse_args()
 if args.queries:
  Path(args.queries).write_text(json.dumps(['サンリオ']+[x[2] for x in c.CHARACTERS.values()],ensure_ascii=False));return
 rows=json.loads(Path(args.input).read_text());unique={};rejected=0
 for row in rows:
  x=normalize(row)
  if x:unique[x['id']]=x
  else:rejected+=1
 candidates=list(unique.values())
 with ThreadPoolExecutor(max_workers=4) as pool:checks=list(pool.map(image_ok,candidates))
 items=[x for x,ok in zip(candidates,checks) if ok]
 if len(items)<6:raise RuntimeError('Fewer than 6 verified books; refusing empty publication')
 wp=c.WordPress();states=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+STATE)
 old=[]
 if states:
  old=json.loads(base64.b64decode(c.text_from(states[0]['content']['raw'])))
 first={x['id']:x.get('addedAt') for x in old};now=datetime.now(timezone.utc).isoformat()
 for x in items:x['addedAt']=first.get(x['id']) or now
 # API output is already newest release first per query; keep deterministic date ordering.
 items.sort(key=lambda x:(re.sub(r'[^0-9]','',x['salesDate'])[:8],x['id']),reverse=True)
 pages=wp.call('/wp/v2/pages?context=edit&slug='+SLUG)
 markup=render(items,directory=True)
 if pages:
  sync_page(wp,pages[0],markup);directory_url=pages[0]['link']
 else:
  created=wp.call('/wp/v2/pages',{'slug':SLUG,'status':'publish','title':'サンリオの本・雑誌・付録を探す','content':markup})
  if created['slug']!=SLUG or created['content']['rendered'].count('class="sf-books-card"')!=len(items):raise RuntimeError('Books directory creation failed')
  directory_url=created['link']
 home=wp.call('/wp/v2/pages/805?context=edit')
 if home['slug']!='shopping-home':raise RuntimeError('Home identity mismatch')
 sync_page(wp,home,render(items),home=True)
 updated=[];skipped=[]
 for key,(pid,slug,name) in c.CHARACTERS.items():
  subset=[x for x in items if key in x['characters']]
  if not subset:skipped.append(name);continue
  page=wp.call('/wp/v2/pages/'+str(pid)+'?context=edit')
  if page['slug']!=slug:raise RuntimeError('Character identity mismatch')
  sync_page(wp,page,render(subset,name));updated.append({'character':name,'books':len(subset)})
  public_check(page['link'],min(len(subset),24))
 public_check(directory_url,len(items));public_check(home['link'],min(len(items),24))
 state={'content':'<pre>'+base64.b64encode(json.dumps(items,ensure_ascii=False).encode()).decode()+'</pre>','status':'draft','title':'Managed Rakuten Books catalog state'}
 if states:wp.call('/wp/v2/pages/'+str(states[0]['id']),state)
 else:wp.call('/wp/v2/pages',dict(state,slug=STATE))
 report={'books':len(items),'newBooks':sum(x['id'] not in first for x in items),'duplicateRows':len(rows)-rejected-len(candidates),'irrelevantOrUnsupported':rejected,'imageSkipped':len(candidates)-len(items),'characters':updated,'charactersWithoutBooks':skipped,'existingGoodsUnchanged':True}
 Path('books-catalog-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('BOOKS VERIFIED',json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
