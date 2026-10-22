import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('detail',Path(__file__).parents[1]/'scripts/product-detail-pilot.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class DetailTests(unittest.TestCase):
 def test_retry_reconciles_write_that_returned_server_error(self):
  class WP:
   content='old';writes=0
   def call(self,path,data=None):
    if data is None:return {'content':{'raw':self.content}}
    self.writes+=1;self.content=data['content']
    raise RuntimeError('WordPress REST returned HTTP 500.')
  wp=WP()
  with patch('time.sleep'):d.update_existing_content(wp,'/wp/v2/pages/1','old','new')
  self.assertEqual(wp.content,'new');self.assertEqual(wp.writes,1)
 def test_retry_does_not_overwrite_concurrent_edit(self):
  class WP:
   def call(self,path,data=None):
    if data is not None:raise AssertionError('Unexpected write')
    return {'content':{'raw':'another edit'}}
  with self.assertRaisesRegex(RuntimeError,'Concurrent catalog edit'):d.update_existing_content(WP(),'/wp/v2/pages/1','old','new')
 def test_only_labelled_facts_and_no_promotional_tail(self):
  text='【本体サイズ】約12×5×8cm【主な素材・原料】ポリエステル【原産国】中国 ※クーポン対象'
  self.assertEqual(d.specifications(text),{'サイズ':'約12×5×8cm','素材・材質':'ポリエステル','生産国':'中国'})
  self.assertEqual(d.specifications('サイズも素材もかわいい！送料無料・おすすめ'),{})
 def test_html_table_and_uncertain_values(self):
  facts=d.specifications('<table><tr><th>サイズ</th><td>幅10cm</td></tr><tr><th>素材</th><td>ABS樹脂</td></tr></table>')
  self.assertEqual(facts,{'サイズ':'幅10cm','素材・材質':'ABS樹脂'})
  self.assertNotIn('容量',d.specifications('【容量】商品によります'))
 def test_combined_labels_and_non_specification_boundaries(self):
  self.assertEqual(d.specifications('【本体サイズ・重量】約12×8×5cm【素材・成分】ポリエステル【備考】送料無料'),{'サイズ':'約12×8×5cm','素材・材質':'ポリエステル'})
  self.assertEqual(d.specifications('容量:500ml 特徴:電子レンジ対応 サイズ(約):幅17.8×奥行11.9×高さ5.5cm セット内容・付属品:2個セット 素材・材質:プラスチック お手入れ:手洗い'),{'容量':'500ml','サイズ':'幅17.8×奥行11.9×高さ5.5cm','セット内容':'2個セット','素材・材質':'プラスチック'})
 def test_actual_sanrio_material_label(self):
  self.assertEqual(d.specifications('本体サイズ:約幅11×奥行5×高さ10cm※チェーン含まず。主な材料・原料:ポリエステル、スチール ケープ着脱可(面ファスナー式開閉)。同シリーズのキーホルダーを付けられる。'),{'サイズ':'約幅11×奥行5×高さ10cm','素材・材質':'ポリエステル、スチール'})
 def record(self,code='sanrio:123456'):
  return {'code':code,'url':d.detail_url(code),'title':'シナモロール ミニポーチ','facts':{'サイズ':'約10×8cm','素材・材質':'ポリエステル'},'images':['https://image.rakuten.co.jp/sanrio/a.jpg'],'affiliate':'https://hb.afl.rakuten.co.jp/hgc/12345678/','shop':'公式ショップ','checkedAt':'2026-10-21T00:00:00Z','character':'cinnamoroll','kind':'バッグ・ポーチ'}
 def test_canonical_must_exist_and_every_canonical_must_match_page_url(self):
  expected='https://sanrio-fan.site/product-abc123/'
  self.assertEqual(d.verify_self_canonical('<link href="'+expected+'" rel="canonical">',expected),1)
  self.assertEqual(d.verify_self_canonical('<link rel="canonical" href="/product-abc123/">',expected),1)
  self.assertEqual(d.verify_self_canonical('<link rel="canonical" href="'+expected+'"><link rel="canonical" href="'+expected+'">',expected),2)
  with self.assertRaisesRegex(RuntimeError,'Missing canonical'):
   d.verify_self_canonical('<title>商品</title>',expected)
  with self.assertRaisesRegex(RuntimeError,'Canonical URL mismatch'):
   d.verify_self_canonical('<link rel="canonical" href="https://sanrio-fan.site/another-page/">',expected)
  with self.assertRaisesRegex(RuntimeError,'Canonical URL mismatch'):
   d.verify_self_canonical('<link rel="canonical" href="'+expected+'"><link rel="canonical" href="https://sanrio-fan.site/another-page/">',expected)
 def test_fixed_url_and_preserved_cards(self):
  x=self.record();raw='<article class="sf-rakuten-product-card" data-code="sanrio:123456" data-title="商品" data-image="image" data-affiliate="original" data-shop="shop"><a href="original">楽天</a></article>'
  new=d.link_cards(raw,[x]);self.assertIn('href="original"',new)
  self.assertEqual(d.c.extract_existing_cards(raw),d.c.extract_existing_cards(new))
  self.assertEqual(d.link_cards(new,[x]),new)
  self.assertEqual(d.link_cards(raw,[]),raw)
  index={'items':[{'id':'rakuten:123','type':'product','url':'old','addedAt':'old-date'},{'id':'rakuten:dan:1','type':'product','url':'old','addedAt':'old-date'}]}
  d.apply_index(index,[dict(x,code='dan:1',url=d.detail_url('dan:1'))])
  self.assertEqual(index['items'][0]['url'],'old');self.assertEqual(index['items'][1]['addedAt'],'old-date')
 def test_retail_duplicates_and_cap(self):
  rows=[]
  for i in range(80):
   x=self.record('sanrio:'+str(i));x['title']='シナモロール 商品'+str(i);x['images']=['https://image.rakuten.co.jp/sanrio/'+str(i)+'.jpg'];rows.append(x)
  rows.append(dict(rows[0],code='another:123'))
  chosen=d.choose(rows);self.assertEqual(len(chosen),40);self.assertEqual(len({x['title'] for x in chosen}),40)
 def test_visible_specs_only_and_no_invented_price_reviews(self):
  x=self.record();out=d.render(x,[x])
  self.assertIn('約10×8cm',out);self.assertIn('ポリエステル',out)
  self.assertNotIn('aggregateRating',out);self.assertNotIn('priceCurrency',out)
  self.assertNotIn('sf-rakuten-product-card',out)
 def test_official_unseparated_sections_and_model_size(self):
  facts=d.specifications('■サイズ【100cm】胸囲:約49-55cm■主な素材、原料本体:綿60%、ポリエステル40%■詳細●モデル着用サイズ:130cm■原産国中国■備考Sanrio Original')
  self.assertIn('100cm',facts['サイズ'])
  self.assertNotIn('130cm',facts['サイズ'])
  self.assertIn('綿60%',facts['素材・材質'])
  self.assertEqual(facts['生産国'],'中国')

 def test_preserve_official_size_exclusion_and_material_spaces(self):
  facts=d.specifications('■サイズ約幅12×奥行8×高さ17cm（※持ち手含まず）■主な素材、原料アクリル、MDF、ステンレス 鋼■詳細●商品説明■原産国中国')
  self.assertEqual(facts['サイズ'],'約幅12×奥行8×高さ17cm(持ち手含まず)')
  self.assertEqual(facts['素材・材質'],'アクリル、MDF、ステンレス 鋼')

 def test_expand_sixty_preserves_existing_and_excludes_duplicate_variants(self):
  import copy
  rows=[]
  for i in range(140):
   x=self.record('sanrio:'+str(i));x['title']='シナモロール 商品'+str(i);x['images']=['https://image.rakuten.co.jp/sanrio/'+str(i)+'.jpg'];rows.append(x)
  existing=rows[:40];before=copy.deepcopy(existing)
  duplicate=dict(rows[0],code='another:123',images=['https://image.rakuten.co.jp/other/a.jpg'])
  additions=d.choose(rows+[duplicate],limit=60,existing=existing)
  self.assertEqual(len(additions),60)
  self.assertEqual(existing,before)
  self.assertFalse({x['code'] for x in additions}&{x['code'] for x in existing})
  self.assertNotIn('another:123',{x['code'] for x in additions})
  self.assertFalse(d.clear_candidate('サンリオ SANRIO マスコット JOCHUM RURU / まめちぃ'))

 def test_duplicate_official_title_hidden_by_shop_keywords(self):
  original=self.record('shop:1');original['title']='ジュエルペット ミニマスコットホルダー サンリオ ぬいぐるみ キーホルダー 4550624175517'
  duplicate=self.record('sanrio:2');duplicate['title']='ジュエルペット ミニマスコットホルダー';duplicate['images']=['https://image.rakuten.co.jp/sanrio/other.jpg']
  self.assertTrue(d.duplicate_with(duplicate,[original]))
  self.assertEqual(d.choose([duplicate],limit=1,existing=[original]),[])

 def test_500_candidate_pool_keeps_existing_and_rejects_ambiguous_titles(self):
  rows=[
   {'id':'rakuten:shop:101','type':'product','title':'シナモロール 500ml ステンレスボトル','image':'https://image.rakuten.co.jp/shop/a.jpg','characters':['cinnamoroll'],'kind':'食器・キッチン'},
   {'id':'rakuten:shop:102','type':'product','title':'シナモロール ぬいぐるみ 全5種から選べる','image':'https://image.rakuten.co.jp/shop/b.jpg','characters':['cinnamoroll'],'kind':'ぬいぐるみ'},
   {'id':'rakuten:shop:103','type':'product','title':'シナモロール クロミ コラボポーチ','image':'https://image.rakuten.co.jp/shop/c.jpg','characters':['cinnamoroll'],'kind':'バッグ・ポーチ'},
   {'id':'rakuten:shop:104','type':'product','title':'シナモロール ミニタオル','image':'https://image.rakuten.co.jp/shop/d.jpg','characters':['cinnamoroll','hello-kitty'],'kind':'タオル'},
  ]
  existing=[self.record('shop:100')]
  pool=d.build_500_candidates({'items':rows},existing)
  self.assertEqual([x['code'] for x in pool],['shop:101'])

 def test_resumable_detail_state_accepts_the_500_page_target(self):
  record=self.record()
  records=[dict(record,code='shop:'+str(i),url=d.detail_url('shop:'+str(i)),pageId=i+1) for i in range(500)]
  class FakeWP:
   def call(self,path):
    import base64,json
    return [{'slug':d.STATE,'id':10,'content':{'raw':'<pre>'+base64.b64encode(json.dumps({'records':records}).encode()).decode()+'</pre>'}}]
  loaded,state_id=d.read_state(FakeWP())
  self.assertEqual(len(loaded),500)
  self.assertEqual(state_id,10)

if __name__=='__main__':unittest.main()

