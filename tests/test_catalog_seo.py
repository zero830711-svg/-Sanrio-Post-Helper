import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('seo',Path(__file__).resolve().parents[1]/'scripts/catalog-seo.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class SEOTests(unittest.TestCase):
 def test_managed_intro_idempotent_and_retains_photos(self):
  original='<div class="sf-hero"><h1>シナモロール</h1></div>'+m.c.START+'photo cards unchanged'+m.c.END
  block=m.MARK+'<p>ジャンルから探す</p>'+m.END
  updated=m.replace_block(original,block)
  self.assertIn(m.c.START+'photo cards unchanged'+m.c.END,updated)
  self.assertEqual(m.replace_block(updated,block),updated)
 def test_misplaced_block_is_relocated_outside_card(self):
  block=m.MARK+'<section>ジャンル紹介</section>'+m.END
  raw='<div class="grid"><article><div class="sf-hero">image</div>'+block+'<p>product</p></article></div>'
  fixed=m.replace_block(raw,block)
  self.assertTrue(fixed.endswith(block))
  self.assertEqual(fixed,'<div class="grid"><article><div class="sf-hero">image</div><p>product</p></article></div>'+block)
  self.assertEqual(m.replace_block(fixed,block),fixed)
 def test_landing_is_crawlable_and_affiliate_links_preserved(self):
  item=dict(code='shop:a',title='シナモロール ポーチ',category='バッグ・ポーチ',image='https://image.rakuten.co.jp/a.jpg',affiliate='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678/?pc=test',shop='店')
  content=m.landing('シナモロール','cinnamoroll','bags',[item]*10,[('ぬいぐるみ','https://sanrio-fan.site/cinnamoroll-plush-goods/')])
  self.assertIn('シナモロール ポーチ',content);self.assertIn('シナモロールのバッグ・ポーチ',content);self.assertIn('href="https://sanrio-fan.site/cinnamoroll-plush-goods/"',content);self.assertEqual(content.count('data-code='),10)
 def test_descriptions_do_not_use_css_or_scripts(self):
  p=m.seo_payload(m.describe('クロミ'));self.assertEqual(p['excerpt'],p['aioseo_meta_data']['description']);self.assertNotIn('<',p['excerpt']);self.assertIn('クロミ',p['excerpt'])
