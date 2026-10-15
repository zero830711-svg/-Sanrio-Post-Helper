<?php
declare(strict_types=1);
try{
 $config=require $argv[1];$key=(string)($config['sync_key']??'');if($key==='')throw new RuntimeException('Sync configuration unavailable');
 $endpoint='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/amazon-creators.php';
 $request=static function(string $action,bool $post=false,array $payload=[])use($endpoint,$key):array{
  $c=curl_init($endpoint.'?action='.$action);curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_TIMEOUT=>65,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key,'Origin: https://zero830711-svg.github.io','Content-Type: application/json']]);
  if($post)curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$payload?json_encode($payload,JSON_THROW_ON_ERROR):'{}']);
  $body=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);$d=is_string($body)?json_decode($body,true):null;
  if($status!==200||!is_array($d)||empty($d['ok']))throw new RuntimeException('Amazon discovery HTTP '.$status.'; stage '.(in_array($d['stage']??'',['authentication','product-search'],true)?$d['stage']:'unknown').'; upstream '.(int)($d['upstreamStatus']??0));
  foreach(['secret','credentialId','access_token','sync_key'] as $field)if(isset($d[$field]))throw new RuntimeException('Private field returned');
  return $d;
 };
 $before=$request('candidates');for($attempt=0;empty($before['configured'])&&$attempt<4;$attempt++){usleep(250000);$before=$request('candidates');}if(($before['storageVersion']??'')!=='persistent-3534')throw new RuntimeException('Persistent Amazon storage is not deployed');if(empty($before['configured']))throw new RuntimeException('Saved Amazon credentials are not configured');
 $result=$request('discover',true);if(($result['autoState']??'')!=='ok')throw new RuntimeException('Amazon auto-discovery did not succeed');
 $after=$request('candidates');$ids=[];$now=time();
 foreach($after['items']??[] as $item){
  $p=parse_url($item['url']??'');if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.amazon.co.jp'||!preg_match('~/[A-Z0-9]{10}(?:/|$)~i',$p['path']??'')||empty($item['title'])||($item['fetchedAt']??0)<=$now-86400)throw new RuntimeException('Invalid or stale discovered product');
  if(isset($ids[$item['asin']??'']))throw new RuntimeException('Duplicate ASIN returned');$ids[$item['asin']]=true;
 }
 if(($after['queryCount']??0)!==41||($after['nextAt']??0)<=$now)throw new RuntimeException('Discovery rotation or cooldown is missing');
 echo 'Persistent Amazon storage and auto-discovery verified; '.count($ids).' unique current products; query rotation and cooldown active; credentials withheld'."\n";
 if(($argv[2]??'')==='--search-pages'){
  // Only code deployment/manual verification uses two extra searches, never scheduled collection.
  foreach([1,2] as $page){
   sleep(5);$search=$request('search',true,['keywords'=>'サンリオ','page'=>$page]);
   if(($search['page']??0)!==$page||($search['pageSize']??0)!==10||!is_bool($search['hasMore']??null)||empty($search['items'])||count($search['items'])>10)throw new RuntimeException('Deployed Amazon search pagination metadata is invalid');
   foreach($search['items'] as $item){if(empty($item['title'])||parse_url($item['url']??'',PHP_URL_HOST)!=='www.amazon.co.jp')throw new RuntimeException('Invalid paginated Amazon product');}
   echo 'Amazon manual search page '.$page.' verified; '.count($search['items']).' products; requested page and ten-item limit active'."\n";
  }
 }
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
