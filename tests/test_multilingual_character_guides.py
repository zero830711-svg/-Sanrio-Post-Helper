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

    def test_character_batch_has_verified_profiles_for_seven_characters(self):
        expected = ("mymelody", "hellokitty", "hanamaru-obake", "cinnamoroll", "kuromi", "pompompurin", "pochacco")
        self.assertEqual(guides.CHARACTER_BATCH, expected)
        self.assertEqual(set(guides.PROFILES), set(expected))
        self.assertEqual(set(guides.SOURCE_PAGES), set(expected))
        self.assertEqual(set(guides.CHARACTER_NAMES), set(expected))

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
