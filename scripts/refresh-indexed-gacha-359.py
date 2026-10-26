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
DATA = ROOT / 'blog/seo-refresh-359'
BACKUP = ROOT / 'article-359-backup'
POST = '/wp/v2/posts/359'
URL = 'https://sanrio-fan.site/sanrio-gashapon-2026-10/'
SLUG = 'sanrio-gashapon-2026-10'
EXPECTED_MODIFIED = '2026-10-25T11:51:00'
EXCERPT = '2026年10月第4週のサンリオガシャポン2種を画像付きで比較。実写版ミニチュアチャーム400円・フリルマスコット300円の全5種、対象年齢、出荷予定と設置場所の確認方法をまとめました。'
spec = importlib.util.spec_from_file_location('editorial', ROOT / 'scripts/publish-editorial-article.py')
editorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editorial)

def validate_identity(post):
    if post['id'] != 359 or post['slug'] != SLUG or post['link'] != URL or post['status'] != 'publish':
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
    e = json.loads((DATA / 'evidence.json').read_text())
    for key in ('miniature', 'frill'):
        p = e['images'][key]
        if not p['image'].startswith('https://image.rakuten.co.jp/geexcollection/cabinet/s/'):
            raise RuntimeError('Unexpected image source.')
        if not p['affiliate'].startswith('https://hb.afl.rakuten.co.jp/hgc/'):
            raise RuntimeError('Unexpected affiliate target.')
        esc = html.escape
        width, height = (700, 700) if key == 'miniature' else (668, 636)
        figure = ('<figure class="wp-block-image size-large"><a href="' + esc(p['affiliate'], quote=True)
            + '" rel="sponsored noopener"><img src="' + esc(p['image'], quote=True)
            + '" alt="' + esc(p['source_product_name'] + ' 全5種セットの楽天市場掲載商品画像', quote=True)
            + f'" width="{width}" height="{height}" loading="lazy" decoding="async" style="max-width:100%;height:auto"/></a>'
            + '<figcaption>画像：楽天市場・GEEX COLLECTIONの商品情報（楽天API経由）。画像内は5種セットです。店頭の1回分とは販売単位が異なります。</figcaption></figure>'
            + '<p><a href="' + esc(p['affiliate'], quote=True)
            + '" rel="sponsored noopener">楽天市場でセット内容・価格・発送時期を確認する</a>（広告）</p>')
        doc = doc.replace('{{' + key + '_figure}}', figure)
    credit = ('<p>商品画像は楽天APIから取得した掲載情報を使用しています。</p>'
        '<!-- Rakuten Web Services Attribution Snippet FROM HERE -->'
        '<a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noopener"><img src="https://webservice.rakuten.co.jp/img/credit/200709/credit_22121.gif" alt="Rakuten Web Service Center" title="Rakuten Web Service Center" width="221" height="21"/></a>'
        '<!-- Rakuten Web Services Attribution Snippet TO HERE -->')
    doc = doc.replace('{{rakuten_credit}}', credit)
    if '{{' in doc or '<h1' in doc or len(doc) < 6000:
        raise RuntimeError('Article template is incomplete.')
    return doc

def apply(wp):
    before = json.loads((BACKUP / 'before.json').read_text())
    current = wp.call(POST + '?context=edit')
    validate_identity(current)
    if current['modified_gmt'] != before['modified_gmt'] or current['content']['raw'] != before['content']['raw']:
        raise RuntimeError('Article changed after backup; refusing to overwrite.')
    doc = content()
    media = editorial.upload_media(wp, 'sanrio-gashapon-202610-editorial-cover-v1',
        'sanrio-gashapon-202610-editorial-cover-v1.jpg',
        'ピンクと紫の空カプセルとノートを並べたカプセルトイのAI生成イメージ。紹介商品の写真ではありません。',
        base64.b64encode((DATA / 'capsule-cover.jpg').read_bytes()).decode())
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
    assert '初回発売後も複数回出荷する予定' in page
    for key in ('miniature', 'frill'):
        image = json.loads((DATA / 'evidence.json').read_text())['images'][key]['image']
        assert image in page
        image_response = request.urlopen(image, timeout=30)
        assert image_response.status == 200 and image_response.headers.get('Content-Type', '').startswith('image/')
    assert media['source_url'] in page
    robots = re.findall(r'<meta\b[^>]*name=["\']robots["\'][^>]*>', page, re.I)
    assert not any('noindex' in tag.lower() for tag in robots)
    canonicals = re.findall(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', page, re.I)
    assert any(URL in tag for tag in canonicals)
    print('UPDATED AND VERIFIED:', after['id'], URL)
    print('Preserved URL, publication date, title, categories, tags, author; verified exact content, cover, two product images, canonical and no noindex.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'apply', 'validate'])
    args = parser.parse_args()
    if args.mode == 'validate':
        print('VALIDATED:', len(content()), 'characters')
    else:
        wp = editorial.WordPress()
        prepare(wp) if args.mode == 'prepare' else apply(wp)
