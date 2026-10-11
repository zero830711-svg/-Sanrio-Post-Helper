<?php
declare(strict_types=1);
require __DIR__.'/../server/lolipop/news-instagram.php';
$path=sys_get_temp_dir().'/sph-ig-'.hash('sha256',realpath(__DIR__.'/../server/lolipop')).'/accounts.json';
$original=is_file($path)?file_get_contents($path):null;
try{
 $rows=news_instagram_settings();
 if(count($rows)<1)throw new RuntimeException('Defaults missing');
 news_instagram_save_settings([['account'=>'test_account','region'=>'香港','enabled'=>false,'favorite'=>true]]);
 $saved=news_instagram_settings();
 if(count($saved)!==1||$saved[0]['enabled']||!$saved[0]['favorite']||$saved[0]['region']!=='香港')throw new RuntimeException('Settings round trip failed');
 if(news_instagram_items())throw new RuntimeException('Stopped source leaked into list');
 try{news_instagram_save_settings([['account'=>'bad/path','region'=>'日本']]);throw new LogicException('Invalid account accepted');}catch(RuntimeException $e){}
 news_instagram_save_settings([]);
 if(news_instagram_settings()!==[])throw new RuntimeException('Remove all failed');
 echo "Account management and disabled-source filtering verified\n";
}finally{if($original===null)@unlink($path);else file_put_contents($path,$original);}
