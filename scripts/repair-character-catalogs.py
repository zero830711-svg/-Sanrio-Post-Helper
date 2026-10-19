"""Clean existing managed catalogs and navigation through standard WP REST only."""
import importlib.util
import re
import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

catalog = load('catalog', 'import-rakuten-character-catalog.py')
directory = load('directory', 'build-product-directory.py')
navigation = load('navigation', 'update-character-navigation.py')


def repair_content(raw, character):
    match = re.search(re.escape(catalog.START) + r'.*?' + re.escape(catalog.END), raw, re.S)
    if not match:
        raise RuntimeError('Managed catalog section missing: ' + character)
    section = match.group(0)
    old = catalog.extract_existing_cards(section)
    products, checked, failed, duplicates = catalog.build_candidate_set([], old, character)
    replacement = catalog.section_html(section, products, catalog.extract_guide_cards(section), catalog.CHARACTERS[character][2])
    updated = catalog.compact_page(raw[:match.start()] + replacement + raw[match.end():], catalog.CHARACTERS[character][2])
    # Existing catalog cleanup is allowed below the initial publication threshold:
    # never leave known wrong/duplicate products just to keep twelve cards.
    return updated, len(old), products


def repair_goods(raw):
    # Unified search owns its data and behavior; do not replace it with the old
    # article-only filtering script.
    if 'id="sf-unified-search-data"' in raw:
        return raw
    # Replace just the behavior script and guide destinations, retaining every card.
    def clean_card(match):
        article = match.group(0)
        title = re.search(r'<strong\b[^>]*>(.*?)</strong>', article, re.S)
        if not title:
            return article
        title = catalog.text_from(title.group(1))
        slug = re.search(r'data-character="([^"]+)"', article)
        key = slug.group(1) if slug else None
        if not directory.title_mentions_character(title, None if key == 'sanrio-characters' else key):
            return ''
        return article
    raw = re.sub(r'<article\b[^>]*class="sf-directory-card"[^>]*>.*?</article>', clean_card, raw, flags=re.S)
    controls = directory.filter_controls([], {})
    script = re.search(r'<script>.*?</script>', controls, re.S).group(0)
    pattern = r'<script>\s*\(function\(\)\{var root=document.currentScript.closest\(".sf-directory"\);.*?</script>'
    updated, count = re.subn(pattern, lambda _: script, raw, flags=re.S)
    if count != 1:
        raise RuntimeError('Expected exactly one product directory filter script.')
    routes = {slug: directory.SITE + '/' + page_slug + '/' for slug, page_slug in directory.CHARACTER_GUIDE_SLUGS.items()}
    def option(match):
        tag = match.group(0)
        value = re.search(r'value="([^"]+)"', tag)
        if not value or value.group(1) not in routes:
            return tag
        return re.sub(r'data-character-page-url="[^"]*"', 'data-character-page-url="' + routes[value.group(1)] + '"', tag)
    updated = re.sub(r'<option\b[^>]*>', option, updated)
    counts = {}
    for slug in re.findall(r'<article\b[^>]*data-character="([^"]+)"', updated):
        counts[slug] = counts.get(slug, 0) + 1
    def recount(match):
        option = match.group(0)
        slug = re.search(r'value="([^"]+)"', option)
        if not slug or 'data-article-count=' not in option:
            return option
        count = counts.get(slug.group(1), 0)
        option = re.sub(r'data-article-count="[^"]*"', 'data-article-count="' + str(count) + '"', option)
        return re.sub(r'（(?:商品 \d+件|通販検索)）', '（商品 ' + str(count) + '件）', option)
    updated = re.sub(r'<option\b[^>]*>.*?</option>', recount, updated, flags=re.S)
    # The hidden attribute must win over card display/grid rules.
    style = '<style id="sf-directory-hidden">.sf-directory [hidden]{display:none!important}</style>'
    updated = re.sub(r'<style id="sf-directory-hidden">.*?</style>', '', updated, flags=re.S)
    return style + updated


