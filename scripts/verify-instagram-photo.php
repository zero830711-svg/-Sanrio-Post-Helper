<?php
declare(strict_types=1);
define('SPH_NEWS_TEST',true);
require __DIR__.'/../server/lolipop/news.php';
function photo_check(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function photo_reject(callable $f):void{try{$f();}catch(RuntimeException $e){return;}throw new RuntimeException('Unsafe input accepted');}
$item=['instagram'=>true,'url'=>'https://www.instagram.com/p/PHOTO_TEST/','images'=>['https://scontent.example.cdninstagram.com/1.jpg','https://scontent.example.fbcdn.net/2.jpg'],'paragraphs'=>['Caption: release 10/10.'],'title'=>'Test'];
photo_check(news_photo_indices($item,[1,0])===[1,0],'Selection order lost');
foreach([[0,0],[-1],[2],['0'],[],[0,1,2,3]] as $indices)photo_reject(fn()=>news_photo_indices($item,$indices));
photo_reject(fn()=>news_photo_indices(['instagram'=>false,'images'=>$item['images']],[0]));
foreach(['http://x.cdninstagram.com/a','https://evilcdninstagram.com/a','https://x.cdninstagram.com.evil.test/a','https://user:pass@x.cdninstagram.com/a','https://x.cdninstagram.com:443/a','https://127.0.0.1/a'] as $url)photo_reject(fn()=>news_photo_image($url));
$valid=['readings'=>[['index'=>1,'original'=>'10/16 HK$1,000','japanese'=>'10/16 香港ドル1,000']]];
$rows=news_photo_validate(json_encode($valid),[1]);photo_check($rows[0]['index']===1,'Photo identity lost');
$bad=$valid;$bad['readings'][0]['japanese']='10/16 100円';photo_reject(fn()=>news_photo_validate(json_encode($bad),[1]));
photo_reject(fn()=>news_photo_validate(json_encode($valid),[0]));
photo_reject(fn()=>news_photo_validate('{"readings":[]}',[1]));
$path=news_photo_cache($item,[1]);file_put_contents($path,json_encode(['configured'=>true,'readings'=>$rows]));
try{
 $merged=news_photo_material($item,[1]);photo_check(str_contains($merged['paragraphs'][0],'HK$1,000')&&end($merged['paragraphs'])===$item['paragraphs'][0],'Photo/caption material lost');
 $safe=news_photo_supported_sentences("🎀 ハローキティのお買い物ニュースです✨\n3日間限定のセールです。\n10月16日に香港ドル1,000のお買い物で特典。",$merged);
 photo_check(!str_contains($safe,'3日間')&&str_contains($safe,'10月16日')&&str_contains($safe,'1,000'),'Unsupported claim not omitted conservatively');
 photo_check(news_photo_supported_sentences('3日間限定です。',['paragraphs'=>[]])==='3日間限定です。','Caption-only drafting changed');
 $changed=$item;$changed['images'][1].='?new=1';photo_check(news_photo_cached($changed,[1])===[],'Changed photo reused stale OCR');
 photo_check(news_photo_cached($item,[0])===[],'Changed selection reused stale OCR');
 touch($path,time()-86401);clearstatcache();photo_check(news_photo_cached($item,[1])===[],'Expired OCR reused');
}finally{@unlink($path);}
echo "Instagram photo selection, URL safety, output validation and cache tests passed\n";
