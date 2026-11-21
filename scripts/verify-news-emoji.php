<?php
$config=require $argv[1];
$article='https://prtimes.jp/main/html/rd/p/000000250.000020954.html';
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
 throw new RuntimeException('Live Groq draft check failed (HTTP '.$status.'). '.($result['error']??''));
}
$text=$result['text'];
preg_match_all('/(?:\p{Emoji_Presentation}|\p{Emoji}\x{FE0F})\x{FE0F}?/u',$text,$matches);
$emoji=array_map(static fn($symbol)=>str_replace("\u{FE0F}",'',$symbol),$matches[0]);
if(count($emoji)<2||count($emoji)!==count(array_unique($emoji))||!str_contains($text,$article)||!str_contains($text,'#サンリオ')||!str_contains($text,'ポムポム')){
 throw new RuntimeException('Live draft did not retain the expected emoji, source link, tag and subject.');
}
echo "Live Groq news draft passed.\n".$text."\n";
