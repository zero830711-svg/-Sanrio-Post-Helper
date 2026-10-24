"""Publish multilingual Sanrio character guides for all catalogued characters."""
import argparse
import collections
import html
import importlib.util
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = __import__("pathlib").Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("detail_catalog", ROOT / "product-detail-pilot.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
c = d.c
spec = importlib.util.spec_from_file_location("english_detail", ROOT / "product-detail-english.py")
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)

SITE = c.SITE
EXISTING_CHARACTER_ORDER = ("mymelody", "hellokitty", "hanamaru-obake", "cinnamoroll", "kuromi", "pompompurin", "pochacco")
CHARACTER_BATCH = EXISTING_CHARACTER_ORDER + tuple(key for key in c.CHARACTERS if key not in EXISTING_CHARACTER_ORDER)
INDEX_MARK = "<!-- sf-multilingual-character-index:v1 -->"
GUIDE_MARK = "<!-- sf-multilingual-character-guide:v1 -->"
JA_LINK_START = "<!-- sf-multilingual-ja-links:start -->"
JA_LINK_END = "<!-- sf-multilingual-ja-links:end -->"
EN_GUIDE_START = "<!-- sf-multilingual-en-guide-links:start -->"
EN_GUIDE_END = "<!-- sf-multilingual-en-guide-links:end -->"
EN_INDEX_START = "<!-- sf-multilingual-en-index:start -->"
EN_INDEX_END = "<!-- sf-multilingual-en-index:end -->"
GRID_CSS = (
    ".sf-multi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));"
    "gap:10px;margin:16px 0}.sf-multi-grid a{display:block;min-width:0;padding:7px;"
    "border:1px solid #eee2ed;border-radius:12px;background:#fff;color:#312b34;"
    "text-decoration:none;font-size:12px;line-height:1.55;overflow-wrap:anywhere}"
    ".sf-multi-grid img{display:block;width:100%;height:auto;aspect-ratio:1;"
    "object-fit:contain;background:#fff;border-radius:8px;margin-bottom:6px}"
    ".sf-multi-grid span{display:block}.sf-multi-note{font-size:13px;"
    "line-height:1.75;color:#756879}"
)
LANGUAGES = (
    {"slug": "zh-hans", "lang": "zh-Hans", "target": "zh-CN", "label": "简体中文",
     "product_english": "英文商品名"},
    {"slug": "zh-hant", "lang": "zh-Hant", "target": "zh-TW", "label": "繁體中文",
     "product_english": "英文商品名稱"},
    {"slug": "ko", "lang": "ko", "target": "ko", "label": "한국어",
     "product_english": "영어 상품명"},
    {"slug": "es", "lang": "es", "target": "es", "label": "Español",
     "product_english": "Nombre del producto en inglés"},
)
CHARACTER_NAMES = {
    "mymelody": {"zh-hans": "美乐蒂", "zh-hant": "美樂蒂", "ko": "마이멜로디", "es": "My Melody"},
    "hellokitty": {"zh-hans": "Hello Kitty", "zh-hant": "Hello Kitty", "ko": "헬로키티", "es": "Hello Kitty"},
    "hanamaru-obake": {"zh-hans": "Hanamaruobake", "zh-hant": "Hanamaruobake", "ko": "하나마루오바케", "es": "Hanamaruobake"},
    "cinnamoroll": {"zh-hans": "大耳狗喜拿", "zh-hant": "大耳狗喜拿", "ko": "시나모롤", "es": "Cinnamoroll"},
    "kuromi": {"zh-hans": "酷洛米", "zh-hant": "酷洛米", "ko": "쿠로미", "es": "Kuromi"},
    "pompompurin": {"zh-hans": "布丁狗", "zh-hant": "布丁狗", "ko": "폼폼푸린", "es": "Pompompurin"},
    "pochacco": {"zh-hans": "帕恰狗", "zh-hant": "帕恰狗", "ko": "포차코", "es": "Pochacco"},
}
for _character, _name in e.CHARACTER_EN.items():
    CHARACTER_NAMES.setdefault(_character, {language["slug"]: _name for language in LANGUAGES})
