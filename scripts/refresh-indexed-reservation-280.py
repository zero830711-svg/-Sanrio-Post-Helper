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
DATA = ROOT / 'blog/seo-refresh-280'
BACKUP = ROOT / 'article-280-backup'
POST = '/wp/v2/posts/280'
URL = 'https://sanrio-fan.site/%e3%82%b5%e3%83%b3%e3%83%aa%e3%82%aa%e3%82%aa%e3%83%b3%e3%83%a9%e3%82%a4%e3%83%b3%e3%82%b7%e3%83%a7%e3%83%83%e3%83%97%e3%81%ae%e4%ba%88%e7%b4%84%e5%95%86%e5%93%81%e3%81%af%e3%81%84%e3%81%a4%e5%b1%8a/'
SLUG = '%e3%82%b5%e3%83%b3%e3%83%aa%e3%82%aa%e3%82%aa%e3%83%b3%e3%83%a9%e3%82%a4%e3%83%b3%e3%82%b7%e3%83%a7%e3%83%83%e3%83%97%e3%81%ae%e4%ba%88%e7%b4%84%e5%95%86%e5%93%81%e3%81%af%e3%81%84%e3%81%a4%e5%b1%8a'
EXPECTED_MODIFIED = '2026-10-08T13:40:30'
EXCERPT = 'サンリオオンラインショップ本店の予約商品はいつ届く？発送予定と到着日の違い、注文履歴・メールの確認手順、同梱・日時指定、届かない場合の確認先を公式情報から整理します。'
spec = importlib.util.spec_from_file_location('editorial', ROOT / 'scripts/publish-editorial-article.py')
editorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editorial)

def validate_identity(post):
    if post['id'] != 280 or post['slug'] != SLUG or post['link'] != URL or post['status'] != 'publish':
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
    media = editorial.upload_media(wp, 'sanrio-preorder-delivery-cover-v1',
        'sanrio-preorder-delivery-cover-v1.jpg',
        '荷物・カレンダー・スマートフォンを並べた予約商品の配送確認のAI生成イメージ。公式の梱包や注文画面ではありません。',
        base64.b64encode((DATA / 'preorder-delivery-cover.jpg').read_bytes()).decode())
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
    assert '発送前・発送後で分ける' in page
    assert '予定を過ぎても届かない' in page
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
