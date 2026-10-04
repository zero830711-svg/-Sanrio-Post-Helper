<?php
define('SPH_NEWS_TEST',true);require __DIR__.'/../server/lolipop/news.php';
function gasha_check(bool $ok):void{if(!$ok)throw new RuntimeException('Gashapon assertion failed.');}
$url='https://gashapon.jp/products/detail.php?jan_code=4582770054712000';$resaleUrl='https://gashapon.jp/products/detail.php?jan_code=4570118183781000';
gasha_check(news_url($url)===$url);gasha_check(news_url(str_replace('gashapon.jp','www.gashapon.jp',$url))===$url);
foreach([$url.'&next=evil',$url.'#test','http://gashapon.jp/products/detail.php?jan_code=4582770054712000','https://gashapon.jp.evil.example/products/detail.php?jan_code=4582770054712000','https://gashapon.jp/products/detail.php?jan_code=1'] as $bad)gasha_check(news_url($bad)==='');
$rows=news_gashapon_rows(file_get_contents(__DIR__.'/gashapon-list.html'),strtotime('2026-10-05'));gasha_check(count($rows)===3);gasha_check(strpos($rows[0]['title'],'HELLOKITTY')===0);gasha_check($rows[1]['url']===$url);gasha_check($rows[1]['date']==='');gasha_check(strpos($rows[2]['title'],'チアリステイルズ')!==false);gasha_check(!news_gashapon_rows(file_get_contents(__DIR__.'/gashapon-list.html'),strtotime('2028-10-05')));
$item=news_parse(file_get_contents(__DIR__.'/gashapon-detail.html'),$url);gasha_check($item['title']==='サンリオキャラクターズ モノトーンマスコット');gasha_check(count($item['images'])===6);gasha_check($item['resale']===false);gasha_check($item['schedule']==='発売時期：2026年10月第2週（地域・店舗により異なります）');gasha_check(in_array('種類数：全5種',$item['paragraphs'],true));
$resale=news_parse(file_get_contents(__DIR__.'/gashapon-resale.html'),$resaleUrl);gasha_check($resale['resale']===true);gasha_check(strpos($resale['schedule'],'再販時期：2026年9月第3週')===0);gasha_check($resale['date']==='');gasha_check(!strpos(ai_cute_suffix($resale),'http'));
$failed=false;try{news_parse(file_get_contents(__DIR__.'/gashapon-detail.html'),$resaleUrl);}catch(RuntimeException $e){$failed=true;}gasha_check($failed);
$scoped=news_parse(file_get_contents(__DIR__.'/gashapon-detail.html').'<img src="https://bandai-a.akamaihd.net/bc/img/model/xl/99999999_1.jpg">',$url);gasha_check(strpos(implode(' ',$scoped['images']),'99999999')===false);
news_gashapon_validate_body('🎀 10月第2週発売予定。地域・店舗により異なります。',$item);
news_gashapon_validate_body('🎀 再販です。9月第3週発売予定。店舗により時期が異なります。',$resale);
foreach([['🎀 10月2日発売',$item],['🎀 10月第2週発売',$item],['🎀 10月第5週発売予定。店舗により異なります。',$item],['🎀 新作です。',$resale],['🎀 再販の新登場商品です。',$resale],['🎀 詳細はこちら',$item]] as [$body,$entry]){$failed=false;try{news_gashapon_validate_body($body,$entry);}catch(RuntimeException $e){$failed=true;}gasha_check($failed);}
$drafts=array_fill(0,3,['body'=>'🎀 再販の新作商品です。']);$failed=false;try{ai_cute_validate(json_encode(['drafts'=>$drafts],JSON_UNESCAPED_UNICODE),$resale);}catch(RuntimeException $e){$failed=true;}gasha_check($failed);
echo "Gashapon canonical JAN, character filtering, scoped photos, weekly release and resale drafts passed\n";
