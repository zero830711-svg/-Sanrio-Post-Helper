<?php
declare(strict_types=1);
define('LW_TEST_ONLY',true);
require __DIR__.'/../server/lolipop/lovely-watch.php';
function skater_check($v,string $msg): void {if(!$v)throw new RuntimeException($msg);}
$jan='4973307091827';$url='https://www.skater-onlineshop.com/shop/g/g'.$jan.'/';
skater_check(lw_article_url($url)===$url,'Manufacturer route');
foreach([$url.'?redirect=x',$url.'#x',str_replace('https:','http:',$url),str_replace('.com/','.com.evil.test/',$url),str_replace($jan,'123',$url)] as $bad)skater_check(lw_skater_article_url($bad)==='','Strict article URL');
skater_check(lw_skater_list_url(lw_skater_page_url(20))&&!lw_skater_list_url(str_replace('_p20','_p21',lw_skater_page_url(20))),'Bounded release-order pagination');
$thumb='https://www.skater-onlineshop.com/img/goods/S/pnb1_hkt_pkg.jpg';
$row='<dl class="block-thumbnail-t--goods"><dt><img src="/img/goods/S/pnb1_hkt_pkg.jpg"></dt><dd><div class="block-thumbnail-t--goods-name"><a data-category1="サンリオ(30)" href="/shop/g/g'.$jan.'/">検索用の長い商品名</a></div><div class="variation-name">（お弁当抜き型 パン キティ）</div></dd></dl>';
$html='<div class="block-category-list--goods">'.$row.str_replace('サンリオ(30)','別ブランド(99)',str_replace($jan,'4973307103957',$row)).'<li class="pager-next"><a href="/shop/c/c30_dT_srd_p2/">次</a></li></div>'.$row;
$list=lw_skater_list($html,1);
skater_check(count($list['items'])===1&&$list['items'][0]['jan']===$jan&&$list['nextPage']===2,'Scoped Sanrio list, exact JAN, pagination');
skater_check($list['items'][0]['title']==='お弁当抜き型 パン キティ'&&$list['items'][0]['date']==='','Compact official name, no inferred date');
skater_check($list['items'][0]['thumbnail']===$thumb,'Relative thumbnail');
skater_check(lw_image_url($thumb)==='','Manufacturer preview cannot enter share proxy');
foreach([$thumb.'?redirect=x',$thumb.'#x',str_replace('/goods/','/other/',$thumb),str_replace('.com/','.com.evil.test/',$thumb),str_replace('https:','http:',$thumb)] as $bad)skater_check(lw_skater_thumbnail_url($bad)==='','Thumbnail allowlist');
$meta=['goods'=>$jan,'category_code1'=>'30','name'=>'ハローキティ 食パン抜き型 サンリオ','variation_name1'=>'お弁当抜き型','variation_name2'=>'パン キティ'];
$detail='<link rel="canonical" href="https://www.skater-onlineshop.com/shop/g/g4973307103957/"><meta property="etm:goods_detail" content="'.htmlspecialchars(json_encode($meta,JSON_UNESCAPED_UNICODE),ENT_QUOTES,'UTF-8').'"><div class="block-goods-detail"><input id="hidden_goods" value="'.$jan.'"><h1 class="block-goods-name--text">ハローキティ 食パン抜き型 サンリオ</h1><dd id="spec_goods">'.$jan.'</dd><dl class="block-goods-comment1"><dd>食パンがキティの顔型に抜けます。<br>クッキー抜き型にも使えます。<br>≪品質表示≫<br>素材：ポリプロピレン</dd></dl><div class="js-goods-img-item"><img src="/img/goods/L/pnb1_hkt_pkg.jpg"></div></div><aside>別の商品 JAN 4973307103957</aside>';
$item=lw_skater_detail($detail,$url);
skater_check($item['jan']===$jan&&$item['productInfo']['searchKeyword']===$jan,'Displayed JAN takes precedence over stale variant canonical');
skater_check(strpos(json_encode($item['manufacturerInfo'],JSON_UNESCAPED_UNICODE),'ポリプロピレン')===false,'Materials excluded');
skater_check($item['thumbnail']==='https://www.skater-onlineshop.com/img/goods/L/pnb1_hkt_pkg.jpg','Detail gallery preview');
skater_check(strpos($item['manufacturerInfo']['facts']['特徴'],'クッキー')!==false,'Scoped usage facts');
skater_check($item['productInfo']['images']===[]&&$item['products']===[],'No unverified retailer or sharing photo');
foreach([str_replace('id="hidden_goods" value="'.$jan.'"','id="hidden_goods" value="4973307103957"',$detail),str_replace('id="spec_goods">'.$jan,'id="spec_goods">4973307103957',$detail),str_replace('サンリオ','別ブランド',str_replace('&quot;30&quot;','&quot;99&quot;',$detail))] as $bad){
    $thrown=false;try{lw_skater_detail($bad,$url);}catch(RuntimeException $e){$thrown=true;}skater_check($thrown,'Mismatched displayed identity rejected');
}
$match=['itemCode'=>'casmin:10000001','itemUrl'=>'https://item.rakuten.co.jp/casmin/pnb1-kitty/','itemName'=>'ハローキティ 食パン抜き型','itemCaption'=>'JAN '.$jan];
skater_check(lw_skater_match(['items'=>[$match]],$jan)===$match,'Exact JAN match, independent API item code');
$bad=$match;$bad['itemCaption']='JAN 4973307103957';skater_check(lw_skater_match(['items'=>[$bad]],$jan)===null,'Different character rejected');
$bad=$match;$bad['itemCaption'].=' 4973307103957';skater_check(lw_skater_match(['items'=>[$bad]],$jan)===null,'Multi-variant or related JAN rejected');
$bad=$match;$bad['itemUrl']=str_replace('/casmin/','/other-shop/',$bad['itemUrl']);skater_check(lw_skater_match(['items'=>[$bad]],$jan)===null,'Wrong destination shop rejected');
$bad=$match;$bad['itemCode']='other-shop:10000001';skater_check(lw_skater_match(['items'=>[$bad]],$jan)===null,'Wrong API shop rejected');
$other=$match;$other['itemUrl']='https://item.rakuten.co.jp/casmin/another/';skater_check(lw_skater_match(['items'=>[$match,$other]],$jan)===null,'Ambiguous listings rejected');
skater_check(lw_skater_match(['count'=>31,'items'=>[$match]],$jan)===null,'Truncated results rejected');
echo "Skater parser checks passed\n";
