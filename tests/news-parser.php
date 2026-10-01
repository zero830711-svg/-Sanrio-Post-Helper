<?php
define('SPH_NEWS_TEST',true);
require __DIR__.'/../server/lolipop/news.php';
function check($v){if(!$v)throw new RuntimeException('News parser check failed');}
$url='https://prtimes.jp/main/html/rd/p/000000122.000013308.html';
$a=news_parse('<html><h1>サンリオ 新作</h1><div id="press-release-body"><p>10月上旬発売予定のコラボレーション商品です。</p><img src="https://prcdn.freetls.fastly.net/release_image/13308/122/test-1.png"><img src="https://evil.example/image.png"></div><img src="https://prcdn.freetls.fastly.net/release_image/13308/122/sidebar.png"></html>',$url);
check($a['title']==='サンリオ 新作');check(count($a['images'])===1);check(count($a['paragraphs'])===1);
check(news_url('https://prtimes.jp.evil.example/main/html/rd/p/1.2.html')==='');
check(news_url('https://user@prtimes.jp/main/html/rd/p/1.2.html')==='');
check(news_image_url('https://prcdn.freetls.fastly.net.evil.example/release_image/1/2/a.png')==='');
check(news_url($url)===$url);
$b=news_parse('<h1>公式商品</h1><section class="c-detail-head"><div class="c-detail-date">2026/10/01</div><p>10月7日から11月8日まで開催します。</p><img src="https://www.sanrio.co.jp/wp-content/uploads/2026/10/main.jpg"></section><section class="c-detail-content"><p>価格は1,290円（税込）です。</p><p>送料は500円です。</p><img src="https://www.sanrio.co.jp/wp-content/uploads/2026/10/sub.jpg"></section>','https://www.sanrio.co.jp/news/goods/test-20261001/');
check($b['date']==='2026/10/01');check(count($b['images'])===2);check(count($b['facts'])===2);
check($b['facts'][0]['kind']==='schedule');check($b['facts'][1]['text']==='価格は1,290円（税込）です。');
echo "News parser and URL validation passed\n";
