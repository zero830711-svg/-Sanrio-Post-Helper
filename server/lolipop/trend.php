<?php
declare(strict_types=1);
$config = require __DIR__ . '/config.php';

$origin=$_SERVER['HTTP_ORIGIN']??'';$allowed=$config['allowed_origins']??[];
if($origin&&in_array($origin,$allowed,true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

function respond(array $d,int $s=200):never{http_response_code($s);echo json_encode($d,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
function token():string{$h=$_SERVER['HTTP_AUTHORIZATION']??'';return preg_match('/^Bearer\\s+(.+)$/i',$h,$m)?trim($m[1]):'';}
function fetchUrl(string $url,int $timeout=10):string{
 $ctx=stream_context_create(['http'=>['timeout'=>$timeout,'user_agent'=>'SanrioPostHelper/2800','header'=>"Accept: application/json, application/rss+xml, application/xml, text/xml, text/html\r\n"]]);
 $b=@file_get_contents($url,false,$ctx);return $b===false?'':$b;
}
function cleanText(string $s):string{$s=html_entity_decode(strip_tags($s),ENT_QUOTES|ENT_HTML5,'UTF-8');$s=preg_replace('/\\s+/u',' ',trim($s));return mb_substr($s,0,500);}
function isoDate(?string $s):?string{if(!$s)return null;$t=strtotime($s);return $t===false?null:date(DATE_ATOM,$t);}
function iid(string $s,string $u,string $t):string{return substr(hash('sha256',$s.'|'.$u.'|'.$t),0,24);}
function addUnique(array &$items,array $item,array &$seen):void{$k=strtolower(trim(($item['url']??'').'|'.($item['title']??'')));if($k==='|'||isset($seen[$k]))return;$seen[$k]=1;$items[]=$item;}
function parseRss(string $xml,string $source,string $region,array &$items,array &$seen):void{
 if($xml==='')return;libxml_use_internal_errors(true);$rss=simplexml_load_string($xml,'SimpleXMLElement',LIBXML_NOCDATA);if(!$rss)return;
 foreach(($rss->channel->item??[]) as $n){$t=cleanText((string)$n->title);$u=trim((string)$n->link);if($t===''||$u==='')continue;
  addUnique($items,['id'=>iid($source,$u,$t),'source'=>$source,'sourceType'=>'news','region'=>$region,'title'=>$t,'summary'=>cleanText((string)$n->description),'url'=>$u,'publishedAt'=>isoDate((string)$n->pubDate),'votes'=>0,'comments'=>0],$seen);}
}
function parseReddit(string $json,string $sub,array &$items,array &$seen):void{
 $d=json_decode($json,true);foreach(($d['data']['children']??[]) as $r){$x=$r['data']??[];$t=cleanText((string)($x['title']??''));if($t==='')continue;$p=(string)($x['permalink']??'');$u=$p?'https://www.reddit.com'.$p:(string)($x['url']??'');
 addUnique($items,['id'=>iid('Reddit r/'.$sub,$u,$t),'source'=>'Reddit r/'.$sub,'sourceType'=>'reddit','region'=>'GLOBAL','title'=>$t,'summary'=>cleanText((string)($x['selftext']??'')),'url'=>$u,'publishedAt'=>!empty($x['created_utc'])?date(DATE_ATOM,(int)$x['created_utc']):null,'votes'=>(int)($x['score']??0),'comments'=>(int)($x['num_comments']??0)],$seen);}
}
function parseOfficial(string $html,string $base,string $source,string $region,array &$items,array &$seen):void{
 if($html==='')return;libxml_use_internal_errors(true);$dom=new DOMDocument();if(!@$dom->loadHTML($html,LIBXML_NOWARNING|LIBXML_NOERROR))return;$xp=new DOMXPath($dom);
 foreach($xp->query('//a[@href]') as $a){$t=cleanText($a->textContent??'');$u=trim($a->getAttribute('href'));if(mb_strlen($t)<12)continue;
  if(!preg_match('/sanrio|hello kitty|kuromi|my melody|cinnamoroll|pompompurin|pochacco|サンリオ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ/iu',$t))continue;
  if(str_starts_with($u,'/'))$u=rtrim($base,'/').$u;elseif(!preg_match('~^https?://~i',$u))continue;
  addUnique($items,['id'=>iid($source,$u,$t),'source'=>$source,'sourceType'=>'official','region'=>$region,'title'=>$t,'summary'=>'','url'=>$u,'publishedAt'=>null,'votes'=>0,'comments'=>0],$seen);}
}
function words(string $t):array{$s=mb_strtolower($t,'UTF-8');$s=preg_replace('/\\s+-\\s+[^-]{2,40}$/u',' ',$s);$s=preg_replace('/[^\\p{L}\\p{N}]+/u',' ',$s);$stop=['sanrio','characters','character','news','global','launches','launch','release','released','debut','new','the','and','with','for','in','on','to','of','a','an'];$p=preg_split('/\\s+/u',trim($s))?:[];return array_values(array_unique(array_filter($p,fn($w)=>mb_strlen($w,'UTF-8')>=3&&!in_array($w,$stop,true))));}
function similarity(string $a,string $b):float{$wa=words($a);$wb=words($b);if(!$wa||!$wb)return 0;$i=count(array_intersect($wa,$wb));$u=count(array_unique(array_merge($wa,$wb)));return $u?$i/$u:0;}
function priority(array $x):int{$t=mb_strtolower(($x['title']??'').' '.($x['summary']??''),'UTF-8');$s=0;if(preg_match('/collab|collaboration|コラボ|新作|new collection|plush|ぬい|goods|グッズ|限定|limited|pop.?up|ポップアップ|発売|release|再販|restock|キャンペーン|campaign/u',$t))$s+=30;if(($x['sourceType']??'')==='official')$s+=20;if(($x['region']??'')==='JP')$s+=12;if(preg_match('/game|rhythm|mobile game|ゲーム|決算|earnings|financial|corporate|株主/u',$t))$s-=18;return $s;}
function groupTopics(array $items):array{usort($items,fn($a,$b)=>priority($b)<=>priority($a));$g=[];foreach($items as $x){$placed=false;foreach($g as &$z){if(similarity((string)$x['title'],(string)$z['representative']['title'])>=.42){$z['items'][]=$x;if(priority($x)>priority($z['representative']))$z['representative']=$x;$placed=true;break;}}unset($z);if(!$placed)$g[]=['representative'=>$x,'items'=>[$x]];}return $g;}
function ageH(?string $d):float{if(!$d)return 9999;$t=strtotime($d);return $t===false?9999:max(0,(time()-$t)/3600);}

$expected=(string)($config['sync_key']??'');$tk=token();if($expected===''||$tk===''||!hash_equals($expected,$tk))respond(['ok'=>false,'error'=>'Unauthorized'],401);
try{$pdo=new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);}catch(Throwable $e){respond(['ok'=>false,'error'=>'Database connection failed'],500);}

$pdo->exec("CREATE TABLE IF NOT EXISTS sanrio_trend_cache(cache_key VARCHAR(64) NOT NULL PRIMARY KEY,payload LONGTEXT NOT NULL,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("CREATE TABLE IF NOT EXISTS sanrio_trend_seen(topic_key VARCHAR(64) NOT NULL PRIMARY KEY,first_seen_at DATETIME NOT NULL,last_seen_at DATETIME NOT NULL) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("CREATE TABLE IF NOT EXISTS sanrio_trend_state(topic_key VARCHAR(64) NOT NULL PRIMARY KEY,state VARCHAR(16) NOT NULL,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

if(($_GET['action']??'')==='state'){
 if($_SERVER['REQUEST_METHOD']!=='POST')respond(['ok'=>false,'error'=>'POST required'],405);
 $topic=trim((string)($_POST['topic_key']??''));$state=trim((string)($_POST['state']??''));
 if($topic===''||!in_array($state,['used','skip','dislike','clear'],true))respond(['ok'=>false,'error'=>'invalid state'],400);
 if($state==='clear'){$s=$pdo->prepare('DELETE FROM sanrio_trend_state WHERE topic_key=?');$s->execute([$topic]);}
 else{$s=$pdo->prepare('INSERT INTO sanrio_trend_state(topic_key,state) VALUES(?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),updated_at=CURRENT_TIMESTAMP');$s->execute([$topic,$state]);}
 $pdo->exec("DELETE FROM sanrio_trend_cache WHERE cache_key='trend'");
 respond(['ok'=>true,'topicKey'=>$topic,'state'=>$state]);
}

$force=isset($_GET['refresh'])&&$_GET['refresh']==='1';$s=$pdo->prepare('SELECT payload,updated_at FROM sanrio_trend_cache WHERE cache_key=?');$s->execute(['trend']);$cached=$s->fetch();
if(!$force&&$cached&&(time()-strtotime((string)$cached['updated_at']))<1200){$p=json_decode((string)$cached['payload'],true);if(is_array($p)){$p['ok']=true;$p['cached']=true;respond($p);}}

$items=[];$seen=[];$health=[];
$b=fetchUrl('https://corporate.sanrio.co.jp/news/2026.html');$health[]=['label'=>'Sanrio JP','ok'=>$b!==''];if($b!=='')parseOfficial($b,'https://corporate.sanrio.co.jp','Sanrio Japan','JP',$items,$seen);
$b=fetchUrl('https://www.sanrio.com/pages/press-releases');$health[]=['label'=>'Sanrio US','ok'=>$b!==''];if($b!=='')parseOfficial($b,'https://www.sanrio.com','Sanrio US','US',$items,$seen);

$qs=[
 ['Google JP','サンリオ OR ハローキティ OR クロミ OR マイメロ OR シナモロール','ja','JP','JP:ja','Google News JP','JP'],
 ['Google US','Sanrio OR "Hello Kitty" OR Kuromi OR "My Melody" OR Cinnamoroll','en-US','US','US:en','Google News US','US'],
 ['Google KR','산리오 OR 헬로키티 OR 쿠로미 OR 마이멜로디 OR 시나모롤','ko','KR','KR:ko','Google News KR','KR']
];
foreach($qs as [$label,$q,$hl,$gl,$ceid,$source,$region]){$url='https://news.google.com/rss/search?q='.rawurlencode($q).'&hl='.$hl.'&gl='.$gl.'&ceid='.rawurlencode($ceid);$b=fetchUrl($url);$health[]=['label'=>$label,'ok'=>$b!==''];if($b!=='')parseRss($b,$source,$region,$items,$seen);}
$b=fetchUrl('https://www.reddit.com/r/sanrio/hot.json?limit=25&raw_json=1');$health[]=['label'=>'Reddit','ok'=>$b!==''];if($b!=='')parseReddit($b,'sanrio',$items,$seen);

$items=array_values(array_filter($items,function($x){$a=ageH($x['publishedAt']??null);if(($x['sourceType']??'')==='reddit'){return $a<=72&&((int)($x['votes']??0)+(int)($x['comments']??0)*3)>=12;}if(!empty($x['publishedAt']))return $a<=168;return ($x['sourceType']??'')==='official';}));
$groups=groupTopics($items);$out=[];$seenQ=$pdo->prepare('SELECT first_seen_at FROM sanrio_trend_seen WHERE topic_key=?');$seenUp=$pdo->prepare('INSERT INTO sanrio_trend_seen(topic_key,first_seen_at,last_seen_at) VALUES(?,NOW(),NOW()) ON DUPLICATE KEY UPDATE last_seen_at=NOW()');$stateQ=$pdo->prepare('SELECT state FROM sanrio_trend_state WHERE topic_key=?');
foreach($groups as $g){$rep=$g['representative'];$key=substr(hash('sha256',implode('|',words((string)$rep['title']))),0,40);$seenQ->execute([$key]);$r=$seenQ->fetch();$first=$r?(string)$r['first_seen_at']:date('Y-m-d H:i:s');$seenUp->execute([$key]);$stateQ->execute([$key]);$sr=$stateQ->fetch();
 $regions=array_map(fn($x)=>(string)($x['region']??''),$g['items']);$rep['topicKey']=$key;$rep['firstSeenAt']=date(DATE_ATOM,strtotime($first));$rep['isNew']=(time()-strtotime($first))<86400;$rep['relatedCount']=count($g['items']);$rep['relatedSources']=array_values(array_unique(array_map(fn($x)=>(string)($x['source']??''),$g['items'])));$rep['relatedItems']=array_map(fn($x)=>['source'=>$x['source']??'','url'=>$x['url']??'','region'=>$x['region']??''],array_slice($g['items'],0,8));$rep['jpCount']=count(array_filter($regions,fn($r)=>$r==='JP'));$rep['foreignCount']=count(array_filter($regions,fn($r)=>$r!==''&&$r!=='JP'));$rep['userState']=$sr?(string)$sr['state']:'';$out[]=$rep;}
usort($out,function($a,$b){$score=function($x){$age=ageH($x['publishedAt']??$x['firstSeenAt']??null);$fresh=max(0,72-min($age,144)*.75);$ahead=((int)($x['jpCount']??0)===0&&(int)($x['foreignCount']??0)>=2)?18:0;return priority($x)+$fresh+$ahead+min(20,max(0,((int)($x['relatedCount']??1)-1)*6));};return $score($b)<=>$score($a);});
$payload=['ok'=>true,'apiVersion'=>'2800','cached'=>false,'fetchedAt'=>date(DATE_ATOM),'items'=>array_slice($out,0,30),'count'=>count($out),'groupedCount'=>count($groups),'rawCount'=>count($items),'sourceHealth'=>$health];
$save=$pdo->prepare('INSERT INTO sanrio_trend_cache(cache_key,payload) VALUES(?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload),updated_at=CURRENT_TIMESTAMP');$save->execute(['trend',json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);respond($payload);
