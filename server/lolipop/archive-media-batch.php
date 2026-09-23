<?php
declare(strict_types=1);
$config=require __DIR__.'/config.php';
$origin=$_SERVER['HTTP_ORIGIN']??'';
if($origin!==''&&in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Content-Type: application/json; charset=utf-8');header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}
function out(array $x,int $s=200):never{http_response_code($s);echo json_encode($x,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}

function share_dir(array $config):string{
  $mediaRoot=realpath((string)($config['media_root']??''));
  if(!$mediaRoot)out(['ok'=>false,'error'=>'Media storage is not configured'],503);
  $dir=rtrim(sys_get_temp_dir(),DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'sanrio-post-helper-shares-'.substr(hash('sha256',$mediaRoot),0,16);
  if(!is_dir($dir)&&!@mkdir($dir,0700,true)&&!is_dir($dir))out(['ok'=>false,'error'=>'Temporary share storage is unavailable'],503);
  @chmod($dir,0700);
  return $dir;
}
function share_read(array $config,string $shareToken):array{
  if(!preg_match('/^[a-f0-9]{64}$/i',$shareToken))out(['ok'=>false,'error'=>'Invalid or expired link'],404);
  $mediaRoot=realpath((string)($config['media_root']??''));
  if(!$mediaRoot)out(['ok'=>false,'error'=>'Share storage is unavailable'],503);
  $dir=rtrim(sys_get_temp_dir(),DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'sanrio-post-helper-shares-'.substr(hash('sha256',$mediaRoot),0,16);
  $file=$dir.DIRECTORY_SEPARATOR.hash('sha256',strtolower($shareToken)).'.json';
  if(!is_file($file))out(['ok'=>false,'error'=>'Link not found or expired'],404);
  $record=json_decode((string)@file_get_contents($file),true);
  if(!is_array($record)||empty($record['expiresAt'])||(int)$record['expiresAt']<time()){
    @unlink($file);
    out(['ok'=>false,'error'=>'Link expired'],410);
  }
  return $record;
}
function share_text(mixed $v,int $max):string{
  if(!is_string($v)&&!is_numeric($v))return '';
  $s=(string)$v;
  return function_exists('mb_substr')?mb_substr($s,0,$max,'UTF-8'):substr($s,0,$max);
}
function share_https_url(mixed $v):?string{
  if(!is_string($v)||strlen($v)>4096)return null;
  $p=parse_url($v);
  return is_array($p)&&strtolower((string)($p['scheme']??''))==='https'&&!empty($p['host'])&&empty($p['user'])&&empty($p['pass'])?$v:null;
}
$action=(string)($_GET['action']??'stats');
$sharedRecord=null;
$sharedRequest=$_SERVER['REQUEST_METHOD']==='GET'&&in_array($action,['shared','shared_file'],true);
if($sharedRequest){
  $sharedRecord=share_read($config,(string)($_GET['token']??''));
  if($action==='shared'){
    header('Cache-Control: no-store, max-age=0');
    out(['ok'=>true,'expiresAt'=>date(DATE_ATOM,(int)$sharedRecord['expiresAt']),'snapshot'=>$sharedRecord['snapshot']??[]]);
  }
}

$h=$_SERVER['HTTP_AUTHORIZATION']??'';$token=preg_match('/^Bearer\\s+(.+)$/i',$h,$m)?trim($m[1]):'';
if(!$sharedRequest&&(($config['sync_key']??'')===''||!hash_equals((string)$config['sync_key'],$token)))out(['ok'=>false,'error'=>'Unauthorized'],401);


if($_SERVER['REQUEST_METHOD']==='POST'&&(string)($_GET['action']??'')==='share'){
  $raw=file_get_contents('php://input');
  if(!is_string($raw)||strlen($raw)>2000000)out(['ok'=>false,'error'=>'Share snapshot is too large'],413);
  $input=json_decode($raw,true);
  if(!is_array($input)||!is_array($input['posts']??null)||count($input['posts'])<1||count($input['posts'])>5)out(['ok'=>false,'error'=>'One to five posts are required'],400);
  $posts=[];
  foreach($input['posts'] as $post){
    if(!is_array($post))continue;
    $images=[];$videos=[];
    foreach(array_slice(is_array($post['images']??null)?$post['images']:[],0,20) as $url){$safe=share_https_url($url);if($safe!==null)$images[]=$safe;}
    foreach(array_slice(is_array($post['videos']??null)?$post['videos']:[],0,10) as $url){$safe=share_https_url($url);if($safe!==null)$videos[]=$safe;}
    $metrics=[];
    foreach(['impressions','likes','bookmarks','clicks'] as $metric){$value=$post[$metric]??null;$metrics[$metric]=is_numeric($value)?max(0,(float)$value):null;}
    $posts[]=[
      'title'=>share_text($post['title']??'',240),
      'text'=>share_text($post['text']??'',16000),
      'postedAt'=>share_text($post['postedAt']??'',100),
      'xUrl'=>share_https_url($post['xUrl']??''),
      'images'=>$images,'videos'=>$videos,
      'impressions'=>$metrics['impressions'],'likes'=>$metrics['likes'],'bookmarks'=>$metrics['bookmarks'],'clicks'=>$metrics['clicks']
    ];
  }
  if(count($posts)<1)out(['ok'=>false,'error'=>'No valid posts to share'],400);
  $dir=share_dir($config);
  foreach((glob($dir.DIRECTORY_SEPARATOR.'*.json')?:[]) as $old){if(!is_file($old))continue;$oldRecord=json_decode((string)@file_get_contents($old),true);if(!is_array($oldRecord)||(int)($oldRecord['expiresAt']??0)<time())@unlink($old);}
  $shareToken=bin2hex(random_bytes(32));
  $expiresAt=time()+1800;
  $snapshot=['version'=>share_text($input['version']??'',40),'scope'=>in_array($input['scope']??'', ['今日の候補','最近の保存投稿'],true)?$input['scope']:'投稿候補','createdAt'=>date(DATE_ATOM),'posts'=>$posts];
  $record=['expiresAt'=>$expiresAt,'snapshot'=>$snapshot];
  $path=$dir.DIRECTORY_SEPARATOR.hash('sha256',$shareToken).'.json';
  $encoded=json_encode($record,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE);
  if(!is_string($encoded)||file_put_contents($path,$encoded,LOCK_EX)===false)out(['ok'=>false,'error'=>'Could not create a temporary share link'],500);
  @chmod($path,0600);
  header('Cache-Control: no-store, max-age=0');
  out(['ok'=>true,'token'=>$shareToken,'expiresAt'=>date(DATE_ATOM,$expiresAt)]);
}
$pdo=new PDO((string)$config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
if($_SERVER['REQUEST_METHOD']==='GET'){
  $action=(string)($_GET['action']??'stats');
  if($action==='shared_file'){
    $url=trim((string)($_GET['url']??''));
    if($url===''||strlen($url)>4096)out(['ok'=>false,'error'=>'Invalid media URL'],400);
    $allowedUrls=[];
    foreach(($sharedRecord['snapshot']['posts']??[]) as $sharedPost){foreach(($sharedPost['images']??[]) as $sharedUrl)$allowedUrls[]=(string)$sharedUrl;}
    if(!in_array($url,$allowedUrls,true))out(['ok'=>false,'error'=>'Media is not included in this share'],403);
    $lookup=$pdo->prepare("SELECT storage_path,mime_type FROM sanrio_post_media WHERE public_url=:url AND media_type IN ('image','gif') LIMIT 1");
    $lookup->execute([':url'=>$url]);$media=$lookup->fetch();
    if(!$media)out(['ok'=>false,'error'=>'Shared image not found'],404);
    $root=realpath((string)($config['media_root']??''));$relative=(string)$media['storage_path'];
    if(!$root||str_contains($relative,'..')||!preg_match('~^media/[0-9]{1,64}/[a-f0-9]{64}\\.[a-z0-9]{1,8}$~i',$relative))out(['ok'=>false,'error'=>'Invalid media path'],404);
    $path=realpath($root.DIRECTORY_SEPARATOR.str_replace('/',DIRECTORY_SEPARATOR,$relative));
    if(!$path||!str_starts_with($path,$root.DIRECTORY_SEPARATOR)||!is_file($path))out(['ok'=>false,'error'=>'Image file not found'],404);
    $mime=(string)$media['mime_type'];if(!str_starts_with($mime,'image/'))out(['ok'=>false,'error'=>'Unsupported image type'],415);
    header('Content-Type: '.$mime);header('Content-Length: '.(string)filesize($path));header('Cache-Control: no-store, max-age=0');header('X-Content-Type-Options: nosniff');readfile($path);exit;
  }

  if($action==='stats'){
    $r=$pdo->query("SELECT COUNT(*) media_count,COUNT(DISTINCT post_id) media_posts,COALESCE(SUM(byte_size),0) bytes,SUM(media_type IN ('image','gif')) images,SUM(media_type='video') videos FROM sanrio_post_media")->fetch();
    $posts=(int)$pdo->query("SELECT COUNT(*) FROM sanrio_post_sync WHERE canonical_key LIKE 'post:%'")->fetchColumn();
    out(['ok'=>true,'posts'=>$posts,'mediaCount'=>(int)($r['media_count']??0),'mediaPosts'=>(int)($r['media_posts']??0),'bytes'=>(int)($r['bytes']??0),'images'=>(int)($r['images']??0),'videos'=>(int)($r['videos']??0)]);
  }
  if($action==='manifest'){
    $rows=$pdo->query("SELECT post_id,media_type,public_url FROM sanrio_post_media WHERE public_url IS NOT NULL AND public_url<>'' ORDER BY post_id,id")->fetchAll();
    $items=array_map(fn($r)=>['postId'=>(string)$r['post_id'],'mediaType'=>(string)$r['media_type'],'publicUrl'=>(string)$r['public_url']],$rows);
    out(['ok'=>true,'count'=>count($items),'items'=>$items]);
  }
  if($action==='file'){
    $url=trim((string)($_GET['url']??''));
    if($url===''||strlen($url)>4096)out(['ok'=>false,'error'=>'Invalid media URL'],400);
    $lookup=$pdo->prepare("SELECT storage_path,mime_type FROM sanrio_post_media WHERE public_url=:url AND media_type IN ('image','gif') LIMIT 1");
    $lookup->execute([':url'=>$url]);
    $media=$lookup->fetch();
    if(!$media)out(['ok'=>false,'error'=>'Image is not in the archive media index'],404);
    $root=realpath((string)($config['media_root']??''));
    $relative=(string)$media['storage_path'];
    if(!$root||str_contains($relative,'..')||!preg_match('~^media/[0-9]{1,64}/[a-f0-9]{64}\\.[a-z0-9]{1,8}$~i',$relative))out(['ok'=>false,'error'=>'Invalid media path'],404);
    $path=realpath($root.DIRECTORY_SEPARATOR.str_replace('/',DIRECTORY_SEPARATOR,$relative));
    if(!$path||!str_starts_with($path,$root.DIRECTORY_SEPARATOR)||!is_file($path))out(['ok'=>false,'error'=>'Image file not found'],404);
    header('Content-Type: '.(string)$media['mime_type']);
    header('Content-Length: '.(string)filesize($path));
    header('Cache-Control: private, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
  }
  if($action==='repair_permissions'){
    $root=rtrim((string)($config['media_root']??''),DIRECTORY_SEPARATOR);
    $base=$root.DIRECTORY_SEPARATOR.'media';
    if($root===''||!is_dir($base))out(['ok'=>false,'error'=>'Media directory not found'],404);
    $dirs=0;$files=0;$failed=0;
    $it=new RecursiveIteratorIterator(
      new RecursiveDirectoryIterator($base,FilesystemIterator::SKIP_DOTS),
      RecursiveIteratorIterator::SELF_FIRST
    );
    @chmod($base,0755);
    foreach($it as $item){
      $path=$item->getPathname();
      if($item->isDir()){
        if(@chmod($path,0755))$dirs++;else $failed++;
      }elseif($item->isFile()){
        if(@chmod($path,0644))$files++;else $failed++;
      }
    }
    out(['ok'=>true,'dirs'=>$dirs,'files'=>$files,'failed'=>$failed]);
  }
  out(['ok'=>false,'error'=>'Unknown action'],404);
}
if($_SERVER['REQUEST_METHOD']!=='POST')out(['ok'=>false,'error'=>'POST required'],405);
$ids=$_POST['post_ids']??[];$uploads=$_FILES['media']??null;
if(!is_array($ids)||!$uploads||!is_array($uploads['tmp_name']??null))out(['ok'=>false,'error'=>'media[] and post_ids[] required'],400);
$stmt=$pdo->prepare('INSERT INTO sanrio_post_media (post_id,media_type,original_name,stored_name,storage_path,public_url,mime_type,byte_size,sha256) VALUES (:post_id,:media_type,:original_name,:stored_name,:storage_path,:public_url,:mime_type,:byte_size,:sha256) ON DUPLICATE KEY UPDATE public_url=VALUES(public_url),storage_path=VALUES(storage_path)');
$allowed=['image/jpeg'=>'image','image/png'=>'image','image/gif'=>'gif','video/mp4'=>'video','video/quicktime'=>'video','video/webm'=>'video'];$results=[];
foreach($uploads['tmp_name'] as $i=>$tmp){
  $id=trim((string)($ids[$i]??''));if(!preg_match('/^[0-9]{1,64}$/',$id)||!is_uploaded_file($tmp)){$results[]=['ok'=>false,'index'=>$i,'error'=>'Invalid upload'];continue;}
  $mime=(new finfo(FILEINFO_MIME_TYPE))->file($tmp)?:'';if(!isset($allowed[$mime])){$results[]=['ok'=>false,'index'=>$i,'error'=>'Unsupported media type'];continue;}
  $hash=hash_file('sha256',$tmp);$ext=strtolower(pathinfo((string)($uploads['name'][$i]??''),PATHINFO_EXTENSION));$ext=preg_match('/^[a-z0-9]{1,8}$/',$ext)?$ext:'bin';
  $stored=$hash.'.'.$ext;$relative='media/'.$id.'/'.$stored;$root=rtrim((string)($config['media_root']??''),DIRECTORY_SEPARATOR);if($root===''){$results[]=['ok'=>false,'index'=>$i,'error'=>'Media storage not configured'];continue;}
  $dir=$root.DIRECTORY_SEPARATOR.'media'.DIRECTORY_SEPARATOR.$id;if(!is_dir($dir)&&!mkdir($dir,0750,true)&&!is_dir($dir)){$results[]=['ok'=>false,'index'=>$i,'error'=>'Storage unavailable'];continue;}
  $target=$dir.DIRECTORY_SEPARATOR.$stored;if(!is_file($target)&&!move_uploaded_file($tmp,$target)){$results[]=['ok'=>false,'index'=>$i,'error'=>'Store failed'];continue;}
  @chmod($dir,0755);@chmod($target,0644);
  $base=rtrim((string)($config['media_public_base']??''),'/');$url=$base!==''?$base.'/'.$relative:null;
  $stmt->execute([':post_id'=>$id,':media_type'=>$allowed[$mime],':original_name'=>basename((string)$uploads['name'][$i]),':stored_name'=>$stored,':storage_path'=>$relative,':public_url'=>$url,':mime_type'=>$mime,':byte_size'=>(int)$uploads['size'][$i],':sha256'=>$hash]);
  $results[]=['ok'=>true,'index'=>$i,'postId'=>$id,'publicUrl'=>$url,'mediaType'=>$allowed[$mime]];
}
out(['ok'=>true,'results'=>$results]);
