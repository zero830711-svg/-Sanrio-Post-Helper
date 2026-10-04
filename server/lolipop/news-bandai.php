<?php
declare(strict_types=1);
// These two public Sanrio lists are fixed feeds. No AI or affiliate lookup is run.
function news_bandai_character(string $title):bool{
 return news_furyu_character($title)||(bool)preg_match('/\bSanrio\b/i',$title);
}
function news_bandai_period(string $text):string{
 if(preg_match('/(20[0-9]{2})年([0-9]{1,2})月(?:([0-9]{1,2})日|(上旬|中旬|下旬))?/u',$text,$m)){
  if((int)$m[2]<1||(int)$m[2]>12)return '';
  if(!empty($m[3])&&!checkdate((int)$m[2],(int)$m[3],(int)$m[1]))return '';
  return $m[1].'年'.(int)$m[2].'月'.(!empty($m[3])?(int)$m[3].'日':($m[4]??''));
 }
 if(!preg_match('/\b(20[0-9]{2})\.([0-9]{1,2})(?:\.([0-9]{1,2}))?\b/',$text,$m))return '';
 if((int)$m[2]<1||(int)$m[2]>12)return '';
 if(isset($m[3])&&!checkdate((int)$m[2],(int)$m[3],(int)$m[1]))return '';
 return $m[1].'年'.(int)$m[2].'月'.(isset($m[3])?(int)$m[3].'日':'');
}
function news_bandai_schedule(array $texts):string{
 $parts=[];foreach($texts as $text){$period=news_bandai_period($text);if(!$period)continue;
  $label=strpos($text,'予約開始')!==false?'予約開始':(strpos($text,'予約終了')!==false?'予約終了':'発売時期');
  $parts[]=$label.'：'.$period;
 }return implode(' ／ ',array_unique($parts));
}
function news_bandai_rows(string $html,string $kind,int $now):array{
 $x=news_doc($html);$candy=$kind==='candy';$rows=[];
 $nodes=$x->query($candy?'//ul[@id="productList"]/li/a[@href]':'//ul[contains(concat(" ",normalize-space(@class)," ")," itemList ")]/li/a[@href]');
 foreach($nodes as $a){$url=$a->getAttribute('href');if(!$candy&&preg_match('~^\.\./item/([0-9]{2}_[0-9]{1,8})/$~D',$url,$m))$url='https://toy.bandai.co.jp/ja/item/'.$m[1].'/';$url=news_url($url);if(!$url)continue;
  $title=news_text($x->query($candy?'.//*[contains(concat(" ",normalize-space(@class)," ")," itemName ")]':'.//p[contains(concat(" ",normalize-space(@class)," ")," itemBox__title ")]',$a)->item(0));
  if(!news_bandai_character($title))continue;
  if(!$candy&&!$x->query('.//li[contains(concat(" ",normalize-space(@class)," ")," sanrio ")]',$a)->length)continue;
  $times=[];foreach($x->query($candy?'.//*[contains(concat(" ",normalize-space(@class)," ")," itemSchedule ")]':'.//p[contains(concat(" ",normalize-space(@class)," ")," itemBox__date ")]',$a) as $node)$times[]=news_text($node);
  $schedule=news_bandai_schedule($times);if(!news_extra_recent(news_bandai_period($schedule),$now))continue;
  $image=news_image_url((string)($x->query('.//img/@src',$a)->item(0)?->nodeValue??''));
  $rows[$url]=['url'=>$url,'source'=>$candy?'バンダイ キャンディ':'バンダイ おもちゃ','tipsOnly'=>true,'title'=>$title,'date'=>'','schedule'=>$schedule,'facts'=>[['kind'=>'schedule','text'=>$schedule]],'image'=>$image];
 }return array_values($rows);
}
function news_bandai_parse(string $html,string $url):array{
 $x=news_doc($html);$candy=strpos($url,'https://www.bandai.co.jp/candy/')===0;
 if(news_url(news_text($x->query('//meta[@property="og:url"]/@content')->item(0)))!==$url)throw new RuntimeException('バンダイの商品識別が一致しませんでした。');
 $root=$x->query($candy?'//div[contains(concat(" ",normalize-space(@class)," ")," itemDetailWrapper ")]/ancestor::article[1]':'//div[contains(concat(" ",normalize-space(@class)," ")," item_detail ")]')->item(0);
 if(!$root)throw new RuntimeException('バンダイの商品本体を確認できませんでした。');
 $title=news_text($x->query($candy?'.//div[contains(concat(" ",normalize-space(@class)," ")," itemDetailWrapper ")]/h2':'.//div[contains(concat(" ",normalize-space(@class)," ")," item_title ")]',$root)->item(0));
 if(!news_bandai_character($title))throw new RuntimeException('サンリオ関連商品ではありません。');
 if(!$candy&&!$x->query('.//li[contains(concat(" ",normalize-space(@class)," ")," sanrio ")]',$root)->length)throw new RuntimeException('サンリオの商品分類を確認できませんでした。');
 $times=[];$price='';$lines=[];
 if($candy){foreach($x->query('.//table[contains(concat(" ",normalize-space(@class)," ")," itemDetailBox ")]//tr',$root) as $row){$label=news_text($x->query('./th',$row)->item(0));$td=$x->query('./td',$row)->item(0);if(!$td)continue;
   // Footnotes, tax explanations and purchase buttons are not the product price.
   $value='';foreach($td->childNodes as $child){if($child instanceof DOMElement&&in_array(strtolower($child->nodeName),['p','ul','a'],true))continue;$value.=$child->textContent;}$value=trim(preg_replace('/\s+/u',' ',$value)??'');
   if($label==='発売日')$times[]=$value;if($label==='価格')$price=$value;if($label==='売場'&&$value)$lines[]='売場：'.$value;
  }
 }else{
  foreach($x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," price ")]/p',$root) as $p){$label=news_text($x->query('./span[contains(concat(" ",normalize-space(@class)," ")," price_label ")]',$p)->item(0));$value=news_text($p);if(in_array($label,['発売日','予約開始','予約終了'],true))$times[]=$value;if($label==='価格')$price=trim(preg_replace('/^価格\s*[：:]/u','',$value)??'');}
 }
 $schedule=news_bandai_schedule($times);$facts=[];if($schedule){$facts[]=['kind'=>'schedule','text'=>$schedule];$lines[]=$schedule;}if($price){$facts[]=['kind'=>'price','text'=>'価格：'.$price];$lines[]='価格：'.$price;}
 $description=$x->query($candy?'.//div[contains(concat(" ",normalize-space(@class)," ")," post ")]':'.//div[contains(concat(" ",normalize-space(@class)," ")," description ")]',$root)->item(0);
 if($description){$fragment=$description->ownerDocument->saveHTML($description);$fragment=preg_replace('~<(?:ul|p)[^>]*class="[^"]*(?:attentionList|marginTop2)[^"]*"[^>]*>.*?</(?:ul|p)>~su','',$fragment)??$fragment;$fragment=preg_replace('~<br\s*/?>~i',"\n",$fragment)??$fragment;
  foreach(explode("\n",html_entity_decode(strip_tags($fragment),ENT_QUOTES|ENT_HTML5,'UTF-8')) as $line){$line=trim($line);if($line&&mb_strlen($line)<=600&&!preg_match('/(?:\(C\)|\(c\)|©|材質|素材)/u',$line))$lines[]=$line;}
 }
 $images=[];$nodes=$x->query($candy?'.//div[contains(concat(" ",normalize-space(@class)," ")," itemSlider ")]//img/@src':'.//ul[contains(concat(" ",normalize-space(@class)," ")," main_itemImgGallery ")]//img/@src',$root);
 foreach($nodes as $node){$image=news_image_url($node->nodeValue);if($image&&!in_array($image,$images,true)&&count($images)<8)$images[]=$image;}
 if(!$schedule||!$images)throw new RuntimeException('商品の発売・予約情報または写真を確認できませんでした。');
 return ['url'=>$url,'source'=>$candy?'バンダイ キャンディ':'バンダイ おもちゃ','tipsOnly'=>true,'title'=>$title,'date'=>'','schedule'=>$schedule,'facts'=>$facts,'paragraphs'=>array_slice(array_unique($lines),0,60),'images'=>$images,'image'=>$images[0]];
}
