<?php
define('SPH_NEWS_TEST',true);require __DIR__.'/../server/lolipop/news.php';
function bandai_check(bool $ok):void{if(!$ok)throw new RuntimeException('Bandai parser assertion failed.');}
$candyUrl='https://www.bandai.co.jp/candy/products/2026/4570117934759000.html';$toyUrl='https://toy.bandai.co.jp/ja/item/01_21086/';
foreach([$candyUrl,$toyUrl] as $url)bandai_check(news_url($url)===$url);
foreach([$candyUrl.'?redirect=bad',$toyUrl.'#bad','https://toy.bandai.co.jp.evil.example/ja/item/01_21086/','https://www.bandai.co.jp/candy/products/2026/../bad.html'] as $url)bandai_check(news_url($url)==='');
$now=strtotime('2026-10-05');$candy=news_bandai_rows(file_get_contents(__DIR__.'/bandai-candy-list.html'),'candy',$now);$toys=news_bandai_rows(file_get_contents(__DIR__.'/bandai-toys-list.html'),'toys',$now);
bandai_check(count($candy)===20);bandai_check(count($toys)===10);bandai_check($candy[0]['schedule']==='発売時期：2027年3月');bandai_check($candy[0]['date']==='');bandai_check($toys[0]['schedule']==='発売時期：2026年12月26日');
bandai_check(news_bandai_period('2027.2発売')==='2027年2月');bandai_check(news_bandai_period('2026.10.5発売')==='2026年10月5日');bandai_check(news_bandai_period('2026.2.31発売')==='');
bandai_check(!news_bandai_rows(file_get_contents(__DIR__.'/bandai-candy-list.html'),'candy',strtotime('2028-10-05')));
// Reject an unrelated title and an unrelated classification even on the Sanrio list.
$toyList=file_get_contents(__DIR__.'/bandai-toys-list.html');bandai_check(count(news_bandai_rows(str_replace(' sanrio',' other',$toyList),'toys',$now))===0);
$cd=news_parse(file_get_contents(__DIR__.'/bandai-candy-detail.html'),$candyUrl);$td=news_parse(file_get_contents(__DIR__.'/bandai-toys-detail.html'),$toyUrl);
bandai_check($cd['title']==='サンリオキャラクターズ ぶどうたべくらべGUMMY');bandai_check($cd['schedule']==='発売時期：2026年10月5日');bandai_check(count($cd['images'])===7);bandai_check(strpos(implode(' ',$cd['paragraphs']),'軽減税率')===false);
bandai_check($td['title']==='ぷちとも Sanrio characters みんなでクリスマス');bandai_check($td['schedule']==='発売時期：2026年10月10日');bandai_check(count($td['images'])===8);bandai_check($td['date']==='');
$reservation=news_parse(file_get_contents(__DIR__.'/bandai-toys-reservation-detail.html'),'https://toy.bandai.co.jp/ja/item/01_21221/');bandai_check($reservation['schedule']==='予約開始：2026年09月11日 ／ 予約終了：2026年11月27日');bandai_check(strpos($reservation['schedule'],'発売')===false);
foreach([['bandai-candy-detail.html','https://www.bandai.co.jp/candy/products/2026/4570117930676000.html'],['bandai-toys-detail.html','https://toy.bandai.co.jp/ja/item/01_99999/']] as [$file,$url]){$failed=false;try{news_parse(file_get_contents(__DIR__.'/'.$file),$url);}catch(RuntimeException $e){$failed=true;}bandai_check($failed);}
// Related products outside the verified gallery must never become shared images.
$extra='<img src="https://bandai-a.akamaihd.net/bc/img/model/xl/99999999_1.jpg">';$scoped=news_parse(file_get_contents(__DIR__.'/bandai-toys-detail.html').$extra,$toyUrl);bandai_check(strpos(implode(' ',$scoped['images']),'99999999')===false);
foreach([$cd,$td,$reservation] as $item){bandai_check($item['tipsOnly']===true);bandai_check(strpos(ai_cute_suffix($item),'http')===false);bandai_check(strpos(ai_cute_suffix($item),'詳細')===false);}
echo "Bandai lists, Sanrio classification, identity, release/reservation precision and scoped photos passed\n";
