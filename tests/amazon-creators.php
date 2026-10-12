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
