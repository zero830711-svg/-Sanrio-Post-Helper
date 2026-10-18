import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
c = load('catalog', 'scripts/import-rakuten-character-catalog.py')
r = load('repair', 'scripts/repair-character-catalogs.py')
d = load('directory', 'scripts/build-product-directory.py')

def item(code, title, image=None):
    return dict(code='shop:'+code, title=title, image='https://image.rakuten.co.jp/shop/cabinet/'+(image or code)+'.jpg', affiliate='https://hb.afl.rakuten.co.jp/hgc/12345678/', shop='テスト店', category='文具・シール')

class QualityTests(unittest.TestCase):
    def test_wrong_character_is_excluded_even_when_legacy_card(self):
        products, *_ = c.build_candidate_set([], [item('wrong','はなまるおばけ マスコット'),item('right','KIRIMIちゃん. マスコット')], 'kirimi-chan')
        self.assertEqual([p['code'] for p in products], ['shop:right'])
    def test_jan_and_model_collapse_different_shops(self):
        rows=[item('a','KIRIMIちゃん. ステッカー 4947864052607'),item('b','好評 KIRIMIちゃん. シール 4947864052607'),item('c','KIRIMIちゃん. マスコット 175200'),item('d','サンリオ KIRIMIちゃん. ミニマスコット 175200')]
        products,*_=c.build_candidate_set([],rows,'kirimi-chan')
        self.assertEqual(len(products),2)
    def test_missing_jan_offer_matches_same_series_design(self):
        rows=[item('a','KIRIMIちゃん. まじかる百貨店ステッカー 4947864052607 KIRIMIちゃん.01'),item('b','まじかる百貨店ステッカー KIRIMIちゃん.(1)'),item('c','まじかる百貨店ステッカー KIRIMIちゃん.(2)')]
        products,*_=c.build_candidate_set([],rows,'kirimi-chan')
        self.assertEqual(len(products),2)
    def test_category_comes_from_item_not_search_query(self):
        products,*_=c.build_candidate_set([], [item('a','KIRIMIちゃん. フラガリアメモリーズ マスコット'),item('b','KIRIMIちゃん. ハンカチ')], 'kirimi-chan')
        self.assertEqual({p['category'] for p in products},{'キーホルダー','タオル'})
    def test_low_resolution_is_rejected(self):
        with patch.object(c,'verify_image',return_value=None):
            products,checked,failed,_=c.build_candidate_set([item('a','KIRIMIちゃん. ポーチ')], [], 'kirimi-chan')
        self.assertEqual((len(products),checked,failed),(0,1,1))
    def test_small_cleanup_does_not_keep_bad_cards(self):
        raw=c.section_html('',[item('a','はなまるおばけ マスコット')],[],'KIRIMIちゃん.')
        updated,old,products=r.repair_content(raw,'kirimi-chan')
        self.assertEqual(old,1);self.assertEqual(products,[])
        self.assertNotIn('はなまるおばけ',updated)
    def test_compact_title_labels_and_filters(self):
        self.assertEqual(c.display_title('【最大1000円OFFクーポン！】KIRIMIちゃん. ポーチ'),'KIRIMIちゃん. ポーチ')
        self.assertIn('中古・未使用品',c.item_labels('【中古】KIRIMIちゃん.'))
        section=c.section_html('',[dict(item('a','KIRIMIちゃん. ポーチ'),category='バッグ・ポーチ')],[],'KIRIMIちゃん.')
        self.assertIn('すべて（1件）',section);self.assertIn('バッグ・ポーチ（1件）',section)
        self.assertNotIn('タオル（0件）',section);self.assertIn('repeat(3,minmax(0,1fr))',section)
    def test_existing_plain_guide_links_survive_repeat_refresh(self):
        section='<div><a href="https://sanrio-fan.site/guide/">サイズ情報 →</a></div>'
        guides=c.extract_guide_cards(section)
        self.assertEqual(guides,[('サイズ情報','https://sanrio-fan.site/guide/')])
        next_section=c.section_html('',[],guides,'KIRIMIちゃん.')
        self.assertEqual(c.extract_guide_cards(next_section),guides)
    def test_unrelated_brand_and_substring_book_are_rejected(self):
        self.assertFalse(d.title_mentions_character('マクロミル データ分析の教科書', 'kuromi'))
        self.assertFalse(d.title_mentions_character('ミッフィー タンブラー'))
        self.assertTrue(d.title_mentions_character('クロミの絵本','kuromi'))
        self.assertFalse(c.matches_character('フォトクロミズム','kuromi'))
    def test_directory_routes_and_initial_filter(self):
        controls=d.filter_controls([])
        self.assertIn('character-kirimi-chan/',controls)
        self.assertIn('DOMContentLoaded',controls)
        self.assertIn('params.get("character")',controls)
        self.assertNotIn("&&",controls)
    def test_compaction_is_idempotent_and_keeps_affiliate(self):
        raw='<!-- sf-character-search-page:v1 --><section class="sf-character-search-guide"><a href="https://www.amazon.co.jp/s?k=KIRIMI&amp;tag=test">Amazon</a></section>'
        once=c.compact_page(raw,'KIRIMIちゃん.')
        self.assertEqual(once,c.compact_page(once,'KIRIMIちゃん.'))
        self.assertIn('tag=test',once)

if __name__=='__main__': unittest.main()
