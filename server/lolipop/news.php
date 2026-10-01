<?php
declare(strict_types=1);
function news_url(string $u): string {
 $p=parse_url(html_entity_decode(trim($u),ENT_QUOTES|ENT_HTML5,'UTF-8'));if(($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port']))return '';
 $h=$p['host']??'';$path=$p['path']??'';
 if($h==='prtimes.jp'&&preg_match('~^/main/html/rd/p/[0-9]+\.[0-9]+\.html$~D',$path))return 'https://'.$h.$path;
 if($h==='www.sanrio.co.jp'&&preg_match('~^/news/goods/[a-zA-Z0-9_-]+/$~D',$path))return 'https://'.$h.$path;
 return '';
}
function news_image_url(string $u): string {
 $u=html_entity_decode($u,ENT_QUOTES|ENT_HTML5,'UTF-8');$p=parse_url($u);
 if(($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port']))return '';
 $h=$p['host']??'';$path=$p['path']??'';
 if($h==='prcdn.freetls.fastly.net'&&preg_match('~^/release_image/[0-9]+/[0-9]+/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$~D',$path))return 'https://'.$h.$path.'?format=jpeg&width=1600&fit=bounds';
 if($h==='www.sanrio.co.jp'&&preg_match('~^/wp-content/uploads/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp)$~D',$path))return 'https://'.$h.$path;
 return '';
}
function news_fetch(string $u,int $limit=2000000):string {
 $c=curl_init($u);$body='';curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>15,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_USERAGENT=>'SanrioPostHelper News/1.0',CURLOPT_WRITEFUNCTION=>static function($c,$chunk)use(&$body,$limit){if(strlen($body)+strlen($chunk)>$limit)return 0;$body.=$chunk;return strlen($chunk);}]);
 $ok=curl_exec($c);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);if($ok===false||$status!==200)throw new RuntimeException('ニュースを取得できませんでした。時間をおいて再試行してください。');return $body;
}
function news_doc(string $s):DOMXPath{$d=new DOMDocument();libxml_use_internal_errors(true);$d->loadHTML('<?xml encoding="UTF-8">'.str_replace("\0",'',$s),LIBXML_NONET);libxml_clear_errors();return new DOMXPath($d);}
function news_text(?DOMNode $n):string{return trim(preg_replace('/\s+/u',' ',$n?$n->textContent:'')??'');}
function news_detail(string $u):array{
 $cache=sys_get_temp_dir().'/sph-news-'.hash('sha256',__DIR__.$u).'.json';if(is_file($cache)&&filemtime($cache)>time()-900){$a=json_decode((string)file_get_contents($cache),true);if(is_array($a))return $a;}
 $a=news_parse(news_fetch($u),$u);file_put_contents($cache,json_encode($a,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),LOCK_EX);@chmod($cache,0600);return $a;
}
function news_parse(string $html,string $u):array{
 $x=news_doc($html);$pr=strpos($u,'https://prtimes.jp/')===0;
 $title=news_text($x->query('//h1')->item(0));$body=$x->query($pr?'//*[@id="press-release-body"]':'//section[contains(concat(" ",normalize-space(@class)," ")," c-detail-content ") or contains(concat(" ",normalize-space(@class)," ")," c-detail-head ")]')->item(0);
 if(!$title||!$body)throw new RuntimeException('記事の本文を確認できませんでした。');
 $images=[];foreach($x->query('.//img[@src]',$body)as $im){$v=news_image_url($im->getAttribute('src'));if($v&&!in_array($v,$images,true))$images[]=$v;if(count($images)>=4)break;}
 $lines=[];foreach($x->query('.//p',$body)as $p){$t=news_text($p);if(mb_strlen($t)>=12&&mb_strlen($t)<=500)$lines[]=$t;if(count($lines)>=12)break;}
 $date=news_text($x->query('//time/@datetime')->item(0));if(!$date)$date=news_text($x->query('//time')->item(0));if(!$date&&preg_match('/([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/u',news_text($x->query('//meta[@name="description"]/@content')->item(0)),$m))$date=sprintf('%04d-%02d-%02d',(int)$m[1],(int)$m[2],(int)$m[3]);
 $a=['url'=>$u,'source'=>$pr?'PR TIMES':'サンリオ公式','title'=>$title,'date'=>$date,'paragraphs'=>$lines,'images'=>$images];return $a;
}
function news_list():array{
 $cache=sys_get_temp_dir().'/sph-news-list-'.hash('sha256',__DIR__).'.json';if(is_file($cache)&&filemtime($cache)>time()-900){$a=json_decode((string)file_get_contents($cache),true);if(is_array($a))return $a;}
 $rows=[];$errors=[];foreach(['https://www.sanrio.co.jp/news/goods/','https://prtimes.jp/topics/keywords/'.rawurlencode('サンリオ')] as $feed){try{$x=news_doc(news_fetch($feed));foreach($x->query('//a[@href]')as $a){$u=$a->getAttribute('href');if(strpos($u,'/news/goods/')===0)$u='https://www.sanrio.co.jp'.$u;if(strpos($u,'/main/html/rd/p/')===0)$u='https://prtimes.jp'.$u;$u=news_url($u);if(!$u||isset($rows[$u]))continue;$title=news_text($a);if(!$title){$im=$x->query('.//img',$a)->item(0);$title=$im?$im->getAttribute('alt'):'';}if(mb_strlen($title)<5)continue;$im=$x->query('.//img',$a)->item(0);$thumb=$im?news_image_url($im->getAttribute('src')):'';$rows[$u]=['url'=>$u,'title'=>mb_substr($title,0,160),'source'=>strpos($u,'prtimes.jp')!==false?'PR TIMES':'サンリオ公式','image'=>$thumb];if(count($rows)>=30)break;}}catch(Throwable $e){$errors[]=$e->getMessage();}}
 if(!$rows)throw new RuntimeException('ニュース一覧を取得できませんでした。記事URLから開けます。');$result=['items'=>array_values($rows),'warnings'=>$errors,'fetchedAt'=>gmdate('c')];file_put_contents($cache,json_encode($result),LOCK_EX);@chmod($cache,0600);return $result;
}
if(defined('SPH_NEWS_TEST'))return;
$config=require __DIR__.'/config.php';$origin=$_SERVER['HTTP_ORIGIN']??'';if(in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, OPTIONS');header('Cache-Control: no-store');
if(($_SERVER['REQUEST_METHOD']??'')==='OPTIONS'){http_response_code(204);exit;}
function news_out(array $a,int $s=200):void{http_response_code($s);header('Content-Type: application/json; charset=utf-8');echo json_encode($a,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
$token='';if(preg_match('/^Bearer\s+(.+)$/i',$_SERVER['HTTP_AUTHORIZATION']??'',$m))$token=trim($m[1]);$key=(string)($config['sync_key']??'');if(!$key||!hash_equals($key,$token))news_out(['ok'=>false,'error'=>'同期キーを設定してください。'],401);
try{if(($_SERVER['REQUEST_METHOD']??'')!=='GET')news_out(['ok'=>false,'error'=>'GET required'],405);$action=$_GET['action']??'list';if($action==='list')news_out(['ok'=>true]+news_list());$u=news_url((string)($_GET['url']??''));if(!$u)news_out(['ok'=>false,'error'=>'サンリオ公式グッズ記事・PR TIMESの記事URLを入力してください。'],400);$item=news_detail($u);if($action==='detail')news_out(['ok'=>true,'item'=>$item]);if($action!=='image')news_out(['ok'=>false,'error'=>'Unknown action'],400);$i=filter_var($_GET['index']??0,FILTER_VALIDATE_INT);if($i===false||!isset($item['images'][$i]))news_out(['ok'=>false,'error'=>'画像がありません。'],400);$bytes=news_fetch($item['images'][$i],6000000);$size=@getimagesizefromstring($bytes);if(!$size||!in_array($size['mime'],['image/jpeg','image/png','image/webp'],true)||$size[0]*$size[1]>30000000)throw new RuntimeException('画像形式を確認できませんでした。');header('Content-Type: '.$size['mime']);header('X-Content-Type-Options: nosniff');echo $bytes;}catch(Throwable $e){news_out(['ok'=>false,'error'=>$e->getMessage()],502);}
