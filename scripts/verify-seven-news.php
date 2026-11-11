<?php
declare(strict_types=1);
// Run only for this rollout: test the deployed API without modifying data or invoking AI.
function seven_live_request(string $key,string $action,string $url=''):array{
 $endpoint='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/news.php?'.http_build_query(['action'=>$action,'url'=>$url,'index'=>0]);
 $ch=curl_init($endpoint);curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_TIMEOUT=>45,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key]]);
 $body=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$type=(string)curl_getinfo($ch,CURLINFO_CONTENT_TYPE);curl_close($ch);
 if($status!==200||!is_string($body))throw new RuntimeException($action.' returned HTTP '.$status);
 if($action==='image'){if(!str_starts_with($type,'image/')||!@getimagesizefromstring($body))throw new RuntimeException('image response is not an image');return [];}
 $json=json_decode($body,true);if(!is_array($json)||empty($json['ok']))throw new RuntimeException($action.' did not return a successful response');return $json;
}
try{
 $config=require $argv[1];$key=(string)($config['sync_key']??'');if(!$key)throw new RuntimeException('sync configuration missing');
 $targets=[
  'エフトイズ'=>'https://f-toys.net/item/sanrio_beadscharm/',
  'IP4'=>'https://www.ip4.co.jp/cupsuletoy/2026-11-sanrio-rubber/',
  'セガプラザ'=>'https://segaplaza.jp/prize/B122756/',
  'Happyくじ'=>'https://www.h-kuji.com/goods/sanrio-holiday2026/',
  'キタンクラブ'=>'https://kitan.jp/products/sanrio_watch4/',
  'Qualia'=>'https://www.qualia-45.jp/product/view/2131',
 ];
 $list=seven_live_request($key,'list');$failures=[];
 if(isset($list['sourceStatuses']['セガ フェイブ'])||array_filter($list['items']??[],static fn($row)=>($row['source']??'')==='セガ フェイブ'))throw new RuntimeException('Removed source is still in the news list');
 foreach($targets as $name=>$url){
  $status=$list['sourceStatuses'][$name]['state']??'missing';$count=$list['sourceStatuses'][$name]['count']??0;
  try{
   if(!in_array($status,['ok','partial','failed'],true))throw new RuntimeException('source status missing');
   $item=seven_live_request($key,'detail',$url)['item']??[];
   if(($item['source']??'')!==$name||($item['url']??'')!==$url||empty($item['title'])||empty($item['images']))throw new RuntimeException('detail fields missing');
   seven_live_request($key,'image',$url);
   if($status!=='ok')throw new RuntimeException('source list is '.$status);
   echo $name.': '.$count." listed, detail and image OK\n";
  }catch(Throwable $e){$failures[]=$name.': '.$e->getMessage();}
 }
 if($failures)throw new RuntimeException(implode('; ',$failures));
}catch(Throwable $e){fwrite(STDERR,'Seven-source verification: '.$e->getMessage()."\n");exit(1);}
