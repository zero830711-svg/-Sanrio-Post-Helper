import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "build_character_product_pages",
    ROOT / "scripts" / "build-character-product-pages.py",
)
pages = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pages)


class CharacterPageCleanupTests(unittest.TestCase):
    def test_repeated_marketplace_blocks_are_removed_and_catalog_moves_above_genres(self):
        name = "シナモロール"
        generated = pages.landing_content(name, "cinnamoroll", [])
        curated = (
            '<section><p>CHARACTER GUIDE</p><h2>購入先から探す</h2>'
            '<nav aria-label="通販サイト"><a>Amazonで関連商品を探す</a>'
            '<a>楽天市場で関連商品を探す</a></nav></section>'
            '<h2>ジャンルを選ぶ</h2><p>ぬいぐるみを探す</p>'
        )
        legacy = curated + generated * 5
        cleaned = pages.clean_generated_content(legacy, name)
        product_section = pages.cards_section(name, "cinnamoroll", [])
        updated = pages.insert_product_section_before_genres(cleaned, product_section)

        self.assertEqual(updated.count("Amazonで関連商品を探す"), 1)
        self.assertEqual(updated.count("楽天市場で関連商品を探す"), 1)
        self.assertEqual(updated.count(name + "のサンリオグッズを、商品ガイドと通販検索から探せるページです"), 0)
        self.assertEqual(updated.count("Amazonで" + name + "を探す"), 0)
        self.assertEqual(updated.count("楽天で" + name + "を探す"), 0)
        self.assertEqual(updated.count(pages.MARKER), 1)
        self.assertEqual(updated.count("記事にアフィリエイト広告を含みます。"), 1)
        self.assertLess(updated.index(pages.MARKER), updated.index("<h2>ジャンルを選ぶ</h2>"))

    def test_normalization_is_repeatable(self):
        name = "クロミ"
        page = pages.landing_content(name, "kuromi", []) * 5
        once = pages.clean_generated_content(page, name)
        twice = pages.clean_generated_content(once, name)
        self.assertEqual(twice, once)
        self.assertNotIn("Amazonで" + name + "を探す", twice)
        self.assertNotIn(pages.MARKER, twice)


if __name__ == "__main__":
    unittest.main()
