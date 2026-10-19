import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('unified', Path(__file__).resolve().parents[1] / 'scripts/unify-product-search.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)


class UnifiedSearchTests(unittest.TestCase):
    def test_shared_offer_has_both_character_memberships(self):
        chars = {'cinnamoroll':(1,'cinna','シナモロール'),'kuromi':(2,'kuromi','クロミ')}
        card = {'code':'shop:shared','title':'シナモロール クロミ ポーチ','image':'https://image.rakuten.co.jp/shop/cabinet/shared.jpg',
                'affiliate':'https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc=test','shop':'店','category':'バッグ・ポーチ'}
        raw = u.c.photo_card(card)
        pages = [{'id':pid,'slug':slug,'content':{'raw':raw}} for pid,slug,name in chars.values()]
        with patch.object(u.c,'CHARACTERS',chars):
            data = u.build_index(pages,[])
        self.assertEqual(len(data['items']),1)
        self.assertEqual(data['items'][0]['characters'],['cinnamoroll','kuromi'])
        self.assertEqual(data['photoMemberships'],{'cinnamoroll':1,'kuromi':1})

    def test_guide_migration_preserves_article_and_affiliate_links(self):
        raw = '<article class="sf-directory-card" data-character="cinnamoroll" data-kind="bags" data-search="シナモロール JAN123"><a href="https://sanrio-fan.site/guide/"><img src="https://sanrio-fan.site/wp-content/uploads/a.jpg"><strong>ポーチの使い方</strong></a><a href="https://www.amazon.co.jp/s?k=test&amp;tag=tag">Amazonで探す</a><a href="https://hb.afl.rakuten.co.jp/hgc/test/">楽天で探す</a></article>'
        guide = u.existing_guides(raw)[0]
        self.assertEqual(guide['type'],'guide')
        self.assertEqual(guide['url'],'https://sanrio-fan.site/guide/')
        self.assertIn('&tag=tag',guide['amazon'])
        self.assertIn('JAN123',guide['search'])

    def test_repeat_refresh_keeps_guides_but_replaces_photo_index(self):
        guide={'id':'guide:a','type':'guide','title':'記事'}
        raw='<script type="application/json" id="'+u.DATA_ID+'">'+u.safe_json({'items':[guide,{'id':'rakuten:a','type':'product'}]})+'</script>'
        self.assertEqual(u.existing_guides(raw),[guide])

    def test_script_data_survives_html_and_ampersands(self):
        value={'title':'A&B </script><img src=x>'}
        encoded=u.safe_json(value)
        self.assertNotIn('</script>',encoded)
        self.assertNotIn('&',encoded)
        self.assertEqual(json.loads(encoded),value)

    def test_client_uses_all_memberships_and_safe_dom_rendering(self):
        script=(u.ROOT/'unified-product-search.js').read_text()
        self.assertIn('item.characters.indexOf(character.value)',script)
        self.assertNotIn('innerHTML',script)
        self.assertNotIn('&&',script)
        self.assertIn("item.type==='guide'?'商品ガイド'",script)


if __name__=='__main__':
    unittest.main()
