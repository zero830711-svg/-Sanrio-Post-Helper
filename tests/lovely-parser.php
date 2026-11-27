<?php
define('LW_TEST_ONLY',true);
require __DIR__.'/../server/lolipop/lovely-watch.php';
function lw_check($value){if(!$value)throw new RuntimeException('Linked product filtering failed');}
function fixture_article(string $id,string $links):string{
 return '<article class="post-list"><h2 class="entry-title">サンリオ新商品 '.$id.'</h2><a rel="bookmark" href="https://lovely-fancy.net/sanrio/2026/'.$id.'/">本文</a><time>2026.10.03</time><div class="btn-float">'.$links.'</div></article>';
}
$unsupported=fixture_article('100','<a href="https://www.animate-onlineshop.jp/products/detail.php?product_id=123">アニメイト通販</a>');
$search=fixture_article('101','<a href="https://www.amazon.co.jp/s?k=sanrio">Amazonで検索</a><a href="https://search.rakuten.co.jp/search/mall/sanrio/">楽天で検索</a>');
$rakuten=fixture_article('102','<a href="https://item.rakuten.co.jp/testshop/sanrio/">楽天</a>');
$amazon=fixture_article('103','<a href="https://www.amazon.co.jp/dp/B012345678">Amazon</a>');
$wrapped=fixture_article('104','<a href="https://af.moshimo.com/af/c/click?url='.rawurlencode('https://item.rakuten.co.jp/testshop/sanrio2/').'">楽天</a>');
$missing=fixture_article('105','');
$rows=lw_list($unsupported.$search.$rakuten.$amazon.$wrapped.$missing,true);
lw_check(count($rows)===3);
lw_check(array_column($rows,'url')===['https://lovely-fancy.net/sanrio/2026/102/','https://lovely-fancy.net/sanrio/2026/103/','https://lovely-fancy.net/sanrio/2026/104/']);
lw_check($rows[0]['productIds']===['rakuten:testshop:sanrio']);
lw_check($rows[1]['productIds']===['asin:B012345678']);
lw_check($rows[2]['productIds']===['rakuten:testshop:sanrio2']);
lw_check(lw_list($unsupported.$search.$missing,true)===[]);
lw_check(lw_next_page($unsupported.'<a class="next" href="/page/2/">次へ</a>',1)===2);
$rejected=false;try{lw_list('<p>構造が変わりました</p>',true);}catch(RuntimeException $e){$rejected=true;}lw_check($rejected);
echo "Amazon/Rakuten candidate filtering and empty-page pagination passed\n";

// Fashion discovery spans brands; no invented release date or replacement of affiliate URLs.
$fashionRow=['itemCode'=>'studioclip:rk4656','itemName'=>'サンリオ コーム [Rakuten Fashion]','itemUrl'=>'https://item.rakuten.co.jp/studioclip/rk4656/','mediumImageUrls'=>[['imageUrl'=>'https://image.rakuten.co.jp/stylife/cabinet/photo.jpg']]];
$fashion=lw_fashion_data(['items'=>[$fashionRow,$fashionRow],'pageCount'=>2],['affiliateId'=>'fixture'],1);
lw_check(count($fashion['items'])===1&&$fashion['nextPage']===2);
lw_check($fashion['items'][0]['source']==='楽天ファッション'&&$fashion['items'][0]['date']==='');
lw_check(count($fashion['items'][0]['productInfo']['images'])===1);
lw_check(lw_fashion_data(['items'=>[$fashionRow]],['affiliateId'=>'fixture'],1,$fashionRow['itemUrl'],$fashionRow['itemCode'])['item']['url']===$fashionRow['itemUrl']);
$bad=$fashionRow;$bad['itemName']='別の商品';
$rejected=false;try{lw_fashion_item($bad,['affiliateId'=>'fixture']);}catch(RuntimeException $e){$rejected=true;}lw_check($rejected);
echo "Fashion cross-brand discovery, deduplication, photos and exact identity passed\n";

