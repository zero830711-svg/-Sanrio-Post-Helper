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

$bandai='<ul id="productList"><li><a href="https://www.bandai.co.jp/candy/products/2026/4570117923098000.html"><img src="https://www.bandai.co.jp/candy/published/bnc_files/product/h78/000000486850hk-product-main.jpg"><span class="itemName">ちいかわ 缶バッジ</span></a></li><li><a href="https://www.bandai.co.jp/candy/products/2026/4570117923098001.html"><span class="itemName">サンリオ クロミ</span></a></li></ul>';
$rows=ota_manufacturer_rows($bandai,'bandai');ota_check(count($rows)===1&&$rows[0]['otaTopic']==='chiikawa'&&!isset($rows[0]['image'])&&str_starts_with($rows[0]['thumbnail'],'https://www.bandai.co.jp/'));
$arts='<a href="/items/item.html?n=Y904455"><p class="name">ディズニー フィギュア</p></a>';
$rows=ota_manufacturer_rows($arts,'takara');ota_check(count($rows)===1&&$rows[0]['otaTopic']==='disney');

$bandaiHtml=file_get_contents(__DIR__.'/bandai-candy-detail.html');$bandaiHtml=preg_replace('~(<div class="itemDetailWrapper[\\s\\S]*?<h2[^>]*>).*?(</h2>)~u','$1ちいかわ の新商品$2',$bandaiHtml,1);$v=ota_bandai_parse($bandaiHtml,'https://www.bandai.co.jp/candy/products/2026/4570117934759000.html');ota_check(count($v['images'])>0&&str_contains($v['title'],'ちいかわ'));
$artsHtml=file_get_contents(__DIR__.'/arts-news-detail.html');$artsHtml=str_replace('2026年サンリオキャラクター大賞　キラキラツインチャーム','ポケモン キラキラツインチャーム',$artsHtml);$v=ota_arts_parse($artsHtml,'https://www.takaratomy-arts.co.jp/items/item.html?n=Y111372');ota_check(count($v['images'])>0&&str_contains($v['title'],'ポケモン'));
