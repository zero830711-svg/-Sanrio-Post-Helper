<?php
declare(strict_types=1);
// Fixed manufacturer feeds, with no AI calls and no shop/affiliate lookups.
function news_extra_abs(string $url,string $source):string{
 if(strpos($url,'../')===0)$url='/'.substr($url,3);
 if(strpos($url,'/')===0)$url=($source==='arts'?'https://www.takaratomy-arts.co.jp':'https://www.re-ment.co.jp').$url;
 return $url;
}
function news_extra_period(string $text):string{
 return preg_match('/20[0-9]{2}年(?:[1-9]|1[0-2])月(?:[0-9]{1,2}日|上旬|中旬|下旬)?(?:発売予定|予定)?/u',$text,$m)?$m[0]:'';
}
function news_extra_recent(string $period,int $now):bool{
 if(!preg_match('/^(20[0-9]{2})年([0-9]{1,2})月/u',$period,$m))return false;
 // Compare months, without manufacturing a precise release day.
 $zone=new DateTimeZone('Asia/Tokyo');$today=(new DateTimeImmutable('@'.$now))->setTimezone($zone);
 $month=(int)$m[1]*12+(int)$m[2];$current=(int)$today->format('Y')*12+(int)$today->format('n');return $month>=$current-2&&$month<=$current+6;
}
function news_arts_rows(string $json,int $now):array{
 $data=json_decode($json,true);if(!is_array($data)||!is_array($data['dblineup_src']??null))throw new RuntimeException('タカラトミーアーツの一覧を確認できませんでした。');$rows=[];
 foreach($data['dblineup_src'] as $html){$x=news_doc((string)$html);$a=$x->query('//a[@id]')->item(0);if(!$a||!preg_match('/^pop_([0-9]{6})$/D',$a->getAttribute('id'),$m))continue;
 $title=news_text($x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," name ")]',$a)->item(0));$period=news_extra_period(news_text($a));if(!news_furyu_character($title)||!news_extra_recent($period,$now))continue;
 $image=news_extra_abs((string)($x->query('.//img/@src',$a)->item(0)?->nodeValue??''),'arts');$image=news_image_url($image);if(!$image||!preg_match('~/Y'.$m[1].'_~',$image))continue;
 $rows[]=['url'=>'https://www.takaratomy-arts.co.jp/items/item.html?n=Y'.$m[1],'source'=>'タカラトミーアーツ','tipsOnly'=>true,'title'=>$title,'date'=>'','schedule'=>'発売時期：'.$period,'facts'=>[['kind'=>'schedule','text'=>'発売時期：'.$period]],'image'=>$image];
 }return $rows;
}
function news_rement_rows(string $html):array{
 $x=news_doc($html);$rows=[];
 foreach($x->query('//div[contains(concat(" ",normalize-space(@class)," ")," items ")]//a[@href]') as $a){$url=news_url(news_extra_abs($a->getAttribute('href'),'rement'));$title=news_text($x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," name ")]',$a)->item(0));if(!$url||!$title)continue;
 $img=$x->query('.//img',$a)->item(0);$image=$img?news_image_url(news_extra_abs($img->getAttribute('data-original')?:$img->getAttribute('src'),'rement')):'';
 $rows[]=['url'=>$url,'source'=>'リーメント','tipsOnly'=>true,'title'=>$title,'date'=>'','image'=>$image];if(count($rows)>=8)break;
 }return $rows;
}
function news_extra_parse(string $html,string $url):array{
 $x=news_doc($html);$arts=strpos($url,'https://www.takaratomy-arts.co.jp/')===0;$source=$arts?'タカラトミーアーツ':'リーメント';
 $identity=news_url(news_text($x->query('//meta[@property="og:url"]/@content')->item(0)));if($identity!==$url)throw new RuntimeException('メーカーの商品識別が一致しませんでした。');
 $root=$x->query($arts?'//section[@id="detail"]':'//div[@id="items"]')->item(0);if(!$root)throw new RuntimeException('メーカーの商品本体を確認できませんでした。');
 $title=news_text($x->query($arts?'./div[contains(concat(" ",normalize-space(@class)," ")," head ")]/h2':'.//h4',$root)->item(0));
 $lines=[];$facts=[];$period='';$price='';
 if($arts){
  $head=news_text($x->query('./div[contains(concat(" ",normalize-space(@class)," ")," head ")]/p',$root)->item(0));$period=news_extra_period($head);
  if(preg_match('/価格[：:]([^■]+)/u',$head,$m))$price=trim($m[1]);
  foreach($x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," summary ")]/p',$root) as $p){$text=news_text($p);if($text)$lines[]=$text;}
 }else{
  $category=news_text($x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," cate ")]',$root)->item(0));if(strpos($category,'サンリオ')===false)throw new RuntimeException('サンリオ関連商品ではありません。');
  foreach($x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," infos ")]/div[contains(concat(" ",normalize-space(@class)," ")," info ")]',$root) as $row){$label=news_text($x->query('./p[contains(concat(" ",normalize-space(@class)," ")," item ")]',$row)->item(0));$value=news_text($x->query('./p[contains(concat(" ",normalize-space(@class)," ")," detail ")]',$row)->item(0));if($label==='発売日')$period=news_extra_period($value);if($label==='価格')$price=$value;if(in_array($label,['種類','商品'],true)&&$value)$lines[]=$label.'：'.$value;}
 }
 if(!$title||($arts&&!news_furyu_character($title)))throw new RuntimeException('サンリオ関連の商品名を確認できませんでした。');
 if($period){$schedule='発売時期：'.$period;$facts[]=['kind'=>'schedule','text'=>$schedule];$lines[]=$schedule;}else $schedule='';
 if($price){$facts[]=['kind'=>'price','text'=>'価格：'.$price];$lines[]='価格：'.$price;}
 $images=[];$nodes=$x->query($arts?'.//div[contains(concat(" ",normalize-space(@class)," ")," images ")]//img/@src':'.//div[contains(concat(" ",normalize-space(@class)," ")," main_item ")]//img/@src | .//div[contains(concat(" ",normalize-space(@class)," ")," gallery ")]/a/@href',$root);
 foreach($nodes as $node){$image=news_image_url(news_extra_abs($node->nodeValue,$arts?'arts':'rement'));if($arts&&$image){parse_str((string)parse_url($url,PHP_URL_QUERY),$query);if(strpos(basename((string)parse_url($image,PHP_URL_PATH)),($query['n']??'').'_' )!==0)continue;}if($image&&!in_array($image,$images,true)&&count($images)<8)$images[]=$image;}
 return ['url'=>$url,'source'=>$source,'tipsOnly'=>true,'title'=>$title,'date'=>'','schedule'=>$schedule,'facts'=>$facts,'paragraphs'=>$lines,'images'=>$images,'image'=>$images[0]??''];
}
function news_extra_enrich(array $rows,array &$errors):array{
 $feeds=[];foreach($rows as $row){$feeds[]=['url'=>$row['url'],'kind'=>'detail'];}$bodies=news_fetch_feeds($feeds);$result=[];
 foreach($rows as $i=>$row){try{if($bodies[$i]===null)throw new RuntimeException();$detail=news_extra_parse($bodies[$i],$row['url']);$period=news_extra_period($detail['schedule']);if(!news_extra_recent($period,time()))continue;$cache=sys_get_temp_dir().'/sph-news-v7-'.hash('sha256',__DIR__.$row['url']).'.json';file_put_contents($cache,json_encode($detail,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),LOCK_EX);@chmod($cache,0600);$result[]=$detail;}catch(Throwable $e){$errors[]='リーメントの一部の商品情報を取得できませんでした。';}}
 return $result;
}
