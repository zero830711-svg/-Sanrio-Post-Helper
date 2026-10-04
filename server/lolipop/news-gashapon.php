<?php
declare(strict_types=1);
function news_gashapon_character(string $title):bool{return news_bandai_character($title)||(bool)preg_match('/HELLO\s*KITTY/i',$title);}
function news_gashapon_rules():string{return 'ガシャポン商品の紹介。発売週を日付に変換しない。発売時期は地域・店舗により異なる条件を残す。再販商品は再販と書き、新作・新登場と書かない。詳細はこちら・リンク案内は書かない。';}
function news_gashapon_validate_body(string $body,array $item):void{
 if(empty($item['gashapon']))return;
 if(preg_match('/詳細はこちら|詳しくはこちら|[0-9０-９]+月[0-9０-９]+日|[0-9０-９]+\/[0-9０-９]+/u',$body))throw new RuntimeException('ガシャポンの発売週・リンク案内を確認できませんでした。');
 if(preg_match('/[0-9０-９]+月|週/u',$body)&&!preg_match('/(?:地域|店舗).{0,20}(?:異な|前後)/u',$body))throw new RuntimeException('ガシャポンの地域・店舗条件を確認できませんでした。');
 $norm=static fn($s)=>str_replace(['第','目'],['',''],preg_replace('/\s+/u','',mb_convert_kana($s,'n','UTF-8'))??'');$schedule=$norm($item['schedule']??'');
 preg_match_all('/[0-9０-９]+月(?:\s*第?[0-9０-９]+週目?)?/u',$body,$matches);foreach($matches[0] as $match){$period=$norm($match);if(strpos($schedule,$period)===false||(preg_match('/月[1-6]週/u',$schedule)&&!preg_match('/月[1-6]週/u',$period)))throw new RuntimeException('公式と異なる発売週を検出しました。');}
 if(!empty($item['resale'])&&(!preg_match('/再販|再発売/u',$body)||preg_match('/新作|新登場/u',$body)))throw new RuntimeException('再販商品の表現を確認できませんでした。');
}
function news_gashapon_period(string $text):string{
 $text=preg_replace('/\s+/u','',$text)??'';
 return preg_match('/20[0-9]{2}年(?:[1-9]|1[0-2])月(?:第?[1-6]週目?|上旬|中旬|下旬)?/u',$text,$m)?$m[0]:'';
}
function news_gashapon_rows(string $html,int $now):array{
 $x=news_doc($html);$rows=[];
 foreach($x->query('//li[contains(concat(" ",normalize-space(@class)," ")," p-item__lists ")]') as $node){
  $url=news_url((string)($x->query('.//a[contains(@href,"/products/detail.php?")]/@href',$node)->item(0)?->nodeValue??''));
  $title=news_text($x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," p-item__name ")]/p',$node)->item(0));
  $period=news_gashapon_period(news_text($x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," p-item__release-text ")]',$node)->item(0)));
  if(!$url||!news_gashapon_character($title)||!news_extra_recent($period,$now))continue;
  $rows[$url]=['url'=>$url,'title'=>$title,'source'=>'ガシャポン公式','date'=>'','tipsOnly'=>true,'gashapon'=>true];
 }return array_values($rows);
}
function news_gashapon_parse(string $html,string $url):array{
 $x=news_doc($html);if(news_url(news_text($x->query('//meta[@property="og:url"]/@content')->item(0)))!==$url)throw new RuntimeException('ガシャポンの商品識別が一致しませんでした。');
 $root=$x->query('//div[contains(concat(" ",normalize-space(@class)," ")," pg-detail ")]')->item(0);if(!$root)throw new RuntimeException('ガシャポンの商品本体を確認できませんでした。');
 $title=news_text($x->query('.//h1[contains(concat(" ",normalize-space(@class)," ")," pg-heading ")]',$root)->item(0));if(!news_gashapon_character($title))throw new RuntimeException('サンリオ関連商品ではありません。');
 $period='';$price='';$kinds='';$lines=[];$facts=[];
 foreach($x->query('.//dl[contains(concat(" ",normalize-space(@class)," ")," pg-detailDefinition ")]',$root) as $dl){$label=news_text($x->query('./dt',$dl)->item(0));$value=news_text($x->query('./dd',$dl)->item(0));if($label==='発売時期')$period=news_gashapon_period($value);if(preg_match('/^価格.*税込/u',$label))$price=$value.'（税込）';if($label==='種類数')$kinds=$value;}
 $notice=news_text($x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," pg-detail__notice ")]',$root)->item(0));$resale=(bool)preg_match('/再販|再発売|発売した商品と同じ/u',$notice.' '.$title);
 $schedule=($resale?'再販時期：':'発売時期：').$period.'（地域・店舗により異なります）';
 if(!$period)throw new RuntimeException('ガシャポンの発売時期を確認できませんでした。');
 $facts[]=['kind'=>'schedule','text'=>$schedule];$lines[]=$schedule;
 if($price){$facts[]=['kind'=>'price','text'=>'価格：'.$price];$lines[]='価格：'.$price;}if($kinds)$lines[]='種類数：'.$kinds;
 $description=$x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," pg-detail__description ")]',$root)->item(0);
 if($description){$text=preg_replace('~<br\s*/?>~i',"\n",$description->ownerDocument->saveHTML($description))??'';foreach(explode("\n",html_entity_decode(strip_tags($text),ENT_QUOTES|ENT_HTML5,'UTF-8')) as $line){$line=trim($line);if($line&&mb_strlen($line)<=600)$lines[]=$line;}}
 if($resale){foreach($x->query('.//small[contains(concat(" ",normalize-space(@class)," ")," pg-detail__annotation ")]',$root) as $small){$line=news_text($small);if(preg_match('/再販|再発売|発売した商品と同じ/u',$line))$lines[]=$line;}}
 $images=[];foreach($x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," pg-detail__picture ")]//img/@src',$root) as $node){$image=news_image_url($node->nodeValue);if($image&&!in_array($image,$images,true)&&count($images)<8)$images[]=$image;}
 if(!$images)throw new RuntimeException('ガシャポンの商品写真を確認できませんでした。');
 return ['url'=>$url,'title'=>$title,'source'=>'ガシャポン公式','tipsOnly'=>true,'gashapon'=>true,'resale'=>$resale,'date'=>'','schedule'=>$schedule,'facts'=>$facts,'paragraphs'=>array_slice(array_unique($lines),0,60),'images'=>$images,'image'=>$images[0]];
}
function news_gashapon_enrich(array $rows,array &$warnings,array $rement=[]):array{
 // Share one concurrent detail batch with Re-Ment; do not add a third timeout stage.
 $rows=array_merge(array_slice($rows,0,30),$rement);$feeds=[];foreach($rows as $row)$feeds[]=['url'=>$row['url'],'kind'=>'detail'];$bodies=news_fetch_feeds($feeds);$result=[];
 foreach($rows as $i=>$row){try{if($bodies[$i]===null)throw new RuntimeException();$detail=($row['source']??'')==='リーメント'?news_extra_parse($bodies[$i],$row['url']):news_gashapon_parse($bodies[$i],$row['url']);if(!news_extra_recent(news_gashapon_period($detail['schedule']),time()))continue;
   $cache=sys_get_temp_dir().'/sph-news-v8-'.hash('sha256',__DIR__.$row['url']).'.json';file_put_contents($cache,json_encode($detail,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),LOCK_EX);@chmod($cache,0600);$result[]=$detail;
  }catch(Throwable $e){$warnings[]=($row['source']??'')==='リーメント'?'リーメントの一部の商品情報を取得できませんでした。':'ガシャポン公式の一部の商品詳細を確認できませんでした。時間をおいて再試行してください。';}
 }return $result;
}
