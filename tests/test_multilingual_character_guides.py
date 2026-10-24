import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "scripts"
spec = importlib.util.spec_from_file_location("multilingual_character_guides", ROOT / "multilingual-character-guides.py")
guides = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guides)


class MultilingualCharacterGuideTests(unittest.TestCase):
    def test_language_routes_and_codes_are_stable(self):
        self.assertEqual([x["slug"] for x in guides.LANGUAGES], ["zh-hans", "zh-hant", "ko", "es"])
        self.assertEqual([x["lang"] for x in guides.LANGUAGES], ["zh-Hans", "zh-Hant", "ko", "es"])
        self.assertEqual(guides.locale_guide_url("zh-hans", "mymelody"), guides.SITE + "/zh-hans/mymelody/")

    def test_character_batch_has_profiles_and_sources_for_all_36_characters(self):
        self.assertEqual(len(guides.CHARACTER_BATCH), 36)
        self.assertEqual(guides.CHARACTER_BATCH[:7], ("mymelody", "hellokitty", "hanamaru-obake", "cinnamoroll", "kuromi", "pompompurin", "pochacco"))
        expected = set(guides.c.CHARACTERS)
        self.assertEqual(set(guides.CHARACTER_BATCH), expected)
        self.assertEqual(set(guides.PROFILES), expected)
        self.assertEqual(set(guides.SOURCE_PAGES), expected)
        self.assertEqual(set(guides.CHARACTER_NAMES), expected)
        self.assertTrue(all(set(names) == {"zh-hans", "zh-hant", "ko", "es"} for names in guides.CHARACTER_NAMES.values()))

    def test_profile_summaries_do_not_use_names_that_need_token_protection(self):
        names = ("マイメロディ", "ハローキティ", "はなまるおばけ", "シナモロール", "クロミ", "ポムポムプリン", "ポチャッコ")
        for profile in guides.PROFILES.values():
            self.assertFalse(any(name in profile["summary"] for name in names))

    def test_managed_block_updates_in_place_and_rejects_duplicates(self):
        raw = "<p>before</p><p>after</p>"
        once = guides.managed_block(raw, "<!-- a -->", "<!-- b -->", "<nav>one</nav>")
        twice = guides.managed_block(once, "<!-- a -->", "<!-- b -->", "<nav>two</nav>")
        self.assertEqual(twice.count("<!-- a -->"), 1)
        self.assertIn("<nav>two</nav>", twice)
        with self.assertRaises(RuntimeError):
            guides.managed_block("<!-- a --><!-- a --><!-- b -->", "<!-- a -->", "<!-- b -->", "x")

    def test_rendered_language_guide_links_to_products_and_all_languages(self):
        language = guides.LANGUAGES[0]
        item = {"code": "sample", "title": "商品名", "images": ["https://example.invalid/item.jpg"], "character": "mymelody"}
        entry = {"titleEn": "My Melody Item", "pageSlug": "sample-item"}
        translations = {x: "translated " + x for x in guides.COMMON_TEXT}
        translations[guides.PROFILES["mymelody"]["summary"]] = "profile text"
        for fact in guides.PROFILES["mymelody"]["facts"]:
            translations[fact] = "fact " + fact
        translations["商品名"] = "localized item"
        markup = guides.render_guide("mymelody", language, translations, {"mymelody": [item]}, {"sample": entry})
        self.assertIn('lang="zh-Hans"', markup)
        self.assertIn(guides.locale_guide_url("ko", "mymelody"), markup)
        self.assertIn("https://sanrio-fan.site/en/product-details/sample-item/", markup)
        self.assertIn("My Melody Item", markup)
        self.assertIn("https://sanrio-fan.site/en/characters/", markup)

    def test_rendered_index_and_guide_support_characters_without_product_details(self):
        language = guides.LANGUAGES[0]
        translations = {x: "translated " + x for x in guides.COMMON_TEXT}
        translations[guides.PROFILES["tuxedo-sam"]["summary"]] = "profile text"
        for fact in guides.PROFILES["tuxedo-sam"]["facts"]:
            translations[fact] = "fact " + fact
        selected = {key: [] for key in guides.CHARACTER_BATCH}
        index = guides.render_index(language, translations, selected)
        self.assertTrue(all(guides.locale_guide_url("zh-hans", key) in index for key in guides.CHARACTER_BATCH))
        guide = guides.render_guide("tuxedo-sam", language, translations, selected, {})
        self.assertIn("translated 現在、掲載中の商品詳細ページはありません。", guide)
        self.assertNotIn('<div class="sf-multi-grid"></div>', guide)
        self.assertIn("https://www.sanrio.co.jp/characters/tuxedosam/", guide)
        self.assertIn("/en/characters/", guide)
        self.assertNotIn('href="/en/characters/tuxedo-sam/"', guide)

    def test_product_sampling_round_robins_kinds(self):
        records = [
            {"code": "a1", "kind": "plush"},
            {"code": "a2", "kind": "plush"},
            {"code": "b1", "kind": "stationery"},
            {"code": "b2", "kind": "stationery"},
        ]
        self.assertEqual(
            [item["code"] for item in guides.diversified_records(records, 4)],
            ["a1", "b1", "a2", "b2"],
        )

    def test_rendered_index_keeps_three_columns(self):
        language = guides.LANGUAGES[0]
        translations = {x: "translated" for x in guides.COMMON_TEXT}
        selected = {key: [{"images": ["https://example.invalid/a.jpg"]}] for key in guides.CHARACTER_BATCH}
        markup = guides.render_index(language, translations, selected)
        self.assertIn("repeat(3,minmax(0,1fr))", markup)
        self.assertEqual(markup.count('class="sf-multi-grid"'), 1)


if __name__ == "__main__":
    unittest.main()
