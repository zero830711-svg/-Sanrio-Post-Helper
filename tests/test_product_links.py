import importlib.util
from pathlib import Path
import unittest
from html.parser import HTMLParser
ROOT = Path(__file__).resolve().parents[1] / 'scripts'
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
class LinkTests(unittest.TestCase):
    def test_static_links_stay_outside_existing_cards_and_are_idempotent(self):
        m = load('links', 'strengthen-product-links.py')
        rows = [dict(url='https://sanrio-fan.site/product-1234567890abcdef/', title='商品 & サイズ', images=['https://example.com/photo.jpg'])]
        original = '<section><article>original card</article></section>'
        markup = m.section(rows, 'クロミ')
        updated = m.replace_section(original, markup)
        self.assertTrue(updated.startswith(original))
        self.assertEqual(updated, m.replace_section(updated, markup))
        self.assertIn('href="'+rows[0]['url']+'"', updated)
        self.assertNotIn('<article>original card'+m.START, updated)
    def test_home_detail_photo_and_title_keep_purchase_button(self):
        h = load('links_home', 'home-catalog.py')
        url = 'https://sanrio-fan.site/product-1234567890abcdef/'
        items = [dict(id=str(i), type='product', image='https://example.com/a.jpg', title='商品'+str(i), rakuten='https://example.com/buy', characters=['kuromi'], kind='ぬいぐるみ', addedAt='2026-10-22', url=url if i == 0 else '/goods/#product-'+str(i)) for i in range(6)]
        raw = h.render({'items':items})
        self.assertEqual(raw.count('href="'+url+'"'), 2)
        self.assertEqual(raw.count('class="sf-live-buy"'), 6)
        self.assertIn('data-save-url="https://sanrio-fan.site/goods/?', raw)
