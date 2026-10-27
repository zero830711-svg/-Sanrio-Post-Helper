"""Back up and improve five previously search-visible posts via WordPress REST."""
import argparse, importlib.util, json, re
from pathlib import Path
from urllib import request
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'blog/seo-refresh-five-20261027'
BACKUP=ROOT/'article-five-20261027-backup'
CONFIG={
 374:('sanrio-gift-selection-guide','2026-09-24T23:19:28','サンリオ好きへのプレゼントの選び方を解説。相手の使い方や予算別の候補、公式通販のラッピング、贈る日までの確認点をまとめました。'),
 364:('sanrio-gacha-duplicate-budget-guide','2026-09-24T22:33:39','サンリオのガシャポンでダブりが出たら？回数別の予算早見表、追加・交換・単品購入の比較、設置店を探す際の注意を紹介します。'),
 362:('sanrio-goods-buying-guide','2026-09-24T22:33:22','サンリオグッズはどこで買う？公式通販・実店舗・ECモール・中古の選び方と、販売者・送料・在庫・返品条件の確認ポイントを紹介します。'),
 370:('find-sanrio-character-goods-guide','2026-09-24T22:34:00','けろっぴ、タキシードサム、シュガーバニーズなどのグッズを公式で探す方法。正式名やはぴだんぶいでの検索、販売先の確認を整理します。'),
 380:('sanrio-goods-wishlist-budget-planner','2026-10-07T12:42:45','サンリオグッズのウィッシュリストの作り方。発売日・発送予定・送料を含む総額・優先度・置き場所を整理できる記入例を紹介します。')}
spec=importlib.util.spec_from_file_location('editorial', ROOT/'scripts/publish-editorial-article.py')
editorial=importlib.util.module_from_spec(spec); spec.loader.exec_module(editorial)
def identity(p,pid,slug):
 assert p['id']==pid and p['slug']==slug and p['link']=='https://sanrio-fan.site/'+slug+'/' and p['status']=='publish', 'unexpected identity'
def validate():
 for pid in CONFIG:
  doc=(DATA/f'{pid}.html').read_text()
  assert len(doc)>1000 and '<h2>' in doc and '{{' not in doc and '<h1' not in doc
 print('VALIDATED',list(CONFIG))
def prepare(wp):
 BACKUP.mkdir(exist_ok=True)
 for pid,(slug,modified,_) in CONFIG.items():
  p=wp.call(f'/wp/v2/posts/{pid}?context=edit'); identity(p,pid,slug)
  if p['modified_gmt']!=modified: raise RuntimeError(f'{pid} changed since review; refusing overwrite')
  (BACKUP/f'{pid}-before.json').write_text(json.dumps(p,ensure_ascii=False,indent=2))
  print('BACKUP',pid,flush=True)
def apply(wp):
 for pid,(slug,_,excerpt) in CONFIG.items():
  before=json.loads((BACKUP/f'{pid}-before.json').read_text());p=wp.call(f'/wp/v2/posts/{pid}?context=edit');identity(p,pid,slug)
  if p['modified_gmt']!=before['modified_gmt'] or p['content']['raw']!=before['content']['raw']: raise RuntimeError(f'{pid} changed since backup')
  doc=before['content']['raw'].rstrip()+'\n\n'+(DATA/f'{pid}.html').read_text()
  wp.call(f'/wp/v2/posts/{pid}',data={'content':doc,'excerpt':excerpt})
  after=wp.call(f'/wp/v2/posts/{pid}?context=edit');(BACKUP/f'{pid}-after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2));identity(after,pid,slug)
  for key in ('slug','link','date','date_gmt','title','categories','tags','author','status','featured_media'): assert after[key]==before[key],(pid,key)
  assert after['content']['raw']==doc and after['excerpt']['raw']==excerpt
  page=request.urlopen(after['link'],timeout=60).read().decode(); assert 'よくある質問' in page
  assert not any('noindex' in x.lower() for x in re.findall(r'<meta\b[^>]*name=["\']robots["\'][^>]*>',page,re.I))
  assert any(after['link'] in x for x in re.findall(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>',page,re.I))
  print('UPDATED AND VERIFIED',pid,after['link'],flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['validate','prepare','apply']);a=p.parse_args()
 if a.mode=='validate':validate()
 else:
  wp=editorial.WordPress();prepare(wp) if a.mode=='prepare' else apply(wp)
