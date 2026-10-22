"""A capped, specification-backed product-page pilot using standard WordPress REST only."""
import argparse,base64,collections,gzip,hashlib,html,importlib.util,json,re,unicodedata,tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib import parse,request
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('detail_catalog',ROOT/'import-rakuten-character-catalog.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
STATE='sf-product-detail-pilot-state';MARK='<!-- sf-product-detail-pilot:v1 -->';HUB='product-details'
CACHE='sf-product-detail-pilot-api-cache'
E=lambda x:html.escape(str(x),quote=True)
def slug(code):return 'product-'+hashlib.sha256(code.encode()).hexdigest()[:16]
def detail_url(code):return c.SITE+'/'+slug(code)+'/'

class Caption(HTMLParser):
 def __init__(self):super().__init__();self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag in {'br','tr','p','div','li'}:self.parts.append('\n')
  if tag in {'td','th'}:self.parts.append(' ')
 def handle_endtag(self,tag):
  if tag in {'tr','p','div','li'}:self.parts.append('\n')
 def handle_data(self,data):self.parts.append(data)

LABELS={'本体サイズ':'サイズ','商品サイズ':'サイズ','サイズ':'サイズ','寸法':'サイズ','主な素材・原料':'素材・材質','主な素材':'素材・材質','主素材':'素材・材質','材質':'素材・材質','素材':'素材・材質','容量':'容量','容積':'容量','重量':'重さ','重さ':'重さ','セット内容':'セット内容','内容量':'内容量','対象年齢':'対象年齢','メーカー品番':'品番・型番','品番':'品番・型番','型番':'品番・型番','JANコード':'JANコード','JAN':'JANコード','原産国':'生産国','生産国':'生産国','製造国':'生産国'}
LABELS.update({'本体サイズ・重量':'サイズ','サイズ・重量':'サイズ','サイズ(約)':'サイズ','商品サイズ(約)':'サイズ','本体サイズ(約)':'サイズ','サイズ・寸法':'サイズ','素材・材質':'素材・材質','素材・成分':'素材・材質','素材・原料':'素材・材質','材質・素材':'素材・材質','セット内容・付属品':'セット内容'})
LABELS.update({'主な材料・原料':'素材・材質','主な材料':'素材・材質','材料・原料':'素材・材質','材料':'素材・材質'})
LABELS.update({'主な素材、原料':'素材・材質'})
BOUNDARIES=['詳細','洗濯方法','特徴','仕様','付属品','お手入れ','ブランド名','メーカー名','備考','耐熱温度','使用抗菌剤の種類','加工方法','加工部位','商品説明','商品詳細']
LABEL_PATTERN='|'.join(map(re.escape,sorted(list(LABELS)+BOUNDARIES,key=len,reverse=True)))
def specifications(caption):
 parser=Caption();parser.feed(str(caption or ''))
 text=unicodedata.normalize('NFKC',html.unescape(''.join(parser.parts)))
 structured=bool(re.search(r'■\s*主な(?:素材|材料)',text))
 text=text.replace('(※','(')
 text=re.sub(r'■\s*('+LABEL_PATTERN+r')',lambda m:'\n'+m[1]+': ',text)
 text=re.sub(r'(:\s*)【([^】]+)】',r'\1(\2)',text)
 pattern=re.compile(r'(?:[【\[■●◆□◎]\s*)?('+LABEL_PATTERN+r')(?:\s*[】\]:：]\s*|\s*\n\s*|[ \t　]+)')
 matches=list(pattern.finditer(text));facts={}
 for n,m in enumerate(matches):
  if m[1] not in LABELS:continue
  value=text[m.end():matches[n+1].start() if n+1<len(matches) else len(text)]
  value=re.split(r'\n|[■●◆□◎]|【|※|ご注意|注意事項|関連商品|検索用|キーワード|おすすめ|お客様|商品説明|商品詳細|\(c\)|\(C\)|©|備考',value)[0]
  value=re.sub(r'\s+',' ',value).strip(' :：/|・。】[]')
  label=LABELS[m[1]]
  value=re.split(r'。|\s+(?:梱包|同シリーズ|ケープ|注意|耐熱|名前シール|使用抗菌剤|ランチグッズ|商品に|製造元|メーカー希望|特徴|仕様)',value)[0].strip()
  value=re.sub(r'\s*[・]?商品$','',value).strip()
  if label=='素材・材質' and not structured:value=re.split(r'\s+(?![0-9%])',value)[0]
  if value.endswith('('):value=value[:-1].rstrip()
  if label=='生産国':
   country=re.search(r'日本|中国|台湾|ベトナム|タイ|韓国|インドネシア|インド|フィリピン|マレーシア',value)
   if country:value=country[0]
  if not 1<len(value)<=150 or re.search(r'https?://|送料無料|クーポン|ポイント|楽天|レビュー|%OFF|割引',value,re.I):continue
  valid={'サイズ':r'\d.*(?:cm|mm|×|[xX]|高さ|幅|奥行|直径)|(?:高さ|幅|直径).*\d','素材・材質':r'綿|ポリ|ナイロン|ABS|PP|PET|PVC|樹脂|紙|ステンレス|アルミ|陶|磁器|ガラス|アクリル|鉄|木|レーヨン|合皮|革|レジン|シリコ|プラスチック|ゴム','容量':r'\d.*(?:ml|mL|L|リットル)','重さ':r'\d.*(?:g|グラム|kg)','対象年齢':r'\d.*(?:歳|才|か月|ヶ月)','内容量':r'\d','品番・型番':r'[A-Za-z0-9][A-Za-z0-9_-]{2,}','JANコード':r'^\d{13}$','生産国':r'日本|中国|台湾|ベトナム|タイ|韓国|インド|フィリピン|マレーシア','セット内容':r'.{3,}'}[label]
  if re.search(valid,value,re.I):facts.setdefault(label,value)
 return facts

def read_state(wp):
 rows=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+STATE+'&_fields=id,slug,content')
 if not rows:return [],None
 if rows[0]['slug']!=STATE:raise RuntimeError('Pilot state identity mismatch')
 payload=json.loads(base64.b64decode(c.text_from(rows[0]['content']['raw'])))
 records=payload['records']
 if len(records)>500:raise RuntimeError('Product detail cap exceeded')
 for x in records:
  if x['url']!=detail_url(x['code']) or not x.get('pageId'):raise RuntimeError('Invalid managed detail URL')
 return records,rows[0]['id']

