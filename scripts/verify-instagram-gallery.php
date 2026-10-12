<?php
declare(strict_types=1);
define('SPH_NEWS_TEST',true);
require __DIR__.'/../server/lolipop/news.php';
$dir=sys_get_temp_dir().'/sph-ig-'.hash('sha256',realpath(__DIR__.'/../server/lolipop'));$path=$dir.'/feed.json';
if(!is_dir($dir))mkdir($dir,0700,true);$previous=is_file($path)?file_get_contents($path):null;
try{
 $images=[];for($i=0;$i<20;$i++)$images[]='https://scontent.example.cdninstagram.com/photo-'.$i.'.jpg';
 file_put_contents($path,json_encode(['items'=>[['account'=>'friendcharacters','shortcode'=>'GalleryTest','caption'=>'ハローキティの新商品','published'=>'2026-10-12','images'=>$images]]]));
 $items=news_instagram_items();if(count($items)!==1||$items[0]['images']!==$images)throw new RuntimeException('Instagram photos were truncated or reordered');
 $detail=news_instagram_detail($items[0]['url']);if(count($detail['images'])!==20||$detail['images'][19]!==$images[19])throw new RuntimeException('Photo 20 unavailable in detail');
 echo "Instagram 20-photo gallery and original order verified\n";
}finally{if($previous===null)unlink($path);else file_put_contents($path,$previous);}
