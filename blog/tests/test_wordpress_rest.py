import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('publisher', ROOT / 'scripts/publish-sanrio-products.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
PRODUCTS = json.loads((ROOT / 'blog/products-2026-10-18.json').read_text())


class FakeWP:
    def __init__(self, posts, verify=True):
        self.saved = None
        self.initial = posts
        self.writes = []
        self.verify = verify

    def posts(self):
        return self.initial.copy()

    def image(self, product):
        return {'id': 99, 'source_url': 'https://sanrio-fan.site/local.jpg'}

    def call(self, path, data=None):
        if data:
            self.writes.append((path, data.copy()))
            if 'content' in data:
                self.saved = {**data, 'id': 830, 'link': 'https://sanrio-fan.site/product/', 'content': {'raw': data['content']}}
            else:
                self.saved.update(data)
            return self.saved.copy(), {}
        if '/categories?' in path:
            return [{'id': 188}], {}
        if '/users/me?' in path:
            return {'id': 1}, {}
        post = self.saved.copy()
        if not self.verify:
            post['featured_media'] = 0
        return post, {}


class Tests(unittest.TestCase):
    def test_duplicate_checks_identifier_not_substring(self):
        p = PRODUCTS[0]
        self.assertTrue(publisher.duplicates(p, [{'content': {'raw': 'JAN: ' + p['jan']}}]))
        self.assertFalse(publisher.duplicates(p, [{'content': {'raw': '9' + p['jan'] + '9'}}]))

    def test_check_does_not_write(self):
        wp = FakeWP([])
        publisher.run('check', wp, PRODUCTS[:1])
        self.assertEqual(wp.writes, [])

    def test_resumes_canonical_draft_and_then_publishes(self):
        p = PRODUCTS[0]
        wp = FakeWP([{'id': 830, 'slug': 'goods-jan-' + p['jan'], 'status': 'draft', 'content': {'raw': p['jan']}}])
        publisher.run('publish', wp, [p])
        self.assertEqual(wp.writes[0][0], '/wp/v2/posts/830')
        self.assertEqual(wp.writes[0][1]['status'], 'draft')
        self.assertEqual(wp.writes[-1][1], {'status': 'publish'})

    def test_never_overwrites_published_duplicate(self):
        p = PRODUCTS[0]
        wp = FakeWP([{'id': 7, 'slug': 'old', 'status': 'publish', 'content': {'raw': p['jan']}}])
        publisher.run('publish', wp, [p])
        self.assertEqual(wp.writes, [])

    def test_failed_image_verification_never_publishes(self):
        wp = FakeWP([], verify=False)
        with self.assertRaises(RuntimeError):
            publisher.run('publish', wp, PRODUCTS[:1])
        self.assertTrue(all(x[1].get('status') != 'publish' for x in wp.writes))


if __name__ == '__main__':
    unittest.main()
