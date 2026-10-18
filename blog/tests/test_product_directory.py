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
char_spec = importlib.util.spec_from_file_location('character_pages', ROOT / 'scripts/build-character-product-pages.py')
character_pages = importlib.util.module_from_spec(char_spec)
char_spec.loader.exec_module(character_pages)
nav_spec = importlib.util.spec_from_file_location('character_navigation', ROOT / 'scripts/update-character-navigation.py')
nav = importlib.util.module_from_spec(nav_spec)
nav_spec.loader.exec_module(nav)


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

    def test_catalog_cards_work_without_one_wordpress_article_per_product(self):
        product = dict(PRODUCTS[0])
        product['jan'] = '4900000000000'
        product['title'] = '未記事カタログ商品'
        product['name'] = '未記事カタログ商品'
        product['model'] = 'CATALOG-1'
        product['character'] = 'シナモロール'
        product['character_slug'] = 'cinnamoroll'
        product['kind'] = 'ポーチ'
        product['kind_slug'] = 'pouches'
        section = directory.make_section([product], [], {})
        self.assertIn('class="sf-directory-card"', section)
        self.assertIn('未記事カタログ商品', section)
        self.assertIn('♡', section)
        self.assertIn('Amazonで探す', section)
        self.assertIn('楽天で探す', section)
        self.assertIn('型番・JANを手がかりに購入先を探せます', section)
        self.assertNotIn('商品情報・仕様を見る', section)
        self.assertNotIn('goods-jan-4900000000000', section)

    def test_marketplace_ids_support_catalog_items_without_jan(self):
        asin_product = dict(PRODUCTS[0])
        asin_product.pop('jan', None)
        asin_product['asin'] = 'B012345678'
        self.assertEqual(directory.product_key(asin_product), 'amazon-b012345678')
        rakuten_product = dict(PRODUCTS[0])
        rakuten_product.pop('jan', None)
        rakuten_product['itemCode'] = 'shop:item-123'
        self.assertTrue(directory.product_key(rakuten_product).startswith('rakuten-'))
        section = directory.make_section([asin_product], [], {})
        self.assertIn('♡', section)
        self.assertIn('Amazonで探す', section)
        self.assertIn('楽天で探す', section)

    def test_directory_filters_search_character_and_product_kind(self):
        section = directory.make_section(PRODUCTS, self.posts, {})
        self.assertIn('data-sf-search', section)
        self.assertIn('data-sf-character', section)
        self.assertIn('data-sf-kind', section)
        self.assertIn('data-sf-reset', section)
        self.assertIn('data-sf-count aria-live="polite"', section)
        self.assertIn('data-sf-empty hidden', section)
        self.assertIn('data-sf-character-page', section)
        self.assertIn('pageLink.style.display=selected.dataset.characterPageUrl?"inline-flex":"none"', section)
        self.assertIn('data-character="hangyodon"', section)
        self.assertIn('data-kind="ice-bags"', section)
        self.assertIn('4973307551598', section)
        self.assertIn('card.hidden=!show', section)
        self.assertIn('addEventListener("input",apply)', section)
        self.assertIn('addEventListener("change",apply)', section)
        self.assertIn('条件をクリア', section)
        self.assertIn('repeat(auto-fit,minmax(150px,1fr))', section)
        self.assertIn('new URLSearchParams(window.location.search)', section)
        self.assertIn('params.get("character")', section)
        self.assertIn('character.value=initialCharacter', section)
        self.assertIn('if(initialQuery)search.value=initialQuery', section)

    def test_official_character_catalog_includes_marketplace_search_for_missing_articles(self):
        controls = directory.filter_controls(PRODUCTS)
        self.assertEqual(len(directory.CHARACTER_CATALOG), 36)
        self.assertEqual(controls.count('data-character-name='), len(directory.CHARACTER_CATALOG) + len({p['character_slug'] for p in PRODUCTS} - {slug for _, slug in directory.CHARACTER_CATALOG}))
        for slug, name in [
            ('tuxedo-sam', 'タキシードサム'),
            ('ahiru-no-pekkle', 'あひるのペックル'),
            ('bad-badtz-maru', 'バッドばつ丸'),
            ('cogimyun', 'こぎみゅん'),
            ('kirimi-chan', 'KIRIMIちゃん.'),
            ('osaru-no-monkichi', 'おさるのもんきち'),
            ('goropikadon', 'ゴロピカドン'),
            ('jewelpet', 'ジュエルペット'),
            ('minna-no-taabou', 'みんなのたあ坊'),
            ('little-forest-fellow', 'リトルフォレストフェロォ'),
            ('ruroromannic', 'ルロロマニック'),
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
        self.assertEqual(len(tags), len(PRODUCTS) * 2)
        self.assertLessEqual(len(set(slug for _, slug in tags)), len(tags))
        self.assertEqual(len({p['jan'] for p in PRODUCTS}), len(PRODUCTS))
        self.assertGreaterEqual(len(PRODUCTS), 20)

    def test_all_existing_character_pages_are_resolved_from_wordpress_ids(self):
        class FakeWordPress:
            def call(self, path, data=None):
                page_id = int(path.split("/pages/")[1].split("?")[0])
                return {"id": page_id, "slug": "verified-page-" + str(page_id)}, None

        urls = directory.character_page_urls(FakeWordPress())
        expected = {
            "pochacco": 800, "kuromi": 797, "my-melody": 798, "cinnamoroll": 796,
            "hello-kitty": 801, "pompompurin": 799, "hangyodon": 802,
            "little-twin-stars": 803,
        }
        for slug, page_id in expected.items():
            self.assertEqual(urls[slug], "https://sanrio-fan.site/verified-page-" + str(page_id) + "/")
        controls = directory.filter_controls(PRODUCTS, urls)
        for slug, page_id in expected.items():
            self.assertIn('value="' + slug + '"', controls)
            self.assertIn('data-character-page-url="https://sanrio-fan.site/verified-page-' + str(page_id) + '/">', controls)
        for slug in directory.CHARACTER_GUIDE_SLUGS:
            self.assertIn('data-character-page-url="https://sanrio-fan.site/' + directory.CHARACTER_GUIDE_SLUGS[slug] + '/">', controls)

    def test_character_directory_routes_guided_characters_and_fills_catalog_gap(self):
        names = [name for name, _ in directory.CHARACTER_CATALOG]
        raw = '<div class="sf-character-grid">' + ''.join(
            '<a class="sf-char" href="/goods/?q=old">' + name + '</a>' for name in names
        ) + '<a class="sf-char" href="/goods/?q=old">チアリステイルズ</a></div>'
        guides = {
            slug: 'https://sanrio-fan.site/' + directory.CHARACTER_GUIDE_SLUGS.get(slug, slug + '-guide') + '/'
            for slug in (
                'cinnamoroll', 'kuromi', 'my-melody', 'pompompurin', 'pochacco',
                'hello-kitty', 'hangyodon', 'little-twin-stars', *directory.CHARACTER_GUIDE_SLUGS.keys()
            )
        }
        updated, count = nav.update_directory(raw, guides)
        self.assertEqual(count, 36)
        self.assertNotIn('チアリステイルズ', updated)
        self.assertIn('href="/goods/?character=kirimi-chan"', updated)
        self.assertIn('href="https://sanrio-fan.site/cinnamoroll-guide/"', updated)
        for slug, page_slug in [
            ('kerokerokeroppi', 'kerokerokeroppi-goods'),
            ('gudetama', 'gudetama-goods'),
            ('wish-me-mell', 'wish-me-mell-goods'),
            ('my-sweet-piano', 'my-sweet-piano-goods'),
            ('jochum', 'jochum-goods'),
        ]:
            self.assertIn('href="https://sanrio-fan.site/' + page_slug + '/"', updated)
        self.assertIn('href="/goods/?character=hanamaru-obake"', updated)

    def test_homepage_features_thirteen_direct_character_guides(self):
        names = ['シナモロール', 'クロミ', 'マイメロディ', 'ポムポムプリン',
                 'ポチャッコ', 'ハローキティ', 'ハンギョドン', 'リトルツインスターズ']
        raw = '<section><div class="sf-chars">' + ''.join(
            '<a class="sf-char" href="/old/' + str(i) + '/" style="--char:#eee"><span class="sf-dot"></span>' + name + '</a>'
            for i, name in enumerate(names)
        ) + '</div></section>'
        guides = {slug: 'https://sanrio-fan.site/' + slug + '-guide/' for _, slug in directory.CHARACTER_CATALOG}
        updated, count = nav.update_home(raw, guides)
        self.assertEqual(count, 13)
        self.assertEqual(updated.count('class="sf-char"'), 13)
        for name, slug, _ in nav.HOME_ADDITIONS:
            self.assertIn('href="https://sanrio-fan.site/' + slug + '-guide/"', updated)
        self.assertIn('href="https://sanrio-fan.site/cinnamoroll-guide/"', updated)

    def test_new_character_landing_pages_have_affiliate_search_and_product_cards(self):
        targets = [
            ("タキシードサム", "tuxedo-sam", "tuxedo-sam-goods"),
            ("あひるのペックル", "ahiru-no-pekkle", "ahiru-no-pekkle-goods"),
            ("バッドばつ丸", "bad-badtz-maru", "bad-badtz-maru-goods"),
            ("こぎみゅん", "cogimyun", "cogimyun-goods"),
            ("ウサハナ", "usahana", "usahana-goods"),
        ]
        for name, slug, page_slug in targets:
            with self.subTest(slug=slug):
                product = next(p for p in PRODUCTS if p["character_slug"] == slug)
                post = next(p for p in self.posts if p["slug"] == "goods-jan-" + product["jan"])
                content = character_pages.landing_content(name, slug, [post])
                self.assertIn(character_pages.MARKER, content)
                self.assertIn(character_pages.END, content)
                self.assertIn(name + "の商品", content)
                self.assertIn("仕様・Amazon・楽天の購入先を見る", content)
                self.assertIn("Amazonで" + name + "を探す", content)
                self.assertIn("楽天で" + name + "を探す", content)
                self.assertIn("/goods/", content)
                self.assertIn("ononbrothers2-22", content)
                self.assertIn("56386226.a6714b12.56386227.a1326022", content)
                self.assertEqual(character_pages.NEW_PAGE_SLUGS[slug], page_slug)

    def test_character_page_slug_collision_requires_identity_match(self):
        self.assertTrue(character_pages.page_identity(
            {"slug": "usahana-goods", "title": {"rendered": "ウサハナのグッズ・通販ガイド"}, "content": {"raw": ""}},
            "ウサハナ", "usahana"
        ))
        self.assertFalse(character_pages.page_identity(
            {"slug": "usahana-goods", "title": {"rendered": "別ページ"}, "content": {"raw": "別内容"}},
            "ウサハナ", "usahana"
        ))


if __name__ == '__main__':
    unittest.main()