SOURCE_PAGES = {
    "mymelody": ("https://www.sanrio.co.jp/characters/mymelody/",),
    "hellokitty": ("https://www.sanrio.co.jp/characters/hellokitty/",),
    "hanamaru-obake": (
        "https://www.sanrio.co.jp/characters/hanamaruobake/",
        "https://corporate.sanrio.co.jp/en/business-info/brands/hanamaruobake/",
    ),
    "cinnamoroll": ("https://www.sanrio.co.jp/characters/cinnamon/",),
    "kuromi": ("https://www.sanrio.co.jp/characters/kuromi/",),
    "pompompurin": ("https://www.sanrio.co.jp/characters/pompompurin/",),
    "pochacco": ("https://www.sanrio.co.jp/characters/pochacco/",),
    "tuxedo-sam": ["https://www.sanrio.co.jp/characters/tuxedosam/"],
        "ahiru-no-pekkle": ["https://www.sanrio.co.jp/characters/pekkle/"],
        "bad-badtz-maru": ["https://www.sanrio.co.jp/characters/badtzmaru/"],
        "cogimyun": ["https://www.sanrio.co.jp/characters/cogimyun/"],
        "usahana": ["https://www.sanrio.co.jp/characters/usahana/"],
        "kerokerokeroppi": ["https://www.sanrio.co.jp/characters/keroppi/"],
        "gudetama": ["https://www.sanrio.co.jp/characters/gudetama/"],
        "wish-me-mell": ["https://www.sanrio.co.jp/characters/wishmemell/"],
        "my-sweet-piano": ["https://www.sanrio.co.jp/characters/mysweetpiano/"],
        "jochum": ["https://www.sanrio.co.jp/characters/jochum/"],
        "hangyodon": ["https://www.sanrio.co.jp/characters/hangyodon/"],
        "little-twin-stars": ["https://www.sanrio.co.jp/characters/kikilala/"],
        "kirimi-chan": ["https://www.sanrio.co.jp/characters/kirimichan/"],
        "osaru-no-monkichi": ["https://www.sanrio.co.jp/characters/monkichi/"],
        "gaopoweru": ["https://www.sanrio.co.jp/characters/gaopowerroo/"],
        "corocorokuririn": ["https://www.sanrio.co.jp/characters/kuririn/"],
        "goropikadon": ["https://www.sanrio.co.jp/characters/goropikadon/"],
        "jewelpet": ["https://www.sanrio.co.jp/characters/jewelpet/"],
        "sugar-bunnies": ["https://www.sanrio.co.jp/characters/sugarbunnies/"],
        "charmmy-kitty": ["https://www.sanrio.co.jp/characters/charmmy/"],
        "chococat": ["https://www.sanrio.co.jp/characters/chococat/"],
        "dear-daniel": ["https://www.sanrio.co.jp/characters/daniel/"],
        "bonbonribbon": ["https://www.sanrio.co.jp/characters/bonbonribbon/"],
        "marshmallow-fuwafuwa-nyanko": ["https://www.sanrio.co.jp/characters/masyumaro/"],
        "marumofubiyori": ["https://www.sanrio.co.jp/characters/marumofubiyori/"],
        "marroncream": ["https://www.sanrio.co.jp/characters/marroncream/"],
        "minna-no-taabou": ["https://www.sanrio.co.jp/characters/tabo/"],
        "little-forest-fellow": ["https://www.sanrio.co.jp/characters/littleforestfellow/"],
        "ruroromannic": ["https://www.sanrio.co.jp/characters/lloromannic/"],
}
PROFILES = {
    "mymelody": {
        "summary": "すなおで明るく、弟思いの女のコです。宝物は、おばあちゃんが作ってくれたかわいいずきん。お母さんとクッキーを焼くのが好きで、好きな食べ物はアーモンドパウンドケーキです。",
        "facts": ["誕生日：1月18日", "デビュー年：1975年", "将来の夢：お菓子屋さん", "趣味：クッキーを焼くこと"],
    },
    "hellokitty": {
        "summary": "ロンドン郊外生まれの明るくてやさしい女のコです。クッキー作りとピアノが好きで、夢はピアニストか詩人になること。好きな食べ物はママが作るアップルパイです。",
        "facts": ["誕生日：11月1日", "デビュー年：1974年", "身長：りんご5個分", "体重：りんご3個分"],
    },
    "hanamaru-obake": {
        "summary": "がんばったあなたにハナマルをくれる、はずかしがりやで不思議なおばけです。気づかれないうちに現れて、毎日の努力をそっとほめてくれます。正体は、夜空の星になった大切な人や思い出かもしれません。",
        "facts": ["誕生日：8月7日", "デビュー年：2023年", "性格：はずかしがりや", "特技：かくれんぼ", "好きな食べ物：あまいもの", "趣味：お昼寝"],
    },
    "cinnamoroll": {
        "summary": "遠い雲の上で生まれた白いこいぬの男のコ。空から飛んできたところをカフェの店員のお姉さんに見つけられ、一緒に暮らすことに。くるくる巻いたしっぽが名前の由来です。",
        "facts": ["誕生日：3月6日", "デビュー年：2002年（初めてグッズが発売された年）", "性格：おとなしいけれど、とても人なつっこい", "夢：レストランのシェフになってみんなを幸せにすること", "特技：大きな耳をパタパタさせて空を飛ぶこと"],
    },
    "kuromi": {
        "summary": "自分でライバルを名乗る、黒いずきんとピンクのどくろがチャームポイントのキャラクター。乱暴者に見えて実は乙女チックで、イケメン好き。世界中を自分色にするために奮闘中です。",
        "facts": ["誕生日：10月31日", "デビュー年：2005年", "性格：実はとっても乙女チック", "好きな食べ物：らっきょう", "趣味：日記をつけること"],
    },
    "pompompurin": {
        "summary": "こげ茶色のベレー帽がトレードマークのゴールデンレトリバーの男のコ。のんびり屋で、「おでかけ」が好きな言葉、「おるすばん」が嫌いな言葉。くつ集めも趣味です。",
        "facts": ["誕生日：4月16日のお天気いい日", "デビュー年：1996年", "性格：のんびりマイペース", "特技：お昼寝とプリン体操、だれとでも仲よくなれること", "好きな食べ物：ママが作ったプリン、ミルク、ふにゃふにゃしたもの", "趣味：くつ集め"],
    },
    "pochacco": {
        "summary": "好奇心旺盛でおっちょこちょい、ちょっぴりおせっかいなイヌの男のコです。ふっくらした様子が名前の由来で、より道のお散歩が大好き。ふわふわタウンのはずれ、うぐいす横丁生まれです。",
        "facts": ["誕生日：2月29日（うるう年生まれ）", "デビュー年：1989年", "性格：好奇心旺盛で、おっちょこちょいで、ちょっぴりおせっかい", "好きな食べ物：バナナアイス", "身長：バナナアイスのラージサイズのカップ4個分"],
    },
    "tuxedo-sam": {"summary": "南極のタキシードアイランド出身のおしゃれなペンギンの男のコ。食いしん坊で少しドジだけれど、蝶ネクタイ集めが得意。365本の蝶ネクタイを持っています。", "facts": ["誕生日：5月12日","デビュー年：1979年","トレードマーク：蝶ネクタイ","特技：英語"]},
        "ahiru-no-pekkle": {"summary": "やさしくて親切なアヒルの男のコ。歌とタップダンスが大好きで、練習を続けています。泳ぎは少し苦手ですが、空を飛ぶことを夢見ています。", "facts": ["誕生日：7月27日","好きなこと：歌とダンス","夢：空を飛ぶこと"]},
        "bad-badtz-maru": {"summary": "ひねくれ者でいたずら好きなペンギンの男のコ。将来の夢は社長になること。お寿司やポリパリラーメンが大好物です。", "facts": ["誕生日：4月1日","デビュー年：1993年","将来の夢：社長","好きな食べ物：お寿司、ポリパリラーメン"]},
        "cogimyun": {"summary": "小麦粉から生まれた、ちょっぴり繊細な妖精の女のコ。おにぎりになるのが夢で、今はおじいちゃんが大家をするアパートのお手伝いをしています。", "facts": ["誕生日：5月7日","デビュー年：2015年","将来の夢：おにぎりになること","性格：ちょっぴり繊細"]},
        "usahana": {"summary": "夏が大好きで元気いっぱいのウサギの女のコ。長い耳と青い目がチャームポイントです。バレリーナになる夢があり、お菓子作りやイヤリング集めも好きです。", "facts": ["夢：バレリーナ","好きな食べ物：オレンジシャーベット","趣味：お菓子作り、イヤリング集め"]},
        "kerokerokeroppi": {"summary": "ドーナツ池で人気者のカエルの男のコ。元気いっぱいで冒険好き、歌が得意です。ピクニックや冒険を楽しみ、クロールも上手です。", "facts": ["出身：ドーナツ池","得意なこと：歌、クロール","趣味：ピクニック、冒険"]},
        "gudetama": {"summary": "やる気のない、ぐでぐでな卵のキャラクター。誕生日は毎日で、気だるそうな姿が特徴です。いろいろな食べ方や料理になって登場します。", "facts": ["誕生日：毎日","デビュー年：2013年","特徴：やる気のない卵"]},
        "wish-me-mell": {"summary": "メルシーヒルズに住む白いうさぎの女のコ。手紙を届けながら、住人の気持ちをつなぐお手伝いをしています。友だちを大切にするやさしいキャラクターです。", "facts": ["出身：メルシーヒルズ","好きなこと：手紙を届けること","大切にしていること：友だちとのつながり"]},
        "my-sweet-piano": {"summary": "ふんわりやさしいヒツジの女のコ。花かんむりやネックレスを作るのが好きで、メレンゲクッキーがお気に入り。ピアノを弾くことも楽しんでいます。", "facts": ["誕生日：7月6日","デビュー年：1980年","好きな食べ物：メレンゲクッキー","趣味：ピアノ"]},
        "jochum": {"summary": "夢をかなえる家で暮らす11人の仲間たち。それぞれが自分の夢に向かってがんばり、個性の違うメンバー同士で毎日を過ごしています。", "facts": ["メンバー：11人","暮らしている場所：夢をかなえる家","テーマ：それぞれの夢"]},
        "hangyodon": {"summary": "中国生まれの半魚人。人を笑わせるのが好きでヒーローに憧れる一方、少しさみしがりやでロマンチストなところもあります。", "facts": ["誕生日：3月14日","デビュー年：1985年","夢：ヒーローになること","性格：さみしがりやでロマンチスト"]},
        "little-twin-stars": {"summary": "思いやり星のゆめ星雲で生まれた、ふたごのきょうだい。好奇心旺盛ないたずら好きの兄と、少し泣き虫でやさしい妹が、輝く星になるため地球へやってきました。", "facts": ["出身：思いやり星のゆめ星雲","メンバー：ふたごのきょうだい","目標：輝く星になること"]},
        "kirimi-chan": {"summary": "おいしく食べてもらうために生まれた、鮭の切り身のキャラクター。新しい友だちとの出会いを大切にし、絵を描いたりゲームをしたりします。", "facts": ["記念日：8月31日（ファーストカットの日）","趣味：絵を描くこと、ゲーム","モチーフ：鮭の切り身"]},
        "osaru-no-monkichi": {"summary": "ダジャレが大好きで、いつも前向きなおさるの男のコ。ちょっぴり目立ちたがり屋で、1分間にバナナを10本食べられるのが特技です。", "facts": ["性格：前向きで目立ちたがり屋","特技：1分間にバナナを10本食べること","好きなこと：ダジャレ"]},
        "gaopoweru": {"summary": "オムライス島に暮らす、力持ちの恐竜。困っている仲間を助けるのが大好きで、オムライスを食べたり、遊んだり、元気に吠えたりします。", "facts": ["出身：オムライス島","好きな食べ物：オムライス","好きなこと：遊ぶこと、吠えること"]},
        "corocorokuririn": {"summary": "花の帽子が似合う、好奇心旺盛だけど少し怖がりなゴールデンハムスター。クッキーやひまわりの種が好きで、宝物を集めています。", "facts": ["好きな食べ物：クッキー、ひまわりの種","性格：好奇心旺盛で少し怖がり","趣味：宝物集め"]},
        "goropikadon": {"summary": "かみなりの国からやってきた、性格の違う三つ子の兄弟。いたずら好きで雨が苦手です。まじめな兄、食いしん坊でお調子者、恥ずかしがり屋で甘えん坊がいます。", "facts": ["メンバー：三つ子の兄弟","出身：かみなりの国","苦手なもの：雨"]},
        "jewelpet": {"summary": "ジュエルランドで暮らす魔法使いのペットたち。瞳にある宝石の力を使い、魔法学校で修行しています。宝石の種類によって、それぞれ使える魔法が異なります。", "facts": ["出身：ジュエルランド","特徴：宝石の瞳が魔法の力を持つ","活動：魔法学校で修行"]},
        "sugar-bunnies": {"summary": "バニーズフィールドに暮らす、双子のパティシエうさぎ。お菓子作りが得意で、特別なスイーツを通じてみんなを笑顔にします。", "facts": ["メンバー：双子のうさぎ","得意なこと：お菓子作り","出身：バニーズフィールド"]},
        "charmmy-kitty": {"summary": "白いペルシャネコの女のコ。大きなリボンと首に下げた鍵がトレードマークで、キラキラしたものが大好きです。", "facts": ["種類：ペルシャネコ","好きなもの：キラキラしたもの","トレードマーク：大きなリボンと鍵"]},
        "chococat": {"summary": "好奇心旺盛で少しドジな黒ネコの男のコ。ひげがアンテナのように情報をキャッチします。チョコボールが好物で、探検や星空を見ることを楽しみます。", "facts": ["誕生日：5月10日","デビュー年：1996年","特技：ひげで情報をキャッチすること","好きな食べ物：チョコボール"]},
        "dear-daniel": {"summary": "写真を撮るのが好きなおしゃれなネコの男のコ。カメラマンを目指して世界を旅した経験があり、思い出を写真に残すことを楽しんでいます。", "facts": ["誕生日：5月3日","好きなこと：写真を撮ること","夢：カメラマン"]},
        "bonbonribbon": {"summary": "大きなリボンがチャームポイントのおしゃれなピンクのうさぎ。将来はデザイナーになるのが夢で、歌やダンス、ファッションを楽しんでいます。", "facts": ["誕生日：8月8日","デビュー年：2012年","夢：デザイナー","好きなこと：歌、ダンス、ファッション"]},
        "marshmallow-fuwafuwa-nyanko": {"summary": "ふわふわの白い子ネコ。パリでファッションデザイナーを目指す男の子と暮らしています。きれいなソプラノの声とピアノが得意で、いつか音楽スターになるのが夢です。", "facts": ["デビュー年：2005年","得意なこと：ソプラノの歌声、ピアノ","夢：音楽スター"]},
        "marumofubiyori": {"summary": "お気に入りの毛布にくるまって過ごす、おうちが大好きな白いクマ。毛布を引きずって歩く姿から名前がつきました。大福とお昼寝が好きです。", "facts": ["誕生日：2月10日","デビュー年：2017年","好きな食べ物：大福","好きなこと：お昼寝"]},
        "marroncream": {"summary": "パリ郊外生まれのうさぎの女のコ。明るく前向きでおしゃれ好き。お菓子作りや手芸、裁縫など、ものづくりを楽しんでいます。", "facts": ["出身：パリ郊外","好きなこと：お菓子作り、手芸、裁縫","性格：明るく前向き"]},
        "minna-no-taabou": {"summary": "明るく正直で、何事にも一生懸命な男のコ。弟思いで友だちもたくさんいます。お母さんが作るオムレツが大好物で、泳ぐのも得意です。", "facts": ["好きな食べ物：お母さんのオムレツ","得意なこと：泳ぐこと","苦手なもの：ピーマン、早口言葉"]},
        "little-forest-fellow": {"summary": "赤いずきんを大切にしている元気な男のコ。ボタン集めが好きで、親せきのお姉さんと遊ぶのが楽しみ。語尾に「なのです」とつけて話します。", "facts": ["誕生日：6月18日","デビュー年：2015年","好きなもの：ボタン","口ぐせ：「なのです」"]},
        "ruroromannic": {"summary": "鏡の向こう側の世界からやってきた、いたずら好きな二人組。少しこわい雰囲気とお茶目さを持ち、夢や想像の世界を楽しませてくれます。", "facts": ["デビュー年：2007年","メンバー：二人組","出身：鏡の向こう側の世界"]}
}
COMMON_TEXT = (
    "キャラクター紹介",
    "プロフィール",
    "関連商品",
    "言語を選ぶ",
    "キャラクター一覧",
    "商品詳細を見る",
    "公式プロフィールを見る",
    "写真と、サイズや素材などの商品情報を確認できます。",
    "商品詳細は日本語または英語のページでご覧いただけます。価格、在庫、仕様は変更される場合があります。",
    "サンリオ公式プロフィールを参考に要約した、非公式ファンサイトの紹介です。サンリオ公式サイトではありません。",
    "一部の商品リンクにはアフィリエイトリンクが含まれる場合があります。",
    "キャラクターを選んで、プロフィールと関連商品をご覧ください。",
    "日本語のキャラクターページ",
    "英語のキャラクター一覧",
    "現在、掲載中の商品詳細ページはありません。",
)
_translation_lock = threading.Lock()
_last_translation = 0.0
_translation_cache = {}


