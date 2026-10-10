<?php
declare(strict_types=1);
$config=require $argv[1];
function ig_news_check(string $action,string $key,string $url=''):array {
 $c=curl_init('https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/news.php?'.http_build_query(['action'=>$action,'url'=>$url,'index'=>0]));
 curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>35,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key]]);
 $body=curl_exec($c);$status=curl_getinfo($c,CURLINFO_HTTP_CODE);curl_close($c);
 if($status!==200||!is_string($body))throw new RuntimeException('Instagram news endpoint check failed');
 if($action==='image'){if(!getimagesizefromstring($body))throw new RuntimeException('Instagram photo check failed');return [];}
 $data=json_decode($body,true);if(empty($data['ok']))throw new RuntimeException('Instagram news response check failed');return $data;
}
try {
 $key=(string)$config['sync_key'];$list=ig_news_check('list',$key);$row=null;
 foreach($list['items']??[] as $item)if(!empty($item['instagram'])){$row=$item;break;}
 if(!$row)throw new RuntimeException('Saved Instagram post missing from news list');
 $detail=ig_news_check('detail',$key,$row['url'])['item'];
 if(empty($detail['images'])||empty($detail['paragraphs'][0]))throw new RuntimeException('Saved Instagram caption or photos missing');
 ig_news_check('image',$key,$row['url']);
 echo 'Instagram news list, caption, and photo endpoint verified; photos: '.count($detail['images']).'; caption length: '.mb_strlen($detail['paragraphs'][0]).".\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
