import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]/'scripts'
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
c=load('catalog','import-rakuten-character-catalog.py')
r=load('titles','refresh-catalog-display-titles.py')
class DisplayTitleTests(unittest.TestCase):
 def test_promotions_removed_but_specs_and_collaboration_kept(self):
  title='【最大1000円OFFクーポン！】シナモロール×ピングー 保冷マグ STWM3N 350mL 送料無料 ポイント5倍'
  cleaned=c.display_title(title)
  for value in ['シナモロール×ピングー','STWM3N','350mL']:self.assertIn(value,cleaned)
  for value in ['1000円','クーポン','送料無料','ポイント5倍']:self.assertNotIn(value,cleaned)
 def test_sale_dates_removed_but_release_and_size_labels_kept(self):
  self.assertEqual(c.display_title('[9月28日〜10月20日 P20倍]クロミ ポーチ [10cm]【予約 12月発売】'),'クロミ ポーチ [10cm]【予約 12月発売】')
 def test_brand_and_real_product_text_survive(self):
  for title in ['OFF WHITE ハローキティ Tシャツ S/M','SALEWA クロミ ポーチ','【マロンクリーム×組曲 KIDS】メッセージTシャツ 110cm','ポイント柄 ハローキティ ノート']:
   self.assertEqual(c.display_title(title),title)
 def test_promotion_in_spec_bracket_does_not_delete_spec(self):
  self.assertIn('350ml',c.display_title('【送料無料 350ml】クロミ 水筒'))
 def test_visible_change_preserves_source_urls_anchor_order_and_identity(self):
  item={'code':'shop:one','title':'【50%OFF】クロミ ポーチ 10cm 送料無料','image':'https://image.rakuten.co.jp/shop/cabinet/a.jpg','affiliate':'https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc=one','shop':'店','category':'バッグ・ポーチ'}
  raw=c.photo_card(item).replace('<article ','<article id="sf-product-1234567890123456" ',1)
  raw=raw.replace('<strong ', '<strong ',1).replace('クロミ ポーチ 10cm</strong>','古い表示</strong>')
  updated,changes=r.visible_titles(raw)
  self.assertTrue(changes)
  self.assertEqual(c.extract_existing_cards(updated),c.extract_existing_cards(raw))
  self.assertIn('クロミ ポーチ 10cm</strong>',updated)
  self.assertIn('sf-product-1234567890123456',updated)
  self.assertEqual(c.identity_keys(item),{*c.identity_keys(dict(item))})
 def test_source_identity_uses_legacy_normalization(self):
  item={'code':'shop:a','title':'クロミ ポーチ ポイント5倍','image':'https://image.rakuten.co.jp/shop/cabinet/a.jpg'}
  self.assertIn('name:'+c.canonical_text(c.identity_title(item['title'])),c.identity_keys(item))
  self.assertNotEqual(c.display_title(item['title']),c.identity_title(item['title']))
if __name__=='__main__':unittest.main()
