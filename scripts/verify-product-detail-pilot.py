"""Verify public detail pages, robots access and discovery in the site's own sitemaps."""
import importlib.util,json,re,xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib import parse,request,robotparser
spec=importlib.util.spec_from_file_location('detail_verify',Path(__file__).with_name('product-detail-pilot.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
def read(url):
 p=parse.urlsplit(url)
 if p.scheme!='https' or p.hostname!='sanrio-fan.site':raise RuntimeError('Unexpected sitemap host')
 with request.urlopen(request.Request(url,headers={'User-Agent':'SanrioProductPilotVerification/1.0'}),timeout=60) as response:return response.read()
def main():
 records,_=d.read_state(d.c.WordPress())
 if not 40<=len(records)<=1000:raise RuntimeError('Product detail count outside the approved 40–1000 range')
 with ThreadPoolExecutor(max_workers=3) as pool:canonical_counts=list(pool.map(d.verify_public,records))
 robots=read(d.c.SITE+'/robots.txt').decode('utf-8');rp=robotparser.RobotFileParser();rp.parse(robots.splitlines())
 for x in records:
  if not rp.can_fetch('Googlebot',x['url']):raise RuntimeError('Robots blocks detail: '+x['url'])
 queue=re.findall(r'^Sitemap:\s*(https://[^\s]+)',robots,re.I|re.M) or [d.c.SITE+'/wp-sitemap.xml']
 visited=[];urls=set()
 while queue and len(visited)<20:
  url=queue.pop(0)
  if url in visited:continue
  root=ET.fromstring(read(url));visited.append(url)
  if root.tag.endswith('sitemapindex'):
   children=[node.text for node in root.findall('.//{*}sitemap/{*}loc') if node.text]
   children.sort(key=lambda x:('page' not in x,x));queue=children+queue
  else:urls.update(node.text for node in root.findall('.//{*}url/{*}loc') if node.text)
  if all(x['url'] in urls for x in records):break
 missing=[x['url'] for x in records if x['url'] not in urls]
 if missing:raise RuntimeError('Published details not yet in sitemap: '+str(len(missing)))
 report={'publicPages':len(records),'googlebotAllowed':True,'selfCanonicalChecked':True,'selfCanonicalPagesChecked':len(canonical_counts),'pagesWithMultipleSelfCanonicals':sum(count>1 for count in canonical_counts),'extraSelfCanonicalTags':sum(max(0,count-1) for count in canonical_counts),'sitemapPagesFound':len(records),'sitemapsChecked':visited}
 Path('product-detail-discovery-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('DETAIL DISCOVERY VERIFIED',json.dumps(report),flush=True)
if __name__=='__main__':main()