// Exact JAN matching stays separate from keyword results and bundles.
$jan='4904810959199';
$rakutenItem=['itemCode'=>'official:'.$jan,'itemName'=>'ぷにるんず サンリオキャラクターズ','itemUrl'=>'https://item.rakuten.co.jp/official/'.$jan.'/'];
lw_check(lw_retailer_rakuten_match(['items'=>[$rakutenItem]],$jan,'official')===$rakutenItem);
lw_check(lw_retailer_rakuten_match(['items'=>[$rakutenItem]],$jan,'another')===null);
$bundle=array_replace($rakutenItem,['itemName'=>'ぷにるんず 2個セット']);
lw_check(lw_retailer_rakuten_match(['items'=>[$bundle]],$jan,'official')===null);
$unconfirmed=array_replace($rakutenItem,['itemCode'=>'official:toy','itemUrl'=>'https://item.rakuten.co.jp/official/toy/','itemCaption'=>'ほかの商品もあります '.$jan]);
lw_check(lw_retailer_rakuten_match(['items'=>[$unconfirmed]],$jan,'official')===null);
echo "JAN identity and bundle rejection passed\n";
$takaraPage='<a class="ItemImageLink_SearchResultItemImageLink__link" href="https://store.shopping.yahoo.co.jp/takaratomymall/4904810959199.html?sc_i=fixture"><span><img alt="ぷにるんず サンリオキャラクターズ" src="https://item-shopping.c.yimg.jp/i/j/takaratomymall_4904810959199?resolution=2x"></span></a>';
$takaraItems=lw_retailer_list($takaraPage,'takara',true)['items'];
lw_check(count($takaraItems)===1&&$takaraItems[0]['url']==='https://store.shopping.yahoo.co.jp/takaratomymall/4904810959199.html');
lw_check($takaraItems[0]['jan']===$jan);
lw_check(lw_official_image('https://item-shopping.c.yimg.jp/i/n/takaratomymall_4904810959199_i_20250723174904')!=='');
echo "Takara storefront canonical product URLs and dated photos passed\n";

$epochList='<div class="item_box"><div class="item_img"><img src="img/catalog/item/w162.jpg"></div><div class="itemname"><a href="item/w162.php">サンリオ スイーツパーティー</a></div><div class="brand_copy">© SANRIO CO., LTD.</div></div>';
$epochItem=lw_retailer_list($epochList,'epoch')['items'][0];
lw_check($epochItem['url']==='https://epoch.jp/ty/whip/item/w162.php');
lw_check($epochItem['thumbnail']==='https://epoch.jp/ty/whip/img/catalog/item/w162.jpg');
$epochProduct='<h1><img alt="サンリオ スイーツパーティー"></h1><img src="../img/catalog/item/box-w162.jpg"><div class="box_shop"><a href="https://joshinweb.jp/toy/32773/4905040323613.html">購入</a><a href="https://amzn.asia/d/Example">Amazon</a></div>';
$epochDetail=lw_retailer_detail($epochProduct,$epochItem['url'],'epoch');
lw_check($epochDetail['jan']==='4905040323613'&&$epochDetail['manufacturerAmazon']==='https://amzn.asia/d/Example');
lw_check($epochDetail['productInfo']['images']===['https://epoch.jp/ty/whip/img/catalog/item/box-w162.jpg']);
$sunUrl='https://shop.sun-star-st.jp/c/character/sanrio/sanrio-seal/s88221-3';
$sunImg='https://sunstarst.itembox.cloud/product/001/000000000133/000000000133-01.jpg';
$sunDetail=lw_retailer_detail('<meta property="og:title" content="サンリオ シール | サンスター文具公式オンラインストア"><meta property="og:image" content="'.$sunImg.'"><script type="application/ld+json">{"gtin13":"4901770758381"}</script>',$sunUrl,'sunstar');
lw_check(lw_article_url($sunUrl)===$sunUrl&&$sunDetail['productInfo']['images']===[$sunImg]&&$sunDetail['jan']==='4901770758381');
echo "Epoch manufacturer links and Sun-Star product identifiers passed\n";

$kawadaUrl='https://kawadabase.com/shop/products/4972825229064';
$kawadaImage='https://d2w53g1q050m78.cloudfront.net/kawadabasecom/ec_assets/f507e831ed9dd9966f4cde1a73982f1bedb0e362-original.?1762879499';
$kawada=lw_retailer_list('<div class="Common_ItemList01_Box"><a href="/shop/products/4972825229064"><img alt="ナノブロック ハローキティ" src="'.$kawadaImage.'"></a></div>','kawada')['items'];
lw_check($kawada[0]['url']===$kawadaUrl&&$kawada[0]['jan']==='4972825229064'&&$kawada[0]['thumbnail']===$kawadaImage);
$beverlyUrl='https://be-en.co.jp/products/sp-002';
$beverlyImage='http://be-en.co.jp/cdn/shop/files/product-photo.jpg?v=1716951496';
$beverly=lw_retailer_detail('<meta property="og:title" content="シナモロール"><meta property="og:image" content="'.$beverlyImage.'"><script type="application/ld+json">{"gtin13":4977524891819}</script>',$beverlyUrl,'beverly');
lw_check($beverly['jan']==='4977524891819'&&$beverly['manufacturerInfo']['facts']['型番']==='SP-002');
lw_check($beverly['productInfo']['images']===['https://be-en.co.jp/cdn/shop/files/product-photo.jpg?v=1716951496']);
echo "Kawada and Beverly official identifiers and photos passed\n";