def page_slug(character):
    if character not in CHARACTER_BATCH:
        raise RuntimeError("Unsupported character guide: " + str(character))
    return character


def locale_index_url(locale):
    return SITE + "/" + locale + "/"


def locale_guide_url(locale, character):
    return locale_index_url(locale) + page_slug(character) + "/"


def managed_block(raw, start, end, body):
    if (start in raw) != (end in raw):
        raise RuntimeError("A multilingual content marker is incomplete.")
    block = start + body + end
    if start in raw:
        if raw.count(start) != 1 or raw.count(end) != 1:
            raise RuntimeError("A multilingual content marker is duplicated.")
        return re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: block, raw, count=1, flags=re.S)
    return raw.rstrip() + "\n" + block + "\n"


def translate_one(source, language):
    key = (language["slug"], source)
    if key in _translation_cache:
        return _translation_cache[key]
    query = urllib.parse.urlencode({"client": "gtx", "sl": "ja", "tl": language["target"], "dt": "t", "q": source})
    request = urllib.request.Request(
        "https://translate.googleapis.com/translate_a/single?" + query,
        headers={"User-Agent": "SanrioMultilingualCharacterGuides/1.0"},
    )
    last_error = None
    global _last_translation
    for attempt in range(4):
        try:
            with _translation_lock:
                delay = 0.23 - (time.monotonic() - _last_translation)
                if delay > 0:
                    time.sleep(delay)
                _last_translation = time.monotonic()
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            value = "".join(part[0] for part in data[0] if part and isinstance(part[0], str)).strip()
            if not value:
                raise RuntimeError("Translation service returned an empty translation.")
            _translation_cache[key] = value
            return value
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError("Translation failed for " + language["slug"] + ": " + str(last_error))


