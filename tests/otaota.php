<?php
define('OTAOTA_TEST',true);
require __DIR__.'/../server/lolipop/otaota.php';
function ota_check($condition){if(!$condition)throw new RuntimeException('otaota test failed');}
foreach(['サンリオ','ハローキティ','クロミ','Sanrio','Hello Kitty','ポチャッコ','ウサハナ'] as $term)ota_check(ota_excluded('新商品 '.$term));
foreach(['ディズニー','ちいかわ','ポケモン','ぬい活'] as $term)ota_check(!ota_excluded($term));
ota_check(news_url('https://prtimes.jp.evil.example/main/html/rd/p/1.2.html')==='');
$source="\n\n出典：PR TIMES\nhttps://prtimes.jp/main/html/rd/p/000000001.000000001.html";
ota_check(post_ai_weight(str_repeat('あ',100).$source)<=280);
ota_check(post_ai_weight(str_repeat('あ',130))<=280);
ota_check(post_ai_weight(str_repeat('あ',130).$source)>280);
ota_check(post_ai_weight(str_repeat('あ',141))>280);
ota_check(ota_topic("ちいかわの新作")==="chiikawa");
ota_check(ota_topic("Pokémonのグッズ")==="pokemon");
ota_check(ota_topic("ディズニーの新作")==="disney");
ota_check(ota_topic("リラックマの新商品")==="sanx");
ota_check(ota_topic("すみっコぐらしの新商品")==="sanx");
ota_check(ota_topic("他社のお知らせ")==="");
echo "otaota exclusion and URL checks passed\n";

$bandai='<ul id="productList"><li><a href="https://www.bandai.co.jp/candy/products/2026/4570117923098000.html"><span class="itemName">ちいかわ 缶バッジ</span></a></li><li><a href="https://www.bandai.co.jp/candy/products/2026/4570117923098001.html"><span class="itemName">サンリオ クロミ</span></a></li></ul>';
$rows=ota_manufacturer_rows($bandai,'bandai');ota_check(count($rows)===1&&$rows[0]['otaTopic']==='chiikawa'&&!isset($rows[0]['image']));
$arts='<a href="/items/item.html?n=Y904455"><p class="name">ディズニー フィギュア</p></a>';
$rows=ota_manufacturer_rows($arts,'takara');ota_check(count($rows)===1&&$rows[0]['otaTopic']==='disney');
