<?php
declare(strict_types=1);

// Deployment checks only the published API. Upstream feed health has its own scheduled/manual check.
function deployed_news_extra_request(string $key,string $action,string $url=''):array{
 $endpoint='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/news.php?'.http_build_query(['action'=>$action,'url'=>$url]);
 $ch=curl_init($endpoint);
 curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_TIMEOUT=>40,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key]]);
 $body=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
 $data=is_string($body)?json_decode($body,true):null;
 if($status!==200||!is_array($data)||empty($data['ok']))throw new RuntimeException('公開ニュースAPIの'.$action.'応答を確認できません。HTTP '.$status.' / '.mb_substr((string)($data['error']??'応答なし'),0,160));
 return $data;
}
try{
 $config=require $argv[1];
 $key=(string)($config['sync_key']??'');if($key==='')throw new RuntimeException('同期キーを確認できません。');
 $list=deployed_news_extra_request($key,'list');
 $targets=[
  'タカラトミーアーツ'=>'https://www.takaratomy-arts.co.jp/items/item.html?n=Y111372',
  'リーメント'=>'https://www.re-ment.co.jp/product/r70125',
  'エイコープライズ'=>'https://www.eikoh-prize.jp/shopdetail/000000002621/ct200/page1/recommend/',
 ];
 foreach($targets as $source=>$url){
  $state=$list['sourceStatuses'][$source]['state']??'';
  if(!in_array($state,['ok','partial','failed'],true))throw new RuntimeException($source.'の情報源状態が公開APIにありません。');
  if($state!=='ok')echo '::warning title=External source::'.$source.'の一覧取得は'.$state.'です。公開APIの動作確認を続けます。'."\n";
  if($source==='エイコープライズ'){
   $current=array_values(array_filter($list['items']??[],static fn($row)=>($row['source']??'')==='エイコープライズ'&&is_string($row['url']??null)&&str_starts_with($row['url'],'https://www.eikoh-prize.jp/shopdetail/')));
   if(!$current)throw new RuntimeException('エイコープライズの商品を公開一覧から確認できません。');
   $url=$current[0]['url'];
  }
  $item=deployed_news_extra_request($key,'detail',$url)['item']??[];
  if(($item['source']??'')!==$source||empty($item['tipsOnly'])||empty($item['images'])||empty($item['title']))throw new RuntimeException($source.'の商品詳細を公開APIから確認できません。');
  if(($item['url']??'')!==$url)throw new RuntimeException($source.'の商品URLが一致しません。');
  if($source==='エイコープライズ'){
   if(($item['title']??'')!==($current[0]['title']??'')||!preg_match('/サンリオ/u',$item['title'])||empty($item['schedule']))throw new RuntimeException('エイコープライズの一覧と詳細の商品名・登場時期を確認できません。');
   preg_match('~/shopdetail/([0-9]{12})/~',$url,$productId);
   foreach($item['images'] as $image){$p=parse_url($image);if(($p['scheme']??'')!=='https'||($p['host']??'')!=='makeshop-multi-images.akamaized.net'||!str_starts_with($p['path']??'','/eikohprize/itemimages/'.$productId[1]))throw new RuntimeException('エイコープライズの商品写真が一致しません。');}
  }
  echo $source.' published detail verified; source state: '.$state."\n";
 }
}catch(Throwable $e){fwrite(STDERR,'Manufacturer deployment verification failed: '.$e->getMessage()."\n");exit(1);}
