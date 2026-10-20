"""Refresh visible titles only, retaining source metadata, URLs, IDs and dates."""
import concurrent.futures
import html
import importlib.util
import json
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('catalog',ROOT/'import-rakuten-character-catalog.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def visible_titles(raw):
 changes=[]
 def replace_card(match):
  block=match[0];items=c.extract_existing_cards(block)
  if len(items)!=1:return block
  item=items[0];title=c.display_title(item['title'])
  short=title[:64]+('…' if len(title)>64 else '')
  updated=re.sub(r'(<strong\b[^>]*>).*?(</strong>)',lambda m:m[1]+html.escape(short,quote=True)+m[2],block,count=1,flags=re.S)
  updated=re.sub(r'(<img\b[^>]*\balt=")[^"]*(")',lambda m:m[1]+html.escape(title,quote=True)+m[2],updated,count=1)
  if updated!=block:changes.append({'before':item['title'],'after':title})
  return updated
 updated=re.sub(r'<article\b[^>]*class="[^"]*sf-rakuten-product-card[^"]*"[^>]*>.*?</article>',replace_card,raw,flags=re.S)
 if c.extract_existing_cards(updated)!=c.extract_existing_cards(raw):raise RuntimeError('Source product metadata changed')
 if re.findall(r'\bhref="[^"]*"',updated)!=re.findall(r'\bhref="[^"]*"',raw):raise RuntimeError('Purchase or navigation URLs changed')
 if re.findall(r'\bid="[^"]*"',updated)!=re.findall(r'\bid="[^"]*"',raw):raise RuntimeError('Product anchors changed')
 return updated,changes
def main():
 wp=c.WordPress();pages=[]
 for n in range(1,20):
  batch=wp.call('/wp/v2/pages?context=edit&status=publish&per_page=100&page='+str(n)+'&_fields=id,slug,content')
  pages+=batch
  if len(batch)<100:break
 plans=[]
 for page in pages:
  raw=page['content']['raw']
  if 'sf-rakuten-product-card' not in raw:continue
  updated,changes=visible_titles(raw)
  if changes:plans.append((page,updated,changes))
 def save(plan):
  page,updated,changes=plan;pid=page['id']
  if wp.call('/wp/v2/pages/'+str(pid)+'?context=edit&_fields=content')['content']['raw']!=page['content']['raw']:raise RuntimeError('Concurrent page edit: '+page['slug'])
  saved=wp.call('/wp/v2/pages/'+str(pid),{'content':updated})
  if saved['content']['raw']!=updated:raise RuntimeError('Saved title content mismatch')
  print('TITLE UPDATED',page['slug'],'cards',len(changes),flush=True)
  return len(changes)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:counts=list(pool.map(save,plans))
 spec=importlib.util.spec_from_file_location('unified',ROOT/'unify-product-search.py')
 u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
 previous=u.read_index(wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']['raw'])
 index=u.sync(wp)
 before={x['id']:x.get('addedAt') for x in previous['items']}
 after={x['id']:x.get('addedAt') for x in index['items']}
 if before!=after:raise RuntimeError('Title refresh changed item identity or publication date')
 for item in index['items']:
  if item['type']=='product' and item.get('displayTitle')!=c.display_title(item['title']):raise RuntimeError('Display title missing in search index')
 report={'updatedPages':len(plans),'changedCards':sum(counts),'products':sum(x['type']=='product' for x in index['items']),'publicationDatesPreserved':True,'examples':[x for p in plans for x in p[2]][:8]}
 Path('catalog-title-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print('TITLE VERIFIED',json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
