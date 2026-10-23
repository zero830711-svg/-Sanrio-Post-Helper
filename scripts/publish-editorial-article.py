"""Publish one prepared editorial article through the standard WordPress REST API."""
import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path
from urllib import error, parse, request

SITE = 'https://sanrio-fan.site'


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Redirect refused; check the configured URL.')


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
            'Authorization': self.auth,
            'User-Agent': 'SanrioEditorialPublisher/1.0',
            **({'Content-Type': 'application/json'} if data is not None else {}),
            **(headers or {}),
        })
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError(f'WordPress returned HTTP {exc.code}. Check account permissions and application password.') from None



def upload_media(wp, slug, filename, alt_text, encoded_image):
    rows = wp.call('/wp/v2/media?' + parse.urlencode({'slug': slug, '_fields': 'id,source_url'}))
    if rows:
        media = rows[0]
        wp.call('/wp/v2/media/' + str(media['id']), data={'alt_text': alt_text})
        return media
    try:
        image_bytes = base64.b64decode(encoded_image, validate=True)
    except (ValueError, TypeError):
        raise RuntimeError('An uploaded image is invalid.') from None
    if not image_bytes.startswith(b'\xff\xd8\xff'):
        raise RuntimeError('An uploaded image must be a JPEG.')
    if len(image_bytes) > 4 * 1024 * 1024:
        raise RuntimeError('An uploaded image exceeds 4 MB.')
    media = wp.call('/wp/v2/media', binary=image_bytes, headers={
        'Content-Type': 'image/jpeg',
        'Content-Disposition': f'attachment; filename="{filename}"',
    })
    wp.call('/wp/v2/media/' + str(media['id']), data={'slug': slug, 'alt_text': alt_text})
    return media


def replace_existing_media(article, wp, existing):
    if article['slug'] != 'toptoy-sanrio-spinning-hot-spring' or existing[0]['status'] != 'publish':
        raise RuntimeError('Refusing to replace media outside the published TOPTOY article.')
    post_path = '/wp/v2/posts/' + str(existing[0]['id'])
    media_specs = [article] + article.get('gallery_images', [])
    if len(media_specs) < 2 or len(media_specs) > 20:
        raise RuntimeError('Expected between one and nineteen article photos plus a cover photo.')
    media_rows = []
    for index, spec in enumerate(media_specs):
        suffix = 'toptoy-photo-cover' if index == 0 else f'toptoy-photo-{index}'
        media_rows.append(upload_media(
            wp, article['slug'] + '-' + suffix, spec['image_filename'],
            spec['alt_text'], spec['image_base64']))
    content = article['content']
    for index, media in enumerate(media_rows):
        token = '{{image_url}}' if index == 0 else f'{{{{image_{index}_url}}}}'
        if token not in content:
            raise RuntimeError('Article content is missing a product-photo placeholder.')
        content = content.replace(token, media['source_url'])
    if '{{image_' in content:
        raise RuntimeError('A product-photo placeholder was not replaced.')
    affiliate_url = 'https://link.amazon/B06ogR7Zt'
    if content.count(affiliate_url) != 2:
        raise RuntimeError('The expected Amazon affiliate links are missing from the article.')
    wp.call(post_path, data={
        'content': content,
        'excerpt': article['excerpt'],
        'featured_media': media_rows[0]['id'],
    })
    verified = wp.call(post_path + '?context=edit')
    saved_content = verified['content']['raw']
    if (verified['status'] != 'publish' or verified['featured_media'] != media_rows[0]['id']
            or any(media['source_url'] not in saved_content for media in media_rows)
            or saved_content.count(affiliate_url) != 2):
        raise RuntimeError('The product-photo update did not pass verification.')
    print('UPDATED product photos:', verified['link'])


