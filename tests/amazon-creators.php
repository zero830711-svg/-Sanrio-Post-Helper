<?php
declare(strict_types=1);
define('SPH_AMAZON_TEST',true);
require __DIR__.'/../server/lolipop/amazon-creators.php';
function check_am(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function reject_am(callable $f):void{try{$f();}catch(RuntimeException $e){return;}throw new RuntimeException('Invalid credentials accepted');}
$settings=['credentialId'=>'amzn1.application-oa2-client.'.str_repeat('a',32),'secret'=>'FAKE_TEST_SECRET_NOT_REAL_123456','version'=>'3.3','partnerTag'=>'test-22'];
check_am(am_validate($settings)===$settings,'Credential validation changed values');
check_am(am_endpoint('3.3')==='https://api.amazon.co.jp/auth/o2/token','Japan token host mismatch');
reject_am(fn()=>am_validate(array_replace($settings,['version'=>'https://evil.test'])));
reject_am(fn()=>am_validate(array_replace($settings,['credentialId'=>'wrong'])));
reject_am(fn()=>am_validate(array_replace($settings,['partnerTag'=>'wrong-20'])));
check_am(!str_contains(json_encode(am_public($settings)),$settings['secret'])&&!array_key_exists('credentialId',am_public($settings)),'Credentials exposed in public settings');
$calls=[];
$transport=static function($url,$payload,$headers)use(&$calls){$calls[]=[$url,$payload,$headers];if(count($calls)===1)return ['status'=>200,'data'=>['access_token'=>'FAKE_TOKEN_NOT_REAL_123456','expires_in'=>3600]];
 return ['status'=>200,'data'=>['searchResult'=>['items'=>[['detailPageURL'=>'https://www.amazon.co.jp/dp/B000000001?tag=test-22','itemInfo'=>['title'=>['displayValue'=>'サンリオのテスト商品']],'images'=>['primary'=>['medium'=>['url'=>'https://m.media-amazon.com/images/I/test.jpg']]]],['detailPageURL'=>'https://evil.test','itemInfo'=>['title'=>['displayValue'=>'Bad link']]]]]]];};
$result=am_search($settings,'サンリオ',$transport);
check_am($calls[0][1]['scope']==='creatorsapi::default'&&$calls[0][1]['client_secret']===$settings['secret'],'OAuth request mismatch');
check_am($calls[1][0]==='https://creatorsapi.amazon/catalog/v1/searchItems'&&$calls[1][1]['marketplace']==='www.amazon.co.jp'&&$calls[1][1]['partnerTag']==='test-22','Search request mismatch');
check_am($calls[1][1]['itemCount']===10&&$calls[1][1]['itemPage']===1,'Search must request ten items on page one');
check_am(count($result['items'])===1&&$result['items'][0]['image']==='https://m.media-amazon.com/images/I/test.jpg','Result URL validation failed');
check_am(!str_contains(json_encode($result),$settings['secret'])&&!str_contains(json_encode($result),'FAKE_TOKEN'),'Token or secret returned in search');
check_am(str_contains(am_error(403,false),'利用権限')&&str_contains(am_error(401,true),'認証情報'),'Authentication and API access not distinguished');
$file=am_dir().'/unit-test.json';try{am_write($file,$settings);check_am((fileperms($file)&0777)===0600,'Private file permissions incorrect');check_am(am_read($file)===$settings,'Saved credentials damaged');}finally{if(is_file($file))unlink($file);}
echo "Amazon JP auth, secret redaction, search payload, URL safety and private storage verified\n";

foreach([true,false] as $tokenFailure){
 $count=0;
 try{
  am_search($settings,'サンリオ',static function()use(&$count,$tokenFailure){$count++;return (!$tokenFailure&&$count===1)?['status'=>200,'data'=>['access_token'=>'FAKE_TOKEN_NOT_REAL_123456','expires_in'=>3600]]:['status'=>403,'data'=>['message'=>'PRIVATE_PROVIDER_RESPONSE']];});
  throw new RuntimeException('403 accepted');
 }catch(AmConnectionException $e){
  check_am($e->stage===($tokenFailure?'authentication':'product-search')&&$e->upstreamStatus===403,'Failed stage not identified');
  check_am(!str_contains($e->getMessage(),'PRIVATE_PROVIDER_RESPONSE')&&!str_contains($e->getMessage(),'48時間'),'Unsafe or misleading error');
  check_am($count===($tokenFailure?1:2),'Unexpected automatic retry');
 }
}
echo "Authentication and product permission failures distinguished without exposing provider responses\n";

$now=1800000000;$requests=[];
$fixture=static function($s,$query)use(&$requests){$requests[]=$query;return ['partnerTag'=>'test-22','items'=>[
 ['title'=>'サンリオ キティのバッグ','url'=>'https://www.amazon.co.jp/dp/B000000001?tag=test-22&ref_=original','image'=>'https://m.media-amazon.com/images/I/test.jpg'],
 ['title'=>'サンリオ 同じ商品','url'=>'https://www.amazon.co.jp/dp/B000000001?tag=test-22&ref_=duplicate','image'=>''],
 ['title'=>' unrelated product','url'=>'https://www.amazon.co.jp/dp/B000000002?tag=test-22','image'=>''],
 ['title'=>'サンリオ 不正ホスト','url'=>'https://www.amazon.co.jp.evil.test/dp/B000000003','image'=>'']
 ]];};
$state=am_auto_tick([],$settings,$now,$fixture);
check_am(count(am_auto_public($state,$now)['items'])===1,'ASIN dedupe or Sanrio filtering failed');
check_am($requests===['サンリオ'],'First query is not broad discovery');
$cached=am_auto_tick($state,$settings,$now+1799,$fixture);check_am($cached===$state&&count($requests)===1,'Cache cooldown made extra API calls');
$next=am_auto_tick($state,$settings,$now+1800,$fixture);check_am($requests[1]==='ハローキティ ぬいぐるみ','Search rotation failed');
check_am(count(am_auto_public($next,$now+1800)['items'])===1,'Duplicate product accumulated');
check_am(am_auto_public($next,$now+1800+86400)['items']===[],'Expired product content displayed');
$failed=am_auto_tick($next,$settings,$now+3600,static function(){throw new AmConnectionException(429,false);});
check_am(count(am_auto_public($failed,$now+3600)['items'])===1&&$failed['queryIndex']===$next['queryIndex'],'Failure lost candidates or advanced query');
check_am($failed['nextAt']===$now+3600+21600&&$failed['autoState']==='error','Rate-limit backoff missing');
$unexpected=am_auto_tick([],$settings,$now,static function(){throw new RuntimeException('PRIVATE_TOKEN_RESPONSE');});
check_am(!str_contains(json_encode(am_auto_public($unexpected,$now)),'PRIVATE_TOKEN'),'Discovery error leaked provider content');
check_am(count(am_auto_queries())===41,'Discovery rotation changed');
echo "Amazon discovery ASIN dedupe, query rotation, cache TTL, retained candidates and backoff verified\n";

$pageCalls=[];
$paged=static function($url,$payload,$headers)use(&$pageCalls){$pageCalls[]=$payload;if(isset($payload['grant_type']))return ['status'=>200,'data'=>['access_token'=>'FAKE_TOKEN_NOT_REAL_123456']];$items=[];for($i=0;$i<10;$i++)$items[]=['detailPageURL'=>'https://www.amazon.co.jp/dp/B'.sprintf('%09d',$i),'itemInfo'=>['title'=>['displayValue'=>'商品 '.$i]]];return ['status'=>200,'data'=>['searchResult'=>['items'=>$items,'totalResultCount'=>99]]];};
$page2=am_search($settings,'サンリオ',$paged,2);check_am(count($page2['items'])===10&&$page2['page']===2&&$page2['hasMore']===true&&$page2['totalResults']===99,'Pagination metadata or ten results missing');check_am($pageCalls[1]['itemPage']===2,'Page two was not requested');
$last=am_search($settings,'サンリオ',$paged,10);check_am($last['hasMore']===false,'Page ten must stop');
$before=count($pageCalls);reject_am(fn()=>am_search($settings,'サンリオ',$paged,0));reject_am(fn()=>am_search($settings,'サンリオ',$paged,11));check_am(count($pageCalls)===$before,'Invalid pages made external requests');
$empty=am_search($settings,'見つからない',static fn($url,$p,$h)=>isset($p['grant_type'])?['status'=>200,'data'=>['access_token'=>'FAKE_TOKEN_NOT_REAL_123456']]:['status'=>200,'data'=>['searchResult'=>['items'=>[],'totalResultCount'=>0]]]);check_am($empty['items']===[]&&$empty['hasMore']===false,'Empty result must not continue');
echo "Ten-result search, explicit page selection, page limit and empty results verified\n";
