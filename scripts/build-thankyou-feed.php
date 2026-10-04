<?php
define('SPH_NEWS_TEST',true);require __DIR__.'/../server/lolipop/news.php';
$body=news_fetch('https://thankyoumart.jp/blogs/news.atom');$rows=news_thankyou_rows($body,time());if(!$rows)throw new RuntimeException('No verified Sanrio announcements');
$path=__DIR__.'/../server/lolipop/.thankyou-news-feed.xml';if(file_put_contents($path,$body,LOCK_EX)===false)throw new RuntimeException('Snapshot write failed');
echo count($rows)." official Sanrio announcements prepared for hosting.\n";
