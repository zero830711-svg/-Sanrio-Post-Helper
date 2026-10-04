<?php
try{
 define('SPH_NEWS_TEST',true);require __DIR__.'/../server/lolipop/news.php';
 $month=(new DateTimeImmutable('now',new DateTimeZone('Asia/Tokyo')))->format('Y-m');
 $rows=news_furyu_rows(news_fetch('https://furyuprize.com/schedule?month='.$month));if(!$rows)throw new RuntimeException('No Sanrio rows');
 $url='https://furyuprize.com/item/22561';$detail=news_parse(news_fetch($url),$url);
 if($detail['title']!=='クロミ たれ耳ロリータBIGぬいぐるみ'||$detail['schedule']!=='2026年10月2週'||!empty($detail['date'])||count($detail['images'])<1)throw new RuntimeException('Wrong detail');
 $bytes=news_fetch($detail['images'][0],6000000);if(!getimagesizefromstring($bytes))throw new RuntimeException('Invalid image');
 echo 'Live FURYU: '.count($rows)." Sanrio products; requested identity, official week and real photo verified.\n";
 if(isset($argv[1])){
  $config=require $argv[1];
  foreach(['list','detail'] as $action){
   $u='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/news.php?'.http_build_query(['action'=>$action,'url'=>$url]);
   $ch=curl_init($u);curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_TIMEOUT=>35,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$config['sync_key']]]);$body=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);$data=json_decode((string)$body,true);
   if($status!==200||empty($data['ok']))throw new RuntimeException('Deployed API failed');
   if($action==='list'&&!array_filter($data['items']??[],static fn($i)=>($i['source']??'')==='フリュー'&&!empty($i['prize'])))throw new RuntimeException('No deployed FURYU list');
   if($action==='detail'&&(($data['item']['schedule']??'')!==$detail['schedule']||empty($data['item']['images'])||empty($data['item']['prize'])))throw new RuntimeException('Deployed detail mismatch');
  }
  echo "Deployed FURYU: news list and requested prize detail verified.\n";
 }
}catch(Throwable $e){fwrite(STDERR,"FURYU verification failed; private details withheld.\n");exit(1);}
