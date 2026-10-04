<?php
declare(strict_types=1);
define('OV_TEST_ONLY',true);
require __DIR__.'/../server/lolipop/overseas.php';
function ov_check(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
$batches=[];
foreach(ov_sources() as $id=>$source){
    $body=file_get_contents(__DIR__.'/overseas-'.$id.($id==='us'?'.json':'.html'));
    $items=ov_parse($id,$body);
    ov_check(count($items)===3,$id.' cards');
    foreach($items as $item){ov_check($item['thumbnail']!=='',$id.' image');ov_check($item['date']===''&&$item['products']===[],$id.' no invented facts');}
    $batches[$id]=['ok'=>true,'items'=>$items];
}
ov_check(str_contains($batches['tarts']['items'][0]['title'],'한교동'),'angle brackets must preserve Korean character name');
ov_check(ov_product_url('https://www.sanrio.com.evil.example/products/test','us')==='','foreign host rejected');
ov_check(ov_image_url('https://cdn.shopify.com/s/files/1/other/files/test.png')==='','other store image rejected');
ov_check(ov_image_url('https://shoplineimg.com/5cc813ba527c4b0001a31e32/id/test.png')!=='','known store image');
ov_check(ov_image_url('https://user@shoplineimg.com/5cc813ba527c4b0001a31e32/id/test.png')==='','credentials rejected');
try{ov_parse('us','{"products":[]}');throw new LogicException('empty list accepted');}catch(RuntimeException $e){}
try{ov_parse('tarts','<html>maintenance</html>');throw new LogicException('broken structure accepted');}catch(RuntimeException $e){}
$first=ov_merge([],$batches,'2026-10-04T00:00:00Z');
ov_check(count(ov_payload($first,'2026-10-04T00:10:00Z')['items'])===12,'initial snapshot includes linkless products');
ov_check(!array_filter(ov_payload($first,'2026-10-04T00:10:00Z')['items'],fn($i)=>$i['isNew']),'initial snapshot is baseline');
$added=$batches;$new=ov_item('us','https://www.sanrio.com/products/new-discovery','New discovery',$batches['us']['items'][0]['thumbnail']);
$added['us']['items']=[$new,$batches['us']['items'][0]];
$second=ov_merge($first,$added,'2026-10-04T01:00:00Z');
$items=ov_payload($second,'2026-10-04T01:10:00Z')['items'];
ov_check(count($items)===13,'retain removed candidates and add one');
$fresh=array_values(array_filter($items,fn($i)=>$i['isNew']));
ov_check(count($fresh)===1&&$fresh[0]['url']===$new['url'],'only newly discovered item is new');
$failed=ov_merge($second,[],'2026-10-04T01:30:00Z');
ov_check(count(ov_payload($failed,'2026-10-04T01:40:00Z')['items'])===13,'failed fetch preserves candidates');
ov_check($failed['sources']['us']['health']['lastSuccessAt']==='2026-10-04T01:00:00Z','failure preserves success timestamp');
$again=ov_merge($failed,$added,'2026-10-04T02:00:00Z');
ov_check($again['sources']['us']['items'][0]['firstSeenAt']==='2026-10-04T01:00:00Z','first discovery timestamp stays stable');
ov_check(!array_filter(ov_payload($again,'2026-10-06T02:00:00Z')['items'],fn($i)=>$i['isNew']),'new badge expires after 24h');
$longLived=ov_merge($first,$batches,'2027-05-04T00:00:00Z');
$longLived=ov_merge($longLived,$batches,'2027-05-04T01:00:00Z');
ov_check(!array_filter(ov_payload($longLived,'2027-05-04T01:10:00Z')['items'],fn($i)=>$i['isNew']),'still-listed old products never become new when identity retention ages');
json_encode($again,JSON_THROW_ON_ERROR);
echo "Overseas parsers, discovery baseline, retention and URL checks passed\n";
if(in_array('--live',$argv,true)){
    foreach(ov_collect() as $id=>$result){
        ov_check(!empty($result['ok'])&&count($result['items'])>0,$id.' live collection failed');
        ov_check(count(array_filter($result['items'],fn($i)=>$i['thumbnail']!==''))===count($result['items']),$id.' live images');
        echo $id.' live candidates: '.count($result['items'])."\n";
    }
}
