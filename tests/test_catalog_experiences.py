import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('experiences',Path(__file__).resolve().parents[1]/'scripts/catalog-experiences.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def item(code='shop:a',title='シナモロール ぬいぐるみポーチ'):
 return dict(code=code,title=title,category='バッグ・ポーチ',image='https://image.rakuten.co.jp/a.jpg',affiliate='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678/?pc=test',shop='店')

class Experiences(unittest.TestCase):
 def test_direct_link_is_stable_without_changing_product_or_order(self):
  raw=m.c.photo_card(item())+m.c.photo_card(item('shop:b'))
  result=m.direct_links(raw)
  self.assertEqual(m.c.extract_existing_cards(raw),m.c.extract_existing_cards(result))
  self.assertEqual(result,m.direct_links(result))
  self.assertEqual(result.count('id="'+m.position('shop:a')+'"'),1)
  self.assertIn('href="#'+m.position('shop:a')+'"',result)
 def test_feature_selection_deduplicates_and_balances_characters(self):
  pool={'a':[item(),item('shop:b')],'b':[item(),item('shop:c')]}
  selected=m.select(pool,'バッグ・ポーチ',r'ぬい')
  self.assertEqual([x['code'] for x in selected],['shop:a','shop:c','shop:b'])
  self.assertEqual(m.select(pool,'タオル'),[])
 def test_feature_has_static_images_and_mobile_buttons(self):
  raw=m.feature_page('ぬい活バッグ・ポーチ','内寸を確認してください。',[item()])
  self.assertIn('white-space:nowrap!important',raw)
  self.assertIn('sf-product-position',raw)
  self.assertEqual(len(m.c.extract_existing_cards(raw)),1)
