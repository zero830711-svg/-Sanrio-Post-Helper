<?php
declare(strict_types=1);
function am_dir():string{$d=sys_get_temp_dir().'/sph-amazon-creators-'.hash('sha256',__DIR__);if(!is_dir($d)&&!mkdir($d,0700,true))throw new RuntimeException('保存先を準備できません。');chmod($d,0700);return $d;}
function am_write(string $path,array $data):void{$tmp=tempnam(dirname($path),'private-');if($tmp===false)throw new RuntimeException('保存できません。');chmod($tmp,0600);try{if(file_put_contents($tmp,json_encode($data,JSON_THROW_ON_ERROR),LOCK_EX)===false||!rename($tmp,$path))throw new RuntimeException('保存できません。');}finally{if(is_file($tmp))unlink($tmp);}}
function am_read(string $path):array{if(!is_file($path))return [];$d=json_decode((string)file_get_contents($path),true);return is_array($d)?$d:[];}
function am_validate(array $d):array{
 foreach(['credentialId','secret','version','partnerTag'] as $field)if(isset($d[$field])&&!is_string($d[$field]))throw new RuntimeException('認証情報の入力内容を確認してください。');
 $id=trim((string)($d['credentialId']??''));$secret=trim((string)($d['secret']??''));$version=(string)($d['version']??'3.3');$tag=trim((string)($d['partnerTag']??''));
 if(!preg_match('/^amzn1\.application-oa2-client\.[A-Za-z0-9]{16,128}$/D',$id))throw new RuntimeException('認証情報IDを確認してください。');
 if(!preg_match('/^[\x21-\x7E]{16,512}$/D',$secret))throw new RuntimeException('シークレットを確認してください。');
 if(!in_array($version,['3.1','3.2','3.3'],true))throw new RuntimeException('バージョンを確認してください。');
 if(!preg_match('/^[a-zA-Z0-9_-]{1,80}-22$/D',$tag))throw new RuntimeException('日本のトラッキングID（末尾 -22）を確認してください。');
 return ['credentialId'=>$id,'secret'=>$secret,'version'=>$version,'partnerTag'=>$tag];
}
function am_public(array $s):array{return ['configured'=>!empty($s['credentialId'])&&!empty($s['secret']),'version'=>$s['version']??'3.3','partnerTag'=>$s['partnerTag']??'ononbrothers2-22'];}
function am_endpoint(string $version):string{return ['3.1'=>'https://api.amazon.com/auth/o2/token','3.2'=>'https://api.amazon.co.uk/auth/o2/token','3.3'=>'https://api.amazon.co.jp/auth/o2/token'][$version]??throw new RuntimeException('認証バージョンを確認してください。');}
function am_http(string $url,array $payload,array $headers=[]):array{
 if(!in_array($url,['https://api.amazon.com/auth/o2/token','https://api.amazon.co.uk/auth/o2/token','https://api.amazon.co.jp/auth/o2/token','https://creatorsapi.amazon/catalog/v1/searchItems'],true))throw new RuntimeException('接続先を確認できません。');
 $c=curl_init($url);$body='';
 curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_THROW_ON_ERROR),CURLOPT_HTTPHEADER=>array_merge(['Content-Type: application/json'],$headers),CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>25,CURLOPT_WRITEFUNCTION=>static function($c,$chunk)use(&$body){if(strlen($body)+strlen($chunk)>1000000)return 0;$body.=$chunk;return strlen($chunk);}]);
 $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
 if($ok===false)throw new RuntimeException('Amazonへの接続が時間切れ、または通信エラーになりました。自動再試行はしません。');
 return ['status'=>$status,'data'=>json_decode($body,true)?:[]];
}
function am_error(int $status,bool $token):string{
 if($status===429)return 'Amazonの利用上限に達しました。時間をおいて接続確認してください。';
 if($status===401||($token&&$status===400))return '認証情報ID・シークレット・バージョンを確認してください。';
 if($status===403)return 'Amazonの商品APIの利用権限をまだ確認できません。作成直後は反映まで最大48時間かかる場合があります。';
 return 'Amazonから商品情報を取得できませんでした（HTTP '.$status.'）。';
}
function am_results(array $data):array{
 $out=[];foreach(array_slice($data['searchResult']['items']??[],0,5) as $row){
  $title=$row['itemInfo']['title']['displayValue']??'';$url=$row['detailPageURL']??'';$image=$row['images']['primary']['medium']['url']??'';
  $p=parse_url((string)$url);if(!is_string($title)||!$title||($p['scheme']??'')!=='https'||($p['host']??'')!=='www.amazon.co.jp'||isset($p['user'])||isset($p['pass'])||isset($p['port']))continue;
  $ip=parse_url((string)$image);if(($ip['scheme']??'')!=='https'||!in_array($ip['host']??'',['m.media-amazon.com','images-na.ssl-images-amazon.com','images-fe.ssl-images-amazon.com'],true)||isset($ip['user'])||isset($ip['pass'])||isset($ip['port']))$image='';
  $out[]=['title'=>mb_substr($title,0,500),'url'=>$url,'image'=>$image];
 }return $out;
}
function am_search(array $s,string $keywords,?callable $transport=null):array{
 $s=am_validate($s);$keywords=trim($keywords);if(!$keywords||mb_strlen($keywords)>120)throw new RuntimeException('検索語を120文字以内で入力してください。');
 $call=$transport??'am_http';$tokenPath=am_dir().'/token.json';$fingerprint=hash('sha256',json_encode($s));$cache=$transport?[]:am_read($tokenPath);
 if(($cache['fingerprint']??'')===$fingerprint&&($cache['expires']??0)>time()+60)$token=$cache['token'];
 else{
  $r=$call(am_endpoint($s['version']),['grant_type'=>'client_credentials','client_id'=>$s['credentialId'],'client_secret'=>$s['secret'],'scope'=>'creatorsapi::default'],[]);
  $token=$r['data']['access_token']??'';if($r['status']!==200||!is_string($token)||!preg_match('/^[\x21-\x7E]{10,10000}$/D',$token))throw new RuntimeException(am_error($r['status'],true));
  if(!$transport)am_write($tokenPath,['fingerprint'=>$fingerprint,'token'=>$token,'expires'=>time()+min(3600,max(0,(int)($r['data']['expires_in']??0)))]);
 }
 $r=$call('https://creatorsapi.amazon/catalog/v1/searchItems',['keywords'=>$keywords,'searchIndex'=>'All','itemCount'=>5,'marketplace'=>'www.amazon.co.jp','partnerTag'=>$s['partnerTag'],'resources'=>['itemInfo.title','images.primary.medium']],['Authorization: Bearer '.$token,'x-marketplace: www.amazon.co.jp']);
 if($r['status']!==200){if(!$transport&&$r['status']===401&&is_file($tokenPath))unlink($tokenPath);throw new RuntimeException(am_error($r['status'],false));}
 if(!isset($r['data']['searchResult'])||!is_array($r['data']['searchResult']))throw new RuntimeException('Amazonの商品検索結果を確認できませんでした。');
 return ['connected'=>true,'items'=>am_results($r['data']),'partnerTag'=>$s['partnerTag']];
}
if(defined('SPH_AMAZON_TEST'))return;
function am_out(array $d,int $status=200):void{http_response_code($status);header('Content-Type: application/json; charset=utf-8');echo json_encode($d,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
$config=require __DIR__.'/config.php';$origin=$_SERVER['HTTP_ORIGIN']??'';header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
if(in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if(($_SERVER['REQUEST_METHOD']??'')==='OPTIONS')exit;
$auth=$_SERVER['HTTP_AUTHORIZATION']??'';$token=preg_match('/^Bearer (.+)$/D',$auth,$m)?$m[1]:'';$key=(string)($config['sync_key']??'');
if(!$key||!hash_equals($key,$token))am_out(['ok'=>false,'error'=>'アプリの同期キーを確認してください。'],401);
try{
 $action=$_GET['action']??'settings';$method=$_SERVER['REQUEST_METHOD']??'GET';$path=am_dir().'/settings.json';
 if($action==='settings'&&$method==='GET')am_out(['ok'=>true]+am_public(am_read($path)));
 if($method!=='POST')am_out(['ok'=>false,'error'=>'POSTで実行してください。'],405);
 if(!in_array($origin,$config['allowed_origins']??[],true))am_out(['ok'=>false,'error'=>'許可されたアプリから実行してください。'],403);
 $raw=(string)file_get_contents('php://input',false,null,0,8193);$d=json_decode($raw,true);if(strlen($raw)>8192||!is_array($d))am_out(['ok'=>false,'error'=>'入力内容を確認してください。'],400);
 if($action==='settings'){$s=am_validate($d);am_write($path,$s);$tokenPath=am_dir().'/token.json';if(is_file($tokenPath))unlink($tokenPath);am_out(['ok'=>true]+am_public($s));}
 if($action!=='search')am_out(['ok'=>false,'error'=>'操作を確認してください。'],400);
 $s=am_read($path);if(!am_public($s)['configured'])am_out(['ok'=>false,'error'=>'先に認証情報を保存してください。'],400);
 $lock=fopen(am_dir().'/search.lock','c+');chmod(am_dir().'/search.lock',0600);if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))throw new RuntimeException('Amazonを確認中です。少し待ってください。');
 try{$last=(int)stream_get_contents($lock);if(time()-$last<5)throw new RuntimeException('5秒以上間隔をあけてください。');rewind($lock);ftruncate($lock,0);fwrite($lock,(string)time());fflush($lock);$result=am_search($s,(string)($d['keywords']??'サンリオ'));}
 finally{flock($lock,LOCK_UN);fclose($lock);}
 am_out(['ok'=>true]+$result);
}catch(Throwable $e){am_out(['ok'=>false,'error'=>$e->getMessage()],502);}
