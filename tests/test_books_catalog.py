import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('books',Path(__file__).parents[1]/'scripts/books-catalog.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BooksTests(unittest.TestCase):
 def row(self,**extra):
  return dict(title='シナモロール 絵本',booksGenreId='001003',isbn='9781234567897',itemUrl='https://books.rakuten.co.jp/rb/123/',affiliateUrl='https://hb.afl.rakuten.co.jp/hgc/ownid/?pc=test',largeImageUrl='https://thumbnail.image.rakuten.co.jp/@0_mall/book/a.jpg',availability='1',**extra)
 def test_relevance_and_source(self):
  x=b.normalize(self.row());self.assertIn('cinnamoroll',x['characters'])
  row=self.row();row['title']='無関係な本';self.assertIsNone(b.normalize(row))
  row=self.row();row['booksGenreId']='006';self.assertIsNone(b.normalize(row))
  row=self.row();row['affiliateUrl']='https://example.com/';self.assertIsNone(b.normalize(row))
 def test_home_and_character_content_preserved(self):
  raw='<section>existing goods</section><!-- sf-home-live-catalog:end --><p>footer</p>'
  markup=b.START+'<section>books</section>'+b.END
  updated=b.replace_shelf(raw,markup,True)
  self.assertEqual(updated.replace(markup,''),raw)
  self.assertEqual(b.replace_shelf(updated,markup,True),updated)
  self.assertEqual(b.replace_shelf(raw,markup).removesuffix('\n'+markup),raw)
 def test_namespaced_cards_and_release_date(self):
  x=b.normalize(self.row(salesDate='2026年11月01日'))
  x['availability']='5';card=b.card(x)
  self.assertIn('予約受付中',card);self.assertIn('発売日：2026年11月01日',card)
  self.assertNotIn('sf-rakuten-product-card',card)
  self.assertIn('楽天ブックスで見る',card)
 def test_placeholder_is_not_a_product_photo(self):
  self.assertFalse(b.image_ok({'image':'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/noimage_01.gif?_ex=200x200'}))
if __name__=='__main__':unittest.main()
