"""Style existing Amazon and Rakuten affiliate links as clear marketplace buttons via WP REST."""
import argparse
import base64
import html
import json
import os
import re
import sys
import unittest
from html.parser import HTMLParser
from urllib import error, parse, request

SITE = 'https://sanrio-fan.site'
BUTTON_STYLES = {
    'amazon': 'display:flex;width:100%;max-width:560px;box-sizing:border-box;min-height:52px;margin:10px 0;padding:13px 18px;align-items:center;justify-content:center;border:1px solid #f0b800;border-radius:8px;background:#ffd814;color:#0f1111;box-shadow:0 2px 0 rgba(0,0,0,.12);font-size:16px;font-weight:700;line-height:1.4;text-align:center;text-decoration:none',
    'rakuten': 'display:flex;width:100%;max-width:560px;box-sizing:border-box;min-height:52px;margin:10px 0;padding:13px 18px;align-items:center;justify-content:center;border:1px solid #bf0000;border-radius:8px;background:#bf0000;color:#fff;box-shadow:0 2px 0 rgba(0,0,0,.12);font-size:16px;font-weight:700;line-height:1.4;text-align:center;text-decoration:none',
}
ANCHOR_RE = re.compile(r'<a\b[^>]*>[\s\S]*?</a\s*>', re.I)
TAG_RE = re.compile(r'<a\b[^>]*>', re.I)
ATTR_RE = lambda name: re.compile(r'\b' + re.escape(name) + r'\s*=\s*(["\'])(.*?)\1', re.I)


def attr(tag, name):
    match = ATTR_RE(name).search(tag)
    return html.unescape(match.group(2)) if match else ''


def set_attr(tag, name, value):
    encoded = html.escape(value, quote=True)
    pattern = ATTR_RE(name)
    if pattern.search(tag):
        return pattern.sub(lambda m: name + '="' + encoded + '"', tag, count=1)
    return tag[:-1] + ' ' + name + '="' + encoded + '>'


def button_kind(tag, anchor):
    href = attr(tag, 'href')
    label = html.unescape(re.sub(r'<[^>]*>', '', anchor)).strip()
    classes = set(attr(tag, 'class').split())
    host = parse.urlsplit(href).hostname or ''
    if ('sf-amazon' in classes or 'Amazon' in label) and host.endswith('amazon.co.jp'):
        return 'amazon'
    if ('sf-rakuten' in classes or '楽天' in label) and host == 'hb.afl.rakuten.co.jp':
        return 'rakuten'
    return ''


def style_anchor(anchor):
    match = TAG_RE.search(anchor)
    if not match:
        return anchor, ''
    tag = match.group(0)
    kind = button_kind(tag, anchor)
    if not kind:
        return anchor, ''
    original = tag
    tag = set_attr(tag, 'style', BUTTON_STYLES[kind])
    classes = set(attr(tag, 'class').split())
    classes.add('sf-marketplace-button')
    tag = set_attr(tag, 'class', ' '.join(sorted(classes)))
    tag = set_attr(tag, 'target', '_blank')
    rel = set(attr(tag, 'rel').split())
    rel.update(('sponsored', 'nofollow', 'noopener'))
    tag = set_attr(tag, 'rel', ' '.join(sorted(rel)))
    return anchor.replace(original, tag, 1), kind


def style_content(content):
    counts = {'amazon': 0, 'rakuten': 0}
    def replace(match):
        anchor, kind = style_anchor(match.group(0))
        if kind:
            counts[kind] += 1
        return anchor
    return ANCHOR_RE.sub(replace, content), counts


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'a':
            self.links.append(dict(attrs))