def translate_many(values, language):
    unique = sorted(set(str(value).strip() for value in values if str(value).strip()))
    def translate(value):
        return value, translate_one(value, language)
    with ThreadPoolExecutor(max_workers=3) as pool:
        return dict(pool.map(translate, unique))


def diversified_records(records, limit=12):
    groups = collections.OrderedDict()
    for item in records:
        groups.setdefault(item.get("kind") or "Sanrio goods", []).append(item)
    selected = []
    while groups and len(selected) < limit:
        empty = []
        for key, values in groups.items():
            if values and len(selected) < limit:
                selected.append(values.pop(0))
            if not values:
                empty.append(key)
        for key in empty:
            del groups[key]
    return selected


def find_page(wp, slug, parent_id):
    rows = e.pages_by_slug(wp, slug)
    return next((row for row in rows if int(row.get("parent", 0)) == int(parent_id)), None)


def rest_page(wp, page_id):
    return wp.call("/wp/v2/pages/" + str(page_id) + "?context=edit&_fields=id,slug,parent,status,content,link")


def publish_page(wp, page):
    if page.get("status") == "publish":
        return page
    saved = wp.call("/wp/v2/pages/" + str(page["id"]), {"status": "publish"})
    if saved.get("status") != "publish" or saved.get("slug") != page.get("slug"):
        raise RuntimeError("Could not publish multilingual page: " + str(page.get("slug")))
    return saved


