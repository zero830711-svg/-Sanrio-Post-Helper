<?php
declare(strict_types=1);
// Read only the collector's private cache, never Instagram credentials.
function news_instagram_items():array {
 $path=sys_get_temp_dir().'/sph-ig-'.hash('sha256',__DIR__).'/feed.json';
 if(!is_file($path)||filesize($path)>2000000)return [];
 $feed=json_decode((string)file_get_contents($path),true);$items=[];
 foreach($feed['items']??[] as $row){
  $account=(string)($row['account']??'friendcharacters');if(!in_array($account,array_column(array_filter(news_instagram_settings(),fn($r)=>$r['enabled']),'account'),true))continue;
  $code=(string)($row['shortcode']??'');$caption=trim((string)($row['caption']??''));
  if(!preg_match('/^[A-Za-z0-9_-]{1,80}$/D',$code)||!$caption)continue;
  $images=[];foreach($row['images']??[] as $image){
   $p=parse_url((string)$image);$host=strtolower($p['host']??'');
   if(($p['scheme']??'')==='https'&&!isset($p['user'])&&!isset($p['pass'])&&!isset($p['port'])&&preg_match('/\.(?:cdninstagram\.com|fbcdn\.net)$/D',$host))$images[]=$image;
  }
  if(!$images)continue;
  $lines=preg_split('/\R/u',$caption);$title='';foreach($lines as $line){$line=trim($line);if(mb_strlen($line)>=4&&!preg_match('/^[#@]|^https?:/u',$line)){$title=mb_substr($line,0,90);break;}}
  if(!$title)$title=$account.'の投稿';
  $date=substr((string)($row['published']??''),0,10);
  if(!preg_match('/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/D',$date))$date='';
  $items[]=['title'=>$title,'url'=>'https://www.instagram.com/p/'.$code.'/','source'=>'Instagram（'.$account.'）','instagramAccount'=>$account,'date'=>$date,'image'=>$images[0],'images'=>array_slice($images,0,8),'paragraphs'=>[$caption],'facts'=>[],'instagram'=>true,'collectedAt'=>(int)($feed['checkedAt']??0)];
 }
 return $items;
}
function news_instagram_detail(string $url):array {
 foreach(news_instagram_items() as $item)if($item['url']===$url)return $item;
 throw new RuntimeException('このInstagram投稿は取得済み一覧にありません。ニュース一覧を更新してください。');
}
function news_instagram_list(array $list):array {
 $list['instagramStatuses']=news_instagram_statuses();$list['instagramAccounts']=news_instagram_settings();
 $rows=news_instagram_items();$list['items']=array_merge($rows,$list['items']??[]);
 $list['sourceStatuses']['Instagram']=['state'=>$rows?'ok':'failed','count'=>count($rows)];
 return $list;
}

function news_instagram_statuses():array {
 $path=sys_get_temp_dir().'/sph-ig-'.hash('sha256',__DIR__).'/collection-status.json';
 $saved=is_file($path)&&filesize($path)<200000?json_decode((string)file_get_contents($path),true):[];
 $rows=news_instagram_items();$result=[];
 foreach(array_column(news_instagram_settings(),'account') as $account){
  $value=$saved[$account]??[];
  $result[]=['account'=>$account,'state'=>($value['state']??'')==='checking'?'error':(in_array($value['state']??'', ['ok','empty','error'],true)?$value['state']:'pending'),'checkedAt'=>(int)($value['checkedAt']??0),'count'=>count(array_filter($rows,fn($row)=>$row['instagramAccount']===$account)),'error'=>($value['state']??'')==='error'?'取得を完了できませんでした':''];
 }
 return $result;
}