def self_test():
    sample = ('<p><a class="sf-amazon" href="https://www.amazon.co.jp/s?k=test&amp;tag=abc">Amazonで探す</a></p>'
              '<p><a class="sf-rakuten" href="https://hb.afl.rakuten.co.jp/hgc/id/?pc=x">楽天市場で探す</a></p>'
              '<a href="https://example.com">公式ページ</a>')
    styled, counts = style_content(sample)
    assert counts == {'amazon': 1, 'rakuten': 1}, counts
    assert 'https://www.amazon.co.jp/s?k=test&amp;tag=abc' in styled
    assert 'https://hb.afl.rakuten.co.jp/hgc/id/?pc=x' in styled
    assert '#ffd814' in styled and '#bf0000' in styled
    assert 'https://example.com' in styled and 'sf-marketplace-button' not in styled.split('https://example.com')[0][-0:]
    styled_again, second_counts = style_content(styled)
    assert styled_again == styled and second_counts == {'amazon': 1, 'rakuten': 1}
    parser = LinkParser()
    parser.feed(styled)
    assert parser.links[0]['target'] == '_blank'
    assert {'sponsored', 'nofollow', 'noopener'} <= set(parser.links[0]['rel'].split())
    print('Button styling self-tests passed.')


class WordPress:
    def __init__(self):
        user = os.getenv('SANRIO_WP_USER', '')
        password = os.getenv('SANRIO_WP_APP_PASSWORD', '')
        if not user or not password:
            raise RuntimeError('Set the WordPress REST credentials in GitHub Actions secrets.')
        token = base64.b64encode((user + ':' + password).encode()).decode()
        self.headers = {'Authorization': 'Basic ' + token, 'User-Agent': 'SanrioMarketplaceButtons/1.0'}
        self.opener = request.build_opener(NoRedirect())

    def call(self, path, data=None):
        if not path.startswith('/wp/v2/'):
            raise ValueError('Only standard WordPress REST routes are allowed.')
        body = json.dumps(data).encode() if data is not None else None
        headers = {**self.headers, **({'Content-Type': 'application/json'} if data is not None else {})}
        req = request.Request(SITE + '/wp-json' + path, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response), response.headers
        except error.HTTPError as exc:
            raise RuntimeError('WordPress REST returned HTTP ' + str(exc.code) + '.') from None

    def product_posts(self):
        categories, _ = self.call('/wp/v2/categories?' + parse.urlencode({
            'slug': 'shopping-products', 'context': 'edit', '_fields': 'id,slug'}))
        if len(categories) != 1 or categories[0].get('slug') != 'shopping-products':
            raise RuntimeError('The shopping-products category could not be verified.')
        category_id = categories[0]['id']
        results = []
        page = 1
        while True:
            posts, headers = self.call('/wp/v2/posts?' + parse.urlencode({
                'context': 'edit', 'status': 'publish', 'categories': category_id,
                'per_page': 100, 'page': page, '_fields': 'id,slug,title,content,categories,link'}))
            results.extend(posts)
            if page >= int(headers.get('X-WP-TotalPages', '1')):
                return results
            page += 1


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('WordPress REST redirected; stopped without writing.')


def run(mode):
    wp = WordPress()
    wp.call('/wp/v2/users/me?context=edit&_fields=id')
    posts = wp.product_posts()
    scanned = matched = changed = 0
    for post in posts:
        raw = post.get('content', {}).get('raw', '')
        if not raw:
            continue
        scanned += 1
        updated, counts = style_content(raw)
        total = counts['amazon'] + counts['rakuten']
        if not total:
            continue
        matched += 1
        if updated == raw:
            continue
        if mode == 'check':
            print('READY:', post['id'], post['slug'], 'Amazon=' + str(counts['amazon']), 'Rakuten=' + str(counts['rakuten']))
            changed += 1
            continue
        wp.call('/wp/v2/posts/' + str(post['id']), {'content': updated})
        verified, _ = wp.call('/wp/v2/posts/' + str(post['id']) + '?context=edit&_fields=id,content')
        saved = verified.get('content', {}).get('raw', '')
        if saved != updated:
            raise RuntimeError('REST reread verification failed for post ' + str(post['id']))
        changed += 1
        print('UPDATED:', post['id'], post['slug'], 'Amazon=' + str(counts['amazon']), 'Rakuten=' + str(counts['rakuten']))
    if not posts:
        raise RuntimeError('No published shopping-products posts were returned.')
    if not matched:
        raise RuntimeError('No affiliate marketplace links were found; nothing was changed.')
    print(('CHECK' if mode == 'check' else 'APPLY') + ': scanned=' + str(scanned) +
          ', matching_posts=' + str(matched) + ', posts_to_update=' + str(changed))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('check', 'apply'), default='check')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
        else:
            run(args.mode)
    except (RuntimeError, error.URLError, ValueError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
