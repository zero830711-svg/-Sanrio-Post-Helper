<?php
declare(strict_types=1);
define('SPH_FLOW_TEST',true);
require __DIR__.'/../server/lolipop/product-flow.php';
if($argc!==3){fwrite(STDERR,"Usage: fetch-rakuten-fashion.php PRIVATE_SETTINGS OUTPUT\n");exit(2);}
try{
 $settings=lw_validate_settings(require $argv[1]);$items=[];$seen=[];$queries=0;
 $plan=[['サンリオ',6],['Sanrio',3],['ハローキティ',1],['クロミ',1],['シナモロール',1],['マイメロディ',1],['ポムポムプリン',1],['ポチャッコ',1],['ハンギョドン',1],['キキララ',1],['タキシードサム',1]];
 $names=['サンリオ','Sanrio'];foreach(pf_catalog_characters() as [$primary,$aliases])$names=array_merge($names,$aliases);
 foreach($plan as [$keyword,$pages])for($page=1;$page<=$pages;$page++){
  $params=['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'keyword'=>$keyword,'shopCode'=>'stylife','availability'=>1,'imageFlag'=>1,'hits'=>30,'page'=>$page,'formatVersion'=>2];
  $data=null;
  for($attempt=0;$attempt<3;$attempt++){
   usleep($attempt?2000000*$attempt:1200000);
   $curl=curl_init('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query($params,'','&',PHP_QUERY_RFC3986));
   curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/']);
   $body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
   if($status===200&&is_string($body)){$data=json_decode($body,true);break;}
   if(!in_array($status,[0,429,500,502,503,504],true))break;
  }
  if(!is_array($data))throw new RuntimeException('Fashion search failed (HTTP '.$status.'); no pages changed.');
  $queries++;$data=lw_rakuten_search_data($data);
  foreach($data['items']??[] as $row){
   if(!is_array($row)||!str_starts_with((string)($row['itemCode']??''),'stylife:'))continue;
   $item=pf_catalog_candidate($row,$names);if(!$item||isset($seen[$item['code']]))continue;
   $seen[$item['code']]=true;$items[]=$item;
  }
  if($page*30>=(int)($data['count']??0))break;
 }
 if(file_put_contents($argv[2],json_encode($items,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),LOCK_EX)===false)throw new RuntimeException('Cannot save candidates.');
 chmod($argv[2],0600);echo 'Fashion candidates: '.count($items).'; bounded API queries: '.$queries."\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
