<?php
define('OTAOTA_TEST',true);
require __DIR__.'/../server/lolipop/otaota.php';
function ota_check($condition){if(!$condition)throw new RuntimeException('otaota test failed');}
foreach(['サンリオ','ハローキティ','クロミ','Sanrio','Hello Kitty','ポチャッコ','ウサハナ'] as $term)ota_check(ota_excluded('新商品 '.$term));
foreach(['ディズニー','ちいかわ','ポケモン','ぬい活'] as $term)ota_check(!ota_excluded($term));
ota_check(news_url('https://prtimes.jp.evil.example/main/html/rd/p/1.2.html')==='');
$source="\n\n出典：PR TIMES\nhttps://prtimes.jp/main/html/rd/p/000000001.000000001.html";
ota_check(post_ai_weight(str_repeat('あ',100).$source)<=280);
ota_check(post_ai_weight(str_repeat('あ',130).$source)>280);
echo "otaota exclusion and URL checks passed\n";