def preflight_existing(wp, records, entries_by_code, en_directory_id):
    ja_pages = {}
    english_guides = {}
    for key in CHARACTER_BATCH:
        page_id, slug, _ = c.CHARACTERS[key]
        page = rest_page(wp, page_id)
        if page.get("slug") != slug or page.get("status") != "publish":
            raise RuntimeError("Japanese character page identity changed: " + slug)
        ja_pages[key] = page
        guide = find_page(wp, key, en_directory_id)
        if guide and (
            guide.get("status") != "publish"
            or (GUIDE_MARK not in guide["content"]["raw"]
                and "<!-- sf-bilingual-character-guide:v1 -->" not in guide["content"]["raw"])
        ):
            raise RuntimeError("Existing English character guide is unmanaged: " + key)
        english_guides[key] = guide
    # Show only product details whose Japanese and English pages are both verified.
    # Character profiles are still useful when a character has fewer than 12 products.
    selected = {}
    for key in CHARACTER_BATCH:
        rows = diversified_records([item for item in records if item["character"] == key], 12)
        for item in rows:
            entry = entries_by_code[item["code"]]
            if not item.get("pageId") or not entry.get("pageId") or not item.get("images"):
                raise RuntimeError("A localized product card is missing source data: " + item["code"])
            if item["url"].rstrip("/") != d.detail_url(item["code"]).rstrip("/") or entry["url"].rstrip("/") != e.page_url(entry).rstrip("/"):
                raise RuntimeError("A localized product card has an unexpected paired URL: " + item["code"])
        selected[key] = rows
    return ja_pages, selected, english_guides