def apply_index(index,records):
 mapping={x['code']:x for x in records}
 for item in index['items']:
  code=item['id'].removeprefix('rakuten:')
  if item['type']=='product' and code in mapping:item['url']=mapping[code]['url']
 return index

def link_cards(raw,records):
 mapping={x['code']:x['url'] for x in records}
 def change(m):
  tag,body=m[1],m[2];found=re.search(r'data-code="([^"]+)"',tag)
  if not found:return m[0]
  code=html.unescape(found[1])
  if code not in mapping:return m[0]
  body=re.sub(r'<a\b[^>]*class="sf-detail-link"[^>]*>.*?</a>','',body,flags=re.S)
  return tag+body+'<a class="sf-detail-link" style="display:block;text-align:center;font-size:11px;line-height:1.6;padding:6px 2px" href="'+E(mapping[code])+'">サイズ・素材など詳しく見る</a></article>'
 return re.sub(r'(<article\b[^>]*class="[^"]*sf-rakuten-product-card[^"]*"[^>]*>)(.*?)(</article>)',change,raw,flags=re.S)

def load_unified():
 spec=importlib.util.spec_from_file_location('detail_unified',ROOT/'unify-product-search.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u);return u

def prepare(wp,path):
 existing,_=read_state(wp)
 if existing:raise RuntimeError('Fixed pilot already exists; no additional products will be published')
 hub=wp.call('/wp/v2/pages?context=edit&slug='+HUB+'&_fields=id,content')
 if hub and MARK not in hub[0]['content']['raw']:raise RuntimeError('Detail directory slug already in use')
 u=load_unified();goods=wp.call('/wp/v2/pages/804?context=edit&_fields=content')
 index=u.read_index(goods['content']['raw']);pool=[]
 cached=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+CACHE+'&_fields=id,content')
 known=set()
 if cached:known={x['existing']['code'] for x in json.loads(gzip.decompress(base64.b64decode(c.text_from(cached[0]['content']['raw']))))}
 for item in index['items']:
  if item['type']!='product' or len(item['characters'])!=1:continue
  title=item['title'];code=item['id'].removeprefix('rakuten:')
  if code in known or len(c.display_title(title))>140:continue
  if sum(c.matches_character(title,k) for k in c.CHARACTERS)!=1:continue
  if re.search(r'中古|福袋|ランダム|全\d+種|選べる|選択|アソート',title):continue
  strength=len(re.findall(r'\d+(?:\.\d+)?\s*(?:cm|mm|ml|mL)|[A-Z]{2,}\d+|\d{6,13}',title))
  strength=min(strength,3)
  strength+=8 if code.split(':')[0]=='sanrio' else (3 if code.split(':')[0] in {'skater','skater-official'} else 0)
  if strength<1:continue
  pool.append(dict(item,code=code,strength=strength))
 pool.sort(key=lambda x:(-x['strength'],x['id']))
 chosen=[];chars=collections.Counter();kinds=collections.Counter()
 while pool and len(chosen)<80:
  best=min(pool,key=lambda x:chars[x['characters'][0]]*2+kinds[x['kind']]*.5-x['strength'])
  pool.remove(best);chosen.append(best);chars[best['characters'][0]]+=1;kinds[best['kind']]+=1
 if len(chosen)<30:raise RuntimeError('Too few candidates for a meaningful pilot')
 Path(path).write_text(json.dumps(chosen,ensure_ascii=False));print('DETAIL PREPARED',len(chosen),'existing products',flush=True)

def clear_candidate(title):
 return len(title)<=100 and not re.search(r'中古|福袋|ランダム|全\d+種|選べる|選択|アソート|[/／]|<|>',title) and sum(c.matches_character(title,k) for k in c.CHARACTERS)==1

def prepare_expansion(wp,path):
 records,_=read_state(wp)
 if len(records)==100:
  _,retired=unique_expansion(records)
  if not retired:Path(path).write_text('[]');return
 elif len(records)!=40:raise RuntimeError('Expected 40 existing details before expansion')
 rows=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+CACHE+'&_fields=id,content')
 if not rows:raise RuntimeError('Verified source cache missing')
 cache=json.loads(gzip.decompress(base64.b64decode(c.text_from(rows[0]['content']['raw']))))
 pool=[];existing_codes={x['code'] for x in records}
 for entry in cache:
  old,row=entry['existing'],entry['api'];title=c.display_title(row.get('itemName',''));facts=specifications(row.get('itemCaption',''))
  if old['code'] in existing_codes or not clear_candidate(title):continue
  if len(facts)<2 or '素材・材質' not in facts or not any(k in facts for k in ['サイズ','容量','重さ']):continue
  pool.append(dict(old,title=title,facts=facts,images=[old['image']],character=old['characters'][0]))
 # At most 100 exact-item API calls, all from existing catalog products.
 chosen=choose(pool,limit=len(retired) if len(records)==100 else 100,existing=records)
 if len(chosen)<(len(retired) if len(records)==100 else 60):raise RuntimeError('Too few clear cached candidates for additions')
 Path(path).write_text(json.dumps(chosen,ensure_ascii=False))
 print('DETAIL EXPANSION PREPARED',len(chosen),'candidates; existing',len(records),flush=True)

