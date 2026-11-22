<?php
$config=require $argv[1];
$cases=[
 ['https://benelic.com/capsuletoy/news/202611_11/','キーホルダー','📁','🔑'],
 ['https://prtimes.jp/main/html/rd/p/000000089.000108253.html','くじ','🎟️','🎁'],
 ['https://www.puroland.jp/goods-feature/embroidery_keychain/','刺繍キーホルダー','',''],
];
foreach($cases as [$article,$subject,$left,$right]){
 $curl=curl_init('https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/news.php?action=ai-draft');
 curl_setopt_array($curl,[
  CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$config['sync_key'],'Origin: https://zero830711-svg.github.io','Content-Type: application/json'],
  CURLOPT_POSTFIELDS=>json_encode(['url'=>$article]),
  CURLOPT_RETURNTRANSFER=>true,
  CURLOPT_CONNECTTIMEOUT=>10,
  CURLOPT_TIMEOUT=>105
 ]);
 $response=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
 $result=json_decode((string)$response,true);
 if($status!==200||empty($result['ok'])||($result['provider']??'')!=='groq'||empty($result['text'])){
  throw new RuntimeException('Live draft failed for '.$subject.' (HTTP '.$status.'). '.($result['error']??''));
 }
 $text=$result['text'];
 $headline=explode("\n",$text,2)[0];
 preg_match_all('/(?:\p{Emoji_Presentation}|\p{Emoji}\x{FE0F})\x{FE0F}?/u',$text,$matches);
 $emoji=array_map(static fn($symbol)=>str_replace("\u{FE0F}",'',$symbol),$matches[0]);
 if(($left!==''&&(!str_starts_with($headline,$left.'【')||!str_ends_with($headline,'】'.$right)))||!str_contains($text,$subject)||count($emoji)!==count(array_unique($emoji))||!str_contains($text,'#サンリオ')){
  throw new RuntimeException('Unexpected live draft for '.$subject.': '.$headline);
 }
 echo "Live Groq headline passed: ".$headline."\n";
}

foreach(['12月4日','各880円','エントランスショップ'] as $term){
 if(!str_contains($text,$term))throw new RuntimeException('Missing official Puroland fact: '.$term);
}
if(!preg_match('/ハローキティ|マイメロディ|クロミ|ピアノ|シナモン|ポムポムプリン|ポチャッコ|ウサハナ/u',$text)){
 throw new RuntimeException('Generated Puroland draft did not use the official lineup.');
}
echo "Live Puroland draft passed:\n".$text."\n";
