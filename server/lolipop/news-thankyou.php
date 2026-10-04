<?php
declare(strict_types=1);
function news_thankyou_content(string $html,string $url,string $title,string $date):array{
 if(!news_furyu_character($title)||preg_match('/中止|お詫び|店舗情報|オープン/u',$title))throw new RuntimeException('サンリオの新作発表ではありません。');
 $x=news_doc($html);$images=[];$lines=[];
 foreach($x->query('//img/@src') as $n){$image=news_image_url($n->nodeValue);if($image&&!in_array($image,$images,true)&&count($images)<8)$images[]=$image;}
 foreach($x->query('//p | //h2 | //h3 | //li') as $n){$text=news_text($n);if(mb_strlen($text)>=4&&mb_strlen($text)<=600&&!preg_match('/こちら|SHOP LIST|お問い合わせ|送料|公式SNS/u',$text)&&!in_array($text,$lines,true)&&count($lines)<40)$lines[]=$text;}
 // Publication date is not a release date. Keep sale conditions in source paragraphs,
 // rather than extracting a bare date that loses store/item exceptions.
 return ['url'=>$url,'source'=>'サンキューマート','tipsOnly'=>true,'title'=>$title,'date'=>$date,'schedule'=>'','facts'=>[],'paragraphs'=>$lines,'images'=>$images,'image'=>$images[0]??''];
}
function news_thankyou_rows(string $xml,int $now):array{
 if(stripos($xml,'<!DOCTYPE')!==false)throw new RuntimeException('ニュース配信形式を確認できませんでした。');
 $d=new DOMDocument();libxml_use_internal_errors(true);$ok=$d->loadXML($xml,LIBXML_NONET);libxml_clear_errors();if(!$ok)throw new RuntimeException('サンキューマートのニュース配信を読み取れませんでした。');
 $x=new DOMXPath($d);$x->registerNamespace('a','http://www.w3.org/2005/Atom');$rows=[];
 foreach($x->query('/a:feed/a:entry') as $entry){$title=news_text($x->query('./a:title',$entry)->item(0));if(!news_furyu_character($title)||preg_match('/中止|お詫び|店舗情報|オープン/u',$title))continue;
 $url=news_url(news_text($x->query('./a:link[@rel="alternate"]/@href',$entry)->item(0)));$date=news_text($x->query('./a:published',$entry)->item(0));$stamp=strtotime($date);if(!$url||!$stamp||$stamp<$now-90*86400||$stamp>$now+86400)continue;
 $rows[$url]=news_thankyou_content((string)($x->query('./a:content',$entry)->item(0)?->textContent??''),$url,$title,$date);
 }return array_values($rows);
}
function news_thankyou_parse(string $html,string $url):array{
 $x=news_doc($html);if(news_url(news_text($x->query('//meta[@property="og:url"]/@content')->item(0)))!==$url)throw new RuntimeException('記事の識別が一致しませんでした。');
 $root=$x->query('//article[contains(concat(" ",normalize-space(@class)," ")," article-template ")]')->item(0);if(!$root)throw new RuntimeException('ニュースの本文を確認できませんでした。');
 $title=news_text($x->query('.//h1',$root)->item(0));$body=$x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," article-template__content ")]',$root)->item(0);if(!$body)throw new RuntimeException('ニュースの本文を確認できませんでした。');
 return news_thankyou_content($body->ownerDocument->saveHTML($body),$url,$title,news_text($x->query('.//time/@datetime',$root)->item(0)));
}
