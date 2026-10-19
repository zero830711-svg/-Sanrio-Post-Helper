import importlib.util
import json
import base64
import gzip
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('unified', Path(__file__).resolve().parents[1] / 'scripts/unify-product-search.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)


class UnifiedSearchTests(unittest.TestCase):
    def test_legacy_guide_refresh_writes_unified_page_once_and_keeps_history(self):
        chars={'cinnamoroll':(1,'cinna','シナモロール')}
        item={'code':'shop:a','title':'シナモロール ポーチ','image':'https://image.rakuten.co.jp/shop/cabinet/a.jpg',
              'affiliate':'https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc=test','shop':'店','category':'バッグ・ポーチ'}
        pages=[{'id':1,'slug':'cinna','content':{'raw':u.c.photo_card(item)}}]
        with patch.object(u.c,'CHARACTERS',chars):
            previous=u.build_index(pages,[])
            u.retain_first_seen(previous,None)
            previous['firstSeenHistory']['rakuten:shop:a']='2026-10-18T00:00:00+00:00'
            previous['items'][0]['addedAt']='2026-10-18T00:00:00+00:00'
            raw=u.render(previous)
            class FakeWP:
                def __init__(self):self.raw=raw;self.writes=[]
                def call(self,path,data=None):
                    if '/pages?' in path:return pages
                    if data is not None:self.raw=data['content'];self.writes.append(self.raw)
                    return {'id':804,'slug':'goods','content':{'raw':self.raw,'rendered':self.raw}}
            wp=FakeWP()
            guide='<article class="sf-directory-card" data-character="cinnamoroll" data-kind="bags"><a href="https://sanrio-fan.site/new-guide/"><strong>ポーチの仕様</strong></a></article>'
            saved=u.sync(wp,previous_index=previous,guide_source=guide)
        self.assertEqual(len(wp.writes),1)
        self.assertIn(u.DATA_ID,wp.writes[0])
        self.assertEqual(saved['firstSeenHistory']['rakuten:shop:a'],'2026-10-18T00:00:00+00:00')
        self.assertTrue(next(x for x in saved['items'] if x['type']=='guide')['addedAt'])

    def test_old_dates_stay_unknown_and_only_new_items_get_dates(self):
        previous={'items':[{'id':'old','type':'product'}]}
        data={'items':[{'id':'old'},{'id':'new'}]}
        u.retain_first_seen(data,previous,now='2026-10-20T00:00:00+00:00')
        self.assertIsNone(data['items'][0]['addedAt'])
        self.assertEqual(data['items'][1]['addedAt'],'2026-10-20T00:00:00+00:00')
        refreshed={'items':[{'id':'new'},{'id':'old'}]}
        u.retain_first_seen(refreshed,data,now='2026-10-21T00:00:00+00:00')
        self.assertEqual(refreshed['items'][0]['addedAt'],'2026-10-20T00:00:00+00:00')
        absent={'items':[]}
        u.retain_first_seen(absent,refreshed)
        returning={'items':[{'id':'new'}]}
        u.retain_first_seen(returning,absent,now='2026-11-01T00:00:00+00:00')
        self.assertEqual(returning['items'][0]['addedAt'],'2026-10-20T00:00:00+00:00')

    def test_first_population_does_not_invent_dates(self):
        data=u.retain_first_seen({'items':[{'id':'a'}]},None)
        self.assertIsNone(data['items'][0]['addedAt'])

    def test_amazon_query_prefers_valid_jan_and_model(self):
        self.assertEqual(u.queries.amazon_query('サンリオ クロミ ポーチ JAN 4901234567894'),'4901234567894')
        self.assertEqual(u.queries.amazon_query('スケーター シナモロール 保冷ストローマグ STWM3N 350ml'),'スケーター シナモロール STWM3N')
        self.assertEqual(u.queries.amazon_query('サンリオ マイメロディ ジェットストリーム 982164'),'サンリオ マイメロディ 982164')
        self.assertNotEqual(u.queries.amazon_query('クロミ ポーチ 4901234567890'),'4901234567890')

    def test_amazon_fallback_removes_promotions_and_keeps_brand_product(self):
        result=u.queries.amazon_query('【SALE／50%OFF】FREAK’S STORE SANRIO マイメロディ マスコットホルダー ファッション雑貨 その他のファッション雑貨 【送料無料】')
        self.assertIn('FREAK',result)
        self.assertIn('マイメロディ マスコットホルダー',result)
        self.assertNotIn('SALE',result)
        self.assertNotIn('送料無料',result)
        self.assertNotIn('ファッション雑貨',result)

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
        compressed=base64.b64encode(gzip.compress(encoded.encode())).decode()
        raw='<script type="application/octet-stream" data-encoding="gzip-base64" id="'+u.DATA_ID+'">'+compressed+'</script>'
        self.assertEqual(u.read_index(raw),value)

    def test_client_uses_all_memberships_and_safe_dom_rendering(self):
        script=(u.ROOT/'unified-product-search.js').read_text()
        self.assertIn('item.characters.indexOf(character.value)',script)
        self.assertNotIn('innerHTML',script)
        self.assertNotIn('&&',script)
        self.assertIn("item.type==='guide'?'商品ガイド'",script)


if __name__=='__main__':
    unittest.main()
