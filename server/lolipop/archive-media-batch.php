<?php
declare(strict_types=1);
$config=require __DIR__.'/config.php';
$origin=$_SERVER['HTTP_ORIGIN']??'';
if($origin!==''&&in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Content-Type: application/json; charset=utf-8');header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}
function out(array $x,int $s=200):never{http_response_code($s);echo json_encode($x,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
$h=$_SERVER['HTTP_AUTHORIZATION']??'';$token=preg_match('/^Bearer\\s+(.+)$/i',$h,$m)?trim($m[1]):'';
if(($config['sync_key']??'')===''||!hash_equals((string)$config['sync_key'],$token))out(['ok'=>false,'error'=>'Unauthorized'],401);
$pdo=new PDO((string)$config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
if($_SERVER['REQUEST_METHOD']==='GET'){
  $action=(string)($_GET['action']??'stats');
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
  $base=rtrim((string)($config['media_public_base']??''),'/');$url=$base!==''?$base.'/'.$relative:null;
  $stmt->execute([':post_id'=>$id,':media_type'=>$allowed[$mime],':original_name'=>basename((string)$uploads['name'][$i]),':stored_name'=>$stored,':storage_path'=>$relative,':public_url'=>$url,':mime_type'=>$mime,':byte_size'=>(int)$uploads['size'][$i],':sha256'=>$hash]);
  $results[]=['ok'=>true,'index'=>$i,'postId'=>$id,'publicUrl'=>$url,'mediaType'=>$allowed[$mime]];
}
out(['ok'=>true,'results'=>$results]);
