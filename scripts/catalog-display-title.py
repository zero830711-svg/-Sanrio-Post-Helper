"""Readable product labels without changing source titles or purchase URLs."""
import re
import unicodedata

PROMO = re.compile(
 r'(?:最大\s*)?\d[\d,]*(?:\.\d+)?\s*(?:円|%)\s*(?:OFF|オフ|引き)(?:クーポン)?'
 r'|(?:ポイント|(?<![A-Za-z])P)\s*(?:最大\s*)?\d+(?:\.\d+)?\s*倍'
 r'|(?:メール便|ネコポス)(?:送料無料|対応商品|対応|無料|可)'
 r'|(?:\d[\d,]*\s*円以上(?:のお買い上げ|の購入|ご購入)?で?\s*)?送料無料|レビュー(?:投稿|記入)(?:特典|キャンペーン)?'
 r'|クーポン(?:配布中|対象商品|対象|利用可|あり|有り|付き)?'
 r'|スーパーセール|買い回り|(?<!\w)SALE(?!\w)|(?<!\w)セール(?!\w)'
 r'|即日発送|翌日配達|ランキング\s*\d+位',
 re.I)
DATES = re.compile(r'\d{1,2}\s*月\s*\d{1,2}\s*日?\s*[~〜～－-]\s*(?:\d{1,2}\s*月\s*)?\d{1,2}\s*日?')
BRACKETS = re.compile(r'【([^】]*)】|\[([^\]]*)\]')
def display_title(value):
 original = re.sub(r'\s+', ' ', str(value or '')).strip()
 text = unicodedata.normalize('NFKC', original)
 def bracket(match):
  inner = match[1] if match[1] is not None else match[2]
  if not PROMO.search(inner):return match[0]
  clean = PROMO.sub(' ', inner)
  clean = DATES.sub(' ', clean)
  clean = re.sub(r'\b(?:最大|限定|今だけ|期間限定|開催中|配布中)\b', ' ', clean)
  clean = clean.strip(' /／・:：!！◆◇★☆ ')
  if not clean:return ''
  return ('【'+clean+'】') if match[1] is not None else '['+clean+']'
 text = BRACKETS.sub(bracket, text)
 text = PROMO.sub(' ', text)
 text = re.sub(r'[\\／/]\s*[\\／/]', ' ', text)
 text = re.sub(r'^[◆◇]+.*?対応商品[◆◇]+', '', text)
 text = re.sub(r'^(?:数量限定\s*在庫セール\s*売れ筋|在庫セール)\s*', '', text)
 text = re.sub(r'(?<!\S)(?:グッズ|定番|好評|楽天|通販|かわいい|可愛い|カワイイ|キャラクター|推しグッズ)(?!\S)', ' ', text)
 text = re.sub(r'【\s*】|\[\s*\]', '', text)
 text = re.sub(r'\s+', ' ', text).strip(' /／・:：!！◆◇ ')
 return text or original or '商品情報'
