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
echo "News parser and URL validation passed\n";
