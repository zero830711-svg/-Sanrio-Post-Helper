"""Apply the reviewed content updates to posts 359 and 330 only."""
import importlib.util
import json
from pathlib import Path


def apply(wp, payload):
    if {p['id'] for p in payload['posts']} != {359, 330}:
        raise RuntimeError('Unexpected article IDs.')
    prepared = []
    for article in payload['posts']:
        path = '/wp/v2/posts/' + str(article['id'])
        current = wp.call(path + '?context=edit')
        if current['slug'] != article['slug'] or current['status'] != 'publish':
            raise RuntimeError('Article identity changed.')
        fields = {key: article[key] for key in ('title', 'content', 'excerpt')}
        if all(current[key]['raw'] == value for key, value in fields.items()):
            continue
        if current['modified_gmt'] != article['expected_modified_gmt'] or '<img' in current['content']['raw']:
            raise RuntimeError('Article changed since review; refusing to overwrite.')
        prepared.append((path, current, fields))
    for path, current, fields in prepared:
        latest = wp.call(path + '?context=edit')
        if latest['modified_gmt'] != current['modified_gmt'] or latest['content']['raw'] != current['content']['raw']:
            raise RuntimeError('Article changed during preparation.')
        wp.call(path, data=fields)
        saved = wp.call(path + '?context=edit')
        if (any(saved[k]['raw'] != v for k, v in fields.items())
                or saved['slug'] != current['slug'] or saved['status'] != 'publish'
                or saved['featured_media'] != current['featured_media']):
            raise RuntimeError('Saved article failed verification.')
        print('VERIFIED', saved['link'])


if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('publisher', 'scripts/publish-editorial-article.py')
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    apply(publisher.WordPress(), json.loads(Path('blog/site-updates/gacha-search-review.json').read_text()))

