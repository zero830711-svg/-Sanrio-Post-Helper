<?php
declare(strict_types=1);
// Read only the collector's private cache, never Instagram credentials.
function news_instagram_items():array {
 $path=sys_get_temp_dir().'/sph-ig-'.hash('sha256',__DIR__).'/feed.json';
 if(!is_file($path)||filesize($path)>2000000)return [];
 $feed=json_decode((string)file_get_contents($path),true);$items=[];
 foreach($feed['items']??[] as $row){
  $account=(string)($row['account']??'friendcharacters');if(!in_array($account,['friendcharacters','sanrio_kr','sanriogiftgatehk','sanrio_ec_official','pompompurin_30th','sanrio_tw','sanrio.hk','sanriosports','skater_all','gravail','grchambre','grshimamura','grbirthday','hk_zip','khtoyy','segaplaza','childtoys.hk','7eleventw','7elevenhk','razer','jy_enc','spaofriends','kiiwio.tw'],true))continue;
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
 $rows=news_instagram_items();$list['items']=array_merge($rows,$list['items']??[]);
 $list['sourceStatuses']['Instagram']=['state'=>$rows?'ok':'failed','count'=>count($rows)];
 return $list;
}
