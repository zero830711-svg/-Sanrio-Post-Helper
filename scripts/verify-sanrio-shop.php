<?php
declare(strict_types=1);
// One cached list and one exact product on deployment; no additional scheduled jobs.
try{
 $config=require $argv[1];$base='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/lovely-watch.php?';
 $request=static function(array $query,bool $binary=false)use($config,$base){$c=curl_init($base.http_build_query($query));curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_TIMEOUT=>55,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$config['sync_key']]]);$raw=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);if($status!==200)throw new RuntimeException('Public API HTTP '.$status);if($binary)return $raw;$data=json_decode((string)$raw,true);if(empty($data['ok']))throw new RuntimeException('Invalid public API response');return $data;};
 $source=$argv[2]??'sanrio';
 $list=$request(['action'=>'list','source'=>$source,'page'=>1]);$rows=$list['items']??[];if(!$rows||count($rows)>30)throw new RuntimeException('Official shop list unavailable');
 $item=null;foreach($rows as $row)if(!empty($row['productInfo']['images'])&&!empty($row['matchedAffiliate']['url'])){$item=$row;break;}if(!$item)throw new RuntimeException('No exact product with affiliate link and photo');
 usleep(1100000);$q=['source'=>$source,'url'=>$item['url'],'code'=>$item['productInfo']['itemCode']];$detail=$request(['action'=>'detail']+$q);$found=$detail['item']??[];
 if(($found['url']??'')!==$item['url']||($found['productInfo']['itemCode']??'')!==$item['productInfo']['itemCode']||($source==='sanrio'&&!str_starts_with($found['productInfo']['itemCode'],'sanrio:'))||empty($found['title'])||!empty($found['date'])||empty($found['catalogUpdate']))throw new RuntimeException('Official shop identity/date mismatch');
 $affiliate=$request(['action'=>'affiliate']+$q);if(($affiliate['affiliate']['itemCode']??'')!==$item['productInfo']['itemCode']||empty($affiliate['affiliate']['url']))throw new RuntimeException('Affiliate identity mismatch');
 $bytes=$request(['action'=>'image','index'=>0]+$q,true);$size=@getimagesizefromstring($bytes);if(!$size)throw new RuntimeException('Real product photo unavailable');
 echo $source.' Rakuten discovery verified: '.count($rows).' products; requested product + API item code + own affiliate link + real photo '.$size[0].'x'.$size[1].'; release date not inferred'."\n";
}catch(Throwable $e){fwrite(STDERR,'Official Sanrio shop verification failed: '.$e->getMessage()."\n");exit(1);}
