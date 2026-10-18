import importlib.util
import json
import unittest
from pathlib import Path
from urllib import parse

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

    def test_five_cards_keep_images_articles_and_marketplace_buttons(self):
        section=directory.make_section(PRODUCTS,self.posts,{})
        self.assertEqual(section.count('class="sf-directory-card"'),5)
        self.assertEqual(section.count('/wp-content/uploads/'),5)
        self.assertEqual(section.count('rel="sponsored nofollow noopener"'),10)
        self.assertEqual(section.count('Amazonで探す'),5)
        self.assertEqual(section.count('楽天で探す'),5)
        self.assertEqual(section.count('商品情報・仕様を見る'),5)
        self.assertIn('ononbrothers2-22',section)
        self.assertIn('56386226.a6714b12.56386227.a1326022',section)
        self.assertIn('/tag/kuromi/',section)
        self.assertIn('/tag/lunch-bags/',section)

    def test_marketplace_links_use_affiliate_ids_and_exact_search_query(self):
        amazon, rakuten=directory.marketplace_links(PRODUCTS[0])
        amazon_query=parse.parse_qs(parse.urlparse(amazon).query)
        self.assertEqual(amazon_query['tag'],['ononbrothers2-22'])
        self.assertEqual(amazon_query['k'],[PRODUCTS[0]['query']])
        self.assertIn('56386226.a6714b12.56386227.a1326022',rakuten)
        target=parse.parse_qs(parse.urlparse(rakuten).query)['pc'][0]
        self.assertIn(parse.quote(PRODUCTS[0]['query'],safe=''),parse.urlparse(target).path)

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