def enrich(entry):
 old,row=entry['existing'],entry['api'];code=old['code']
 if row.get('itemCode')!=code or not row.get('availability'):return None
 title=re.sub(r'^【[0-9,]+円】\s*','',c.display_title(row.get('itemName','')))
 chars=[k for k,v in c.CHARACTERS.items() if c.matches_character(title,k)]
 if len(chars)!=1:return None
 facts=specifications(row.get('itemCaption',''))
 if len(facts)<2 or not ('素材・材質' in facts and any(k in facts for k in ['サイズ','容量','重さ'])):return None
 image=c.safe_image_url(old['image'])
 if not image:return None
 images=[image]
 for value in row.get('mediumImageUrls',[]):
  url=value.get('imageUrl','') if isinstance(value,dict) else str(value)
  parts=parse.urlsplit(url);url=parse.urlunsplit((parts.scheme,parts.netloc,parts.path,'',''))
  if c.safe_image_url(url) and url not in images:images.append(url)
 images=[url for url in images[:3] if c.verify_image(url)]
 if not images:return None
 affiliate=c.safe_affiliate_url(row.get('affiliateUrl','')) or c.safe_affiliate_url(old['rakuten'])
 if not affiliate:return None
 # Source URLs come from the API's own affiliate destination, never a reconstructed item code.
 parts=parse.urlsplit(affiliate);dest=parse.parse_qs(parts.query).get('pc',[''])[0];p=parse.urlsplit(dest)
 if p.scheme!='https' or p.hostname!='item.rakuten.co.jp':return None
 return {'code':code,'title':title,'facts':facts,'images':images,'affiliate':affiliate,'source':dest,'shop':str(row.get('shopName') or old['shop']),'character':chars[0],'kind':old['kind'],'url':detail_url(code),'checkedAt':datetime.now(timezone.utc).isoformat(timespec='seconds')}

def identity_keys(x):
 title=c.canonical_text(x['title'])
 # Treat clothing size variants and duplicate shop listings as the same pilot product.
 title=re.sub(r'\d+(?:[-〜~]\d+)?\s*cm','',title,flags=re.I)
 keys={'code:'+x['code'],'title:'+title,'image:'+parse.urlsplit(x['images'][0]).path}
 if x['facts'].get('JANコード'):keys.add('jan:'+x['facts']['JANコード'])
 return keys

def duplicate_with(x,others):
 name=c.canonical_text(x['title'])
 for y in others:
  other=c.canonical_text(y['title'])
  if identity_keys(x)&identity_keys(y):return True
  # Retailer SEO suffixes can hide the same official product title.
  if min(len(name),len(other))>=12 and (name.startswith(other) or other.startswith(name)):return True
 return False

def unique_expansion(records):
 kept=list(records[:40]);retired=[]
 for x in records[40:]:
  if duplicate_with(x,kept):retired.append(x)
  else:kept.append(x)
 return kept,retired

def choose(entries,limit=40,existing=()):
 pool=sorted(entries,key=lambda x:(-len(x['facts']),-len(x['images']),x['code']));chosen=[];seen=set();chars=collections.Counter();kinds=collections.Counter()
 for x in existing:seen.update(identity_keys(x));chars[x['character']]+=1;kinds[x['kind']]+=1
 while pool and len(chosen)<limit:
  best=min(pool,key=lambda x:chars[x['character']]*3+kinds[x['kind']]-len(x['facts'])-len(x['images'])*.5)
  pool.remove(best)
  keys=identity_keys(best)
  if keys&seen or duplicate_with(best,list(existing)+chosen):continue
  chosen.append(best);seen.update(keys);chars[best['character']]+=1;kinds[best['kind']]+=1
 return chosen

def related(x,records):
 pool=[y for y in records if y['code']!=x['code']]
 pool.sort(key=lambda y:(y['character']!=x['character'],y['kind']!=x['kind'],y['code']))
 return '<div class="sf-detail-related">'+''.join('<a href="'+E(y['url'])+'"><img src="'+E(y['images'][0])+'" alt="'+E(y['title'])+'" loading="lazy"><span>'+E(y['title'])+'</span></a>' for y in pool[:3])+'</div>'