def validate_cohorts(records, entries):
    if len(records) != 1000 or len(entries) != 1000:
        raise RuntimeError("Expected 1,000 Japanese and English product details.")
    records_by_code = {item["code"]: item for item in records}
    entries_by_code = {item["code"]: item for item in entries}
    if len(records_by_code) != 1000 or len(entries_by_code) != 1000 or set(records_by_code) != set(entries_by_code):
        raise RuntimeError("Japanese and English product detail cohorts do not match exactly.")
    return records_by_code, entries_by_code


def language_switch(locale, character, language_text, english_url=None):
    links = []
    ja = c.CHARACTERS[character]
    for item in LANGUAGES:
        if item["slug"] == locale:
            links.append('<span aria-current="page">' + html.escape(item["label"]) + "</span>")
        else:
            links.append('<a href="' + html.escape(locale_guide_url(item["slug"], character), quote=True) + '">' + html.escape(item["label"]) + "</a>")
    en_url = english_url or SITE + "/en/characters/"
    links.append('<a href="' + html.escape(en_url, quote=True) + '">English</a>')
    links.append('<a href="/' + html.escape(ja[1], quote=True) + '/">日本語</a>')
    return '<p class="sf-multi-languages"><strong>' + html.escape(language_text) + ":</strong> " + " · ".join(links) + "</p>"
def render_index(language, translations, selected):
    cards = []
    for key in CHARACTER_BATCH:
        rows = selected.get(key, [])
        item = rows[0] if rows else None
        name = CHARACTER_NAMES[key][language["slug"]]
        image = (
            '<img src="' + html.escape(item["images"][0], quote=True) + '" alt="' + html.escape(name + " product photo", quote=True) + '" loading="lazy" decoding="async">'
            if item else ""
        )
        cards.append(
            '<a href="' + html.escape(locale_guide_url(language["slug"], key), quote=True) + '">'
            + image + "<span>" + html.escape(name) + "</span></a>"
        )
    intro = translations["キャラクターを選んで、プロフィールと関連商品をご覧ください。"]
    return (
        INDEX_MARK + "<style>" + GRID_CSS + "</style>"
        '<section lang="' + html.escape(language["lang"], quote=True) + '">'
        "<h2>" + html.escape(translations["キャラクター一覧"]) + "</h2>"
        '<p class="sf-multi-note">' + html.escape(intro) + "</p>"
        '<div class="sf-multi-grid">' + "".join(cards) + "</div>"
        '<p><a href="/en/characters/">English character guides</a> · <a href="/">日本語</a></p>'
        "</section>"
    )
def render_guide(character, language, translated, selected, entries_by_code, english_url=None):
    char_name = CHARACTER_NAMES[character][language["slug"]]
    facts = "".join("<li>" + html.escape(translated[item]) + "</li>" for item in PROFILES[character]["facts"])
    products = []
    for item in selected.get(character, []):
        entry = entries_by_code[item["code"]]
        title = entry["titleEn"]
        products.append(
            '<a href="' + html.escape(e.page_url(entry), quote=True) + '">'
            '<img src="' + html.escape(item["images"][0], quote=True) + '" alt="' + html.escape(char_name + " " + title, quote=True) + '" loading="lazy" decoding="async">'
            "<span>" + html.escape(title) + "</span>"
            "<small>" + html.escape(language["product_english"] + ": " + entry["titleEn"]) + "</small></a>"
        )
    summary = translated[PROFILES[character]["summary"]]
    unoff = translated[COMMON_TEXT[9]]
    goods = translated[COMMON_TEXT[2]]
    product_note = translated[COMMON_TEXT[8]]
    affiliate_note = translated[COMMON_TEXT[10]]
    source_links = " · ".join(
        '<a href="' + html.escape(url, quote=True) + '" target="_blank" rel="noopener noreferrer">'
        + html.escape(translated[COMMON_TEXT[6]]) + "</a>"
        for url in SOURCE_PAGES[character]
    )
    ja = c.CHARACTERS[character]
    product_area = (
        '<div class="sf-multi-grid">' + "".join(products) + "</div>"
        if products else '<p class="sf-multi-note">' + html.escape(translated[COMMON_TEXT[14]]) + "</p>"
    )
    notes = (
        '<p class="sf-multi-note">' + html.escape(translated[COMMON_TEXT[7]]) + " "
        + html.escape(product_note) + " " + html.escape(affiliate_note) + "</p>"
        if products else ""
    )
    return (
        GUIDE_MARK + "<style>" + GRID_CSS + "</style>"
        + '<section lang="' + html.escape(language["lang"], quote=True) + '">'
        + '<p class="sf-multi-note">' + html.escape(unoff) + "</p>"
        + language_switch(language["slug"], character, translated[COMMON_TEXT[3]], english_url)
        + "<h2>" + html.escape(char_name) + " — " + html.escape(translated[COMMON_TEXT[1]]) + "</h2>"
        + "<p>" + html.escape(summary) + "</p>"
        + "<ul>" + facts + "</ul>"
        + "<p>" + source_links + "</p>"
        + "<p><a href='/" + html.escape(ja[1], quote=True) + "/'>" + html.escape(translated[COMMON_TEXT[12]]) + "</a> · "
        + "<a href='/en/characters/'>" + html.escape(translated[COMMON_TEXT[13]]) + "</a></p>"
        + "<h2>" + html.escape(goods) + "</h2>"
        + product_area + notes
        + "</section>"
    )
