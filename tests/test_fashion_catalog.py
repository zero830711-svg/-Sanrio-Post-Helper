import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fashion', Path(__file__).resolve().parents[1] / 'scripts/add-rakuten-fashion.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


def item(n, title='クロミ パーカー'):
    return {'code': 'stylife:item'+str(n), 'title': title+str(n), 'image': 'https://image.rakuten.co.jp/stylife/cabinet/'+str(n)+'.jpg',
            'affiliate': 'https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc=test', 'shop': 'Rakuten Fashion'}


class FashionTests(unittest.TestCase):
    def test_append_filters_duplicates_character_and_bad_image(self):
        old = [item(1)]
        raw = [item(1), item(2), item(3, 'ハローキティ 帽子'), item(4)]
        images = {x['image']: (600,600) for x in raw if x['code'] != 'stylife:item4'}
        added, bad, duplicates = f.additions(raw, old, 'kuromi', 20, images)
        self.assertEqual([x['code'] for x in added], ['stylife:item2'])
        self.assertEqual(added[0]['category'], 'ファッション')
        self.assertEqual((bad, duplicates), (1,1))
        self.assertEqual(len(old), 1)

    def test_incremental_limit(self):
        raw = [item(n) for n in range(30)]
        added, _, _ = f.additions(raw, [], 'kuromi', 5, {x['image']:(600,600) for x in raw})
        self.assertEqual(len(added), 5)

    def test_repair_retains_catalog_above_initial_cap(self):
        old = [item(n) for n in range(110)]
        with patch.object(f.c, 'verify_image', side_effect=AssertionError('Existing photos must not be downloaded')):
            products, _, _, _ = f.c.build_candidate_set([], old, 'kuromi')
        self.assertEqual(len(products), 110)


if __name__ == '__main__':
    unittest.main()
