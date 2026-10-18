"""Publish reviewed products using only the standard WordPress REST API."""
import argparse
import base64
import html
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

SITE = 'https://sanrio-fan.site'
ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Redirect refused; check the configured URL.')


def plain(value):
    if isinstance(value, dict):
        value = value.get('raw', value.get('rendered', ''))
    return html.unescape(re.sub('<[^>]*>', '', str(value)))


def duplicates(product, posts):
    hits = []
    for post in posts:
        title = plain(post.get('title', ''))
        content = html.unescape(str(post.get('content', {}).get('raw', '')))
        text = title + '\n' + content
        jan_match = re.search(r'(?<!\d)' + re.escape(product['jan']) + r'(?!\d)', text)
        if (jan_match or post.get('slug') == 'goods-jan-' + product['jan']
                or product['source'] in content or title == product['title']
                or (product.get('model') and product.get('character')
                    and product['model'] in text and product['character'] in text)):
            hits.append(post)
    return hits


class WordPress:
    def __init__(self):
        user = os.environ.get('SANRIO_WP_USER', '')
        password = os.environ.get('SANRIO_WP_APP_PASSWORD', '')
        if not user or not password:
            raise RuntimeError('Set SANRIO_WP_USER and SANRIO_WP_APP_PASSWORD in GitHub Actions secrets.')
        self.auth = 'Basic ' + base64.b64encode((user + ':' + password).encode()).decode()
        self.opener = request.build_opener(NoRedirect)

    def call(self, path, data=None, binary=None, headers=None):
        if not path.startswith('/wp/v2/'):
            raise ValueError('Only standard WordPress REST routes are allowed.')
        body = binary if binary is not None else (json.dumps(data).encode() if data is not None else None)
        req = request.Request(SITE + '/wp-json' + path, data=body, headers={
            'Authorization': self.auth, 'User-Agent': 'SanrioBlogPublisher/1.0',
            **({'Content-Type': 'application/json'} if data is not None else {}), **(headers or {})})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response), response.headers
        except error.HTTPError as exc:
            # Never print request headers, credential values, or server response bodies.
            raise RuntimeError(f'WordPress returned HTTP {exc.code}. Check account permissions and application password.') from None

    def posts(self):
        posts, page = [], 1
        while True:
            query = parse.urlencode({'context': 'edit', 'status': 'publish,draft,pending,future,private,trash',
                                     'per_page': 100, 'page': page, '_fields': 'id,slug,status,title,content,featured_media,link'})
            rows, headers = self.call('/wp/v2/posts?' + query)
            posts.extend(rows)
            if page >= int(headers.get('X-WP-TotalPages', '1')):
                return posts
            page += 1

    def image(self, product):
        slug = 'sanrio-' + product['jan']
        existing, _ = self.call('/wp/v2/media?' + parse.urlencode({'slug': slug, '_fields': 'id,source_url'}))
        if existing:
            return existing[0]
        url = product['image']
        parts = parse.urlsplit(url)
        skater_image = parts.hostname == 'www.skater-onlineshop.com' and parts.path.startswith('/img/goods/')
        official_yahoo_image = parts.hostname == 'shopping.c.yimg.jp' and parts.path.startswith('/lib/skater-koshiki/')
        if (parts.scheme != 'https' or not (skater_image or official_yahoo_image)
                or parts.username or parts.password or parts.port or parts.query):
            raise RuntimeError('The product image must come from Skater or Skater official Yahoo! Shop.')
        with request.build_opener(NoRedirect).open(url, timeout=30) as response:
            image = response.read(8 * 1024 * 1024 + 1)
        if len(image) > 8 * 1024 * 1024:
            raise RuntimeError('Image exceeds 8 MB.')
        if image.startswith(b'\xff\xd8\xff'):
            mime, extension = 'image/jpeg', 'jpg'
        elif image.startswith(b'\x89PNG\r\n\x1a\n'):
            mime, extension = 'image/png', 'png'
        else:
            raise RuntimeError('Expected a JPEG or PNG product image.')
        media, _ = self.call('/wp/v2/media', binary=image, headers={
            'Content-Type': mime, 'Content-Disposition': f'attachment; filename="{slug}.{extension}"'})
        self.call('/wp/v2/media/' + str(media['id']), data={'slug': slug, 'alt_text': product['character'] + ' ' + product['name']})
        return media


def run(mode, wp, products):
    wp.call('/wp/v2/users/me?context=edit&_fields=id')
    posts = wp.posts()
    categories, _ = wp.call('/wp/v2/categories?slug=shopping-products&_fields=id')
    if not categories:
        raise RuntimeError('The shopping-products category was not found.')
    for product in products:
        hits = duplicates(product, posts)
        slug = 'goods-jan-' + product['jan']
        # Resume only a single draft with our canonical slug; never overwrite other articles.
        draft = hits[0] if len(hits) == 1 and hits[0]['status'] == 'draft' and hits[0]['slug'] == slug else None
        if hits and not draft:
            print('SKIP existing:', product['jan'], ','.join(str(p['id']) for p in hits))
            continue
        if mode == 'check':
            print('READY:', product['jan'], 'resume draft' if draft else 'new article')
            continue
        media = wp.image(product)
        body = {'title': product['title'], 'slug': slug, 'status': 'draft',
                'content': product['content'].replace(product['image'], media['source_url']),
                'excerpt': product['intro'], 'categories': [categories[0]['id']], 'featured_media': media['id']}
        path = '/wp/v2/posts' + ('/' + str(draft['id']) if draft else '')
        saved, _ = wp.call(path, data=body)
        # Verify draft and featured image before any publication.
        verified, _ = wp.call('/wp/v2/posts/' + str(saved['id']) + '?context=edit')
        if (verified['status'] != 'draft' or verified['featured_media'] != media['id']
                or product['jan'] not in verified['content']['raw']):
            raise RuntimeError('Saved article did not pass verification; left unpublished.')
        if mode == 'publish':
            saved, _ = wp.call('/wp/v2/posts/' + str(saved['id']), data={'status': 'publish'})
            public, _ = wp.call('/wp/v2/posts/' + str(saved['id']) + '?_fields=id,status,featured_media')
            if public['status'] != 'publish' or public['featured_media'] != media['id']:
                raise RuntimeError('Published article verification failed.')
        print(mode.upper() + ':', saved['id'], saved['link'])
        posts.append(verified) if not draft else posts.__setitem__(posts.index(draft), verified)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['check', 'draft', 'publish'], default='check')
    args = parser.parse_args()
    try:
        products = []
        for path in sorted((ROOT / 'blog').glob('products-*.json')):
            products.extend(json.loads(path.read_text()))
        run(args.mode, WordPress(), products)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        # Network exception strings can contain URLs, so show a bounded operational message.
        print(str(exc) if isinstance(exc, RuntimeError) else 'Operation failed; inspect configuration and product data.', file=sys.stderr)
        sys.exit(1)