def public_verify(url, marker):
    body = e.public_body(url)
    if marker not in body:
        raise RuntimeError("Multilingual page marker missing: " + url)
    if re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', body, re.I):
        raise RuntimeError("A multilingual page is noindex: " + url)
    parser = e.CanonicalParser()
    parser.feed(body)
    parser.close()
    canonical_urls = [urllib.parse.urljoin(url, value) for value in parser.urls]
    if not canonical_urls or any(value.rstrip("/") != url.rstrip("/") for value in canonical_urls):
        raise RuntimeError("Missing or unexpected canonical URL: " + url)
    return len(canonical_urls)


def update_content(wp, page_id, marker_start, marker_end, body):
    current = rest_page(wp, page_id)
    raw = current["content"]["raw"]
    updated = managed_block(raw, marker_start, marker_end, body)
    if updated != raw:
        d.update_existing_content(wp, "/wp/v2/pages/" + str(page_id), raw, updated)
    saved = rest_page(wp, page_id)
    if marker_start not in saved["content"]["raw"] or saved["content"]["raw"] != updated:
        raise RuntimeError("Language links were not saved: " + current.get("slug", str(page_id)))
    return saved, updated != raw


def run():
    wp = c.WordPress()
    records, _ = d.read_state(wp)
    english_state = e.read_english_state(wp)
    if not english_state:
        raise RuntimeError("The verified English product detail state is missing.")
    records_by_code, entries_by_code = validate_cohorts(records, english_state["entries"])
    en_landing, en_product_hub = e.managed_directory(wp)
    en_directory = find_page(wp, "characters", en_landing["id"])
    if not en_directory or "<!-- sf-bilingual-character-directory:v1 -->" not in en_directory["content"]["raw"]:
        raise RuntimeError("The managed English character directory is missing.")
    ja_pages, selected, english_guides = preflight_existing(wp, records, entries_by_code, en_directory["id"])

    existing_indexes = {}
    existing_guides = {}
    for language in LANGUAGES:
        root = find_page(wp, language["slug"], 0)
        if root and INDEX_MARK not in root["content"]["raw"]:
            raise RuntimeError("Refusing to overwrite an unmanaged language index: " + language["slug"])
        existing_indexes[language["slug"]] = root
        parent_id = root["id"] if root else None
        existing_guides[language["slug"]] = {}
        if parent_id:
            for character in CHARACTER_BATCH:
                page = find_page(wp, character, parent_id)
                if page and GUIDE_MARK not in page["content"]["raw"]:
                    raise RuntimeError("Refusing to overwrite an unmanaged multilingual character page.")
                existing_guides[language["slug"]][character] = page

    # Prepare all translations before the first WordPress write.
    common_sources = list(COMMON_TEXT)
    for character in CHARACTER_BATCH:
        common_sources.append(PROFILES[character]["summary"])
        common_sources.extend(PROFILES[character]["facts"])
    translated_by_locale = {}
    for language in LANGUAGES:
        translated_by_locale[language["slug"]] = translate_many(common_sources, language)

    index_pages = {}
    guide_pages = {}
    changed_ja_links = 0
    changed_en_links = 0
    for language in LANGUAGES:
        locale = language["slug"]
        translated = translated_by_locale[locale]
        index_body = render_index(language, translated, selected)
        old_index = existing_indexes[locale]
        index_page = e.get_or_save_page(
            wp, locale, 0, INDEX_MARK,
            language["label"] + " | " + translated[COMMON_TEXT[4]],
            index_body, translated[COMMON_TEXT[11]],
            old_index.get("status", "draft") if old_index else "draft",
        )
        if int(index_page.get("parent", 0)) != 0:
            raise RuntimeError("Language index is not a root page: " + locale)
        index_pages[locale] = index_page
        guide_pages[locale] = {}
        for character in CHARACTER_BATCH:
            english_url = english_guides[character].get("link") if english_guides[character] else None
            body = render_guide(character, language, translated, selected, entries_by_code, english_url)
            old = existing_guides[locale].get(character)
            title = CHARACTER_NAMES[character][locale] + " | " + translated[COMMON_TEXT[1]]
            page = e.get_or_save_page(
                wp, character, index_page["id"], GUIDE_MARK, title, body,
                translated[PROFILES[character]["summary"]],
                (old or {}).get("status", "draft"),
            )
            guide_pages[locale][character] = page

    # Publish parents first so WordPress creates stable hierarchical URLs.
    published_indexes = {}
    published_guides = {}
    for language in LANGUAGES:
        locale = language["slug"]
        published_indexes[locale] = publish_page(wp, index_pages[locale])
        expected_index = locale_index_url(locale)
        if published_indexes[locale].get("link", "").rstrip("/") != expected_index.rstrip("/"):
            raise RuntimeError("Unexpected language index URL: " + str(published_indexes[locale].get("link")))
        published_guides[locale] = {}
        for character in CHARACTER_BATCH:
            published = publish_page(wp, guide_pages[locale][character])
            expected_guide = locale_guide_url(locale, character)
            if published.get("link", "").rstrip("/") != expected_guide.rstrip("/"):
                raise RuntimeError("Unexpected localized guide URL: " + str(published.get("link")))
            published_guides[locale][character] = published

    # Link the new locale guides from the matching Japanese and English pages.
    for character in CHARACTER_BATCH:
        ja = c.CHARACTERS[character]
        body = (
            '<section lang="ja"><h2>他の言語のキャラクター紹介</h2><p>'
            + " · ".join('<a href="' + html.escape(locale_guide_url(x["slug"], character), quote=True) + '">' + html.escape(x["label"]) + "</a>" for x in LANGUAGES)
            + "</p></section>"
        )
        _, changed = update_content(wp, ja[0], JA_LINK_START, JA_LINK_END, body)
        changed_ja_links += int(changed)
        en_guide = english_guides[character]
        if en_guide:
            en_body = (
                '<section lang="en"><h2>Character guides in other languages</h2><p>'
                + " · ".join('<a href="' + html.escape(locale_guide_url(x["slug"], character), quote=True) + '">' + html.escape(x["label"]) + "</a>" for x in LANGUAGES)
                + "</p></section>"
            )
            _, changed = update_content(wp, en_guide["id"], EN_GUIDE_START, EN_GUIDE_END, en_body)
            changed_en_links += int(changed)

    en_index_body = (
        '<section lang="en"><h2>Character guides in Chinese, Korean and Spanish</h2><p>'
        + " · ".join('<a href="' + html.escape(locale_index_url(x["slug"]), quote=True) + '">' + html.escape(x["label"]) + "</a>" for x in LANGUAGES)
        + "</p></section>"
    )
    _, en_index_changed = update_content(wp, en_directory["id"], EN_INDEX_START, EN_INDEX_END, en_index_body)

    verify_targets = []
    for language in LANGUAGES:
        locale = language["slug"]
        verify_targets.append((published_indexes[locale]["link"], INDEX_MARK))
        for character in CHARACTER_BATCH:
            verify_targets.append((published_guides[locale][character]["link"], GUIDE_MARK))
    for character in CHARACTER_BATCH:
        verify_targets.append((ja_pages[character]["link"], JA_LINK_START))
        en_guide = english_guides[character]
        if en_guide:
            verify_targets.append((en_guide["link"], EN_GUIDE_START))
    verify_targets.append((rest_page(wp, en_directory["id"])["link"], EN_INDEX_START))

    with ThreadPoolExecutor(max_workers=8) as pool:
        canonical_counts = list(pool.map(lambda pair: public_verify(*pair), verify_targets))
    googlebot, urls, sitemap_count = e.sitemap_urls()
    url_set = {item.rstrip("/") for item in urls}
    missing = [url for url, _ in verify_targets if url.rstrip("/") not in url_set]
    if missing:
        time.sleep(10)
        googlebot, urls, sitemap_count = e.sitemap_urls()
        url_set = {item.rstrip("/") for item in urls}
        missing = [url for url, _ in verify_targets if url.rstrip("/") not in url_set]
    if missing:
        raise RuntimeError("Multilingual pages are missing from the published sitemap: " + str(len(missing)))
    blocked = [url for url, _ in verify_targets if not googlebot.can_fetch("Googlebot", url)]
    if blocked:
        raise RuntimeError("Googlebot is blocked from %d multilingual pages." % len(blocked))

    report = {
        "japaneseAndEnglishProducts": 1000,
        "charactersLocalized": list(CHARACTER_BATCH),
        "languages": [x["slug"] for x in LANGUAGES],
        "languageIndexesPublished": len(published_indexes),
        "characterGuidesPublished": sum(len(x) for x in published_guides.values()),
        "japaneseCharacterPagesUpdated": changed_ja_links,
        "englishCharacterGuidesUpdated": changed_en_links,
        "englishDirectoryUpdated": int(en_index_changed),
        "productCardsByCharacter": {key: len(selected[key]) for key in CHARACTER_BATCH},
        "charactersWithNoProductCards": [key for key in CHARACTER_BATCH if not selected[key]],
        "publishedPagesVerified": len(verify_targets),
        "canonicalTagsObserved": sum(canonical_counts),
        "pagesWithDuplicateCanonicalTags": sum(1 for count in canonical_counts if count > 1),
        "googlebotAllowed": True,
        "sitemapPagesFound": len(urls),
        "sitemapsChecked": sitemap_count,
        "hreflangHeadMarkup": "not managed by page content REST",
    }
    __import__("pathlib").Path("multilingual-character-guides-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print("MULTILINGUAL CHARACTER GUIDES COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main():
    argparse.ArgumentParser().parse_args()
    run()


if __name__ == "__main__":
    main()
