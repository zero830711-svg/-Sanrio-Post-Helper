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

class ManagedBatchTests(unittest.TestCase):
    def test_favorites_and_stopped_accounts(self):
        rows=[{'account':str(i),'enabled':i!=9,'favorite':i<3} for i in range(10)]
        self.assertEqual(worker.managed_batch(rows,0,0)[:2], ['0','1'])
        self.assertEqual(worker.managed_batch(rows,3,2)[:2], ['2','0'])
        checked=set(sum([worker.managed_batch(rows,i*3,i*2) for i in range(30)], []))
        self.assertEqual(checked, set(str(i) for i in range(9)))
        self.assertEqual(worker.managed_batch([],0,0), [])

class RequestedBatchTests(unittest.TestCase):
    def test_only_selected_enabled_account(self):
        rows=[{'account':'marimocraft','enabled':True},{'account':'sunstar_now','enabled':True},{'account':'stopped','enabled':False}]
        self.assertEqual(worker.requested_batch(rows,'sunstar_now'),['sunstar_now'])
        for account in ('stopped','unknown','all','../session',None):
            with self.assertRaises(ValueError):
                worker.requested_batch(rows,account)

class MultiplePostTests(unittest.TestCase):
    def post(self, code, date, caption='クロミのバッグ', kind=1):
        from types import SimpleNamespace
        return SimpleNamespace(code=code,taken_at=date,caption_text=caption,media_type=kind)
    def test_three_new_matching_posts_only(self):
        posts=[self.post('old',9),self.post('unrelated',8,'洋服'),self.post('video',7,kind=2)]+[self.post(str(i),i) for i in range(6)]
        chosen=worker.selected_posts('gravail',posts,[{'shortcode':'old'}])
        self.assertEqual([p.code for p in chosen],['5','4','3'])
    def test_refresh_existing_when_no_new(self):
        posts=[self.post('old',9)]
        self.assertEqual([p.code for p in worker.selected_posts('gravail',posts,[{'shortcode':'old'}])],['old'])
        self.assertEqual(worker.selected_posts('gravail',[self.post('x',1,'洋服')],[]),[])
