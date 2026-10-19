"""Conservative Amazon search queries derived only from supplied product titles."""
import re
import unicodedata


def valid_jan(number):
    if not re.fullmatch(r'(?:\d{8}|\d{13})', number):
        return False
    checksum = sum(int(n) * (3 if i % 2 == 0 else 1) for i,n in enumerate(number[:-1][::-1]))
    return (10-checksum % 10) % 10 == int(number[-1])


def clean_title(title):
    title = unicodedata.normalize('NFKC', str(title or ''))
    title = re.sub(r'https?://\S+', '', title)
    title = re.sub(r'[【\[][^】\]]*(?:SALE|OFF|クーポン|送料無料|ポイント|ランキング|メール便)[^】\]]*[】\]]', ' ', title, flags=re.I)
    title = re.sub(r'(?:送料無料|メール便可|メール便送料無料|楽天市場|Rakuten Fashion|ポイント\d+倍|\d+%OFF)', ' ', title, flags=re.I)
    title = re.sub(r'[【】\[\]「」『』"“”]', ' ', title)
    title = re.sub(r'\s+', ' ', title).strip()
    words = []
    for word in title.split():
        if word.casefold() not in {x.casefold() for x in words}:
            words.append(word)
    return ' '.join(words)


def amazon_query(title):
    original = unicodedata.normalize('NFKC', str(title or ''))
    jans = sorted({x for x in re.findall(r'(?<!\d)(?:\d{13}|\d{8})(?!\d)', original) if valid_jan(x)})
    if len(jans) == 1:
        return jans[0]
    # Avoid promoting one code from a title advertising several different items.
    models = set(re.findall(r'(?:型番|品番|商品番号|model)\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,24})', original, re.I))
    if not models:
        models = {x for x in re.findall(r'(?<![A-Za-z0-9])(?:[A-Z]{2,8}\d{1,6}[A-Z0-9]*|[A-Z]{2,8}-[A-Z0-9-]*\d[A-Z0-9-]*)(?![A-Za-z0-9])', original)
                  if not re.fullmatch(r'(?:SS|AW|FW)\d{4}', x)}
    if not models and re.search(r'サンリオ|SANRIO', original, re.I):
        models = set(re.findall(r'(?<![\d¥￥])\b\d{6}\b(?!\s*円)', original))
    if len(models) == 1 and len(jans) <= 1:
        model = next(iter(models))
        # A known character or manufacturer helps disambiguate short model codes.
        characters = [name for name in ['シナモロール','クロミ','マイメロディ','ハローキティ','ポムポムプリン','ポチャッコ','ハンギョドン','リトルツインスターズ'] if name in original]
        character = characters[0] if len(characters) == 1 else ''
        manufacturer = next((name for name in ['スケーター','サンリオ','タカラトミー','サンスター文具'] if name in original), '')
        return ' '.join(x for x in [manufacturer,character,model] if x)
    cleaned = clean_title(original)
    # Keep brand and the leading product description, dropping long shop/category tails.
    cleaned = re.split(r'\s+(?:トップス|インテリア・生活雑貨|ファッション雑貨|マタニティウェア・ベビー用品|食器・調理器具・キッチン用品)\s+', cleaned, maxsplit=1)[0]
    return cleaned[:72].rstrip() or original[:72]
