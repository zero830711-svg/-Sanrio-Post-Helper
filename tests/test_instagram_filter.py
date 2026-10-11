import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).parents[1] / 'server/lolipop/instagram-mobile-worker.py'
spec = importlib.util.spec_from_file_location('filter_worker', path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class SanrioFilterTests(unittest.TestCase):
    def test_multilingual_matches(self):
        for caption in ('クロミのバッグ', '三麗鷗限定系列', '산리오 쿠로미', 'HELLO KITTY collaboration', '#hello_kitty', '#MyMelody'):
            self.assertTrue(worker.is_sanrio_post('gravail', caption))
        self.assertFalse(worker.is_sanrio_post('gravail', '新作ジャケット発売'))
    def test_trusted_source_and_rotation(self):
        self.assertTrue(worker.is_sanrio_post('sanrio_tw', '新商品発売'))
        batches = [worker.collection_batch(i) for i in range(0, len(worker.ACCOUNTS), 5)]
        self.assertTrue(all(len(batch) == 5 for batch in batches))
        self.assertEqual(set(sum(batches, [])), set(worker.ACCOUNTS))
