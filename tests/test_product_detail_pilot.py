import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('detail',Path(__file__).parents[1]/'scripts/product-detail-pilot.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class DetailTests(unittest.TestCase):
 def test_only_labelled_facts_and_no_promotional_tail(self):
  text='【本体サイズ】約12×5×8cm【主な素材・原料】ポリエステル【原産国】中国 ※クーポン対象'
  self.assertEqual(d.specifications(text),{'サイズ':'約12×5×8cm','素材・材質':'ポリエステル','生産国':'中国'})
  self.assertEqual(d.specifications('サイズも素材もかわいい！送料無料・おすすめ'),{})
 def test_html_table_and_uncertain_values(self):
  facts=d.specifications('<table><tr><th>サイズ</th><td>幅10cm</td></tr><tr><th>素材</th><td>ABS樹脂</td></tr></table>')
  self.assertEqual(facts,{'サイズ':'幅10cm','素材・材質':'ABS樹脂'})
  self.assertNotIn('容量',d.specifications('【容量】商品によります'))
 def record(self,code='sanrio:123456'):
  return {'code':code,'url':d.detail_url(code),'title':'シナモロール ミニポーチ','facts':{'サイズ':'約10×8cm','素材・材質':'ポリエステル'},'images':['https://image.rakuten.co.jp/sanrio/a.jpg'],'affiliate':'https://hb.afl.rakuten.co.jp/hgc/12345678/','shop':'公式ショップ','checkedAt':'2026-10-21T00:00:00Z','character':'cinnamoroll','kind':'バッグ・ポーチ'}
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
if __name__=='__main__':unittest.main()
