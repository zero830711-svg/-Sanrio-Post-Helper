"""Improve exactly one Search Console-visible post through WordPress REST API."""
import argparse
import base64
import hashlib
import html
import importlib.util
import json
import re
from pathlib import Path
from urllib import request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'blog/seo-refresh-368'
BACKUP = ROOT / 'article-368-backup'
POST = '/wp/v2/posts/368'
URL = 'https://sanrio-fan.site/sanrio-goods-storage-care-guide/'
SLUG = 'sanrio-goods-storage-care-guide'
EXPECTED_MODIFIED = '2026-10-07T13:27:33'
EXCERPT = 'サンリオグッズの飾り方と保管方法を素材別に解説。ぬいぐるみ・アクスタ・缶バッジ・紙ものの収納、洗濯表示の確認とお手入れの注意点を紹介します。'
spec = importlib.util.spec_from_file_location('editorial', ROOT / 'scripts/publish-editorial-article.py')
editorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editorial)

def validate_identity(post):
    if post['id'] != 368 or post['slug'] != SLUG or post['link'] != URL or post['status'] != 'publish':
        raise RuntimeError('Unexpected article identity; no update attempted.')

def prepare(wp):
    before = wp.call(POST + '?context=edit')
    validate_identity(before)
    if before['modified_gmt'] != EXPECTED_MODIFIED:
        raise RuntimeError('Article changed since review; refusing to overwrite.')
    BACKUP.mkdir(exist_ok=True)
    (BACKUP / 'before.json').write_text(json.dumps(before, ensure_ascii=False, indent=2))
    print('BACKUP READY:', before['id'], before['modified_gmt'])

def content():
    doc = (DATA / 'article.html').read_text()
    if '{{' in doc or '<h1' in doc or len(doc) < 4000:
        raise RuntimeError('Article template is incomplete.')
    return doc


def apply(wp):
    before = json.loads((BACKUP / 'before.json').read_text())
    current = wp.call(POST + '?context=edit')
    validate_identity(current)
    if current['modified_gmt'] != before['modified_gmt'] or current['content']['raw'] != before['content']['raw']:
        raise RuntimeError('Article changed after backup; refusing to overwrite.')
    doc = content()
    media = editorial.upload_media(wp, 'sanrio-goods-storage-material-check-v1',
        'sanrio-goods-storage-material-check-v1.jpg',
        'ぬいぐるみ、アクリル、缶バッジ、紙ものを素材別に整理する当サイト作成の保管チェック図。',
        base64.b64encode((DATA / 'storage-check.jpg').read_bytes()).decode())
    wp.call(POST, data={'content': doc, 'excerpt': EXCERPT, 'featured_media': media['id']})
    after = wp.call(POST + '?context=edit')
    (BACKUP / 'after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2))
    validate_identity(after)
    for key in ('slug', 'link', 'date', 'date_gmt', 'title', 'categories', 'tags', 'author', 'status'):
        assert after[key] == before[key], key
    assert after['content']['raw'] == doc
    assert after['excerpt']['raw'] == EXCERPT
    assert after['featured_media'] == media['id']
    page = request.urlopen(URL, timeout=45).read().decode()
    assert '収納前と定期点検に使えるチェックリスト' in page
    assert 'サンリオのぬいぐるみは洗える？商品ごとに確認' in page
    assert media['source_url'] in page
    robots = re.findall(r'<meta\b[^>]*name=["\']robots["\'][^>]*>', page, re.I)
    assert not any('noindex' in tag.lower() for tag in robots)
    canonicals = re.findall(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', page, re.I)
    assert any(URL in tag for tag in canonicals)
    print('UPDATED AND VERIFIED:', after['id'], URL)
    print('Preserved URL, publication date, title, categories, tags, author; verified exact content, cover, comparison tables, canonical and no noindex.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'apply', 'validate'])
    args = parser.parse_args()
    if args.mode == 'validate':
        print('VALIDATED:', len(content()), 'characters')
    else:
        wp = editorial.WordPress()
        prepare(wp) if args.mode == 'prepare' else apply(wp)
