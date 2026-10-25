"""Preflight and publish five individually verified Sanrio capsule-toy pages."""
import importlib.util, json, html, sys
from pathlib import Path
def loadmod(name,file):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
batch=loadmod("gacha_batch","publish-rakuten-gacha-batch.py")
editorial=loadmod("editorial","publish-editorial-article.py")
data=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
candidate_data=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["products"]
batch.IMAGE_HOSTS.add("thumbnail.image.rakuten.co.jp")
prepared=[]
for article in data["products"]:
 rows=candidate_data.get(article["slug"],[])
 for row in rows:
  if batch.valid_affiliate(row.get("url")):
   row["url"]=batch.parse.parse_qs(batch.parse.urlsplit(row["url"]).query).get("pc",[""])[0]
  image=batch.parse.urlsplit(row.get("image",""))
  if image.hostname=="thumbnail.image.rakuten.co.jp": row["image"]=batch.parse.urlunsplit(image._replace(query="_ex=600x600"))
 matches=[r for r in rows if batch.eligible(r) and batch.product_name_matches(article["name"],r["title"])]
 if not matches: raise RuntimeError("A Rakuten result did not match the reviewed product: "+article["name"])
 item=matches[0]
 article["content"]=article["content"]
 replacements={"{{rakuten_affiliate_url}}":item["affiliate"],"{{amazon_affiliate_url}}":batch.amazon_url(article["amazon_search_query"]),"{{rakuten_title}}":item["title"],"{{rakuten_attribution}}":batch.RAKUTEN_ATTRIBUTION}
 for token,value in replacements.items():
  expected=2 if token=="{{rakuten_affiliate_url}}" else 1
  if article["content"].count(token)!=expected: raise RuntimeError("Article affiliate or attribution placeholder is invalid.")
  article["content"]=article["content"].replace(token,value if token=="{{rakuten_attribution}}" else html.escape(value,quote=True))
 if "ガチャガチャアイランド" in article["content"]: raise RuntimeError("Unexpected reference-site name in article.")
 article["image_base64"]=batch.download_jpeg(item["image"])
 prepared.append((article,item))
print(f"Prepared {len(prepared)} Rakuten API product matches and image files.",flush=True)
wp=editorial.WordPress()
for article,item in prepared:
 q=batch.parse.urlencode({"slug":article["slug"],"context":"edit","_fields":"id,slug,status,link"})
 if wp.call("/wp/v2/posts?"+q): raise RuntimeError("An article slug already exists; publishing stopped before writes.")
 search=batch.parse.urlencode({"search":article["name"],"context":"edit","per_page":20,"_fields":"id,slug,title,status,link,content"})
 existing=wp.call("/wp/v2/posts?"+search)
 possible_duplicates=[]
 for post in existing:
  title_data=post.get("title",{})
  title=title_data.get("rendered",title_data.get("raw","")) if isinstance(title_data,dict) else title_data
  content_data=post.get("content",{})
  content=content_data.get("rendered",content_data.get("raw","")) if isinstance(content_data,dict) else content_data
  if batch.product_name_matches(article["name"],batch.plain_text(str(title)+" "+str(content))):
   possible_duplicates.append(post)
 if possible_duplicates: raise RuntimeError("A possible duplicate of the same product exists; publishing stopped before writes.")
for article,item in prepared:
 print("Publishing:",article["name"],"from",item["url"],flush=True)
 editorial.publish(article,wp)
