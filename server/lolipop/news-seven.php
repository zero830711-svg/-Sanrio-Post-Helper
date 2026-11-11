<?php
declare(strict_types=1);
// Official manufacturer pages. URLs are deliberately restricted to product paths.
function news_seven_product_url(array $p):string{
 if(isset($p['query'])||isset($p['fragment']))return '';
 $host=$p['host']??'';$path=$p['path']??'';
 $rules=[
  'f-toys.net'=>'~^/item/[a-zA-Z0-9_-]+/$~D',
  'www.ip4.co.jp'=>'~^/cupsuletoy/[a-zA-Z0-9_-]+/$~D',
  'segaplaza.jp'=>'~^/prize/[A-Za-z0-9]+/$~D',
  'www.h-kuji.com'=>'~^/goods/[a-zA-Z0-9_-]+/$~D',
  'kitan.jp'=>'~^/products/[a-zA-Z0-9_-]+/$~D',
  'www.qualia-45.jp'=>'~^/product/view/[0-9]+$~D',
  'www.segafave.co.jp'=>'~^/news/[0-9]{6}_[0-9]+/$~D',
 ];
 return isset($rules[$host])&&preg_match($rules[$host],$path)?'https://'.$host.$path:'';
}
function news_seven_image_url(array $p):string{
 if(isset($p['fragment']))return '';
 $host=$p['host']??'';$path=$p['path']??'';$query=$p['query']??'';
 $rules=[
  'f-toys.net'=>'~^/wp-content/uploads/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$~Di',
  'www.ip4.co.jp'=>'~^/ip4_index/wp-content/uploads/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$~Di',
  'segaplaza.jp'=>'~^/images-v3/prize/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$~Di',
  'www.h-kuji.com'=>'~^/wp-content/uploads/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$~Di',
  'kitan.jp'=>'~^/wp-content/uploads/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$~Di',
  'www.qualia-45.jp'=>'~^/media/[0-9/]+/[0-9]+_[0-9]+x[0-9]+\.(?:png|jpe?g|webp)$~Di',
  'www.segafave.co.jp'=>'~^/(?:_nuxt|ogp/news)/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$~Di',
 ];
 if(!isset($rules[$host])||strpos($path,'..')!==false||!preg_match($rules[$host],$path))return '';
 if($query!==''&&($host!=='www.qualia-45.jp'||!preg_match('/^t=[0-9]+$/D',$query)))return '';
 return 'https://'.$host.$path;
}
function news_seven_source(string $url):string{
 $names=['f-toys.net'=>'エフトイズ','www.ip4.co.jp'=>'IP4','segaplaza.jp'=>'セガプラザ','www.h-kuji.com'=>'Happyくじ','kitan.jp'=>'キタンクラブ','www.qualia-45.jp'=>'Qualia','www.segafave.co.jp'=>'セガ フェイブ'];
 return $names[parse_url($url,PHP_URL_HOST)?:'']??'';
}
function news_seven_abs(string $value,string $origin):string{
 $value=trim($value);if(str_starts_with($value,'//'))return 'https:'.$value;
 return str_starts_with($value,'/')?$origin.$value:$value;
}
function news_seven_relevant(string $s):bool{
 return news_furyu_character($s)||(bool)preg_match('/sanrio|マイスウィートピアノ|ウィッシュミーメル/iu',$s);
}
function news_seven_title(string $s):string{
 return trim(preg_replace('/\s+/u',' ',html_entity_decode(strip_tags($s),ENT_QUOTES|ENT_HTML5,'UTF-8'))??'');
}
function news_seven_image(?DOMElement $img,string $origin):string{
 if(!$img)return '';
 foreach(['data-src-img','data-src','src'] as $key){$v=news_image_url(news_seven_abs($img->getAttribute($key),$origin));if($v)return $v;}
 return '';
}
function news_seven_rows(string $html,string $kind):array{
 $x=news_doc($html);$rows=[];
 $origins=['ftoys'=>'https://f-toys.net','ip4'=>'https://www.ip4.co.jp','segaplaza'=>'https://segaplaza.jp','happy'=>'https://www.h-kuji.com','kitan'=>'https://kitan.jp','qualia'=>'https://www.qualia-45.jp','segafave'=>'https://www.segafave.co.jp'];
 if(!isset($origins[$kind]))throw new RuntimeException('情報元を確認できませんでした。');$origin=$origins[$kind];
 $query=match($kind){
  'ip4'=>'//li[.//a[contains(@href,"/cupsuletoy/")] and .//dl]',
  'segaplaza'=>'//div[contains(concat(" ",normalize-space(@class)," ")," ContainerItem ")]',
  'happy'=>'//a[contains(concat(" ",normalize-space(@class)," ")," c-cardList__link ")]',
  'kitan'=>'//li[contains(concat(" ",normalize-space(@class)," ")," c-productBox__item ")]/a',
  'segafave'=>'//a[contains(concat(" ",normalize-space(@class)," ")," news-content-item ")]',
  default=>'//a[@href]',
 };
 $nodes=$x->query($query);if(!$nodes||!$nodes->length)throw new RuntimeException('情報元の一覧を確認できませんでした。');
 foreach($nodes as $node){
  $a=in_array($kind,['ip4','segaplaza'],true)?$x->query('.//a[@href]',$node)->item(0):$node;
  if(!$a)continue;$url=news_url(news_seven_abs($a->getAttribute('href'),$origin));
  if(!$url||news_seven_source($url)!==news_seven_source($origin)||isset($rows[$url]))continue;
  $image=news_seven_image($x->query('.//img',$node)->item(0),$origin);$schedule='';$date='';
  if($kind==='kitan'){
   // The Sanrio category intentionally contains no product names; details are fetched in one shared batch.
   $rows[$url]=['url'=>$url,'source'=>'キタンクラブ','image'=>$image,'date'=>''];if(count($rows)>=12)break;continue;
  }
  if($kind==='ip4'){
   $dd=$x->query('.//dl/dd',$node)->item(0);$brand=news_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," brand ")]',$node)->item(0));$parts=[];
   if($dd)foreach($x->query('./text()',$dd) as $text){$v=news_seven_title($text->nodeValue);if($v)$parts[]=$v;}
   $title=trim($brand.' '.implode(' ',$parts));$schedule=news_text($x->query('.//dl/dt',$node)->item(0));
  }elseif($kind==='segaplaza'){
   $title=news_text($x->query('.//a[contains(concat(" ",normalize-space(@class)," ")," itemName ")]',$node)->item(0));
   $schedule=news_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," tag-text-date ")]',$node)->item(0));
  }elseif($kind==='happy'){
   $title=news_text($x->query('.//h2',$node)->item(0));$schedule=news_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," c-cardList__date ")]',$node)->item(0));
  }elseif($kind==='segafave'){
   $title=news_text($x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," title ")]',$node)->item(0));$date=str_replace('.','-',news_text($x->query('.//p[contains(concat(" ",normalize-space(@class)," ")," date-text ")]',$node)->item(0)));
  }else{
   $title=news_seven_title(news_text($node));if(!$title){$img=$x->query('.//img',$node)->item(0);$title=$img?news_seven_title($img->getAttribute('alt')):'';}
  }
  if(!$title||!news_seven_relevant($title))continue;
  if($kind==='qualia'&&!$image){foreach($x->query('//a[@href]') as $other){if(news_url(news_seven_abs($other->getAttribute('href'),$origin))!==$url)continue;$image=news_seven_image($x->query('.//img',$other)->item(0),$origin);if($image)break;}}
  $row=['url'=>$url,'source'=>news_seven_source($url),'tipsOnly'=>true,'title'=>mb_substr($title,0,160),'date'=>$date,'image'=>$image];
  if($kind==='segaplaza')$row['prize']=true;
  if($schedule){$row['schedule']=$schedule;$row['facts']=[['kind'=>'schedule','text'=>$schedule]];}
  $rows[$url]=$row;if(count($rows)>=60)break;
 }
 return array_values($rows);
}
function news_seven_parse(string $html,string $url):array{
 $source=news_seven_source($url);$x=news_doc($html);$origin='https://'.parse_url($url,PHP_URL_HOST);
 $rootQuery=match($source){
  'エフトイズ'=>'//div[contains(concat(" ",normalize-space(@class)," ")," item-area ")]',
  'IP4'=>'//article',
  'セガプラザ'=>'//div[contains(concat(" ",normalize-space(@class)," ")," itemDetail ")]',
  'Happyくじ'=>'//section[contains(concat(" ",normalize-space(@class)," ")," p-goodsPost ")]',
  'キタンクラブ'=>'//main[contains(concat(" ",normalize-space(@class)," ")," p-background__contents ")]',
  'Qualia'=>'//div[contains(concat(" ",normalize-space(@class)," ")," product_detail_content ")]',
  'セガ フェイブ'=>'//div[contains(concat(" ",normalize-space(@class)," ")," news-article-container ")]',
  default=>'',
 };
 if(!$rootQuery||!($root=$x->query($rootQuery)->item(0)))throw new RuntimeException('メーカーの商品・記事本体を確認できませんでした。');
 $titleQuery=match($source){
  'エフトイズ'=>'.//h1',
  'IP4'=>'//section/h1',
  'セガプラザ'=>'.//div[contains(concat(" ",normalize-space(@class)," ")," itemName ")]/h3',
  'Happyくじ'=>'.//h1',
  'キタンクラブ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," c-productDetail__content ")]//h2',
  'Qualia'=>'.//h3',
  'セガ フェイブ'=>'.//h2',
  default=>'.//h1',
 };
 $title=news_text($x->query($titleQuery,$root)->item(0));
 if(!$title&&$source==='キタンクラブ')$title=news_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," c-productDetail__detail-item ")]//dd',$root)->item(0));
 if(!$title||!news_seven_relevant($title))throw new RuntimeException('サンリオ関連の商品・記事名を確認できませんでした。');
 // These sites provide stable product canonicals; the other sites either omit or misstate them.
 if(in_array($source,['IP4','セガプラザ','キタンクラブ'],true)){
  $canonical=news_text($x->query('//link[@rel="canonical"]/@href')->item(0));
  if(news_url($canonical)!==$url)throw new RuntimeException('メーカーの商品識別が一致しませんでした。');
 }
 $paragraphQueries=match($source){
  'エフトイズ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," item-txt ")]//p | .//*[contains(concat(" ",normalize-space(@class)," ")," item-txt ")]//dt | .//*[contains(concat(" ",normalize-space(@class)," ")," item-txt ")]//dd | .//*[contains(concat(" ",normalize-space(@class)," ")," item-txt ")]//li',
  'IP4'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," data-read ")]/p',
  'セガプラザ'=>'.//p | .//dt | .//dd',
  'Happyくじ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," p-goodsPost__info ")]/* | .//*[contains(concat(" ",normalize-space(@class)," ")," p-goodsPrize ")]//h3 | .//*[contains(concat(" ",normalize-space(@class)," ")," p-goodsPrize ")]//p',
  'キタンクラブ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," c-productDetail__desc ")]//p | .//*[contains(concat(" ",normalize-space(@class)," ")," c-productDetail__detail ")]//dt',
  'Qualia'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," product_detail_info ")]//dt',
  'セガ フェイブ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," news-article-contents ")]//p | .//*[contains(concat(" ",normalize-space(@class)," ")," news-article-contents ")]//h3',
 };
 $lines=[];$facts=[];$schedule='';
 foreach($x->query($paragraphQueries,$root) as $node){
  $line=news_text($node);if(strtolower($node->nodeName)==='dt'){$dd=$x->query('following-sibling::dd[1]',$node)->item(0);if($dd)$line.='：'.news_text($dd);}
  if(mb_strlen($line)<3||mb_strlen($line)>600||preg_match('/^\s*[©Ⓒ]|APPROVAL NO\.|https?:\/\//iu',$line))continue;
  if(!in_array($line,$lines,true))$lines[]=$line;
  if(!$schedule&&mb_strlen($line)<=120&&preg_match('/(?:発売|登場|販売)[^。]*(?:20[0-9]{2}[.\/年][0-9]{1,2}|[0-9]{1,2}月)|20[0-9]{2}年[0-9]{1,2}月[^。]*(?:発売|登場)/u',$line)){$schedule=$line;$facts[]=['kind'=>'schedule','text'=>$line];}
  if(mb_strlen($line)<=120&&preg_match('/(?:価格|税込|税抜)[^。]*[0-9０-９,，]+円|[0-9０-９,，]+円[^。]*(?:税込|税抜)/u',$line)&&!preg_match('/送料|以上.*購入/u',$line)&&!array_filter($facts,static fn($f)=>$f['kind']==='price'))$facts[]=['kind'=>'price','text'=>$line];
 }
 if($source==='エフトイズ')foreach($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," item-release-info ")]//tr',$root) as $tr){
  $label=news_text($x->query('./th',$tr)->item(0));$value=news_text($x->query('./td',$tr)->item(0));if(!$label||!$value||mb_strlen($value)>120)continue;
  $line=$label.'：'.$value;if(!in_array($line,$lines,true))$lines[]=$line;
  if($label==='発売日'){$schedule=$line;$facts[]=['kind'=>'schedule','text'=>$line];}
  if($label==='販売価格'&&!array_filter($facts,static fn($f)=>$f['kind']==='price'))$facts[]=['kind'=>'price','text'=>$line];
 }
 if($source==='セガプラザ'){
  $period=news_text($x->query('.//span[span[contains(concat(" ",normalize-space(@class)," ")," dateSuffix ")]]',$root)->item(0));
  if($period&&preg_match('/20[0-9]{2}年[0-9]{1,2}月[0-9]{1,2}日/u',$period)){$schedule=$period;$facts[]=['kind'=>'schedule','text'=>$period];$lines[]=$period;}
 }
 if($source==='セガプラザ'){$description=news_text($x->query('//meta[@name="description"]/@content')->item(0));if($description&&!in_array($description,$lines,true))array_unshift($lines,$description);}
 $imageQuery=match($source){
  'エフトイズ'=>'.//ul[contains(concat(" ",normalize-space(@class)," ")," item-main-img ")]//img',
  'IP4'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," data-img ")]//img',
  'セガプラザ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," sampleImages ")]//img',
  'Happyくじ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," p-goodsFv ")]//img | .//*[contains(concat(" ",normalize-space(@class)," ")," p-goodsPost__main ")]//img',
  'キタンクラブ'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," c-productDetail__thum ")]//img | .//*[contains(concat(" ",normalize-space(@class)," ")," c-productDetail__pickup ")]//img',
  'Qualia'=>'.//*[contains(concat(" ",normalize-space(@class)," ")," slide-media ")]//img',
  'セガ フェイブ'=>'.//section[contains(concat(" ",normalize-space(@class)," ")," news-article-section ")]//img',
 };
 $images=[];foreach($x->query($imageQuery,$root) as $img){$image=news_seven_image($img,$origin);
  if($source==='セガプラザ'&&$image){$id=basename(parse_url($url,PHP_URL_PATH));if(!str_contains((string)parse_url($image,PHP_URL_PATH),'/'.$id.'_'))continue;}
  if($image&&!in_array($image,$images,true)&&count($images)<100)$images[]=$image;
 }
 $date='';if($source==='セガ フェイブ'){$d=news_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," news-date ")]',$root)->item(0));if(preg_match('/20[0-9]{2}[.\/][0-9]{1,2}[.\/][0-9]{1,2}/',$d,$m))$date=str_replace(['.','/'],'-',$m[0]);}
 $out=['url'=>$url,'source'=>$source,'tipsOnly'=>true,'title'=>$title,'date'=>$date,'schedule'=>$schedule,'facts'=>$facts,'paragraphs'=>array_slice($lines,0,60),'images'=>$images,'image'=>$images[0]??''];
 if($source==='セガプラザ')$out['prize']=true;
 return $out;
}