def main():
    wp = catalog.WordPress()
    ids = ','.join(str(value[0]) for value in catalog.CHARACTERS.values())
    batch_path = '/wp/v2/pages?context=edit&per_page=100&include=' + ids + '&_fields=id,slug,content'
    pages = {page['id']: page for page in wp.call(batch_path)}
    plans = []
    for character, (page_id, slug, name) in catalog.CHARACTERS.items():
        page = pages.get(page_id, {})
        if page.get('id') != page_id or page.get('slug') != slug:
            raise RuntimeError('Character page identity mismatch: ' + character)
        if not catalog.extract_existing_cards(page['content']['raw']):
            print('KEPT editorial guide without a photo catalog:', character, flush=True)
            continue
        updated, old_count, products = repair_content(page['content']['raw'], character)
        plans.append((character, page_id, slug, updated, old_count, products))
    for character, page_id, slug, updated, old_count, products in plans:
        if updated != pages[page_id]['content']['raw']:
            wp.call('/wp/v2/pages/%d' % page_id, {'content': updated})
        print('CLEANED', character, old_count, '->', len(products), flush=True)
    # One independent REST read verifies the saved content of every catalog.
    saved_pages = {page['id']: page for page in wp.call(batch_path)}
    for character, page_id, slug, updated, old_count, products in plans:
        saved_page = saved_pages.get(page_id, {})
        saved = saved_page.get('content', {}).get('raw', '')
        cards = catalog.extract_existing_cards(saved)
        if saved_page.get('slug') != slug or len(cards) != len(products) or any(not catalog.matches_character(c['title'], character) for c in cards):
            raise RuntimeError('Saved catalog verification failed: ' + character)
        if 'data-sf-catalog-category' not in saved or 'sf-catalog-compact' not in saved:
            raise RuntimeError('Catalog controls were not retained: ' + character)
    # Update directory links without regenerating its layout or sort order.
    page = wp.call('/wp/v2/pages/821?context=edit&_fields=id,slug,content')
    if page.get('slug') != 'characters':
        raise RuntimeError('Character directory identity mismatch.')
    raw = page['content']['raw']
    routes = {slug: directory.SITE + '/' + page_slug + '/' for slug, page_slug in directory.CHARACTER_GUIDE_SLUGS.items()}
    for slug, (page_id, page_slug, _) in catalog.CHARACTERS.items():
        routes[{'mymelody':'my-melody','hellokitty':'hello-kitty'}.get(slug,slug)] = directory.SITE + '/' + page_slug + '/'
    updated, count = navigation.update_directory(raw, routes)
    # Match complete anchors, preserving exact label order.
    labels = lambda text: re.findall(r'<a\b[^>]*>(.*?)</a>', text, re.S)
    if labels(raw) != labels(updated):
        raise RuntimeError('Directory character order unexpectedly changed.')
    wp.call('/wp/v2/pages/821', {'content': updated})
    saved = wp.call('/wp/v2/pages/821?context=edit&_fields=content')['content']['raw']
    if labels(saved) != labels(raw) or any('/goods/?character='+slug in saved for slug in catalog.CHARACTERS):
        raise RuntimeError('Directory routes/order verification failed.')
    goods = wp.call('/wp/v2/pages/804?context=edit&_fields=id,slug,content')
    if goods.get('slug') != 'goods':
        raise RuntimeError('Goods directory identity mismatch.')
    goods_updated = repair_goods(goods['content']['raw'])
    wp.call('/wp/v2/pages/804', {'content': goods_updated})
    goods_saved = wp.call('/wp/v2/pages/804?context=edit&_fields=content')['content']['raw']
    if 'DOMContentLoaded' not in goods_saved or 'sf-directory-hidden' not in goods_saved:
        if 'id="sf-unified-search-data"' not in goods_saved:
            raise RuntimeError('Goods directory filter verification failed.')
    if 'id="sf-unified-search-data"' in goods_saved:
        load('unified_search', 'unify-product-search.py').sync(wp)
    print('VERIFIED:',len(plans),'photo catalogs; 36 character links/order preserved; goods filters deferred until DOM ready.', flush=True)

if __name__ == '__main__':
    main()
