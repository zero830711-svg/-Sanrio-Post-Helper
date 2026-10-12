<?php
declare(strict_types=1);
define('SPH_FLOW_TEST',true);
require __DIR__.'/../server/lolipop/product-flow.php';
function pf_check(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
$jan='4901234567894';$other='4901234567887';$aid='12345678.12345678.12345678.12345678';
pf_check(pf_settings()['dailyLimit']===20,'Daily draft limit was not raised to 20');
pf_check(in_array('サンリオ',pf_stock_queries(),true)&&in_array('クロミ グッズ',pf_stock_queries(),true),'Broad Sanrio Rakuten queries missing');
pf_check(pf_stock_related(['itemName'=>'クロミ ぬいぐるみ'])&&!pf_stock_related(['itemName'=>'別キャラクター 商品']),'Sanrio stock item filtering failed');
pf_check(pf_stock_used(['attempted'=>['rakuten-shop:item'=>time()]],'shop:item'),'Prepared stock item was not deduplicated');
pf_check(pf_jan($jan)&&!pf_jan('4901234567890'),'JAN check digit validation failed');
pf_check(pf_google_books_cover('not-an-isbn')==='','Invalid ISBN reached the Google Books lookup');
$identity=pf_identity(['title'=>'キティ マスコット','paragraphs'=>['JAN：'.$jan]]);
pf_check($identity['jan']===$jan&&$identity['keyword']===$jan,'Source JAN not selected');
$ambiguous=pf_identity(['title'=>'商品まとめ','paragraphs'=>[$jan.' '.$other]]);
pf_check($ambiguous['ambiguous']&&$ambiguous['jan']==='','Multiple JANs promoted to a single item');
pf_check(!pf_exact(['itemName'=>'キティ マスコット','itemCaption'=>'別商品 '.$other],$identity,'キティ マスコット'),'Different item matched');
pf_check(!pf_exact(['itemName'=>'キティ マスコット 3個セット '.$jan],$identity,'キティ マスコット'),'Bundle promoted as single item');
pf_check(!pf_exact(['itemName'=>'中古キティ '.$jan],$identity,'キティ マスコット'),'Used item promoted');
pf_check(!pf_exact(['itemName'=>'キティ '.$jan.'1'],$identity,'キティ マスコット'),'Partial JAN matched');
pf_check(!pf_exact(['itemName'=>'キティ マスコット'],['jan'=>'','model'=>'','ambiguous'=>false],'キティ マスコット'),'Name-only match auto approved');
$model=pf_identity(['title'=>'キティポーチ','paragraphs'=>['型番：KT-123']]);
pf_check(pf_fallback_keyword(['title'=>'キティの新作','paragraphs'=>[]],'ハローキティのマスコット')==='ハローキティ マスコット','Fallback product keywords missing');
pf_check($model['model']==='kt-123'&&pf_exact(['itemName'=>'キティ KT-123'],$model,'キティポーチ'),'Model match failed');
$make=static fn($shop)=>['itemCode'=>$shop.':kitty','itemName'=>'キティ マスコット '.$jan,'itemUrl'=>'https://item.rakuten.co.jp/'.$shop.'/kitty/','itemCaption'=>'','affiliateUrl'=>'https://hb.afl.rakuten.co.jp/hgc/'.$aid.'/?pc='.rawurlencode('https://item.rakuten.co.jp/'.$shop.'/kitty/'),'shopName'=>$shop,'mediumImageUrls'=>[]];
$one=pf_match(['items'=>[$make('shop1')]],$identity,'キティ マスコット',['affiliateId'=>$aid]);
pf_check($one['shopCount']===1&&$one['linkMode']==='item','Single shop link not selected');
$many=pf_match(['items'=>[$make('shop1'),$make('shop2')]],$identity,'キティ マスコット',['affiliateId'=>$aid]);
pf_check($many['shopCount']===2&&$many['linkMode']==='search','Multiple shops did not select search link');
$p=parse_url($many['link']);$query=[];parse_str($p['query'],$query);
pf_check($p['host']==='hb.afl.rakuten.co.jp'&&$query['pc']===pf_search_url($jan)&&$query['m']===$query['pc'],'Search affiliate destination encoding failed');
pf_check(pf_affiliate('https://evil.test/'.$jan,$aid)===''&&pf_affiliate(pf_search_url($jan),'bad')==='','Unsafe affiliate link generated');
$no=pf_match(['items'=>[$make('shop1')]],['jan'=>'','model'=>'','keyword'=>'キティ','ambiguous'=>false],'キティ',['affiliateId'=>$aid]);
pf_check($no['link']===''&&count($no['candidates'])===1,'Unconfirmed candidate got a link');
pf_check(!pf_eligible(['title'=>'キティ発売','date'=>'2001-01-01'],time()),'Old announcement auto selected');
pf_check(pf_eligible(['title'=>'キティ マスコット発売','date'=>date('Y-m-d',time()-20*86400)],time()),'Recent product post was excluded');
pf_check(!pf_eligible(['title'=>'キティ発売','date'=>gmdate('Y-m-d'),'prize'=>true],time()),'Prize auto selected');

$bookRows=pf_books_rows(['Items'=>[['Item'=>['title'=>'ハローキティ ぬいぐるみ絵本','itemCaption'=>'サンリオキャラクターの絵本','itemUrl'=>'https://books.rakuten.co.jp/rb/12345/','affiliateUrl'=>'https://hb.afl.rakuten.co.jp/hgc/'.$aid.'/?pc=book','largeImageUrl'=>'https://shop.r10s.jp/books/cabinet/kitty.jpg','isbn'=>'9781234567890','itemPrice'=>1320]]]],[]);
pf_check(count($bookRows)===1&&$bookRows[0]['service']==='books'&&$bookRows[0]['price']===1320,'Rakuten Books candidates were not normalized');
$hotel=['hotelNo'=>'123456','hotelName'=>'サンリオキャラクターホテル','hotelSpecial'=>'サンリオキャラクターの客室あり','hotelInformationUrl'=>'https://hb.afl.rakuten.co.jp/hgc/'.$aid.'/?pc=hotel','hotelThumbnailUrl'=>'https://img.travel.rakuten.co.jp/images/hotel/kitty.jpg','hotelMinCharge'=>12000];
$travelRows=pf_travel_rows(['hotels'=>[['hotel'=>[['hotelBasicInfo'=>$hotel]]]]],[]);
pf_check(count($travelRows)===1&&$travelRows[0]['service']==='travel'&&str_contains($travelRows[0]['sourceLabel'],'空室未確認'),'Rakuten Travel candidates were not normalized');

$file='unit-'.bin2hex(random_bytes(6));
try{pf_write($file,['body'=>'編集済み本文','mark'=>'done']);pf_check(pf_read($file)['body']==='編集済み本文','Saved draft damaged');pf_check((fileperms(pf_dir().'/'.$file.'.json')&0777)===0600,'Draft not private');}finally{unlink(pf_dir().'/'.$file.'.json');}
echo "Product identity, Rakuten Ichiba/Books/Travel candidates, wrong-item/bundle rejection, multi-shop links and private storage verified\n";
