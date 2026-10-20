import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('discovery',Path(__file__).resolve().parents[1]/'scripts/import-discovered-products.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def item(code='cinemacollection:a',title='シナモロール ポーチ',image='https://image.rakuten.co.jp/shop/cabinet/a.jpg'):
 return dict(code=code,title=title,image=image,affiliate='https://hb.afl.rakuten.co.jp/hgc/g1234567.12345678.g1234567.12345678/',shop='店')
class DiscoveryImport(unittest.TestCase):
 def test_accepts_verified_shop_outside_fashion_and_rejects_duplicates(self):
  row=item();cache={row['image']:(600,600)}
  added,_,_=m.additions([row,row],[],'cinnamoroll',10000,cache)
  self.assertEqual([x['code'] for x in added],[row['code']])
  added,_,_=m.additions([row],added,'cinnamoroll',10000,cache);self.assertEqual(added,[])
 def test_wrong_character_and_missing_image_cannot_be_added(self):
  self.assertEqual(m.additions([item()],[],'kuromi',10000,{'https://image.rakuten.co.jp/shop/cabinet/a.jpg':True})[0],[])
  self.assertEqual(m.additions([item()],[],'cinnamoroll',10000,{})[0],[])