def render(x,records):
 name=c.CHARACTERS[x['character']][2];char_url=c.SITE+'/'+c.CHARACTERS[x['character']][1]+'/'
 facts=''.join('<tr><th scope="row">'+E(k)+'</th><td>'+E(v)+'</td></tr>' for k,v in x['facts'].items())
 gallery=''.join('<img src="'+E(src)+'" alt="'+E(x['title'])+('の商品写真' if i==0 else 'の詳細写真'+str(i+1))+'" loading="'+('eager' if i==0 else 'lazy')+'" decoding="async">' for i,src in enumerate(x['images']))
 breadcrumb={'@context':'https://schema.org','@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':1,'name':'ホーム','item':c.SITE+'/'},{'@type':'ListItem','position':2,'name':name+'のグッズ','item':char_url},{'@type':'ListItem','position':3,'name':x['title'],'item':x['url']}]}
 data=json.dumps(breadcrumb,ensure_ascii=False).replace('<','\\u003c')
 return MARK+'\n<style>'+(ROOT/'product-detail-pilot.css').read_text()+'</style><section class="sf-detail"><p class="sf-detail-note">非公式ファンサイト・アフィリエイト広告を含みます。</p><p><a href="'+E(char_url)+'">'+E(name)+'のグッズ一覧</a> ／ <a href="/'+HUB+'/">詳しい商品情報の一覧</a></p><p>'+E(x['title'])+'のサイズ・素材など、購入前に確認したい情報をまとめました。</p><div class="sf-detail-gallery">'+gallery+'</div><a class="sf-detail-buy" href="'+E(x['affiliate'])+'" target="_blank" rel="sponsored nofollow noopener">楽天で価格・在庫を確認する</a><h2>サイズ・素材などの商品情報</h2><table><tbody><tr><th scope="row">商品名</th><td>'+E(x['title'])+'</td></tr><tr><th scope="row">キャラクター</th><td>'+E(name)+'</td></tr>'+facts+'</tbody></table><p class="sf-detail-note">出典：楽天市場「'+E(x['shop'])+'」の商品情報。確認日：'+E(x['checkedAt'][:10])+ '。購入前に、選択する種類・サイズ・セット内容・配送条件を販売ページでご確認ください。</p><h2>購入先</h2><p>楽天市場の掲載商品へご案内します。</p><a class="sf-detail-buy" href="'+E(x['affiliate'])+'" target="_blank" rel="sponsored nofollow noopener">楽天で価格・在庫を確認する</a><h2>関連する商品</h2>'+related(x,records)+'</section><script type="application/ld+json">'+data+'</script>\n'

def save_page(wp,slug_name,title,raw,excerpt):
 rows=wp.call('/wp/v2/pages?context=edit&slug='+slug_name+'&_fields=id,slug,content')
 if rows and MARK not in rows[0]['content']['raw']:raise RuntimeError('Refusing unmanaged page: '+slug_name)
 data={'slug':slug_name,'status':'publish','title':title,'content':raw,'excerpt':excerpt}
 if rows:
  before=rows[0]['content']['raw'];path='/wp/v2/pages/'+str(rows[0]['id'])
  if wp.call(path+'?context=edit&_fields=content')['content']['raw']!=before:raise RuntimeError('Concurrent edit')
 else:path='/wp/v2/pages'
 saved=wp.call(path,data)
 if saved['slug']!=slug_name or saved['content']['raw']!=raw:raise RuntimeError('Saved product page mismatch')
 return saved

def verify_public(record):
 req=request.Request(record['url'],headers={'User-Agent':'SanrioProductDetailPilot/1.0'})
 with request.urlopen(req,timeout=60) as response:body=response.read().decode('utf-8')
 if MARK not in body or 'サイズ・素材などの商品情報' not in body:raise RuntimeError('Blank detail page: '+record['url'])
 if re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\'][^"\']*noindex',body,re.I):raise RuntimeError('Detail page is noindex')
 canonical=re.search(r'<link\b[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)',body,re.I)
 if canonical and html.unescape(canonical[1]).rstrip('/')!=record['url'].rstrip('/'):raise RuntimeError('Canonical URL mismatch')

