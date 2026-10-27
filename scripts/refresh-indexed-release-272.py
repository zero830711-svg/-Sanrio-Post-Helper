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
DATA = ROOT / 'blog/seo-refresh-272'
BACKUP = ROOT / 'article-272-backup'
POST = '/wp/v2/posts/272'
URL = 'https://sanrio-fan.site/%e3%82%b5%e3%83%b3%e3%83%aa%e3%82%aa%e6%96%b0%e5%95%86%e5%93%81%e3%81%af%e3%81%84%e3%81%a4%e7%99%ba%e5%a3%b2%ef%bc%9f%e5%85%ac%e5%bc%8f%e3%83%9a%e3%83%bc%e3%82%b8%e3%81%a7%e7%99%ba%e5%a3%b2%e6%97%a5/'
SLUG = '%e3%82%b5%e3%83%b3%e3%83%aa%e3%82%aa%e6%96%b0%e5%95%86%e5%93%81%e3%81%af%e3%81%84%e3%81%a4%e7%99%ba%e5%a3%b2%ef%bc%9f%e5%85%ac%e5%bc%8f%e3%83%9a%e3%83%bc%e3%82%b8%e3%81%a7%e7%99%ba%e5%a3%b2%e6%97%a5'
EXPECTED_MODIFIED = '2026-09-23T13:18:44'
EXCERPT = 'サンリオ新商品はいつ発売？2026年10月からの木曜日中心への変更、オリジナルとライセンス、店頭・通販の発売日、商品ページ公開と販売開始の違いを公式情報から解説します。'
spec = importlib.util.spec_from_file_location('editorial', ROOT / 'scripts/publish-editorial-article.py')
editorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editorial)

def validate_identity(post):
    if post['id'] != 272 or post['slug'] != SLUG or post['link'] != URL or post['status'] != 'publish':
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
    media = editorial.upload_media(wp, 'sanrio-new-goods-release-check-v1',
        'sanrio-new-goods-release-check-v1.jpg',
        'サンリオ新商品の公式紹介、店頭と通販、ページ公開と発売開始を分けて確認する当サイト作成の説明図。',
        base64.b64encode((DATA / 'new-goods-release-check.jpg').read_bytes()).decode())
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
    assert '保存用：発売日確認メモ' in page
    assert '木曜日を中心とした発売日に変更' in page
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
