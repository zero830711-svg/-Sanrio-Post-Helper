<?php
declare(strict_types=1);
try {
 $settings=require $argv[1];
 $params=['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'itemCode'=>'mirakikaku:c2605194','availability'=>0,'formatVersion'=>2,'hits'=>1,'elements'=>'itemCode,itemName,itemUrl,mediumImageUrls,affiliateUrl,shopName'];
 $url='https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query($params,'','&',PHP_QUERY_RFC3986);
 $c=curl_init($url);
 curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/']);
 $body=curl_exec($c);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
 if($body===false||$status!==200)throw new RuntimeException('Rakuten API request failed (HTTP '.$status.').');
 $data=json_decode($body,true,512,JSON_THROW_ON_ERROR);$items=[];
 foreach(($data['Items']??$data['items']??[]) as $wrapper){
  $r=$wrapper['Item']??$wrapper['item']??$wrapper;
  $images=$r['mediumImageUrls']??[];
  $first=$images[0]??'';
  $image=is_array($first)?($first['imageUrl']??''):$first;
  $items[]=['code'=>$r['itemCode']??'','title'=>$r['itemName']??'','url'=>$r['itemUrl']??'','affiliate'=>$r['affiliateUrl']??'','image'=>$image,'shop'=>$r['shopName']??'','source_product_name'=>'サンリオキャラクターズ クリスタルめじるしアクセサリー'];
 }
 file_put_contents($argv[2],json_encode(['candidates'=>$items],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
 chmod($argv[2],0600);
 echo 'Rakuten API item lookup: '.count($items).' rows. Response fields: '.implode(',',array_keys($data))."\n";
} catch(Throwable $e) { fwrite(STDERR,$e instanceof RuntimeException?$e->getMessage():"Rakuten API data could not be read."); exit(1); }
