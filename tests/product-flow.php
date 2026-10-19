<?php
declare(strict_types=1);
define('SPH_FLOW_TEST',true);
require __DIR__.'/../server/lolipop/product-flow.php';
function pf_check(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
$jan='4901234567894';$other='4901234567887';$aid='12345678.12345678.12345678.12345678';
pf_check(pf_settings()['dailyLimit']===20,'Daily draft limit was not raised to 20');
pf_check(in_array('サンリオ',pf_stock_queries(),true)&&in_array('クロミ グッズ',pf_stock_queries(),true),'Broad Sanrio Rakuten queries missing');
pf_check(!isset(pf_stock_expire_prices([['price'=>1200,'sourceAt'=>time()-86401,'sourceLabel'=>'楽天市場・在庫あり']])[0]['price'])&&pf_stock_expire_prices([['price'=>1200,'sourceAt'=>time()-3600]],time())[0]['price']===1200,'Expired Rakuten price was retained or fresh price was removed');
pf_check(pf_stock_expire_prices([['price'=>1320,'sourceAt'=>time()-86401,'sourceLabel'=>'楽天ブックス・在庫あり','service'=>'books']])[0]['sourceLabel']==='楽天ブックスの商品候補','Expired Rakuten Books availability label was retained');
pf_check(pf_stock_related(['itemName'=>'クロミ ぬいぐるみ'])&&!pf_stock_related(['itemName'=>'別キャラクター 商品']),'Sanrio stock item filtering failed');
pf_check(pf_stock_used(['attempted'=>['rakuten-shop:item'=>time()]],'shop:item'),'Prepared stock item was not deduplicated');
pf_check(pf_jan($jan)&&!pf_jan('4901234567890'),'JAN check digit validation failed');
pf_check(pf_google_books_cover('not-an-isbn')==='','Invalid ISBN reached the Google Books lookup');
$thumbnail='https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/kitty.jpg?_ex=128x128';
$marketImage=pf_image_url($thumbnail);
pf_check($marketImage==='https://image.rakuten.co.jp/shop/cabinet/kitty.jpg?_ex=128x128','Rakuten market thumbnail was not normalized');
pf_check(pf_image_fetch_candidates($marketImage)===['https://image.rakuten.co.jp/shop/cabinet/kitty.jpg'],'Post photo did not prefer the original Rakuten image');
$catalogAffiliate='https://hb.afl.rakuten.co.jp/hgc/'.$aid.'/?pc='.rawurlencode('https://item.rakuten.co.jp/testshop/cinna/');
$catalogCandidate=pf_catalog_candidate(['itemCode'=>'testshop:cinna','itemName'=>'シナモロール ぬいぐるみ','itemUrl'=>'https://item.rakuten.co.jp/testshop/cinna/','affiliateUrl'=>$catalogAffiliate,'mediumImageUrls'=>[['imageUrl'=>$thumbnail]],'shopName'=>'テスト店']);
pf_check(is_array($catalogCandidate)&&$catalogCandidate['image']==='https://image.rakuten.co.jp/shop/cabinet/kitty.jpg'&&$catalogCandidate['affiliate']===$catalogAffiliate,'Cinnamoroll catalog image/link normalization failed');
pf_check(pf_catalog_candidate(['itemCode'=>'testshop:kitty','itemName'=>'ハローキティ ぬいぐるみ','itemUrl'=>'https://item.rakuten.co.jp/testshop/kitty/','affiliateUrl'=>$catalogAffiliate,'mediumImageUrls'=>[['imageUrl'=>$thumbnail]]])===null,'Non-Cinnamoroll item entered the Cinnamoroll catalog');
pf_check(!pf_image_large_enough([128,128])&&!pf_image_large_enough([599,1500])&&!pf_image_large_enough([800,899]),'Low resolution photo was accepted');
pf_check(pf_image_large_enough([600,900])&&pf_image_large_enough([1200,800]),'Usable photo was rejected');
$tshop='https://tshop.r10s.jp/shop/cabinet/kitty.jpg?fitin=128%3A128';
pf_check(pf_image_fetch_candidates(pf_image_url($tshop))===['https://tshop.r10s.jp/shop/cabinet/kitty.jpg'],'tshop thumbnail did not prefer the original image');
$highResBook=pf_rakuten_book_cover_from_html('<img src="https://shop.r10s.jp/book/cabinet/9555/9784065439555_1_2.jpg?composite-to=%2A%2C%2A%7C560%3A400&amp;fitin=560%3A400">','9784065439555');
pf_check($highResBook==='https://shop.r10s.jp/book/cabinet/9555/9784065439555_1_2.jpg','Rakuten Books original cover URL was not selected');
$gallery=pf_rakuten_book_images_from_html('https://shop.r10s.jp/book/cabinet/9555/9784065439555_1_2.jpg?fitin=560%3A400 https://shop.r10s.jp/book/cabinet/9555/9784065439555_2_2.jpg?fitin=560%3A400 https://shop.r10s.jp/book/cabinet/9555/9784065439556_1_2.jpg','9784065439555');
pf_check(count($gallery)===2&&$gallery[0]==='https://shop.r10s.jp/book/cabinet/9555/9784065439555_1_2.jpg'&&$gallery[1]==='https://shop.r10s.jp/book/cabinet/9555/9784065439555_2_2.jpg','Rakuten Books gallery images were not extracted as unresized original URLs');
pf_check(pf_rakuten_book_cover_from_html('https://shop.r10s.jp/book/cabinet/9555/9784065439556_1_2.jpg','9784065439555')==='','A different ISBN image was accepted');
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

$stockState=[];
$stock=pf_prepare_stock(['code'=>'testshop:manual-generation','affiliate'=>'https://hb.afl.rakuten.co.jp/hgc/'.$aid.'/?pc=test','url'=>'https://item.rakuten.co.jp/testshop/manual-generation/','title'=>'クロミのポーチ','shop'=>'テスト店','price'=>1000,'service'=>'market','images'=>['https://image.rakuten.co.jp/testshop/cabinet/pouch.jpg']],$stockState);
pf_check($stock['body']===''&&$stock['generatedOnRequest']===false,'Stock preparation generated a body without a button request');
pf_check(pf_generated_body("クロミのポーチ\n\n🔎 詳細：\nhttps://books.rakuten.co.jp/rb/18281023/\n\n#サンリオ")==="クロミのポーチ\n\n#サンリオ",'Generated source URL was not removed');
try{pf_generated_body('https://books.rakuten.co.jp/rb/18281023/');throw new LogicException('URL-only draft accepted');}catch(RuntimeException $expected){}

$expansionQueries=pf_catalog_expansion_queries('kirimi-chan');
pf_check(count(pf_catalog_characters())===36,'Expanded catalog does not cover all 36 characters');
pf_check(count($expansionQueries)<=16&&in_array(['KIRIMIちゃん.',3],$expansionQueries,true),'Expanded catalog pagination missing or unbounded');
pf_check(in_array(['KIRIMIちゃん',1],$expansionQueries,true),'Character alias search missing');
pf_check(in_array(['KIRIMIちゃん. タオル',1],$expansionQueries,true),'Simple product-kind query missing');

// Apply the seller exclusion before grouping and to old cached drafts.
pf_check(pf_blocked_shop(['shopName'=>'TSJショップ'])&&pf_blocked_shop(['shop'=>'ＴＳＪ ショップ'])&&pf_blocked_shop(['shop'=>'TSJショップ 楽天市場店']),'Excluded seller name was not recognized');
pf_check(!pf_blocked_shop(['shop'=>'ヨツバ商店 楽天市場店'])&&!pf_blocked_shop(['shop'=>'TSJ商品取扱店']),'Unrelated seller was excluded');
$blockedOffer=['code'=>'blocked:item','shop'=>'TSJショップ','service'=>'market','title'=>'クロミのぬいぐるみ','url'=>'https://item.rakuten.co.jp/blocked/item/','affiliate'=>'https://hb.afl.rakuten.co.jp/hgc/'.$aid.'/?pc=blocked','images'=>['https://image.rakuten.co.jp/blocked/cabinet/item.jpg'],'sourceAt'=>time()];
$otherOffer=array_replace($blockedOffer,['code'=>'normal:item','shop'=>'ヨツバ商店','url'=>'https://item.rakuten.co.jp/normal/item/']);
$blockedDraft=['id'=>'blocked','item'=>['rakuten'=>true,'url'=>$blockedOffer['url'],'paragraphs'=>['販売店：TSJショップ']],'createdAt'=>time(),'body'=>'保存済み本文'];
$original=['sourcePool'=>[$blockedOffer,$otherOffer],'entries'=>['blocked'=>$blockedDraft]];
$public=pf_public($original);
pf_check(count($public['sources'])===1&&$public['sources'][0]['shop']==='ヨツバ商店'&&$public['sourcePoolCount']===1,'Cached excluded seller remained visible or affected counts');
pf_check($public['entries']===[]&&$original['entries']['blocked']['body']==='保存済み本文','Excluded draft remained visible or saved data was deleted');
$rawBlocked=['shopName'=>'TSJショップ','itemName'=>'サンリオ クロミ','itemCode'=>'blocked:item','itemUrl'=>$blockedOffer['url']];
pf_check(pf_stock_rows(['items'=>[$rawBlocked]],[],[])===[],'New excluded seller offer entered the pool');
pf_check(pf_match(['items'=>[$rawBlocked]],['jan'=>'','model'=>'','keyword'=>'クロミ'],'クロミ',['affiliateId'=>$aid])['candidates']===[],'Excluded seller remained in matching offers');
try{pf_prepare_stock($blockedOffer,$original);throw new LogicException('Excluded seller was prepared');}catch(RuntimeException $expected){}
echo "Excluded seller: new offers, cached pool, counts, saved draft visibility and preparation verified\n";