def publish(wp,input_path,target=40):
 old,state_id=read_state(wp);prior=list(old);retired=[]
 if target not in (40,100):raise RuntimeError('Unsupported detail target')
 if target==100 and len(old)==100:
  old,retired=unique_expansion(old)
  if not retired:
   result=sync_catalogs(wp,old);print('DETAIL TOTAL VERIFIED',json.dumps({'total':100,'newPages':0,**result}),flush=True);return
 if old and target==40:raise RuntimeError('Pilot already exists')
 if target==100 and len(prior) not in (40,100):raise RuntimeError('Expansion requires the original 40-product cohort')
 source=json.loads(Path(input_path).read_text());incoming=list(source)
 cache=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+CACHE+'&_fields=id,content')
 if cache:
  previous=json.loads(gzip.decompress(base64.b64decode(c.text_from(cache[0]['content']['raw']))))
  merged={x['existing']['code']:x for x in previous+source};source=list(merged.values())
 payload=base64.b64encode(gzip.compress(json.dumps(source,ensure_ascii=False).encode(),mtime=0)).decode()
 if cache:wp.call('/wp/v2/pages/'+str(cache[0]['id']),{'content':'<pre>'+payload+'</pre>'})
 else:wp.call('/wp/v2/pages',{'slug':CACHE,'status':'draft','title':'Managed exact-item API cache for the fixed detail pilot','content':'<pre>'+payload+'</pre>'})
 selection_source=incoming if target==100 else source
 with ThreadPoolExecutor(max_workers=4) as pool:enriched=list(pool.map(enrich,selection_source))
 eligible=[x for x in enriched if x]
 if target==100:eligible=[x for x in eligible if clear_candidate(x['title']) and not any(v.count('(')!=v.count(')') for v in x['facts'].values()) and not re.search(r'[、,:][A-Za-z]$',x['facts']['素材・材質'])]
 additions=choose(eligible,limit=target-len(old),existing=old);records=old+additions
 audit={'apiMatched':len(source),'eligible':len(eligible),'selected':len(records),'skipped':len(source)-len(records),'examples':[{'title':x['title'],'facts':x['facts']} for x in records[:6]]}
 Path('product-detail-selection.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2));print('DETAIL SELECTION',json.dumps(audit,ensure_ascii=False),flush=True)
 if (target==100 and len(records)!=100) or len(records)<30:
  for entry in source[-80:][:12]:
   row=entry['api'];parser=Caption();parser.feed(row.get('itemCaption',''));print('DETAIL SOURCE',json.dumps({'code':row.get('itemCode'),'title':row.get('itemName'),'facts':specifications(row.get('itemCaption','')),'caption':''.join(parser.parts)[:2200]},ensure_ascii=False),flush=True)
  raise RuntimeError('Not enough unique specification-backed products for target; nothing published')
 for x in additions:x['cohort']='2026-10-product-detail-'+str(target)
 # All content is rendered and validated before the first publication.
 contents={x['code']:render(x,records) for x in additions}
 def publish_one(x):
  raw=contents[x['code']];description=x['title']+'。'+ '／'.join(k+'：'+v for k,v in x['facts'].items())
  saved=save_page(wp,slug(x['code']),x['title']+'｜サイズ・素材・購入先',raw,description[:250]);x['pageId']=saved['id']
  if saved['link']!=x['url']:raise RuntimeError('Unexpected product URL')
  verify_public(x);print('DETAIL PAGE VERIFIED',x['url'],flush=True);return x
 with ThreadPoolExecutor(max_workers=3) as pool:records=old+list(pool.map(publish_one,additions))
 manifest={'version':1,'records':records,'createdAt':datetime.now(timezone.utc).isoformat(timespec='seconds')}
 if state_id:
  state=wp.call('/wp/v2/pages/'+str(state_id)+'?context=edit&_fields=content')['content']['raw']
  original=json.loads(base64.b64decode(c.text_from(state)))
  if original['records']!=prior:raise RuntimeError('Concurrent detail state edit')
  manifest['createdAt']=original['createdAt']
  manifest['retiredProducts']=original.get('retiredProducts',[])
  by_code={x['existing']['code']:x['existing'] for x in source}
  for x in retired:manifest['retiredProducts'].append({'code':x['code'],'pageId':x['pageId'],'originalUrl':by_code[x['code']]['url']})
 state_path='/wp/v2/pages/'+str(state_id) if state_id else '/wp/v2/pages'
 saved=wp.call(state_path,{'slug':STATE,'status':'draft','title':'Managed product detail pilot state','content':'<pre>'+base64.b64encode(json.dumps(manifest,ensure_ascii=False).encode()).decode()+'</pre>'})
 if saved['slug']!=STATE:raise RuntimeError('State slug collision')
 loaded,_=read_state(wp)
 if loaded!=records:raise RuntimeError('Pilot state verification failed')
 result=sync_catalogs(wp,records)
 report={'published':len(records),'newPages':len(additions),'existingPagesPreserved':len(old),'eligible':len(eligible),'selectionSkipped':len(source)-len(records),**result,'publicationDatesPreserved':True,'hubUrl':c.SITE+'/'+HUB+'/','records':[{'url':x['url'],'title':x['title'],'facts':x['facts']} for x in records]}
 Path('product-detail-pilot-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('DETAIL PILOT VERIFIED',json.dumps(report,ensure_ascii=False),flush=True)


def write_state_payload(wp,state_id,payload,expected_raw):
 path='/wp/v2/pages/'+str(state_id)
 current=wp.call(path+'?context=edit&_fields=content')['content']['raw']
 if current!=expected_raw:raise RuntimeError('Concurrent detail state edit')
 content='<pre>'+base64.b64encode(json.dumps(payload,ensure_ascii=False).encode()).decode()+'</pre>'
 saved=wp.call(path,{'content':content})
 if saved['content']['raw']!=content:raise RuntimeError('Detail state checkpoint mismatch')
 return content

def write_cache(wp,rows):
 found=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+CACHE+'&_fields=id,content')
 previous=json.loads(gzip.decompress(base64.b64decode(c.text_from(found[0]['content']['raw'])))) if found else []
 merged={x['existing']['code']:x for x in previous}
 for row in rows:merged[row['existing']['code']]=row
 payload=base64.b64encode(gzip.compress(json.dumps(list(merged.values()),ensure_ascii=False).encode(),mtime=0)).decode()
 content='<pre>'+payload+'</pre>'
 if found:
  path='/wp/v2/pages/'+str(found[0]['id'])
  if wp.call(path+'?context=edit&_fields=content')['content']['raw']!=found[0]['content']['raw']:raise RuntimeError('Concurrent API cache edit')
  saved=wp.call(path,{'content':content})
 else:saved=wp.call('/wp/v2/pages',{'slug':CACHE,'status':'draft','title':'Managed exact-item API cache for product details','content':content})
 if saved['content']['raw']!=content:raise RuntimeError('API cache checkpoint mismatch')

def build_500_candidates(index,records):
 excluded={x['code'] for x in records};pool=[]
 for item in index['items']:
  if item.get('type')!='product' or len(item.get('characters',[]))!=1:continue
  title=c.display_title(item.get('title',''));code=item['id'].removeprefix('rakuten:')
  if code in excluded or not clear_candidate(title):continue
  probe={'code':code,'title':title,'facts':{},'images':[item.get('image','')]}
  if any(duplicate_with(probe,[x]) for x in records):continue
  old=dict(item);old.update({'code':code,'title':title,'character':item['characters'][0],'kind':item.get('kind','サンリオグッズ')})
  old['strength']=(8 if code.split(':',1)[0]=='sanrio' else 0)+min(4,len(re.findall(r'\d+(?:\.\d+)?\s*(?:cm|mm|ml|mL)|[A-Z]{2,}\d+|\d{6,13}',title)))
  pool.append(old)
 grouped=collections.defaultdict(list)
 for x in pool:grouped[(x['character'],x['kind'])].append(x)
 for values in grouped.values():values.sort(key=lambda x:(-x['strength'],x['code']))
 result=[]
 while any(grouped.values()):
  keys=[k for k,v in grouped.items() if v]
  best=max(keys,key=lambda k:(-len([x for x in result if (x['character'],x['kind'])==k]),grouped[k][0]['strength'],k))
  result.append(grouped[best].pop(0))
 return result

def expand500(wp,settings_path):
 records,state_id=read_state(wp)
 if not records or not state_id:raise RuntimeError('The existing managed detail cohort is missing')
 if len(records)>500:raise RuntimeError('The detail target exceeds 500')
 state_path='/wp/v2/pages/'+str(state_id)
 state_raw=wp.call(state_path+'?context=edit&_fields=content')['content']['raw'];manifest=json.loads(base64.b64decode(c.text_from(state_raw)))
 u=load_unified();goods=wp.call('/wp/v2/pages/804?context=edit&_fields=content');index=u.read_index(goods['content']['raw'])
 progress=manifest.get('expansion500')
 if progress:
  candidates=build_500_candidates(index,records[:100]);codes=[x['code'] for x in candidates]
  if progress.get('candidateCodes')!=codes:raise RuntimeError('Catalog candidate set changed during resumable expansion')
 else:
  candidates=build_500_candidates(index,records);codes=[x['code'] for x in candidates]
  progress={'candidateCodes':codes,'cursor':0,'checked':0,'matched':0,'eligible':0,'skipped':0,'target':500}
  manifest['expansion500']=progress;state_raw=write_state_payload(wp,state_id,manifest,state_raw)
 lookup={x['code']:x for x in candidates}
 if not candidates and len(records)<500:raise RuntimeError('No qualifying catalog candidates remain')
 cache_rows=[];new_total=0
 while len(records)<500 and progress['cursor']<len(codes):
  start=progress['cursor'];batch=[lookup[code] for code in codes[start:start+100]]
  with tempfile.TemporaryDirectory(prefix='sf-detail-500-') as tmp:
   source=Path(tmp)/'candidates.json';verified=Path(tmp)/'verified.json';source.write_text(json.dumps(batch,ensure_ascii=False))
   import subprocess
   subprocess.run(['php',str(ROOT/'fetch-product-detail-pilot.php'),str(settings_path),str(source),str(verified)],check=True)
   matched=json.loads(verified.read_text())
  with ThreadPoolExecutor(max_workers=4) as pool:enriched=list(pool.map(enrich,matched))
  eligible=[x for x in enriched if x and clear_candidate(x['title']) and not any(v.count('(')!=v.count(')') for v in x['facts'].values()) and not re.search(r'[、,:][A-Za-z]$',x['facts'].get('素材・材質',''))]
  additions=choose(eligible,limit=min(50,500-len(records)),existing=records);next_records=records+additions
  contents={x['code']:render(x,next_records) for x in additions}
  def save_one(x):
   raw=contents[x['code']];desc=x['title']+'。'+'／'.join(k+'：'+v for k,v in x['facts'].items())
   saved=save_page(wp,slug(x['code']),x['title']+'｜サイズ・素材・購入先',raw,desc[:250]);x['pageId']=saved['id']
   if saved.get('link')!=x['url']:raise RuntimeError('Unexpected product detail URL')
   verify_public(x);return x
  if additions:
   with ThreadPoolExecutor(max_workers=3) as pool:next_records=records+list(pool.map(save_one,additions))
   chosen_codes={x['code'] for x in additions};cache_rows.extend(row for row in matched if row['existing']['code'] in chosen_codes)
   write_cache(wp,cache_rows);new_total+=len(additions)
  progress['cursor']=start+len(batch);progress['checked']+=len(batch);progress['matched']+=len(matched);progress['eligible']+=len(eligible);progress['skipped']+=len(batch)-len(additions)
  manifest['records']=next_records;manifest['expansion500']=progress
  state_raw=write_state_payload(wp,state_id,manifest,state_raw);records=next_records
  hub=MARK+'<style>'+(ROOT/'product-detail-pilot.css').read_text()+'</style><section><p>サイズ・素材などを購入先の商品情報で確認できた商品をご紹介します。アフィリエイト広告を含みます。</p><div class="sf-detail-hub">'+''.join('<a href="'+E(x['url'])+'"><img src="'+E(x['images'][0])+'" alt="'+E(x['title'])+'" loading="lazy"><strong>'+E(x['title'])+'</strong></a>\n' for x in records)+'</div></section>'
  save_page(wp,HUB,'サンリオグッズの商品情報｜サイズ・素材から確認する',hub,'写真付きサンリオグッズのサイズ・素材などを確認できる商品詳細の一覧。')
  print('DETAIL 500 CHECKPOINT',json.dumps({'total':len(records),'newThisRun':new_total,'checked':progress['checked'],'matched':progress['matched'],'eligible':progress['eligible'],'skipped':progress['skipped'],'remainingCandidates':len(codes)-progress['cursor']},ensure_ascii=False),flush=True)
 if len(records)<500:
  result=sync_catalogs(wp,records)
  report={'published':len(records),'newPages':len(records)-100,'existingPagesPreserved':100,'apiChecked':progress['checked'],'apiMatched':progress['matched'],'qualityEligible':progress['eligible'],'skipped':progress['skipped'],'candidatePool':len(codes),**result,'qualityThresholdRetained':True,'hubUrl':c.SITE+'/'+HUB+'/'}
  Path('product-detail-pilot-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
  print('DETAIL 500 CANDIDATES EXHAUSTED',json.dumps(report,ensure_ascii=False),flush=True)
  raise RuntimeError('Candidate pool exhausted before 500; quality threshold retained. Published '+str(len(records)))
 result=sync_catalogs(wp,records)
 report={'published':len(records),'newPages':len(records)-100,'existingPagesPreserved':100,'apiChecked':progress['checked'],'apiMatched':progress['matched'],'qualityEligible':progress['eligible'],'skipped':progress['skipped'],'candidatePool':len(codes),**result,'publicationDatesPreserved':True,'hubUrl':c.SITE+'/'+HUB+'/'}
 Path('product-detail-pilot-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('DETAIL 500 COMPLETE',json.dumps(report,ensure_ascii=False),flush=True)

def sync_catalogs(wp,records):
 states=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+STATE+'&_fields=content')
 retired=json.loads(base64.b64decode(c.text_from(states[0]['content']['raw']))).get('retiredProducts',[]) if states else []
 retired_codes={x['code'] for x in retired}
 def clean_retired(raw):
  def clean(m):
   found=re.search(r'data-code="([^"]+)"',m[1])
   if not found or html.unescape(found[1]) not in retired_codes:return m[0]
   return m[1]+re.sub(r'<a\b[^>]*class="sf-detail-link"[^>]*>.*?</a>','',m[2],flags=re.S)+'</article>'
  return re.sub(r'(<article\b[^>]*class="[^"]*sf-rakuten-product-card[^"]*"[^>]*>)(.*?)(</article>)',clean,raw,flags=re.S)
 hub=MARK+'<style>'+(ROOT/'product-detail-pilot.css').read_text()+'</style><section><p>サイズ・素材などを購入先の商品情報で確認できた商品をご紹介します。アフィリエイト広告を含みます。</p><div class="sf-detail-hub">'+''.join('<a href="'+E(x['url'])+'"><img src="'+E(x['images'][0])+'" alt="'+E(x['title'])+'" loading="lazy"><strong>'+E(x['title'])+'</strong></a>\n' for x in records)+'</div></section>'
 save_page(wp,HUB,'サンリオグッズの商品情報｜サイズ・素材から確認する',hub,'写真付きサンリオグッズのサイズ・素材などを確認できる商品詳細の一覧。')
 # Only add internal detail links; product data and the existing card order are invariant.
 pages=[]
 for n in range(1,20):
  batch=wp.call('/wp/v2/pages?context=edit&status=publish&per_page=100&page='+str(n)+'&_fields=id,slug,content');pages+=batch
  if len(batch)<100:break
 linked=0;placements=0
 def link_page(page):
  raw=page['content']['raw'];updated=link_cards(clean_retired(raw),records)
  if raw==updated:return 0
  if c.extract_existing_cards(raw)!=c.extract_existing_cards(updated):raise RuntimeError('Catalog products changed')
  path='/wp/v2/pages/'+str(page['id'])
  if wp.call(path+'?context=edit&_fields=content')['content']['raw']!=raw:raise RuntimeError('Concurrent catalog edit')
  saved=wp.call(path,{'content':updated})
  if saved['content']['raw']!=updated:raise RuntimeError('Catalog links not saved')
  return 1
 static=[p for p in pages if 'sf-rakuten-product-card' in p['content']['raw']]
 with ThreadPoolExecutor(max_workers=3) as pool:linked=sum(pool.map(link_page,static))
 placements=sum(len(c.extract_existing_cards(p['content']['raw'])) for p in static)
 u=load_unified();goods=wp.call('/wp/v2/pages/804?context=edit&_fields=id,slug,content');raw=goods['content']['raw'];index=u.read_index(raw)
 before={x['id']:x.get('addedAt') for x in index['items']};count=len(index['items'])
 # Restore a duplicate retailer listing to its original catalog position.
 retired_urls={x['code']:x['originalUrl'] for x in retired}
 for item in index['items']:
  code=item['id'].removeprefix('rakuten:')
  if item['type']=='product' and code in retired_urls:item['url']=retired_urls[code]
 apply_index(index,records)
 payload=base64.b64encode(__import__('gzip').compress(u.safe_json(index).encode(),mtime=0)).decode()
 pattern=r'(<script\b[^>]*id="sf-unified-search-data"[^>]*>).*?(</script>)'
 updated,n=re.subn(pattern,lambda m:m[1]+payload+m[2],raw,flags=re.S)
 if n!=1:raise RuntimeError('Search index boundary missing')
 if wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']['raw']!=raw:raise RuntimeError('Concurrent search edit')
 wp.call('/wp/v2/pages/804',{'content':updated});saved=u.read_index(wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']['raw'])
 if saved!=index or len(saved['items'])!=count or {x['id']:x.get('addedAt') for x in saved['items']}!=before:raise RuntimeError('Search products/dates changed')
 home=wp.call('/wp/v2/pages/805?context=edit&_fields=content');raw=home['content']['raw'];tag='<p id="sf-product-detail-pilot-link"><a href="/'+HUB+'/">サイズ・素材を確認できる商品情報を見る →</a></p>'
 if 'id="sf-product-detail-pilot-link"' not in raw:
  marker='<!-- sf-home-live-catalog:end -->'
  if raw.count(marker)!=1:raise RuntimeError('Home marker missing')
  updated=raw.replace(marker,marker+tag,1)
  if wp.call('/wp/v2/pages/805?context=edit&_fields=content')['content']['raw']!=raw:raise RuntimeError('Concurrent home edit')
  if wp.call('/wp/v2/pages/805',{'content':updated})['content']['raw']!=updated:raise RuntimeError('Home link not saved')
 for x in retired:
  path='/wp/v2/pages/'+str(x['pageId']);page=wp.call(path+'?context=edit&_fields=content,status')
  if MARK not in page['content']['raw']:raise RuntimeError('Retired duplicate is not managed')
  if page['status']!='draft':wp.call(path,{'status':'draft'})
 return {'retiredDuplicates':len(retired),'linkedCatalogPages':linked,'catalogPlacementsPreserved':placements,'searchProductsPreserved':sum(x['type']=='product' for x in saved['items'])}

def maintain(wp):
 records,state_id=read_state(wp)
 if not records:return False
 if not 30<=len(records)<=500:raise RuntimeError('Unexpected fixed cohort size')
 state=wp.call('/wp/v2/pages/'+str(state_id)+'?context=edit&_fields=content')['content']['raw']
 payload=json.loads(base64.b64decode(c.text_from(state)))
 rows=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+CACHE+'&_fields=id,content')
 if not rows:raise RuntimeError('Verified source cache missing')
 cached=json.loads(gzip.decompress(base64.b64decode(c.text_from(rows[0]['content']['raw']))))
 sources={x['existing']['code']:x['api'] for x in cached}
 repaired=[];changes=[]
 for x in records:
  row=sources[x['code']]
  if row.get('itemCode')!=x['code']:raise RuntimeError('Source identity changed')
  facts=specifications(row.get('itemCaption',''))
  if len(facts)<2 or '素材・材質' not in facts or not any(k in facts for k in ['サイズ','容量','重さ']):raise RuntimeError('Existing facts no longer supported: '+x['code'])
  if any(v.endswith('(') for v in facts.values()):raise RuntimeError('Unfinished specification')
  new=dict(x,facts=facts);repaired.append(new)
  if facts!=x['facts']:changes.append({'url':x['url'],'before':x['facts'],'after':facts})
 # Validate all source facts before changing any page; retain the same product cohort and URLs.
 for old,new in zip(records,repaired):
  if old['facts']==new['facts']:continue
  path='/wp/v2/pages/'+str(old['pageId'])
  current=wp.call(path+'?context=edit&_fields=content')['content']['raw']
  expected=render(old,records);updated=render(new,repaired)
  if current not in (expected,updated):raise RuntimeError('Concurrent detail edit: '+old['url'])
  if current!=updated:
   if wp.call(path+'?context=edit&_fields=content')['content']['raw']!=current:raise RuntimeError('Concurrent detail edit')
   if wp.call(path,{'content':updated})['content']['raw']!=updated:raise RuntimeError('Detail repair not saved')
  verify_public(new)
 payload['records']=repaired
 if wp.call('/wp/v2/pages/'+str(state_id)+'?context=edit&_fields=content')['content']['raw']!=state:raise RuntimeError('Concurrent state edit')
 updated='<pre>'+base64.b64encode(json.dumps(payload,ensure_ascii=False).encode()).decode()+'</pre>'
 wp.call('/wp/v2/pages/'+str(state_id),{'content':updated})
 saved,_=read_state(wp)
 if saved!=repaired or [x['code'] for x in saved]!=[x['code'] for x in records]:raise RuntimeError('Fixed cohort changed')
 report={'fixedProducts':len(records),'repairedPages':len(changes),'newApiRequests':0,'changes':changes}
 Path('product-detail-maintenance-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print('DETAIL MAINTENANCE VERIFIED',json.dumps(report,ensure_ascii=False),flush=True)
 return True

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--prepare');ap.add_argument('--publish');ap.add_argument('--cached');ap.add_argument('--maintain',action='store_true');ap.add_argument('--prepare100');ap.add_argument('--expand100');ap.add_argument('--expand500');args=ap.parse_args();wp=c.WordPress()
 if args.prepare100:prepare_expansion(wp,args.prepare100)
 elif args.expand100:publish(wp,args.expand100,target=100)
 elif args.expand500:expand500(wp,args.expand500)
 elif args.maintain:raise SystemExit(0 if maintain(wp) else 3)
 elif args.prepare:prepare(wp,args.prepare)
 elif args.publish:publish(wp,args.publish)
 elif args.cached:
  rows=wp.call('/wp/v2/pages?context=edit&status=draft&slug='+CACHE+'&_fields=id,content')
  if not rows:raise SystemExit(1)
  data=json.loads(gzip.decompress(base64.b64decode(c.text_from(rows[0]['content']['raw']))))
  if not 30<=len(data)<=400:raise RuntimeError('Unexpected cached pilot size')
  Path(args.cached).write_text(json.dumps(data,ensure_ascii=False));print('DETAIL using existing verified API cache',len(data),flush=True)
 else:ap.error('Choose --prepare or --publish')

