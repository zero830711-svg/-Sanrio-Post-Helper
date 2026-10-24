import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "scripts"
spec = importlib.util.spec_from_file_location("bilingual_product_discovery", ROOT / "bilingual-product-discovery.py")
discovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(discovery)


class BilingualProductDiscoveryTests(unittest.TestCase):
    def test_character_selection_uses_catalog_coverage_and_existing_order(self):
        keys = list(discovery.c.CHARACTERS)[:4]
        records = (
            [{"character": keys[0]}] * 7
            + [{"character": keys[1]}] * 9
            + [{"character": keys[2]}] * 9
            + [{"character": keys[3]}] * 10
        )
        selected, counts = discovery.choose_pilot_characters(records)
        self.assertEqual(selected, [keys[1], keys[2], keys[3]])
        self.assertEqual(counts, {keys[1]: 9, keys[2]: 9, keys[3]: 10})

    def test_managed_block_is_idempotent_and_preserves_surrounding_content(self):
        raw = "<p>before</p><div>grid</div><p>after</p>"
        once = discovery.managed_block(raw, "<!-- start -->", "<!-- end -->", "<nav>pilot</nav>", "<div>grid</div>")
        twice = discovery.managed_block(once, "<!-- start -->", "<!-- end -->", "<nav>updated</nav>", "<div>grid</div>")
        self.assertEqual(twice.count("<!-- start -->"), 1)
        self.assertEqual(twice.count("<!-- end -->"), 1)
        self.assertIn("<p>before</p>", twice)
        self.assertIn("<nav>updated</nav><!-- end --><div>grid</div>", twice)
        self.assertIn("<p>after</p>", twice)

    def test_product_sampling_round_robins_categories_without_reordering_them(self):
        records = [
            {"code": "a1", "kind": "plush"},
            {"code": "a2", "kind": "plush"},
            {"code": "b1", "kind": "stationery"},
            {"code": "b2", "kind": "stationery"},
        ]
        self.assertEqual(
            [item["code"] for item in discovery.diversified_records(records, 4)],
            ["a1", "b1", "a2", "b2"],
        )

    def test_missing_character_guide_starts_as_a_draft(self):
        self.assertEqual(discovery.managed_page_status(None), "draft")
        self.assertEqual(discovery.managed_page_status({"status": "publish"}), "publish")


if __name__ == "__main__":
    unittest.main()
