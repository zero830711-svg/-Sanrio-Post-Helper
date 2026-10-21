<?php
declare(strict_types=1);
define('SPH_FLOW_TEST',true);
require __DIR__.'/../server/lolipop/product-flow.php';
if($argc!==4){fwrite(STDERR,"Usage: fetch-product-detail-pilot.php SETTINGS CANDIDATES OUTPUT\n");exit(2);}
try{
 $settings=lw_validate_settings(require $argv[1]);
 $candidates=json_decode(file_get_contents($argv[2]),true,512,JSON_THROW_ON_ERROR);$rows=[];$skipped=0;
 foreach($candidates as $n=>$candidate){
  $code=$candidate['code'];
  if(!preg_match('/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+$/D',$code))throw new RuntimeException('Invalid existing item code');
  $params=['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'itemCode'=>$code,'availability'=>1,'imageFlag'=>1,'formatVersion'=>2];$data=null;$status=0;
  for($attempt=0;$attempt<3;$attempt++){
   usleep($attempt?3000000:1300000);
   $curl=curl_init('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query($params,'','&',PHP_QUERY_RFC3986));
   curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/']);
   $body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
   if($status===404){$data=['items'=>[]];break;}
   if($status===200){$data=lw_rakuten_search_data(json_decode((string)$body,true,512,JSON_THROW_ON_ERROR));break;}
   if(!in_array($status,[0,429,500,502,503,504],true))break;
  }
  if(!is_array($data))throw new RuntimeException('Rakuten exact-item verification failed HTTP '.$status.'; no product pages written');
  $found=false;
  foreach($data['items']??[] as $row)if(($row['itemCode']??'')===$code&&($row['availability']??0)){$rows[]=['existing'=>$candidate,'api'=>$row];$found=true;break;}
  if(!$found)$skipped++;
  if(($n+1)%20===0)echo 'DETAIL API checked='.($n+1).' matched='.count($rows).' skipped='.$skipped."\n";
 }
 file_put_contents($argv[3],json_encode($rows,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
 echo 'DETAIL API COMPLETE '.json_encode(['checked'=>count($candidates),'matched'=>count($rows),'skipped'=>$skipped])."\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
