<?php
declare(strict_types=1);
define('SPH_NEWS_TEST',true);require __DIR__.'/../server/lolipop/news.php';
function seven_check(bool $test,string $message):void{if(!$test)throw new RuntimeException($message);}
$cases=[
 'ftoys'=>['https://f-toys.net/item/test/','<a href="/item/test/"><img src="/wp-content/uploads/2026/11/test.jpg" alt="サンリオ ビーズ"></a><a href="/item/other/">別の玩具</a>'],
 'ip4'=>['https://www.ip4.co.jp/cupsuletoy/test/','<li><div><a href="/cupsuletoy/test/"><img src="/ip4_index/wp-content/uploads/2026/11/test.jpg"></a></div><dl><dt>2026年11月</dt><dd><div class="brand">クロミ</div>チャーム<div class="copy">著作権表示</div></dd></dl></li>'],
 'segaplaza'=>['https://segaplaza.jp/prize/B123/','<div class="ContainerItem"><div><a href="/prize/B123/"><img src="/images-v3/prize/B123_a/small/B123_01.webp"></a></div><a class="itemName" href="/prize/B123/">シナモロール ぬいぐるみ</a><span class="tag-text-date">2026年12月4日より順次登場</span></div>'],
 'happy'=>['https://www.h-kuji.com/goods/test/','<a class="c-cardList__link" href="/goods/test/"><h2>Happyくじ Sanrio characters</h2><img src="data:image/gif;base64,AA" data-src-img="/wp-content/uploads/2026/11/test.jpg"><span class="c-cardList__date">2026年12月4日発売予定</span></a>'],
 'kitan'=>['https://kitan.jp/products/test/','<li class="c-productBox__item"><a href="/products/test/"><img src="/wp-content/uploads/2026/11/test.jpg"></a></li>'],
 'qualia'=>['https://www.qualia-45.jp/product/view/1','<a href="/product/view/1"><img src="/media/1/2/12_255x296.jpg?t=123"></a><a href="/product/view/1">サンリオ ぬいぐるみ</a>'],
 'segafave'=>['https://www.segafave.co.jp/news/261111_1/','<a class="news-content-item" href="/news/261111_1/"><p class="date-text">2026.11.11</p><p class="title">サンリオ ぬいぐるみ</p></a>'],
];
foreach($cases as $kind=>[$url,$html]){$rows=news_seven_rows($html,$kind);seven_check(count($rows)===1&&$rows[0]['url']===$url,"$kind list");if($kind!=='kitan')seven_check(news_seven_relevant($rows[0]['title']),"$kind relevance");}
seven_check(news_seven_rows('<a href="/item/other/">関係ない玩具</a>','ftoys')===[],'unrelated product filtered');
seven_check(news_seven_rows($cases['ip4'][1],'ip4')[0]['date']==='','release is not publication date');
seven_check(news_seven_rows($cases['happy'][1],'happy')[0]['schedule']==='2026年12月4日発売予定','release schedule retained');
foreach(['https://f-toys.net/item/test/?redirect=https://evil.example/','https://evil.example/item/test/','https://www.ip4.co.jp/cupsuletoy/test/#x','http://segaplaza.jp/prize/B123/','https://127.0.0.1/item/test/'] as $url)seven_check(news_url($url)==='','invalid product URL');
foreach(['https://f-toys.net/wp-content/uploads/../secret.jpg','https://www.qualia-45.jp/media/1/2/12_255x296.jpg?redirect=evil','https://segaplaza.jp/images-v3/prize/../../private.jpg','https://evil.example/a.jpg'] as $url)seven_check(news_image_url($url)==='','invalid image URL');
$details=[
 'ftoys'=>'<div class="item-area"><h1>サンリオ ビーズ</h1><ul class="item-main-img"><li><img src="/wp-content/uploads/2026/11/test.jpg"></li></ul><div class="item-txt"><div class="item-release-info"><table><tr><th>発売日</th><td>2026.12.04</td></tr><tr><th>販売価格</th><td>500円（税込）</td></tr></table></div><p>ビーズのチャーム</p></div></div>',
 'ip4'=>'<link rel="canonical" href="https://www.ip4.co.jp/cupsuletoy/test/"><section><h1>クロミ チャーム</h1></section><article><div class="data-img"><img src="/ip4_index/wp-content/uploads/2026/11/test.jpg"></div><div class="data-read"><p>全6種類</p></div></article>',
 'segaplaza'=>'<link rel="canonical" href="https://segaplaza.jp/prize/B123/"><div class="itemDetail"><div class="itemName"><h3>シナモロール ぬいぐるみ</h3></div><div class="sampleImages"><img src="/images-v3/prize/B123_a/large/B123_01.webp"><img src="/images-v3/prize/B999_a/large/B999_01.webp"></div><span><span>2026年12月4日</span><span class="dateSuffix">より順次登場</span></span></div>',
 'happy'=>'<section class="p-goodsPost"><div class="p-goodsPost__main"><h1>Happyくじ Sanrio characters</h1><div class="p-goodsPost__info"><p>2026年12月4日発売予定</p></div><img data-src-img="/wp-content/uploads/2026/11/test.jpg"></div><section class="p-goodsRelated"><img src="/wp-content/uploads/2026/11/different-product.jpg"></section></section>',
 'kitan'=>'<link rel="canonical" href="https://kitan.jp/products/test/"><main class="p-background__contents"><div class="c-productDetail__content"><h2>サンリオ 時計</h2></div><div class="c-productDetail__thum"><img src="/wp-content/uploads/2026/11/test.jpg"></div><div class="c-productDetail__desc"><p>全5種類</p><div class="c-productDetail__detail"><dl><dt>発売日</dt><dd>2026年11月</dd></dl></div></div></main>',
 'qualia'=>'<div class="product_detail_content"><h3>サンリオ ぬいぐるみ</h3><div class="slide-media"><img src="/media/1/2/12_255x296.jpg?t=123"></div><div class="product_detail_info"><dl><dt>発売日</dt><dd>2026年11月</dd></dl></div></div>',
 'segafave'=>'<div class="news-article-container"><h2>サンリオ ぬいぐるみ</h2><p class="news-date">2026.11.11</p><div class="news-article-contents"><section class="news-article-section"><p>サンリオの新しいぬいぐるみ。</p><img src="/_nuxt/example.hash.jpg"></section></div></div>',
];
foreach($details as $kind=>$html){$d=news_parse($html,$cases[$kind][0]);seven_check($d['source']!==''&&count($d['images'])===1&&news_seven_relevant($d['title']),"$kind detail");}
seven_check(news_parse($details['ftoys'],$cases['ftoys'][0])['schedule']==='発売日：2026.12.04','F-toys facts');
seven_check(news_parse($details['segafave'],$cases['segafave'][0])['date']==='2026-11-11','Sega Fave publication date');
$many='<section class="p-goodsPost"><div class="p-goodsPost__main"><h1>Sanrio characters</h1>';
for($i=1;$i<=12;$i++)$many.='<img src="/wp-content/uploads/2026/11/item'.$i.'.jpg">';
$many.='</div><section class="p-goodsRelated"><img src="/wp-content/uploads/2026/11/other.jpg"></section></section>';
seven_check(count(news_parse($many,$cases['happy'][0])['images'])===12,'all product images and no related-product image');
$bad=str_replace('href="https://kitan.jp/products/test/"','href="https://kitan.jp/products/wrong/"',$details['kitan']);
try{news_parse($bad,$cases['kitan'][0]);throw new RuntimeException('mismatched canonical accepted');}catch(RuntimeException $e){seven_check($e->getMessage()!=='mismatched canonical accepted','identity');}
$bad=str_replace('サンリオ 時計','別キャラクター 時計',$details['kitan']);
try{news_parse($bad,$cases['kitan'][0]);throw new RuntimeException('unrelated title accepted');}catch(RuntimeException $e){seven_check($e->getMessage()!=='unrelated title accepted','relevance on detail');}
$future=news_seven_rows($cases['happy'][1],'happy')[0];$merged=news_merge_feeds([[$future]],strtotime('2026-11-11'));seven_check(count($merged)===1,'upcoming release not treated as future publication');
seven_check(!array_filter(news_feeds(),static fn($feed)=>($feed['kind']??'')==='segafave'),'removed source must not be fetched');
$retired=news_seven_rows($cases['segafave'][1],'segafave')[0];seven_check(news_merge_feeds([[$retired]],strtotime('2026-11-11'))===[],'removed source must not appear in news');
echo "Seven source lists, detail pages, image boundaries, identity, and release dates passed.\n";
