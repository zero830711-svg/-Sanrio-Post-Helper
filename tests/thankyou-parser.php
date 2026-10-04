<?php
define('SPH_NEWS_TEST',true);require __DIR__.'/../server/lolipop/news.php';
function thankyou_check($ok){if(!$ok)throw new RuntimeException('Thankyou news check failed');}
$rows=news_thankyou_rows(file_get_contents(__DIR__.'/thankyou-feed.xml'),strtotime('2026-10-05'));
thankyou_check(count($rows)===4);thankyou_check(count(news_thankyou_rows(file_get_contents(__DIR__.'/thankyou-feed.xml'),strtotime('2028-10-05')))===0);
$url='https://thankyoumart.jp/blogs/news/kuromi';$item=news_parse(file_get_contents(__DIR__.'/thankyou-detail.html'),$url);
thankyou_check($item['source']==='サンキューマート'&&$item['tipsOnly']);thankyou_check(count($item['images'])>0);thankyou_check($item['facts']===[]&&$item['schedule']==='');thankyou_check(strpos(implode(' ',$item['paragraphs']),'上限数')!==false);
thankyou_check(!news_image_url('https://cdn.shopify.com/s/files/1/9999/4934/0569/files/test.jpg'));thankyou_check(!news_url($url.'?redirect=https://example.com'));
$failed=false;try{news_parse(file_get_contents(__DIR__.'/thankyou-detail.html'),'https://thankyoumart.jp/blogs/news/other');}catch(RuntimeException $e){$failed=true;}thankyou_check($failed);
$xml=file_get_contents(__DIR__.'/thankyou-feed.xml');thankyou_check(!news_thankyou_rows(str_replace('クロミ','他作品',preg_replace('/<entry>.*?サンリオ.*?<\/entry>/s','',$xml)),strtotime('2028-10-05')));
echo "Thankyou character filtering, article identity, scoped images and sale conditions passed\n";

$tmp=tempnam(sys_get_temp_dir(),'thankyou-');try{file_put_contents($tmp,file_get_contents(__DIR__.'/thankyou-feed.xml'));touch($tmp,strtotime('2026-10-05'));thankyou_check(count(news_thankyou_snapshot(null,strtotime('2026-10-05'),$tmp))===4);$failed=false;try{news_thankyou_snapshot(null,strtotime('2026-10-05')+10801,$tmp);}catch(RuntimeException $e){$failed=true;}thankyou_check($failed);}finally{unlink($tmp);}
echo "Hourly feed fallback and stale snapshot rejection passed\n";
