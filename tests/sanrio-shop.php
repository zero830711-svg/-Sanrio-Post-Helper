<?php
declare(strict_types=1);
define('LW_TEST_ONLY',true);require __DIR__.'/../server/lolipop/lovely-watch.php';
function sanrio_check(bool $ok,string $label):void{if(!$ok)throw new RuntimeException($label);}
$url='https://item.rakuten.co.jp/sanrio/4550337000000/';$settings=['affiliateId'=>'original-account'];
$row=['itemCode'=>'sanrio:10012345','itemName'=>'ハローキティ ポーチ','itemUrl'=>$url,'itemPrice'=>2200,'mediumImageUrls'=>[['imageUrl'=>'https://thumbnail.image.rakuten.co.jp/@0_mall/sanrio/cabinet/202610/pouch.jpg?_ex=128x128'],['imageUrl'=>'https://image.rakuten.co.jp/other/cabinet/wrong.jpg']],'affiliateUrl'=>'https://hb.afl.rakuten.co.jp/hgc/original1234/?pc='.rawurlencode($url)];
$data=lw_sanrio_data(['items'=>[$row,$row],'pageCount'=>3],$settings,1);$item=$data['items'][0];
sanrio_check(count($data['items'])===1&&$data['nextPage']===2,'Product URL deduplication and bounded pagination');
sanrio_check($item['date']===''&&$item['catalogUpdate']&&$item['priceAtFetch']===2200,'No inferred release/publication date or availability claim');
sanrio_check($item['productInfo']['itemCode']==='sanrio:10012345'&&$item['productIds']===['rakuten:sanrio:4550337000000'],'API code independent from URL identity');
sanrio_check($item['matchedAffiliate']['url']===$row['affiliateUrl'],'Original API affiliate URL preserved');
sanrio_check($item['productInfo']['images']===['https://image.rakuten.co.jp/sanrio/cabinet/202610/pouch.jpg?_ex=1200x1200'],'Only official shop photos');
sanrio_check(lw_sanrio_data(['items'=>[$row],'pageCount'=>30],$settings,20)['nextPage']===null,'Page limit');
sanrio_check(lw_sanrio_data(['items'=>[$row],'pageCount'=>1],$settings,1,$url)['item']['url']===$url,'Exact requested product');
foreach([$url.'?x=1',$url.'#x',str_replace('/sanrio/','/other/',$url),str_replace('.co.jp/','.co.jp.evil.test/',$url)] as $bad)sanrio_check(lw_sanrio_url($bad)==='','Strict detail route');
foreach(['itemCode'=>'other:10012345','itemUrl'=>'https://item.rakuten.co.jp/other/item/','itemName'=>''] as $k=>$v){$bad=$row;$bad[$k]=$v;$failed=false;try{lw_sanrio_item($bad,$settings);}catch(RuntimeException $e){$failed=true;}sanrio_check($failed,'Wrong shop or missing identity rejected');}
$failed=false;try{lw_sanrio_data(['items'=>[$row]],$settings,1,str_replace('4550337000000','other',$url));}catch(RuntimeException $e){$failed=true;}sanrio_check($failed,'Mismatched detail rejected');
$tracking=$row;$tracking['itemUrl']=$row['affiliateUrl'];unset($tracking['affiliateUrl']);sanrio_check(lw_sanrio_data(['items'=>[$tracking]],$settings,1)['items'][0]['url']===$url,'Current API tracking destination normalized');
echo "Official Sanrio shop API identity, exact affiliate link, photo scope, deduplication and unknown dates passed\n";
