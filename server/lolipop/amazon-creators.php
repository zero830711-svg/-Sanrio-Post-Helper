<?php
declare(strict_types=1);
// Runtime files stay on persistent hosting storage. PHP guards also protect them if
// directory access rules are unavailable; credentials never live in plain JSON.
function am_guard():string{return "<?php http_response_code(404); exit; __halt_compiler();\n";}
function am_write(string $path,array $data):void{
 $tmp=tempnam(dirname($path),'private-');if($tmp===false)throw new RuntimeException('保存できません。');
 $guarded=$tmp.'.php';if(!rename($tmp,$guarded)){unlink($tmp);throw new RuntimeException('保存できません。');}
 chmod($guarded,0600);try{if(file_put_contents($guarded,am_guard().json_encode($data,JSON_THROW_ON_ERROR),LOCK_EX)===false||!rename($guarded,$path))throw new RuntimeException('保存できません。');}finally{if(is_file($guarded))unlink($guarded);}
}
function am_read(string $path):array{
 if(!is_file($path))return [];$raw=file_get_contents($path);if($raw===false)throw new RuntimeException('保存データを読み込めません。');
 if(str_starts_with($raw,am_guard()))$raw=substr($raw,strlen(am_guard()));
 try{$d=json_decode($raw,true,512,JSON_THROW_ON_ERROR);}catch(Throwable $e){throw new RuntimeException('保存データを確認できません。上書きせず管理者に確認してください。');}
 if(!is_array($d))throw new RuntimeException('保存データの形式を確認してください。');return $d;
}
function am_storage(string $dir,string $legacy):string{
 if(!is_dir($dir)&&!mkdir($dir,0700,true)&&!is_dir($dir))throw new RuntimeException('保存先を準備できません。');chmod($dir,0700);
 if(!is_file($dir.'/.htaccess')&&file_put_contents($dir.'/.htaccess',"Require all denied\nDeny from all\n",LOCK_EX)===false)throw new RuntimeException('保存先を保護できません。');
 $lock=fopen($dir.'/migration.lock.php','c+');if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('保存先を確認できません。');chmod($dir.'/migration.lock.php',0600);
 try{foreach(['settings','auto','token'] as $name){$target=$dir.'/'.$name.'.php';$old=$legacy.'/'.$name.'.json';if(!is_file($target)&&is_file($old))am_write($target,am_read($old));}}finally{flock($lock,LOCK_UN);fclose($lock);}
 return $dir;
}
function am_dir():string{return am_storage(__DIR__.'/.amazon-creators-private',sys_get_temp_dir().'/sph-amazon-creators-'.hash('sha256',__DIR__));}
function am_validate(array $d):array{
 foreach(['credentialId','secret','version','partnerTag'] as $field)if(isset($d[$field])&&!is_string($d[$field]))throw new RuntimeException('認証情報の入力内容を確認してください。');
 $id=trim((string)($d['credentialId']??''));$secret=trim((string)($d['secret']??''));$version=(string)($d['version']??'3.3');$tag=trim((string)($d['partnerTag']??''));
 if(!preg_match('/^amzn1\.application-oa2-client\.[A-Za-z0-9]{16,128}$/D',$id))throw new RuntimeException('認証情報IDを確認してください。');
 if(!preg_match('/^[\x21-\x7E]{16,512}$/D',$secret))throw new RuntimeException('シークレットを確認してください。');
 if(!in_array($version,['3.1','3.2','3.3'],true))throw new RuntimeException('バージョンを確認してください。');
 if(!preg_match('/^[a-zA-Z0-9_-]{1,80}-22$/D',$tag))throw new RuntimeException('日本のトラッキングID（末尾 -22）を確認してください。');
 return ['credentialId'=>$id,'secret'=>$secret,'version'=>$version,'partnerTag'=>$tag];
}
function am_public(array $s):array{return ['storageVersion'=>'persistent-3534','configured'=>!empty($s['credentialId'])&&!empty($s['secret']),'version'=>$s['version']??'3.3','partnerTag'=>$s['partnerTag']??'ononbrothers2-22'];}
function am_endpoint(string $version):string{return ['3.1'=>'https://api.amazon.com/auth/o2/token','3.2'=>'https://api.amazon.co.uk/auth/o2/token','3.3'=>'https://api.amazon.co.jp/auth/o2/token'][$version]??throw new RuntimeException('認証バージョンを確認してください。');}
function am_http(string $url,array $payload,array $headers=[]):array{
 if(!in_array($url,['https://api.amazon.com/auth/o2/token','https://api.amazon.co.uk/auth/o2/token','https://api.amazon.co.jp/auth/o2/token','https://creatorsapi.amazon/catalog/v1/searchItems'],true))throw new RuntimeException('接続先を確認できません。');
 $c=curl_init($url);$body='';
 curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_THROW_ON_ERROR),CURLOPT_HTTPHEADER=>array_merge(['Content-Type: application/json'],$headers),CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>25,CURLOPT_WRITEFUNCTION=>static function($c,$chunk)use(&$body){if(strlen($body)+strlen($chunk)>1000000)return 0;$body.=$chunk;return strlen($chunk);}]);
 $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
 if($ok===false)throw new RuntimeException('Amazonへの接続が時間切れ、または通信エラーになりました。自動再試行はしません。');
 return ['status'=>$status,'data'=>json_decode($body,true)?:[]];
}
final class AmConnectionException extends RuntimeException{
 public string $stage;public int $upstreamStatus;
 public function __construct(int $status,bool $token){parent::__construct(am_error($status,$token));$this->stage=$token?'authentication':'product-search';$this->upstreamStatus=$status;}
}
function am_error(int $status,bool $token):string{
 if($status===429)return 'Amazonの利用上限に達しました。時間をおいて接続確認してください。';
 if($status===401||($token&&$status===400))return '認証情報ID・シークレット・バージョンを確認してください。';
 if($status===403)return $token?'Amazonの認証段階でアクセスを拒否されました。認証情報・バージョンとAmazon側の利用資格を確認してください。':'Amazonの認証は通りましたが、商品APIの利用権限をまだ確認できません。作成直後の反映待ちの可能性がありますが、このエラーだけでは断定できません。';
 return 'Amazonから商品情報を取得できませんでした（HTTP '.$status.'）。';
}
function am_results(array $data):array{
 $out=[];foreach(array_slice($data['searchResult']['items']??[],0,10) as $row){
  $title=$row['itemInfo']['title']['displayValue']??'';$url=$row['detailPageURL']??'';$image=$row['images']['primary']['medium']['url']??'';
  $p=parse_url((string)$url);if(!is_string($title)||!$title||($p['scheme']??'')!=='https'||($p['host']??'')!=='www.amazon.co.jp'||isset($p['user'])||isset($p['pass'])||isset($p['port']))continue;
  $ip=parse_url((string)$image);if(($ip['scheme']??'')!=='https'||!in_array($ip['host']??'',['m.media-amazon.com','images-na.ssl-images-amazon.com','images-fe.ssl-images-amazon.com'],true)||isset($ip['user'])||isset($ip['pass'])||isset($ip['port']))$image='';
  $out[]=['title'=>mb_substr($title,0,500),'url'=>$url,'image'=>$image];
 }return $out;
}
function am_search(array $s,string $keywords,?callable $transport=null,int $page=1):array{
 if($page<1||$page>10)throw new RuntimeException('検索ページは1〜10で指定してください。');
 $s=am_validate($s);$keywords=trim($keywords);if(!$keywords||mb_strlen($keywords)>120)throw new RuntimeException('検索語を120文字以内で入力してください。');
 $call=$transport??'am_http';$tokenPath=am_dir().'/token.php';$fingerprint=hash('sha256',json_encode($s));$cache=$transport?[]:am_read($tokenPath);
 if(($cache['fingerprint']??'')===$fingerprint&&($cache['expires']??0)>time()+60)$token=$cache['token'];
 else{
  $r=$call(am_endpoint($s['version']),['grant_type'=>'client_credentials','client_id'=>$s['credentialId'],'client_secret'=>$s['secret'],'scope'=>'creatorsapi::default'],[]);
  $token=$r['data']['access_token']??'';if($r['status']!==200||!is_string($token)||!preg_match('/^[\x21-\x7E]{10,10000}$/D',$token))throw new AmConnectionException($r['status'],true);
  if(!$transport)am_write($tokenPath,['fingerprint'=>$fingerprint,'token'=>$token,'expires'=>time()+min(3600,max(0,(int)($r['data']['expires_in']??0)))]);
 }
 $r=$call('https://creatorsapi.amazon/catalog/v1/searchItems',['keywords'=>$keywords,'searchIndex'=>'All','itemCount'=>10,'itemPage'=>$page,'marketplace'=>'www.amazon.co.jp','partnerTag'=>$s['partnerTag'],'resources'=>['itemInfo.title','images.primary.medium']],['Authorization: Bearer '.$token,'x-marketplace: www.amazon.co.jp']);
 if($r['status']!==200){if(!$transport&&$r['status']===401&&is_file($tokenPath))unlink($tokenPath);throw new AmConnectionException($r['status'],false);}
 if(!isset($r['data']['searchResult'])||!is_array($r['data']['searchResult']))throw new RuntimeException('Amazonの商品検索結果を確認できませんでした。');
 $total=$r['data']['searchResult']['totalResultCount']??null;if(!is_int($total)||$total<0)$total=null;
 $rawCount=count($r['data']['searchResult']['items']??[]);
 return ['connected'=>true,'items'=>am_results($r['data']),'partnerTag'=>$s['partnerTag'],'page'=>$page,'pageSize'=>10,'totalResults'=>$total,'hasMore'=>$page<10&&$rawCount>0&&($total!==null?$total>$page*10:$rawCount>=10)];
}
// Shared server-side discovery cache: URLs/text expire within 24 hours; no image bytes.
function am_asin(string $url):string{
 $p=parse_url($url);if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.amazon.co.jp'||isset($p['user'])||isset($p['pass'])||isset($p['port']))return '';
 return preg_match('~/(?:dp|gp/product)/([A-Z0-9]{10})(?:/|$)~i',$p['path']??'',$m)?strtoupper($m[1]):'';
}
function am_auto_queries():array{
 $queries=['サンリオ'];
 foreach(['ハローキティ','マイメロディ','クロミ','シナモロール','ポムポムプリン','ポチャッコ','ハンギョドン','リトルツインスターズ','こぎみゅん','ウサハナ'] as $character){
  foreach(['ぬいぐるみ','ポーチ','文房具','キーホルダー'] as $category)$queries[]=$character.' '.$category;
 }
 return $queries;
}
function am_auto_items(array $state,int $now):array{
 return array_values(array_filter($state['items']??[],static fn($item)=>is_array($item)&&($item['fetchedAt']??0)>$now-86400&&($item['fetchedAt']??0)<=$now&&am_asin((string)($item['url']??''))!==''));
}
function am_auto_public(array $state,int $now):array{
 $queries=am_auto_queries();$next=max(0,(int)($state['queryIndex']??0))%count($queries);
 return ['items'=>am_auto_items($state,$now),'partnerTag'=>$state['partnerTag']??'','updatedAt'=>$state['updatedAt']??0,'lastAttemptAt'=>$state['lastAttemptAt']??0,'nextAt'=>$state['nextAt']??0,'lastQuery'=>$state['lastQuery']??'','nextQuery'=>$queries[$next],'queryCount'=>count($queries),'autoState'=>$state['autoState']??'empty','autoError'=>$state['autoError']??''];
}
function am_auto_tick(array $state,array $settings,int $now,?callable $search=null):array{
 // A browser opening, cron run and manual refresh all share this cooldown.
 if(($state['nextAt']??0)>$now)return $state;
 $queries=am_auto_queries();$index=max(0,(int)($state['queryIndex']??0))%count($queries);$query=$queries[$index];
 $state['lastAttemptAt']=$now;$state['nextAt']=$now+1800;$state['lastQuery']=$query;
 try{
  $result=($search??'am_search')($settings,$query);$pool=[];
  foreach(am_auto_items($state,$now) as $item)$pool[am_asin($item['url'])]=$item;
  foreach($result['items']??[] as $item){
   $asin=am_asin((string)($item['url']??''));$title=(string)($item['title']??'');
   if(!$asin||!preg_match('/サンリオ|ハローキティ|マイメロディ|クロミ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|リトルツインスターズ|キキララ|こぎみゅん|ウサハナ/u',$title))continue;
   $pool[$asin]=['asin'=>$asin,'title'=>mb_substr($title,0,500),'url'=>$item['url'],'image'=>$item['image']??'','fetchedAt'=>$now,'query'=>$query];
  }
  uasort($pool,static fn($a,$b)=>$b['fetchedAt']<=>$a['fetchedAt']);$state['items']=array_slice($pool,0,300,true);
  $state['updatedAt']=$now;$state['partnerTag']=$result['partnerTag']??$settings['partnerTag'];$state['queryIndex']=($index+1)%count($queries);$state['autoState']='ok';$state['autoError']='';unset($state['failureStage'],$state['upstreamStatus']);
 }catch(Throwable $e){
  $state['items']=am_auto_items($state,$now);$state['autoState']='error';
  $state['autoError']=$e instanceof AmConnectionException?$e->getMessage():'Amazon候補の取得に失敗しました。取得済み候補は保持しています。';
  if($e instanceof AmConnectionException){$state['failureStage']=$e->stage;$state['upstreamStatus']=$e->upstreamStatus;if(in_array($e->upstreamStatus,[401,403,429],true))$state['nextAt']=$now+21600;}
 }
 return $state;
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
 $action=$_GET['action']??'settings';$method=$_SERVER['REQUEST_METHOD']??'GET';$path=am_dir().'/settings.php';
 if($action==='settings'&&$method==='GET')am_out(['ok'=>true]+am_public(am_read($path)));
 if($action==='candidates'&&$method==='GET')am_out(['ok'=>true]+am_auto_public(am_read(am_dir().'/auto.php'),time())+am_public(am_read($path)));
 if($method!=='POST')am_out(['ok'=>false,'error'=>'POSTで実行してください。'],405);
 if(!in_array($origin,$config['allowed_origins']??[],true))am_out(['ok'=>false,'error'=>'許可されたアプリから実行してください。'],403);
 $raw=(string)file_get_contents('php://input',false,null,0,8193);$d=json_decode($raw,true);if(strlen($raw)>8192||!is_array($d))am_out(['ok'=>false,'error'=>'入力内容を確認してください。'],400);
 if($action==='settings'){$s=am_validate($d);am_write($path,$s);am_write(am_dir().'/auto.php',[]);$tokenPath=am_dir().'/token.php';if(is_file($tokenPath))unlink($tokenPath);am_out(['ok'=>true]+am_public($s));}
 if(!in_array($action,['search','discover'],true))am_out(['ok'=>false,'error'=>'操作を確認してください。'],400);
 $page=$d['page']??1;if($action==='search'&&(!is_int($page)||$page<1||$page>10))am_out(['ok'=>false,'error'=>'検索ページは1〜10で指定してください。'],400);
 $s=am_read($path);if(!am_public($s)['configured'])am_out(['ok'=>false,'error'=>'先に認証情報を保存してください。'],400);
 $lock=fopen(am_dir().'/search.lock.php','c+');chmod(am_dir().'/search.lock.php',0600);if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))throw new RuntimeException('Amazonを確認中です。少し待ってください。');
 try{
  if($action==='discover'){
   $state=am_read(am_dir().'/auto.php');
   if(($state['nextAt']??0)>time())$result=['ok'=>true,'cached'=>true]+am_auto_public($state,time());
   else{
    $last=(int)stream_get_contents($lock);if(time()-$last<5)throw new RuntimeException('5秒以上間隔をあけてください。');rewind($lock);ftruncate($lock,0);fwrite($lock,(string)time());fflush($lock);
    $state=am_auto_tick($state,$s,time());am_write(am_dir().'/auto.php',$state);$result=['ok'=>($state['autoState']??'')!=='error']+am_auto_public($state,time());
    if(!$result['ok'])$result+=['error'=>$state['autoError'],'stage'=>$state['failureStage']??'unknown','upstreamStatus'=>$state['upstreamStatus']??0];
   }
  }else{$last=(int)stream_get_contents($lock);if(time()-$last<5)throw new RuntimeException('5秒以上間隔をあけてください。');rewind($lock);ftruncate($lock,0);fwrite($lock,(string)time());fflush($lock);$result=am_search($s,(string)($d['keywords']??'サンリオ'),null,$page);}
 }
 finally{flock($lock,LOCK_UN);fclose($lock);}
 am_out($result+['ok'=>true],empty($result['ok'])&&isset($result['ok'])?502:200);
}catch(AmConnectionException $e){am_out(['ok'=>false,'error'=>$e->getMessage(),'stage'=>$e->stage,'upstreamStatus'=>$e->upstreamStatus],502);
}catch(Throwable $e){am_out(['ok'=>false,'error'=>$e->getMessage()],502);}
