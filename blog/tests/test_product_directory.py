import importlib.util
import json
import unittest
from pathlib import Path
from urllib import parse

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('directory', ROOT / 'scripts/build-product-directory.py')
directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)
PRODUCTS = directory.load_products()


class Tests(unittest.TestCase):
    def setUp(self):
        self.posts = [{
            'slug': 'goods-jan-' + p['jan'],
            'title': {'rendered': p['title']},
            'link': 'https://sanrio-fan.site/goods-jan-' + p['jan'] + '/',
            'content': {'raw': '<img src="https://sanrio-fan.site/wp-content/uploads/' + p['jan'] + '.jpg">'},
            'status': 'publish',
            'tags': [],
        } for p in PRODUCTS]

    def test_all_cards_keep_images_articles_and_marketplace_buttons(self):
        section = directory.make_section(PRODUCTS, self.posts, {})
        count = len(PRODUCTS)
        self.assertEqual(section.count('class="sf-directory-card"'), count)
        self.assertEqual(section.count('/wp-content/uploads/'), count)
        self.assertEqual(section.count('rel="sponsored nofollow noopener"'), count * 2 + 2)
        self.assertEqual(section.count('Amazonで探す'), count)
        self.assertEqual(section.count('楽天で探す'), count)
        self.assertEqual(section.count('商品情報・仕様を見る'), count)
        self.assertIn('ononbrothers2-22', section)
        self.assertIn('56386226.a6714b12.56386227.a1326022', section)
        self.assertIn('/tag/kuromi/', section)
        self.assertIn('/tag/hangyodon/', section)
        self.assertIn('/tag/little-twin-stars/', section)
        self.assertIn('/tag/kerokerokeroppi/', section)

    def test_directory_filters_search_character_and_product_kind(self):
        section = directory.make_section(PRODUCTS, self.posts, {})
        self.assertIn('data-sf-search', section)
        self.assertIn('data-sf-character', section)
        self.assertIn('data-sf-kind', section)
        self.assertIn('data-sf-reset', section)
        self.assertIn('data-sf-count aria-live="polite"', section)
        self.assertIn('data-sf-empty hidden', section)
        self.assertIn('data-character="hangyodon"', section)
        self.assertIn('data-kind="ice-bags"', section)
        self.assertIn('4973307551598', section)
        self.assertIn('card.hidden=!show', section)
        self.assertIn('addEventListener("input",apply)', section)
        self.assertIn('addEventListener("change",apply)', section)
        self.assertIn('条件をクリア', section)
        self.assertIn('repeat(auto-fit,minmax(150px,1fr))', section)

    def test_official_character_catalog_includes_marketplace_search_for_missing_articles(self):
        controls = directory.filter_controls(PRODUCTS)
        self.assertEqual(len(directory.CHARACTER_CATALOG), 30)
        self.assertEqual(controls.count('data-character-name='), 30)
        for slug, name in [
            ('tuxedo-sam', 'タキシードサム'),
            ('ahiru-no-pekkle', 'あひるのペックル'),
            ('bad-badtz-maru', 'バッドばつ丸'),
            ('cogimyun', 'こぎみゅん'),
        ]:
            self.assertIn('value="' + slug + '"', controls)
            self.assertIn('data-character-name="' + name + '"', controls)
        self.assertIn('data-article-count="0"', controls)
        self.assertIn('data-article-count="2"', controls)
        self.assertIn('data-sf-marketplace', controls)
        self.assertIn('data-sf-amazon', controls)
        self.assertIn('data-sf-rakuten', controls)
        self.assertIn('data-sf-marketplace style="display:none;', controls)
        self.assertIn('marketplace.style.display=character.value?"flex":"none"', controls)
        self.assertIn('楽天でこのキャラを探す', controls)
        self.assertIn('https://shop.sanrio.co.jp/character', controls)

    def test_marketplace_links_use_affiliate_ids_and_exact_search_query(self):
        amazon, rakuten = directory.marketplace_links(PRODUCTS[0])
        amazon_query = parse.parse_qs(parse.urlparse(amazon).query)
        self.assertEqual(amazon_query['tag'], ['ononbrothers2-22'])
        self.assertEqual(amazon_query['k'], [PRODUCTS[0]['query']])
        self.assertIn('56386226.a6714b12.56386227.a1326022', rakuten)
        target = parse.parse_qs(parse.urlparse(rakuten).query)['pc'][0]
        self.assertIn(parse.quote(PRODUCTS[0]['query'], safe=''), parse.urlparse(target).path)

    def test_unexpected_article_domain_is_rejected(self):
        self.posts[0]['link'] = 'https://evil.test/post'
        with self.assertRaises(RuntimeError):
            directory.make_section(PRODUCTS, self.posts, {})

    def test_external_images_are_rejected(self):
        self.posts[0]['content']['raw'] = '<img src="https://evil.test/img.jpg">'
        with self.assertRaises(RuntimeError):
            directory.make_section(PRODUCTS, self.posts, {})

    def test_unknown_character_and_kind_are_data_driven(self):
        product = {
            'character': 'マイスウィートピアノ', 'character_slug': 'my-sweet-piano',
            'kind': 'ポーチ', 'kind_slug': 'pouches',
        }
        self.assertEqual(directory.tag_spec(product),
                         [('マイスウィートピアノ', 'my-sweet-piano'), ('ポーチ', 'pouches')])

    def test_all_product_taxonomy_slugs_are_unique_by_name(self):
        tags = [tag for product in PRODUCTS for tag in directory.tag_spec(product)]
        self.assertEqual(len(tags), 20)
        self.assertEqual(len(set(slug for _, slug in tags)), 19)


if __name__ == '__main__':
    unittest.main()
