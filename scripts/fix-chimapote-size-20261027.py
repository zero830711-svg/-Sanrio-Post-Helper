import importlib.util
spec=importlib.util.spec_from_file_location('ed','scripts/publish-editorial-article.py');ed=importlib.util.module_from_spec(spec);spec.loader.exec_module(ed)
w=ed.WordPress(); post=w.call('/wp/v2/posts/7909?context=edit'); content=post['content']['raw']
old='ぬいぐるみ本体の付属有無、ショップ本体の寸法、材質は注文する商品ページで確認しましょう。掲載写真に一緒に写っているぬいぐるみが付属するとは限りません。'
new='ショップ本体は約幅25×奥行12×高さ25.5cm、主な素材はポリエステル、対象年齢は3才以上です（サンリオ公式楽天の商品情報）。ぬいぐるみ本体の付属有無は注文する商品ページで確認しましょう。掲載写真に一緒に写っているぬいぐるみが付属するとは限りません。'
if post['slug']!='sanrio-chimapote-plush-shop-3' or post['status']!='publish' or content.count(old)!=1: raise RuntimeError('Content changed: do not overwrite')
content=content.replace(old,new).replace('ショップ本体は約幅25', 'ショップ本体は約幅25').replace('（サンリオ公式楽天の商品情報）', '（<a href="https://item.rakuten.co.jp/sanrio/n-2607-356760/">サンリオ公式楽天の商品情報</a>）')
w.call('/wp/v2/posts/7909',{'content':content}); check=w.call('/wp/v2/posts/7909?context=edit')
if '奥行12×高さ25.5cm' not in check['content']['raw'] or check['featured_media']!=post['featured_media']: raise RuntimeError('Verification failed')
print('VERIFIED',check['link'])
