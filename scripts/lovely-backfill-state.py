"""Persist public discovery IDs/cursor in a managed WordPress draft via REST."""
import html
import importlib.util
import json
from pathlib import Path
import re
import sys
s=importlib.util.spec_from_file_location('catalog',Path(__file__).with_name('import-rakuten-character-catalog.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
SLUG='sf-lovely-catalog-backfill-state';MARK='<!-- sf-lovely-backfill-state:v1 -->'
def state_page(wp):
 rows=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+SLUG+'&_fields=id,slug,content,status')
 if rows and MARK not in rows[0]['content']['raw']:raise RuntimeError('Unmanaged state page')
 return rows[0] if rows else None
def main():
 wp=c.WordPress();page=state_page(wp)
 if sys.argv[1]=='prepare':
  state=json.loads(html.unescape(re.search(r'<pre>(.*?)</pre>',page['content']['raw'],re.S)[1])) if page else {'cursor':1,'known':[],'pending':[],'finished':False}
  ids=','.join(str(v[0]) for v in c.CHARACTERS.values());pages=wp.call('/wp/v2/pages?context=edit&per_page=100&include='+ids+'&_fields=content')
  state['existingCodes']=sorted({x['code'] for p in pages for x in c.extract_existing_cards(p['content']['raw'])})
  Path(sys.argv[2]).write_text(json.dumps(state,ensure_ascii=False));print('PREPARED next page',state['cursor'],'pending',len(state['pending']),'existing codes',len(state['existingCodes']),flush=True)
 elif sys.argv[1]=='commit':
  state=json.loads(Path(sys.argv[2]).read_text());assert 'existingCodes' not in state
  payload={'slug':SLUG,'title':'Catalog discovery checkpoint (internal)','status':'draft','content':MARK+'<pre>'+html.escape(json.dumps(state,ensure_ascii=False))+'</pre>'}
  saved=wp.call('/wp/v2/pages'+('/'+str(page['id']) if page else ''),payload)
  if saved['status']!='draft':raise RuntimeError('State must remain a draft')
  check=json.loads(html.unescape(re.search(r'<pre>(.*?)</pre>',saved['content']['raw'],re.S)[1]))
  if check!=state:raise RuntimeError('Checkpoint mismatch')
  print('CHECKPOINT',json.dumps(state['lastBatch'],ensure_ascii=False),flush=True)
 else:raise ValueError('Unknown state operation')
if __name__=='__main__':main()
