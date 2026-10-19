import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('home',Path(__file__).resolve().parents[1]/'scripts/home-catalog.py');h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
class HomeTests(unittest.TestCase):
 def test_recent_selection_varies_and_preserves_characters(self):
  items=[dict(id=str(i),type='product',image='https://example.com/a.jpg',title='商品',rakuten='https://example.com/',characters=[str(i%4)],kind=['ぬいぐるみ','バッグ・ポーチ','ファッション'][i%3],addedAt='2026-10-20') for i in range(40)]
  items.append(dict(items[0],id='old',addedAt=None))
  index={'items':items};raw='<section id="characters">original order</section><section><h2>新しく掲載したグッズ</h2>old</section>'
  class WP:
   def __init__(self):self.raw=raw
   def call(self,path,data=None):
    if '/pages?' in path:return []
    if data:self.raw=data['content']
    return {'slug':'shopping-home','content':{'raw':self.raw,'rendered':self.raw}}
  wp=WP();h.sync(wp,index);first=wp.raw;h.sync(wp,index)
  self.assertEqual(first,wp.raw);self.assertIn('<section id="characters">original order</section>',wp.raw)
  self.assertEqual(wp.raw.count('class="sf-live-card"'),24);self.assertEqual(wp.raw.count('class="sf-live-page"'),4)
  self.assertNotIn('data-product-id="old"',wp.raw);self.assertEqual(len({x['kind'] for x in h.choose(items)[:6]}),3)
