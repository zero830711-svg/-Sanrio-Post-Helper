"""Finalize the already imported batch without repeating discovery or API calls."""
import html
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
state_module=load('state','lovely-backfill-state.py');c=state_module.c
def main():
 wp=c.WordPress();page=state_module.state_page(wp)
 if not page:raise RuntimeError('Discovery checkpoint missing')
 state=json.loads(html.unescape(re.search(r'<pre>(.*?)</pre>',page['content']['raw'],re.S)[1]))
 candidates=json.loads(Path('recovery/lovely-verified-candidates.json').read_text())
 report=json.loads(Path('recovery/lovely-import-report.json').read_text())
 if report['newUniqueOffers']!=216 or report['newCharacterPlacements']!=359:raise RuntimeError('Unexpected recovery batch')
 pending=state['pending'];already=state.get('lastBatch',{}).get('apiQueries')==300 and len(pending)==1249
 if not already:
  if state['cursor']!=101 or len(pending)!=1549 or state['lastBatch'].get('phase')!='discovered':raise RuntimeError('Checkpoint changed; refusing to advance it')
  sources={x['source'] for x in pending[:300]}
  if any(x.get('discoveredFrom') not in sources for x in candidates):raise RuntimeError('Recovery candidates differ from pending batch')
 ids=','.join(str(v[0]) for v in c.CHARACTERS.values())
 pages=wp.call('/wp/v2/pages?context=edit&per_page=100&include='+ids+'&_fields=id,content')
 byid={p['id']:p for p in pages};verified=0
 for key,(pid,slug,name) in c.CHARACTERS.items():
  cards=c.extract_existing_cards(byid[pid]['content']['raw'])
  identities=set().union(*(c.identity_keys(x,key) for x in cards)) if cards else set()
  for raw in candidates:
   item=c.clean_candidate(raw)
   if item and c.matches_character(item['title'],key):
    if not identities.intersection(c.identity_keys(item,key)):raise RuntimeError('Imported candidate missing: '+key)
    verified+=1
 print('RECOVERY VERIFIED candidate memberships',verified,flush=True)
 load('seo','catalog-seo.py').run(wp)
 load('experiences','catalog-experiences.py').run()
 load('images','catalog-image-seo.py').run(wp)
 load('deploy','deploy-catalog-image-sitemap.py').main()
 if not already:
  # Recheck the exact checkpoint before committing; do not replace a newer batch.
  current=state_module.state_page(wp)
  if current['content']['raw']!=page['content']['raw']:raise RuntimeError('Discovery checkpoint changed during finalization')
  state['pending']=pending[300:]
  state['lastBatch']={'scannedPages':100,'newSourceIds':1648,'unsupportedAmazon':99,'apiQueries':300,'apiMatched':293,'unavailableOrUnmatched':7,'remaining':1249,'nextPage':101,**report}
  Path('lovely-finalized-state.json').write_text(json.dumps(state,ensure_ascii=False))
  subprocess.run([sys.executable,str(ROOT/'lovely-backfill-state.py'),'commit','lovely-finalized-state.json'],check=True)
 print('FINALIZED',json.dumps(report,ensure_ascii=False),'remaining',len(state['pending']),flush=True)
if __name__=='__main__':main()
