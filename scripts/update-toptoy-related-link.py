"""Add the approved Halloween related link to the existing hot-spring article."""
import importlib.util
import re

POST_PATH = '/wp/v2/posts/4214'
SLUG = 'toptoy-sanrio-spinning-hot-spring'
TARGET = 'https://sanrio-fan.site/toptoy-sanrio-halloween-mischief-night/'
START = '<!-- sf-toptoy-halloween-related:start -->'
END = '<!-- sf-toptoy-halloween-related:end -->'
MARKUP = (
    START + '\n<h2>ほかのTOPTOY×サンリオフィギュアもチェック</h2>\n'
    '<p>違う衣装やテーマも見たい方は、<a href="' + TARGET + '">'
    'TOPTOY×サンリオ「ハロウィン・トリック・ナイト」の実物写真16枚付き紹介'
    '</a>もどうぞ。ハロウィン衣装や小物を、集合写真とキャラクター別のアップで紹介しています。</p>\n'
    + END
)


def update(wp):
    target = wp.call('/wp/v2/posts/7358?context=edit')
    if target['status'] != 'publish' or target['link'] != TARGET:
        raise RuntimeError('Related article identity or publication status changed.')
    current = wp.call(POST_PATH + '?context=edit')
    if current['slug'] != SLUG or current['status'] != 'publish':
        raise RuntimeError('Hot-spring article identity or publication status changed.')
    raw = current['content']['raw']
    if START in raw or END in raw:
        if raw.count(START) != 1 or raw.count(END) != 1:
            raise RuntimeError('Invalid related-section markers.')
        updated = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda _: MARKUP, raw, flags=re.S)
    elif TARGET in raw:
        print('The Halloween related link already exists; no change needed.')
        return
    else:
        updated = raw + '\n' + MARKUP + '\n'
    latest = wp.call(POST_PATH + '?context=edit')
    if latest['content']['raw'] != raw or latest['modified_gmt'] != current['modified_gmt']:
        raise RuntimeError('Article changed during preparation; refusing to overwrite it.')
    if updated != raw:
        wp.call(POST_PATH, data={'content': updated})
    saved = wp.call(POST_PATH + '?context=edit')
    if (saved['content']['raw'] != updated or saved['status'] != 'publish'
            or saved['featured_media'] != current['featured_media']
            or saved['title']['raw'] != current['title']['raw']):
        raise RuntimeError('Related-link update did not pass verification.')
    print('VERIFIED related link:', saved['link'])


if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('publisher', 'scripts/publish-editorial-article.py')
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    update(publisher.WordPress())

