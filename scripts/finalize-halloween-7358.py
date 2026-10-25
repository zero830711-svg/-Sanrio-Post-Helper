import importlib.util,json
from pathlib import Path
s=importlib.util.spec_from_file_location('publisher','scripts/publish-editorial-article.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=json.loads(Path('blog/editorial/halloween-final-7358.json').read_text());wp=m.WordPress();current=wp.call('/wp/v2/posts/7358?context=edit')
assert current['slug']==p['slug'] and current['status'] in ('draft','publish')
content=p['content'];medias=[]
for i,photo in enumerate(p['photos']):
 media=m.upload_media(wp,'toptoy-halloween-user-'+photo['filename'].split('-')[-1].split('.')[0],photo['filename'],photo['alt'],Path(photo['base64_path']).read_text());medias.append(media)
 token='{{image_url}}' if i==0 else '{{image_'+str(i)+'_url}}';content=content.replace(token,media['source_url'])
assert '{{image_' not in content and 'https://link.amazon/B09vD2dVE' in content
wp.call('/wp/v2/posts/7358',data={'title':p['title'],'content':content,'excerpt':p['excerpt'],'featured_media':medias[0]['id'],'status':'publish'})
v=wp.call('/wp/v2/posts/7358?context=edit');assert v['status']=='publish' and all(x['source_url'] in v['content']['raw'] for x in medias)
print('PUBLISHED',v['link'],'PHOTOS',len(medias))
