"""Repair long catalog lines via standard WP REST and verify public rendering."""
import concurrent.futures, importlib.util, json, re, time
from pathlib import Path
from urllib import request
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("catalog",ROOT/"import-rakuten-character-catalog.py")
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def frontend(slug,fresh=False):
 url=c.SITE+"/"+slug+"/"
 if fresh:url+="?sf-render-check="+str(time.time_ns())
 req=request.Request(url,headers={"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1"})
 with request.urlopen(req,timeout=60) as response:return response.read().decode("utf-8","replace")
def main():
 wp=c.WordPress()
 ids=",".join(str(x[0]) for x in c.CHARACTERS.values())
 pages=wp.call("/wp/v2/pages?context=edit&per_page=100&include="+ids+"&_fields=id,slug,content")
 byid={p["id"]:p for p in pages}
 Path("character-render-backups").mkdir(exist_ok=True)
 modified=[]
 for key in ["cinnamoroll","kuromi","mymelody","hellokitty"]:
  pid,slug,name=c.CHARACTERS[key];page=byid[pid];raw=page["content"]["raw"]
  if page["slug"]!=slug:raise RuntimeError("Page identity mismatch")
  old=c.extract_existing_cards(raw)
  updated=raw.replace("</article><","</article>\n<")
  if old!=c.extract_existing_cards(updated):raise RuntimeError("Product data changed")
  if updated==raw:
   print("ALREADY FORMATTED",key,flush=True)
  else:
   Path("character-render-backups/"+str(pid)+".json").write_text(json.dumps({"id":pid,"slug":slug,"content":raw},ensure_ascii=False))
   current=wp.call("/wp/v2/pages/"+str(pid)+"?context=edit&_fields=content")["content"]["raw"]
   if current!=raw:raise RuntimeError("Concurrent edit: "+slug)
   saved=wp.call("/wp/v2/pages/"+str(pid),{"content":updated})
   if saved["content"]["raw"]!=updated:raise RuntimeError("Saved content mismatch")
   for fresh in [True,False]:
    rendered=frontend(slug,fresh)
    if c.extract_existing_cards(rendered)!=old or "<h1" not in rendered:
     wp.call("/wp/v2/pages/"+str(pid),{"content":raw})
     raise RuntimeError("Frontend still failed; restored original content: "+slug)
   modified.append(key)
   print("REPAIRED",key,"products",len(old),"maxLineBefore",max(map(len,raw.splitlines())),"maxLineAfter",max(map(len,updated.splitlines())),flush=True)
 def verify(pair):
  key,(pid,slug,name)=pair;expected=c.extract_existing_cards(byid[pid]["content"]["raw"])
  rendered=frontend(slug)
  actual=c.extract_existing_cards(rendered)
  if actual!=expected or "<h1" not in rendered:raise RuntimeError("Blank or mismatched public page: "+slug)
  for card in actual:
   import hashlib
   anchor="sf-product-"+hashlib.sha256(card["code"].encode()).hexdigest()[:16]
   if 'id="'+anchor+'"' not in rendered:raise RuntimeError("Missing product anchor")
  print("PUBLIC VERIFIED",key,"products",len(actual),"bytes",len(rendered.encode()),flush=True)
  return len(actual)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:counts=list(pool.map(verify,c.CHARACTERS.items()))
 print("RENDER VERIFIED",json.dumps({"repaired":modified,"publicPages":len(counts),"placementsPreserved":sum(counts)},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
