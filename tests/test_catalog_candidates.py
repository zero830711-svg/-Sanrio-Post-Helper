import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'build-product-directory.py'
SPEC = importlib.util.spec_from_file_location('product_directory', SCRIPT)
DIRECTORY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIRECTORY)


class CatalogCandidateTests(unittest.TestCase):
    def setUp(self):
        self.now = int(time.time())
        self.base = [
            {
                'jan': '4901234567894',
                'character': 'ハローキティ',
                'character_slug': 'hello-kitty',
                'kind': '文具・シール',
                'kind_slug': 'stationery-stickers',
                'name': 'Reviewed item',
            },
            {
                'rakuten_item_code': 'shop:already',
                'character': 'クロミ',
                'character_slug': 'kuromi',
                'kind': 'サンリオグッズ',
                'kind_slug': 'sanrio-goods',
                'name': 'Already listed',
            },
        ]

    def merge(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidates.json'
            path.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
            return DIRECTORY.merge_rakuten_candidates([dict(row) for row in self.base], str(path))

    def test_rakuten_candidates_are_classified_and_deduplicated(self):
        rows = [
            {'code': 'shop:new', 'title': 'シナモロール バッグ ポーチ', 'service': 'market', 'sourceAt': self.now},
            {'code': 'books:9784065439555', 'title': 'ハローキティの絵本', 'service': 'books', 'sourceAt': self.now},
            {'code': 'shop:already', 'title': '重複 クロミ ポーチ', 'service': 'market', 'sourceAt': self.now},
            {'code': 'shop:stale', 'title': '期限切れ商品', 'service': 'market', 'sourceAt': self.now - 15 * 86400},
            {'code': 'shop:travel', 'title': '旅行商品', 'service': 'travel', 'sourceAt': self.now},
        ]
        result = self.merge(rows)
        additions = result[len(self.base):]
        self.assertEqual(len(additions), 2)
        self.assertEqual(additions[0]['character_slug'], 'cinnamoroll')
        self.assertEqual(additions[0]['kind_slug'], 'bags-pouches')
        self.assertEqual(additions[1]['character_slug'], 'hello-kitty')
        self.assertEqual(additions[1]['kind_slug'], 'books-calendar')
        self.assertTrue(all(row['catalog_candidate'] for row in additions))
        self.assertTrue(all('price' not in row and 'url' not in row for row in additions))

    def test_amazon_candidates_are_marked_as_catalog_only(self):
        row = {
            'asin': 'B012345678',
            'title': 'クロミ ぬいぐるみ',
            'query': 'クロミ ぬいぐるみ',
            'url': 'https://www.amazon.co.jp/dp/B012345678',
            'fetchedAt': self.now,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'amazon.json'
            path.write_text(json.dumps([row], ensure_ascii=False), encoding='utf-8')
            result = DIRECTORY.merge_amazon_candidates([dict(self.base[0])], str(path))
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1]['character_slug'], 'kuromi')
        self.assertTrue(result[1]['catalog_candidate'])


if __name__ == '__main__':
    unittest.main()
