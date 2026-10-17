<?php
declare(strict_types=1);
// One real product generation on code deployment, no recurring jobs or retries.
try{
 $config=require $argv[1];$key=(string)($config['sync_key']??'');if($key==='')throw new RuntimeException('Sync configuration unavailable');
 $base='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/';
 $request=static function(string $path,?array $payload=null)use($base,$key):array{
  $c=curl_init($base.$path);curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_TIMEOUT=>65,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key,'Origin: https://zero830711-svg.github.io','Content-Type: application/json']]);
  if($payload!==null)curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_THROW_ON_ERROR)]);
  $raw=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);$data=json_decode((string)$raw,true);
  if($status!==200||empty($data['ok']))throw new RuntimeException('Product AI verification HTTP '.$status.'; '.($data['error']??'Invalid response'));return $data;
 };
 $data=$request('lovely-watch.php?action=detail&url='.rawurlencode('https://www.gourmandise.jp/view/item/000000011056'));$item=$data['item']??[];
 if(!str_contains(strtolower($item['title']??''),'bubble pop charm'))throw new RuntimeException('Requested product identity mismatch');
 $rows=[$item['title']];foreach([$item['manufacturerInfo']['facts']??[],$item['productInfo']['specs']??[]] as $facts)foreach($facts as $name=>$value)if(!preg_match('/素材|価格|在庫|JAN|商品コード|掲載/u',(string)$name))$rows[]=$name.'：'.$value;
 if(!empty($item['productInfo']['contents']))$rows[]='セット内容：'.implode(' / ',$item['productInfo']['contents']);
 $amazon='https://link.amazon/B00Yq3m5X';$link='https://a.r10.to/hPDw44';$source=mb_substr(implode("\n",$rows),0,4000);
 $result=$request('news.php?action=product-groq-draft',['mode'=>'product','title'=>$item['title'],'text'=>$source,'links'=>[['kind'=>'amazon','url'=>$amazon],['kind'=>'rakuten','url'=>$link]]]);$text=(string)($result['text']??'');
 if(empty($result['configured'])||!str_contains($text,'bubble pop charm')||!str_contains($text,$link)||!str_contains($text,$amazon)||!str_ends_with($text,'#pr'))throw new RuntimeException('Generated product text or original link missing');
 $withoutLinks=preg_replace('~https?://[^\s<>]+~u','',$text);$numbers=static function(string $s):array{preg_match_all('/[0-9０-９]+(?:[,，.．][0-9０-９]+)*/u',$s,$m);return array_map(static fn($v)=>str_replace([',','，','．'],['','','.'],mb_convert_kana($v,'n','UTF-8')),$m[0]);};
 if(array_diff($numbers($withoutLinks),$numbers($source)))throw new RuntimeException('Unsupported numbers remain in generated text');
 echo "Live product AI verified: bubble pop charm; supported numeric tokens and original Amazon link.amazon and Rakuten links preserved; no retries\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
