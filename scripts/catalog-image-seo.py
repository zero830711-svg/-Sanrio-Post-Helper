"""Improve existing photo alt text via standard WP REST; build an image sitemap."""
import html
import gzip
import hashlib
from urllib import request
import importlib.util
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import xml.etree.ElementTree as ET
s=importlib.util.spec_from_file_location('catalog',Path(__file__).with_name('import-rakuten-character-catalog.py'))
c=importlib.util.module_from_spec(s);s.loader.exec_module(c)

def improve(raw):
 # Touch only product images inside managed product cards, preserving all links/layout.
 pattern=r'(<article\b[^>]*class="[^"]*sf-rakuten-product-card[^"]*"[^>]*>)(.*?)(</article>)'
 def card(m):
  title=re.search(r'data-title="([^"]*)"',m[1])
  if not title:return m[0]
  alt=html.escape(c.display_title(html.unescape(title[1])),quote=True)
  body=re.sub(r'(<img\b[^>]*\balt=")[^"]*(")',lambda x:x[1]+alt+x[2],m[2],count=1)
  return m[1]+body+m[3]
 return re.sub(pattern,card,raw,flags=re.S)

class Images(HTMLParser):
 def __init__(self):super().__init__();self.urls=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='img' and a.get('src','').startswith('https://') and a.get('alt','').strip():
   if a['src'] not in self.urls:self.urls.append(a['src'])

def sitemap(pages):
 ns='http://www.sitemaps.org/schemas/sitemap/0.9';im='http://www.google.com/schemas/sitemap-image/1.1'
 ET.register_namespace('',ns);ET.register_namespace('image',im)
 root=ET.Element('{'+ns+'}urlset');total=0
 for link,raw in pages:
  p=Images();p.feed(raw)
  for start in range(0,len(p.urls),1000):
   u=ET.SubElement(root,'{'+ns+'}url');ET.SubElement(u,'{'+ns+'}loc').text=link
   for src in p.urls[start:start+1000]:
    node=ET.SubElement(u,'{'+im+'}image');ET.SubElement(node,'{'+im+'}loc').text=src;total+=1
 return ET.tostring(root,encoding='utf-8',xml_declaration=True),total

def publish_sitemap(wp,data):
 # Gzip is a supported WordPress media type and Google sitemap format.
 # Never rename an executable or change upload permissions.
 digest=hashlib.sha256(data).hexdigest()[:16];slug='sf-catalog-image-sitemap-'+digest
 existing=wp.call('/wp/v2/media?slug='+slug+'&_fields=id,source_url')
 if existing:url=existing[0]['source_url']
 else:
  req=request.Request(c.SITE+'/wp-json/wp/v2/media',data=gzip.compress(data,mtime=0),headers={
   'Authorization':wp.auth,'Content-Type':'application/x-gzip',
   'Content-Disposition':'attachment; filename="'+slug+'.xml.gz"'},method='POST')
  with request.urlopen(req,timeout=90) as response:media=json.load(response)
  wp.call('/wp/v2/media/'+str(media['id']),{'slug':slug,'title':'Catalog image sitemap','description':'Google image sitemap, gzip XML; submit this file URL in Search Console.'})
  url=media['source_url']
 with request.urlopen(url,timeout=90) as response:download=response.read()
 if gzip.decompress(download)!=data:raise RuntimeError('Public sitemap content mismatch')
 return url

def run(wp=None):
 wp=wp or c.WordPress();rows=[]
 for page in range(1,20):
  batch=wp.call('/wp/v2/pages?context=edit&status=publish&per_page=100&page='+str(page)+'&_fields=id,slug,link,content')
  rows+=batch
  if len(batch)<100:break
 selected=[p for p in rows if 'sf-rakuten-product-card' in p['content']['raw']]
 changed=0;placements=0;maps=[]
 for p in selected:
  raw=p['content']['raw'];updated=improve(raw)
  oldcards=c.extract_existing_cards(raw)
  if updated!=raw:
   current=wp.call('/wp/v2/pages/'+str(p['id'])+'?context=edit&_fields=content')
   if current['content']['raw']!=raw:raise RuntimeError('Concurrent edit: '+p['slug'])
   saved=wp.call('/wp/v2/pages/'+str(p['id']),{'content':updated})
   actual=saved['content']['raw']
   if actual!=updated:raise RuntimeError('Content not retained: '+p['slug'])
   if c.extract_existing_cards(actual)!=oldcards:raise RuntimeError('Product details changed')
   changed+=1
  placements+=len(oldcards);maps.append((p['link'],updated))
  print('IMAGE PAGE',p['slug'],'photos',len(oldcards),'updated',updated!=raw,flush=True)
 data,count=sitemap(maps)
 Path('catalog-image-sitemap.xml').write_bytes(data)
 url=publish_sitemap(wp,data)
 report={'sitemapUrl':url,'pages':len(selected),'updated':changed,'productPlacementsPreserved':placements,'sitemapImages':count,'sitemapPublished':True}
 Path('catalog-image-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print('IMAGE SUMMARY',json.dumps(report),flush=True)
 return report
if __name__=='__main__':run()