function news_instagram_settings():array{
 $path=sys_get_temp_dir().'/sph-ig-'.hash('sha256',__DIR__).'/accounts.json';
 $defaults=json_decode('[{"account":"friendcharacters","region":"日本","enabled":true,"favorite":false},{"account":"sanrio_kr","region":"韓国","enabled":true,"favorite":false},{"account":"sanriogiftgatehk","region":"香港","enabled":true,"favorite":false},{"account":"sanrio_ec_official","region":"日本","enabled":true,"favorite":false},{"account":"pompompurin_30th","region":"日本","enabled":true,"favorite":false},{"account":"sanrio_tw","region":"台湾","enabled":true,"favorite":false},{"account":"sanrio.hk","region":"香港","enabled":true,"favorite":false},{"account":"sanriosports","region":"日本","enabled":true,"favorite":false},{"account":"skater_all","region":"日本","enabled":true,"favorite":false},{"account":"gravail","region":"日本","enabled":true,"favorite":false},{"account":"grchambre","region":"日本","enabled":true,"favorite":false},{"account":"grshimamura","region":"日本","enabled":true,"favorite":false},{"account":"grbirthday","region":"日本","enabled":true,"favorite":false},{"account":"hk_zip","region":"香港","enabled":true,"favorite":false},{"account":"khtoyy","region":"香港","enabled":true,"favorite":false},{"account":"segaplaza","region":"日本","enabled":true,"favorite":false},{"account":"childtoys.hk","region":"香港","enabled":true,"favorite":false},{"account":"7eleventw","region":"台湾","enabled":true,"favorite":false},{"account":"7elevenhk","region":"香港","enabled":true,"favorite":false},{"account":"razer","region":"その他","enabled":true,"favorite":false},{"account":"jy_enc","region":"韓国","enabled":true,"favorite":false},{"account":"spaofriends","region":"韓国","enabled":true,"favorite":false},{"account":"kiiwio.tw","region":"台湾","enabled":true,"favorite":false},{"account":"lunchgoods.skater","region":"日本","enabled":true,"favorite":false},{"account":"minilike_official","region":"その他","enabled":true,"favorite":false},{"account":"ds_x_kawaii_collabroom","region":"日本","enabled":true,"favorite":false},{"account":"toptoy.international","region":"その他","enabled":true,"favorite":false},{"account":"benelic.capsuletoy","region":"日本","enabled":true,"favorite":false},{"account":"mash_sanriohouse_official","region":"日本","enabled":true,"favorite":false},{"account":"kiddyland_co.jp","region":"日本","enabled":true,"favorite":false},{"account":"7elevenkorea","region":"韓国","enabled":true,"favorite":false},{"account":"epoch1958_jp","region":"日本","enabled":true,"favorite":false},{"account":"sanrioatarikuji","region":"日本","enabled":true,"favorite":false},{"account":"daiso_official","region":"日本","enabled":true,"favorite":false},{"account":"hellokitty.india","region":"その他","enabled":true,"favorite":false},{"account":"shuwatama_times","region":"日本","enabled":true,"favorite":false},{"account":"fuiuchi_official","region":"日本","enabled":true,"favorite":false},{"account":"miniso.official","region":"その他","enabled":true,"favorite":false},{"account":"perihapi_official","region":"日本","enabled":true,"favorite":false},{"account":"petitpoche_official","region":"日本","enabled":true,"favorite":false},{"account":"parade_prize","region":"日本","enabled":true,"favorite":false},{"account":"purolandjp","region":"日本","enabled":true,"favorite":false},{"account":"takaratomyarts.nuigurumi","region":"日本","enabled":true,"favorite":false},{"account":"ftoys_character","region":"日本","enabled":true,"favorite":false},{"account":"tokyo_characterstreet","region":"日本","enabled":true,"favorite":false},{"account":"roychefriends","region":"韓国","enabled":true,"favorite":false},{"account":"kthings_official","region":"日本","enabled":true,"favorite":false},{"account":"takaratomyarts.gacha","region":"日本","enabled":true,"favorite":false},{"account":"takaratomyarts","region":"日本","enabled":true,"favorite":false},{"account":"shop_nui_bnn","region":"日本","enabled":true,"favorite":false},{"account":"390webshop","region":"日本","enabled":true,"favorite":false},{"account":"awajihellokittyappleland","region":"日本","enabled":true,"favorite":false},{"account":"bandaicandy","region":"日本","enabled":true,"favorite":false},{"account":"seven_eleven_japan","region":"日本","enabled":true,"favorite":false},{"account":"gotochi_kitty","region":"日本","enabled":true,"favorite":false},{"account":"paseos_official","region":"日本","enabled":true,"favorite":false},{"account":"ichibankuji","region":"日本","enabled":true,"favorite":false},{"account":"k2_capsule","region":"日本","enabled":true,"favorite":false},{"account":"thankyoumart","region":"日本","enabled":true,"favorite":false},{"account":"shobido_corporation","region":"日本","enabled":true,"favorite":false},{"account":"gashapon_instabu","region":"日本","enabled":true,"favorite":false},{"account":"takaratomytoys","region":"日本","enabled":true,"favorite":false}]',true);
 if(!is_file($path))return $defaults;
 $rows=json_decode((string)file_get_contents($path),true);
 return is_array($rows)?$rows:$defaults;
}
function news_instagram_save_settings(array $rows):void{
 if(count($rows)>150)throw new RuntimeException('アカウントは150件までです。');
 $clean=[];$seen=[];
 foreach($rows as $row){
  $account=strtolower(trim((string)($row['account']??'')));
  if(!preg_match('/^[a-z0-9_.]{1,30}$/D',$account)||isset($seen[$account]))throw new RuntimeException('アカウント名の形式・重複を確認してください。');
  $seen[$account]=true;$region=(string)($row['region']??'その他');
  if(!in_array($region,['日本','韓国','台湾','香港','その他'],true))throw new RuntimeException('地域を確認してください。');
  $clean[]=['account'=>$account,'region'=>$region,'enabled'=>!empty($row['enabled']),'favorite'=>!empty($row['favorite'])];
 }
 $root=sys_get_temp_dir().'/sph-ig-'.hash('sha256',__DIR__);
 if(!is_dir($root))mkdir($root,0700,true);
 $lock=fopen($root.'/accounts.lock','c');if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('設定を保存できませんでした。');
 try{$tmp=tempnam($root,'accounts-');if($tmp===false)throw new RuntimeException('設定を保存できませんでした。');chmod($tmp,0600);file_put_contents($tmp,json_encode($clean,JSON_UNESCAPED_UNICODE),LOCK_EX);rename($tmp,$root.'/accounts.json');}finally{flock($lock,LOCK_UN);fclose($lock);}
}
