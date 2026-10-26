"""Publish exactly one standalone guide via standard WordPress REST API."""
import importlib.util
from pathlib import Path
from urllib import parse, request
import re

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('editorial', ROOT / 'scripts/publish-editorial-article.py')
editorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editorial)
SLUG = 'sanrio-gacha-not-found-guide'
TITLE = 'サンリオのガチャが見つからない？検索に出ない・発売月にないときの確認方法'
EXCERPT = 'サンリオのガチャが見つからないときの確認手順。メーカー別の公式検索、検索結果0件、発売月と入荷日、再販・再入荷の違い、通販の単品・全種セットの見分け方を整理します。'

def main():
    content = (ROOT / 'blog/gacha-not-found-guide.html').read_text(encoding='utf-8')
    assert len(content) > 5000 and content.count('<h2>') >= 8
    assert '<h1' not in content and '<script' not in content
    wp = editorial.WordPress()
    wp.call('/wp/v2/users/me?context=edit&_fields=id')
    query = parse.urlencode({'slug': SLUG, 'context': 'edit'})
    existing = wp.call('/wp/v2/pages?' + query)
    if existing:
        if len(existing) != 1 or existing[0]['content']['raw'] != content or existing[0]['status'] != 'publish':
            raise RuntimeError('Existing page differs; refusing an unreviewed overwrite.')
        page = existing[0]
        print('ALREADY PUBLISHED:', page['link'])
    else:
        page = wp.call('/wp/v2/pages', data={
            'slug': SLUG, 'title': TITLE, 'content': content,
            'excerpt': EXCERPT, 'status': 'publish', 'parent': 0,
            'comment_status': 'closed', 'ping_status': 'closed',
        })
    saved = wp.call('/wp/v2/pages/' + str(page['id']) + '?context=edit')
    assert saved['status'] == 'publish' and saved['slug'] == SLUG
    assert saved['content']['raw'] == content
    assert saved['title']['raw'] == TITLE
    assert saved['parent'] == 0
    html = request.urlopen(saved['link'], timeout=45).read().decode('utf-8')
    assert TITLE in html and 'メーカーごとに公式の検索先' in html
    robots = re.findall(r'<meta\b[^>]*name=["\']robots["\'][^>]*>', html, re.I)
    assert not any('noindex' in tag.lower() for tag in robots), robots
    canonicals = re.findall(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', html, re.I)
    assert any(saved['link'] in tag for tag in canonicals), canonicals
    home = request.urlopen('https://sanrio-fan.site/', timeout=45).read().decode('utf-8')
    assert SLUG not in home, 'Guide unexpectedly appears on the homepage.'
    print('PUBLISHED AND VERIFIED:', saved['id'], saved['link'])
    print('Verified: exact content, public HTTP 200, canonical, no noindex, absent from homepage.')

if __name__ == '__main__':
    main()
