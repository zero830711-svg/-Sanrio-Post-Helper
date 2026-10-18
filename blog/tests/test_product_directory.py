import importlib.util
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('directory',ROOT/'scripts/build-product-directory.py')
directory=importlib.util.module_from_spec(spec);spec.loader.exec_module(directory)
PRODUCTS=json.loads((ROOT/'blog/products-2026-10-18.json').read_text())
for p in PRODUCTS:
    p['kind']={'4973307730078':'ボトルケース','4973307729553':'ミラー','4973307730160':'ランチバッグ','4973307643958':'保冷剤','4973307250705':'ストローホッパーキャップ'}[p['jan']]

class Tests(unittest.TestCase):
    def setUp(self):
        self.posts=[{'slug':'goods-jan-'+p['jan'],'title':{'rendered':p['title']},'link':'https://sanrio-fan.site/goods-jan-'+p['jan']+'/',
           'content':{'raw':'<img src="https://sanrio-fan.site/wp-content/uploads/'+p['jan']+'.jpg">'},'status':'publish','tags':[]}
           for p in PRODUCTS]

    def test_five_cards_keep_local_images_and_product_links(self):
        section=directory.make_section(PRODUCTS,self.posts,{})
        self.assertEqual(section.count('class="sf-directory-card"'),5)
        self.assertEqual(section.count('/wp-content/uploads/'),5)
        self.assertIn('クロミ',section);self.assertIn('/tag/kuromi/',section)
        self.assertIn('/tag/lunch-bags/',section)

    def test_unexpected_article_domain_is_rejected(self):
        self.posts[0]['link']='https://evil.test/post'
        with self.assertRaises(RuntimeError): directory.make_section(PRODUCTS,self.posts,{})

    def test_external_images_are_rejected(self):
        self.posts[0]['content']['raw']='<img src="https://evil.test/img.jpg">'
        with self.assertRaises(RuntimeError): directory.make_section(PRODUCTS,self.posts,{})

    def test_taxonomy_is_complete_and_deduplicated(self):
        tags=[tag for p in PRODUCTS for tag in directory.tag_spec(p)]
        self.assertEqual(len(set(slug for _,slug in tags)),10)

if __name__=='__main__': unittest.main()
