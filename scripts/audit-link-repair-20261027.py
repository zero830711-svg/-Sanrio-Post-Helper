"""Connect the existing high-traffic gashapon guide to related November product pages."""
import argparse, importlib.util,json,re
from pathlib import Path
from urllib import request
ROOT=Path(__file__).resolve().parents[1];BACKUP=ROOT/'audit-link-repair-backup';URL='https://sanrio-fan.site/sanrio-gashapon-2026-10/'; MOD='2026-10-27T04:40:21'
spec=importlib.util.spec_from_file_location('editorial',ROOT/'scripts/publish-editorial-article.py'); editorial=importlib.util.module_from_spec(spec);spec.loader.exec_module(editorial)
links=[('sanrio-zodiac-swing-part1','星座スイングマスコットPART1','全6種、1回400円'),('sanrio-zodiac-swing-part2','星座スイングマスコットPART2','全6種、1回400円'),('sanrio-jelly-deco-band','ジェリーデコバンド（再販）','全5種、1回300円')]
def check(p):assert p['id']==359 and p['slug']=='sanrio-gashapon-2026-10' and p['link']==URL and p['status']=='publish'
def prepare(w):
 p=w.call('/wp/v2/posts/359?context=edit');check(p);assert p['modified_gmt']==MOD
 BACKUP.mkdir(exist_ok=True);(BACKUP/'before.json').write_text(json.dumps(p,ensure_ascii=False,indent=2));print('BACKUP',p['id'])
def apply(w):
 b=json.loads((BACKUP/'before.json').read_text());p=w.call('/wp/v2/posts/359?context=edit');check(p);assert p['modified_gmt']==b['modified_gmt'] and p['content']['raw']==b['content']['raw']
 doc=b['content']['raw'];marker='11月発売予定のサンリオガシャポンも確認';i=doc.find(marker);assert i>=0
 start=doc.find('<ul>',i);end=doc.find('</ul>',start);assert start>=0 and end>=0
 for slug,_,_ in links:assert slug not in doc
 addition=''.join(f'<li><a href="https://sanrio-fan.site/{slug}/">{label}</a>：{description}。</li>\n' for slug,label,description in links)
 doc=doc[:end]+addition+doc[end:];doc=doc.replace('次の2点は発売週が未定','以下の商品は発売週が未定',1).replace('どちらも10月の2商品とは別シリーズです','いずれも10月の2商品とは別シリーズです',1)
 assert '次の2点は発売週が未定' not in doc
 w.call('/wp/v2/posts/359',data={'content':doc});a=w.call('/wp/v2/posts/359?context=edit');(BACKUP/'after.json').write_text(json.dumps(a,ensure_ascii=False,indent=2));check(a)
 for k in ('slug','link','date','date_gmt','title','categories','tags','author','status','featured_media'):assert a[k]==b[k],k
 assert a['excerpt']['raw']==b['excerpt']['raw'] and a['content']['raw']==doc
 page=request.urlopen(URL,timeout=60).read().decode()
 for slug,_,_ in links: assert f'https://sanrio-fan.site/{slug}/' in page
 assert not any('noindex' in t.lower() for t in re.findall(r'<meta\b[^>]*name=["\']robots["\'][^>]*>',page,re.I))
 print('UPDATED AND VERIFIED',URL,'links',','.join(x[0] for x in links))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','apply']);a=p.parse_args();w=editorial.WordPress();prepare(w) if a.mode=='prepare' else apply(w)