def publish(article, wp):
    required = ('title', 'slug', 'excerpt', 'content', 'image_base64', 'image_filename', 'alt_text', 'category_slug')
    if any(not article.get(key) for key in required):
        raise RuntimeError('Article data is incomplete.')
    if not re.fullmatch(r'[a-z0-9-]{3,80}', article['slug']):
        raise RuntimeError('Article slug has an invalid format.')
    if article.get('status') not in ('draft', 'publish'):
        raise RuntimeError('Article status must be draft or publish.')

    wp.call('/wp/v2/users/me?context=edit&_fields=id')
    slug_query = parse.urlencode({'slug': article['slug'], 'context': 'edit', '_fields': 'id,slug,status,link'})
    existing = wp.call('/wp/v2/posts?' + slug_query)
    if existing:
        if article.get('replace_existing_media'):
            replace_existing_media(article, wp, existing)
            return
        replacement = article.get('replace_existing_link')
        if replacement:
            if existing[0]['slug'] != article['slug'] or existing[0]['status'] != 'publish':
                raise RuntimeError('Refusing to update an article with a different identity or status.')
            old_url = replacement.get('old')
            new_url = replacement.get('new')
            old_parts = parse.urlsplit(old_url or '')
            new_parts = parse.urlsplit(new_url or '')
            if (old_parts.scheme != 'https' or old_parts.hostname != 'www.amazon.co.jp'
                    or new_parts.scheme != 'https' or new_parts.hostname != 'link.amazon'
                    or new_url not in article['content']):
                raise RuntimeError('Affiliate link replacement is not valid for this article.')
            post_path = '/wp/v2/posts/' + str(existing[0]['id'])
            current = wp.call(post_path + '?context=edit')['content']['raw']
            old_count = current.count(old_url)
            if old_count == 0 and current.count(new_url) == 2:
                print('ALREADY updated article links:', existing[0]['link'])
                return
            if old_count != 2:
                raise RuntimeError('Expected exactly two original product links before replacement.')
            updated = current.replace(old_url, new_url)
            wp.call(post_path, data={'content': updated})
            verified = wp.call(post_path + '?context=edit')
            saved_content = verified['content']['raw']
            if (verified['status'] != 'publish' or verified['link'] != existing[0]['link']
                    or old_url in saved_content or saved_content.count(new_url) != 2):
                raise RuntimeError('Updated affiliate links did not pass verification.')
            print('UPDATED article links:', verified['link'])
            return
        print('SKIP existing article:', existing[0]['link'])
        return

    categories = wp.call('/wp/v2/categories?' + parse.urlencode({'slug': article['category_slug'], '_fields': 'id'}))
    if not categories:
        raise RuntimeError('The requested WordPress category was not found.')

    media_slug = article['slug'] + '-cover'
    media_rows = wp.call('/wp/v2/media?' + parse.urlencode({'slug': media_slug, '_fields': 'id,source_url'}))
    if media_rows:
        media = media_rows[0]
    else:
        try:
            image_bytes = base64.b64decode(article['image_base64'], validate=True)
        except (ValueError, TypeError):
            raise RuntimeError('The featured image data is invalid.') from None
        if not image_bytes.startswith(b'\xff\xd8\xff'):
            raise RuntimeError('The featured image must be a JPEG.')
        if len(image_bytes) > 4 * 1024 * 1024:
            raise RuntimeError('The featured image exceeds 4 MB.')
        media = wp.call('/wp/v2/media', binary=image_bytes, headers={
            'Content-Type': 'image/jpeg',
            'Content-Disposition': f'attachment; filename="{article["image_filename"]}"',
        })
        wp.call('/wp/v2/media/' + str(media['id']), data={
            'slug': media_slug,
            'alt_text': article['alt_text'],
        })

    if '{{image_url}}' not in article['content']:
        raise RuntimeError('Article content is missing the image placeholder.')
    content = article['content'].replace('{{image_url}}', media['source_url'])
    if '{{image_url}}' in content:
        raise RuntimeError('Article image URL replacement failed.')
    saved = wp.call('/wp/v2/posts', data={
        'title': article['title'],
        'slug': article['slug'],
        'status': article['status'],
        'content': content,
        'excerpt': article['excerpt'],
        'categories': [categories[0]['id']],
        'featured_media': media['id'],
    })
    verified = wp.call('/wp/v2/posts/' + str(saved['id']) + '?context=edit')
    if (verified['status'] != article['status'] or verified['featured_media'] != media['id']
            or media['source_url'] not in verified['content']['raw']):
        raise RuntimeError('Saved article did not pass verification.')
    print('PUBLISHED:' if verified['status'] == 'publish' else 'DRAFT:', verified['link'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('article_json')
    args = parser.parse_args()
    try:
        article = json.loads(Path(args.article_json).read_text(encoding='utf-8'))
        publish(article, WordPress())
    except (RuntimeError, error.URLError, ValueError, KeyError, OSError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else 'Operation failed; inspect configuration and article data.', file=sys.stderr)
        sys.exit(1)
