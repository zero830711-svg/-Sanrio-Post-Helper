"""Update five existing posts via REST with backup and change guards."""
import argparse, importlib.util, json, re
from pathlib import Path
from urllib import request
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'blog/traffic-cycle-20261027';BACKUP=ROOT/'traffic-cycle-20261027-backup'
CONFIG=json.loads((DATA/'config.json').read_text())
spec=importlib.util.spec_from_file_location('editorial',ROOT/'scripts/publish-editorial-article.py');editorial=importlib.util.module_from_spec(spec);spec.loader.exec_module(editorial)
def identity(post,pid,c):
 assert post['id']==int(pid) and post['slug']==c['slug'] and post['link']==c['link'] and post['status']=='publish', 'unexpected identity'
def validate():
 assert set(CONFIG)=={'310','42','444','7128','7416'}
 for pid in CONFIG:
  doc=(DATA/f'{pid}.html').read_text();assert len(doc)>300 and '<h2>' in doc and '<h1' not in doc and '{{' not in doc
 print('VALIDATED',list(CONFIG))
def prepare(wp):
 BACKUP.mkdir(exist_ok=True)
 for pid,c in CONFIG.items():
  p=wp.call(f'/wp/v2/posts/{pid}?context=edit');identity(p,pid,c)
  if p['modified_gmt']!=c['modified']:raise RuntimeError(f'{pid} changed since review')
  (BACKUP/f'{pid}-before.json').write_text(json.dumps(p,ensure_ascii=False,indent=2));print('BACKUP',pid,flush=True)
def apply(wp):
 for pid,c in CONFIG.items():
  before=json.loads((BACKUP/f'{pid}-before.json').read_text());p=wp.call(f'/wp/v2/posts/{pid}?context=edit');identity(p,pid,c)
  if p['modified_gmt']!=before['modified_gmt'] or p['content']['raw']!=before['content']['raw']:raise RuntimeError(f'{pid} changed since backup')
  extra=(DATA/f'{pid}.html').read_text();original=before['content']['raw']
  if pid=='444':
   original=original.replace('速報：香港のハロウィン新作を写真で確認','香港のハロウィングッズを写真で確認')
   original='<p><strong>掲載内容は過去の紹介情報です。現在の販売状況は未確認です。</strong>購入前に公式の最新情報をご確認ください。</p>\n'+original
  doc=original.rstrip()+'\n\n'+extra
  wp.call(f'/wp/v2/posts/{pid}',data={'content':doc})
  after=wp.call(f'/wp/v2/posts/{pid}?context=edit');(BACKUP/f'{pid}-after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2));identity(after,pid,c)
  for k in ('slug','link','date','date_gmt','title','categories','tags','author','status','featured_media'):assert after[k]==before[k],(pid,k)
  assert after['excerpt']['raw']==before['excerpt']['raw']
  assert after['content']['raw']==doc
  page=request.urlopen(c['link'],timeout=60).read().decode();headline=re.search(r'<h2>(.*?)</h2>',extra).group(1);assert headline in page,(pid,headline)
  assert not any('noindex' in t.lower() for t in re.findall(r'<meta\b[^>]*name=["\']robots["\'][^>]*>',page,re.I))
  assert any(c['link'] in t for t in re.findall(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>',page,re.I))
  print('UPDATED AND VERIFIED',pid,c['link'],flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['validate','prepare','apply']);a=p.parse_args()
 if a.mode=='validate':validate()
 else:
  wp=editorial.WordPress();prepare(wp) if a.mode=='prepare' else apply(wp)
