<?php
declare(strict_types=1);
try {
 $settings=require $argv[1];
 $data=json_decode((string)file_get_contents($argv[2]),true,512,JSON_THROW_ON_ERROR);
 $out=[];
 foreach(($data['products']??[]) as $p){
  $query=(string)($p['rakuten_search_query']??'');
  $params=['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'keyword'=>$query,'availability'=>1,'field'=>0,'formatVersion'=>2,'hits'=>30,'elements'=>'itemCode,itemName,itemUrl,mediumImageUrls,affiliateUrl,shopName'];
  $url='https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query($params,'','&',PHP_QUERY_RFC3986);
  $c=curl_init($url);curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/']);
  $body=curl_exec($c);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
  if($body===false||$status!==200)throw new RuntimeException('Rakuten API search failed for one product (HTTP '.$status.').');
  $response=json_decode($body,true,512,JSON_THROW_ON_ERROR);$rows=[];
  foreach(($response['Items']??$response['items']??[]) as $wrap){
   $r=$wrap['Item']??$wrap['item']??$wrap;$images=$r['mediumImageUrls']??[];$img=$images[0]??'';$img=is_array($img)?($img['imageUrl']??''):$img;
   $rows[]=['code'=>$r['itemCode']??'','title'=>$r['itemName']??'','url'=>$r['itemUrl']??'','affiliate'=>$r['affiliateUrl']??'','image'=>$img,'shop'=>$r['shopName']??'','source_product_name'=>$p['name']];
  }
  $out[$p['slug']]=$rows;
  usleep(1100000);
 }
 file_put_contents($argv[3],json_encode(['products'=>$out],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));chmod($argv[3],0600);
 echo 'Rakuten API returned product-specific result sets for '.count($out)." articles.\n";
} catch(Throwable $e){fwrite(STDERR,$e instanceof RuntimeException?$e->getMessage():'Rakuten API lookup failed.');exit(1);}
