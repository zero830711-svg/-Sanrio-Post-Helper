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
function token():string{$h=$_SERVER['HTTP_AUTHORIZATION']??'';return preg_match('/^Bearer\s+(.+)$/i',$h,$m)?trim($m[1]):'';}
function fetchUrl(string $url,int $timeout=10):string{
 $ctx=stream_context_create(['http'=>['timeout'=>$timeout,'user_agent'=>'SanrioPostHelper/2805','header'=>"Accept: application/json, application/rss+xml, application/xml, text/xml, text/html\r\n"]]);
 $b=@file_get_contents($url,false,$ctx);return $b===false?'':$b;
}
function cleanText(string $s):string{$s=html_entity_decode(strip_tags($s),ENT_QUOTES|ENT_HTML5,'UTF-8');$s=preg_replace('/\s+/u',' ',trim($s));return mb_substr($s,0,500);}
function isoDate(?string $s):?string{if(!$s)return null;$t=strtotime($s);return $t===false?null:date(DATE_ATOM,$t);}
function iid(string $s,string $u,string $t):string{return substr(hash('sha256',$s.'|'.$u.'|'.$t),0,24);}
function addUnique(array &$items,array $item,array &$seen):void{$k=strtolower(trim(($item['url']??'').'|'.($item['title']??'')));if($k==='|'||isset($seen[$k]))return;$seen[$k]=1;$items[]=$item;}
function parseRss(string $xml,string $source,string $region,array &$items,array &$seen):void{
 if($xml==='')return;libxml_use_internal_errors(true);$rss=simplexml_load_string($xml,'SimpleXMLElement',LIBXML_NOCDATA);if(!$rss)return;
 foreach(($rss->channel->item??[]) as $n){$t=cleanText((string)$n->title);$u=trim((string)$n->link);$publisher=cleanText((string)$n->source);if($publisher==='')$publisher=$source;if($t===''||$u==='')continue;
  addUnique($items,['id'=>iid($source,$u,$t),'source'=>$source,'publisher'=>$publisher,'sourceType'=>'news','region'=>$region,'title'=>$t,'summary'=>cleanText((string)$n->description),'url'=>$u,'publishedAt'=>isoDate((string)$n->pubDate),'votes'=>0,'comments'=>0],$seen);}
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
function words(string $t):array{$s=mb_strtolower($t,'UTF-8');$s=preg_replace('/\s+-\s+[^-]{2,40}$/u',' ',$s);$s=preg_replace('/[^\p{L}\p{N}]+/u',' ',$s);$stop=['sanrio','characters','character','news','global','launches','launch','release','released','debut','new','the','and','with','for','in','on','to','of','a','an'];$p=preg_split('/\s+/u',trim($s))?:[];return array_values(array_unique(array_filter($p,fn($w)=>mb_strlen($w,'UTF-8')>=3&&!in_array($w,$stop,true))));}
function similarity(string $a,string $b):float{$wa=words($a);$wb=words($b);if(!$wa||!$wb)return 0;$i=count(array_intersect($wa,$wb));$u=count(array_unique(array_merge($wa,$wb)));return $u?$i/$u:0;}
function priority(array $x):int{$s=!empty($x['amazonProducts'])?55:0;$t=mb_strtolower(($x['title']??'').' '.($x['summary']??''),'UTF-8');if(preg_match('/collab|collaboration|コラボ|新作|new collection|plush|ぬい|goods|グッズ|限定|limited|pop.?up|ポップアップ|発売|release|再販|restock|キャンペーン|campaign/u',$t))$s+=30;if(($x['sourceType']??'')==='official')$s+=20;if(($x['region']??'')==='JP')$s+=12;if(preg_match('/game|rhythm|mobile game|ゲーム|決算|earnings|financial|corporate|株主/u',$t))$s-=18;return $s;}
function groupTopics(array $items):array{usort($items,fn($a,$b)=>priority($b)<=>priority($a));$g=[];foreach($items as $x){$placed=false;foreach($g as &$z){if(similarity((string)$x['title'],(string)$z['representative']['title'])>=.42){$z['items'][]=$x;if(priority($x)>priority($z['representative']))$z['representative']=$x;$placed=true;break;}}unset($z);if(!$placed)$g[]=['representative'=>$x,'items'=>[$x]];}return $g;}
function ageH(?string $d):float{if(!$d)return 9999;$t=strtotime($d);return $t===false?9999:max(0,(time()-$t)/3600);}

function isAllAboutHost(string $host):bool{return $host==='allabout.co.jp'||str_ends_with($host,'.allabout.co.jp');}
function amazonProductCards(string $html):array{
 if($html==='')return [];
 libxml_use_internal_errors(true);$dom=new DOMDocument();if(!@$dom->loadHTML($html,LIBXML_NOWARNING|LIBXML_NOERROR))return [];
 $xp=new DOMXPath($dom);$out=[];$seen=[];$articleTitle='';$articleFeature='';
 $articleTitleNodes=$xp->query('//h1');if($articleTitleNodes&&$articleTitleNodes->length)$articleTitle=cleanText((string)$articleTitleNodes->item(0)->textContent);
 $leadNodes=$xp->query('//*[contains(concat(" ",normalize-space(@class)," ")," article__lead ")]');if($leadNodes&&$leadNodes->length)$articleFeature=cleanText((string)$leadNodes->item(0)->textContent);
 $articleTitleNorm=mb_strtolower(preg_replace('/[^\\p{L}\\p{N}]+/u','',$articleTitle)??'','UTF-8');
 foreach($xp->query('//a[@href]') as $a){
  $href=trim($a->getAttribute('href'));$u=parse_url($href);$host=strtolower((string)($u['host']??''));
  if(!in_array($host,['amazon.co.jp','www.amazon.co.jp','m.amazon.co.jp'],true))continue;
  $path=(string)($u['path']??'');$asin='';
  if(preg_match('~/(?:dp|gp/product|gp/aw/d|exec/obidos/ASIN)/([A-Z0-9]{10})(?:[/?]|$)~i',$path,$m))$asin=strtoupper($m[1]);
  if($asin===''||isset($seen[$asin]))continue;
  $title='';
  for($node=$a->parentNode,$depth=0;$node&&$depth<6;$node=$node->parentNode,$depth++){
   if(!($node instanceof DOMElement))continue;
   $productTitles=$xp->query('.//*[contains(concat(" ",normalize-space(@class)," ")," article-product-item__title ")]',$node);
   if($productTitles&&$productTitles->length){$candidate=cleanText((string)$productTitles->item(0)->textContent);if(mb_strlen($candidate)>=8&&mb_strlen($candidate)<=180)$title=$candidate;}
   if($title!=='')break;
   foreach($xp->query('.//h1|.//h2|.//h3|.//h4|.//strong', $node) as $h){
    $candidate=cleanText((string)$h->textContent);
    if(mb_strlen($candidate)>=8&&mb_strlen($candidate)<=180&&!preg_match('/amazonで見る|楽天で見る|購入はこちら/iu',$candidate)){$title=$candidate;break;}
   }
   if($title!=='')break;
  }
  if($title==='')continue;
  $productTitleComparable=preg_replace('/\\s*[（(][^（）()]{1,40}[）)]\\s*$/u','',$title)??$title;
  $productTitleNorm=mb_strtolower(preg_replace('/[^\\p{L}\\p{N}]+/u','',$productTitleComparable)??'','UTF-8');
  if($articleTitleNorm!==''&&$productTitleNorm!==''&&mb_strpos($articleTitleNorm,$productTitleNorm,0,'UTF-8')===false&&mb_strpos($productTitleNorm,$articleTitleNorm,0,'UTF-8')===false)continue;
  $seen[$asin]=true;
  $out[]=['title'=>$title,'asin'=>$asin,'url'=>'https://www.amazon.co.jp/dp/'.$asin,'source'=>'記事内のAmazon商品カード','feature'=>$articleFeature];
  if(count($out)>=12)break;
 }
 return $out;
}
function getAllAboutAmazonProducts(string $url):array{
 $host=strtolower((string)parse_url($url,PHP_URL_HOST));
 if($host===''||(!isAllAboutHost($host)&&!in_array($host,['news.google.com','news.googleusercontent.com'],true)))return [];
 $html=fetchUrl($url,5);if($html==='')return [];
 libxml_use_internal_errors(true);$dom=new DOMDocument();if(!@$dom->loadHTML($html,LIBXML_NOWARNING|LIBXML_NOERROR))return [];
 $xp=new DOMXPath($dom);$canonical='';
 $nodes=$xp->query('//link[translate(@rel,"CANONICAL","canonical")="canonical"]/@href');
 if($nodes&&$nodes->length)$canonical=trim($nodes->item(0)->nodeValue);
 if($canonical!==''){$finalHost=strtolower((string)parse_url($canonical,PHP_URL_HOST));if(!isAllAboutHost($finalHost))return [];}
 elseif(!isAllAboutHost($host))return [];
 return amazonProductCards($html);
}
function prioritizeLinkedArticleProducts(array &$items):void{
 $order=array_keys($items);usort($order,fn($a,$b)=>priority($items[$b])<=>priority($items[$a]));$checked=0;
 foreach($order as $i){
  if($checked>=5)break;
  if(($items[$i]['sourceType']??'')!=='news')continue;
  $host=strtolower((string)parse_url((string)($items[$i]['url']??''),PHP_URL_HOST));
  if(!isAllAboutHost($host))continue;
  if(!preg_match('/sanrio|hello kitty|kuromi|my melody|cinnamoroll|pompompurin|pochacco|サンリオ|ハローキティ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ/iu',(string)($items[$i]['title']??'')))continue;
  $checked++;$products=getAllAboutAmazonProducts((string)$items[$i]['url']);
  if($products){$items[$i]['amazonProducts']=$products;$items[$i]['hasAmazonProductLinks']=true;}
 }
}
function amazonAsinFromProductUrl(string $url):string{
 $u=parse_url($url);$host=strtolower((string)($u['host']??''));$path=(string)($u['path']??'');
 if(!in_array($host,['amazon.co.jp','www.amazon.co.jp','m.amazon.co.jp'],true))return '';
 if(preg_match('~/(?:dp|gp/product|gp/aw/d|exec/obidos/ASIN)/([A-Z0-9]{10})(?:[/?]|$)~i',$path,$m))return strtoupper($m[1]);
 return '';
}
function resolveAmznShortAsin(string $url):string{
 $host=strtolower((string)parse_url($url,PHP_URL_HOST));if(!in_array($host,['amzn.to','www.amzn.to'],true))return '';
 $ctx=stream_context_create(['http'=>['method'=>'GET','timeout'=>4,'follow_location'=>0,'ignore_errors'=>true,'user_agent'=>'Mozilla/5.0 SanrioPostHelper/2805','header'=>"Accept: text/html\\r\\n"]]);
 @file_get_contents($url,false,$ctx);$headers=$http_response_header??[];
 foreach($headers as $h){if(preg_match('/^Location:\\s*(https?:\\/\\/\\S+)/i',$h,$m)){$asin=amazonAsinFromProductUrl($m[1]);if($asin!=='')return $asin;}}
 return '';
}
function usefulProductLabel(string $value):string{
 $value=cleanText($value);
 if(mb_strlen($value)<5||preg_match('/amazon|楽天|https?:|在庫を確認|商品を探す|こちら/iu',$value))return '';
 return mb_substr($value,0,180);
}
function productLabelFromAffiliateLink(DOMElement $a,DOMXPath $xp):string{
 $label=usefulProductLabel((string)$a->textContent);if($label!=='')return $label;
 $p=$a->parentNode;
 for($depth=0;$p&&$depth<3;$depth++,$p=$p->parentNode){
  $steps=0;
  for($s=$p->previousSibling;$s&&$steps<10;$s=$s->previousSibling,$steps++){
   if(!($s instanceof DOMElement))continue;$candidate=usefulProductLabel((string)$s->textContent);if($candidate!=='')return $candidate;
   if(in_array(strtolower($s->tagName),['h2','h3','h4'],true))break;
  }
 }
 $headings=$xp->query('preceding::*[self::h3 or self::h4][1]',$a);
 if($headings&&$headings->length)return usefulProductLabel((string)$headings->item(0)->textContent);
 return '';
}
function productFeatureBeforeLink(DOMElement $a):string{
 $p=$a->parentNode;if(!($p instanceof DOMElement))return '';
 for($parent=$p->parentNode,$depth=0;$parent&&$depth<2;$parent=$parent->parentNode,$depth++){
  $steps=0;
  for($s=($depth===0?$p:$parent)->previousSibling;$s&&$steps<10;$s=$s->previousSibling,$steps++){
   if(!($s instanceof DOMElement))continue;$tag=strtolower($s->tagName);$t=cleanText((string)$s->textContent);
   if(in_array($tag,['h2','h3'],true))break;
   if($tag!=='p'||mb_strlen($t)<35||preg_match('/amazon|楽天|予約|品切|発売(?:日|予定)|在庫|価格|販売|受付|クーポン|リンク/iu',$t))continue;
   return mb_substr($t,0,360);
  }
 }
 return '';
}
function affiliateBlogProductCards(string $content,int &$resolvedLinks):array{
 if($content==='')return [];
 libxml_use_internal_errors(true);$dom=new DOMDocument();if(!@$dom->loadHTML('<?xml encoding="utf-8" ?>'.$content,LIBXML_NOWARNING|LIBXML_NOERROR))return [];
 $xp=new DOMXPath($dom);$out=[];$seen=[];
 foreach($xp->query('//a[@href]') as $a){
  $href=trim($a->getAttribute('href'));$host=strtolower((string)parse_url($href,PHP_URL_HOST));$asin='';
  if(in_array($host,['amazon.co.jp','www.amazon.co.jp','m.amazon.co.jp'],true))$asin=amazonAsinFromProductUrl($href);
  elseif(in_array($host,['amzn.to','www.amzn.to'],true)&&$resolvedLinks<24){$resolvedLinks++;$asin=resolveAmznShortAsin($href);}
  if($asin===''||isset($seen[$asin]))continue;
  $title=productLabelFromAffiliateLink($a,$xp);if($title==='')continue;
  $seen[$asin]=true;$out[]=['title'=>$title,'asin'=>$asin,'url'=>'https://www.amazon.co.jp/dp/'.$asin,'source'=>'記事内のAmazon商品リンク','feature'=>productFeatureBeforeLink($a)];
  if(count($out)>=6)break;
 }
 return $out;
}
function appendAffiliateBlogArticles(array &$items,array &$seen,array &$health):void{
 $after=date('c',time()-90*86400);
 $url='https://asitaaozora.net/wp-json/wp/v2/posts?search='.rawurlencode('サンリオ').'&after='.rawurlencode($after).'&per_page=100&_fields=date_gmt,link,title,content,excerpt';
 $json=fetchUrl($url,12);$posts=json_decode($json,true);$health[]=['label'=>'あしたはあおぞら（90日）','ok'=>is_array($posts)];
 if(!is_array($posts))return;
 $resolved=0;$checked=0;
 foreach($posts as $post){
  if(!is_array($post))continue;
  $title=cleanText((string)($post['title']['rendered']??''));$link=trim((string)($post['link']??''));$published=isoDate((string)($post['date_gmt']??$post['date']??''));
  if($title===''||$link===''||ageH($published)>2160)continue;
  if(!preg_match('/sanrio|hello kitty|kuromi|my melody|cinnamoroll|pompompurin|pochacco|サンリオ|ハローキティ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ|こぎみゅん|ウサハナ|タキシードサム|ハンギョドン|ペックル/iu',$title))continue;
  if($checked>=18)break;$checked++;
  $content=(string)($post['content']['rendered']??'');$products=affiliateBlogProductCards($content,$resolved);
  if(!$products)continue;
  $excerpt=cleanText((string)($post['excerpt']['rendered']??''));
  addUnique($items,['id'=>iid('あしたはあおぞら',$link,$title),'source'=>'あしたはあおぞら','publisher'=>'あしたはあおぞら','sourceType'=>'news','region'=>'JP','title'=>$title,'summary'=>$excerpt,'url'=>$link,'publishedAt'=>$published,'votes'=>0,'comments'=>0,'amazonProducts'=>$products,'hasAmazonProductLinks'=>true],$seen);
 }
}
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
if(!$force&&$cached&&(time()-strtotime((string)$cached['updated_at']))<1200){$p=json_decode((string)$cached['payload'],true);if(is_array($p)&&($p['apiVersion']??'')==='2805'){$p['ok']=true;$p['cached']=true;respond($p);}}

$items=[];$seen=[];$health=[];
$b=fetchUrl('https://corporate.sanrio.co.jp/news/2026.html');$health[]=['label'=>'Sanrio JP','ok'=>$b!==''];if($b!=='')parseOfficial($b,'https://corporate.sanrio.co.jp','Sanrio Japan','JP',$items,$seen);
$b=fetchUrl('https://www.sanrio.com/pages/press-releases');$health[]=['label'=>'Sanrio US','ok'=>$b!==''];if($b!=='')parseOfficial($b,'https://www.sanrio.com','Sanrio US','US',$items,$seen);

$qs=[
 ['Google JP','サンリオ OR ハローキティ OR クロミ OR マイメロ OR シナモロール','ja','JP','JP:ja','Google News JP','JP'],
 ['Google US','Sanrio OR "Hello Kitty" OR Kuromi OR "My Melody" OR Cinnamoroll','en-US','US','US:en','Google News US','US'],
 ['Google KR','산리오 OR 헬로키티 OR 쿠로미 OR 마이멜로디 OR 시나모롤','ko','KR','KR:ko','Google News KR','KR']
];
$aa=fetchUrl('https://news.allabout.co.jp/rss/all_latest/',10);$health[]=['label'=>'All About NEWS RSS','ok'=>$aa!==''];if($aa!=='')parseRss($aa,'All About ニュース','JP',$items,$seen);
foreach($qs as [$label,$q,$hl,$gl,$ceid,$source,$region]){$url='https://news.google.com/rss/search?q='.rawurlencode($q).'&hl='.$hl.'&gl='.$gl.'&ceid='.rawurlencode($ceid);$b=fetchUrl($url);$health[]=['label'=>$label,'ok'=>$b!==''];if($b!=='')parseRss($b,$source,$region,$items,$seen);}
appendAffiliateBlogArticles($items,$seen,$health);
$b=fetchUrl('https://www.reddit.com/r/sanrio/hot.json?limit=25&raw_json=1');$health[]=['label'=>'Reddit','ok'=>$b!==''];if($b!=='')parseReddit($b,'sanrio',$items,$seen);

$items=array_values(array_filter($items,function($x){$a=ageH($x['publishedAt']??null);if(($x['sourceType']??'')==='reddit'){return $a<=72&&((int)($x['votes']??0)+(int)($x['comments']??0)*3)>=12;}if(($x['publisher']??'')==='あしたはあおぞら')return $a<=2160;if(!empty($x['publishedAt']))return $a<=720;return ($x['sourceType']??'')==='official';}));
prioritizeLinkedArticleProducts($items);
$groups=groupTopics($items);$out=[];$seenQ=$pdo->prepare('SELECT first_seen_at FROM sanrio_trend_seen WHERE topic_key=?');$seenUp=$pdo->prepare('INSERT INTO sanrio_trend_seen(topic_key,first_seen_at,last_seen_at) VALUES(?,NOW(),NOW()) ON DUPLICATE KEY UPDATE last_seen_at=NOW()');$stateQ=$pdo->prepare('SELECT state FROM sanrio_trend_state WHERE topic_key=?');
foreach($groups as $g){$rep=$g['representative'];$key=substr(hash('sha256',implode('|',words((string)$rep['title']))),0,40);$seenQ->execute([$key]);$r=$seenQ->fetch();$first=$r?(string)$r['first_seen_at']:date('Y-m-d H:i:s');$seenUp->execute([$key]);$stateQ->execute([$key]);$sr=$stateQ->fetch();
 $regions=array_map(fn($x)=>(string)($x['region']??''),$g['items']);$rep['topicKey']=$key;$rep['firstSeenAt']=date(DATE_ATOM,strtotime($first));$rep['isNew']=(time()-strtotime($first))<86400;$rep['relatedCount']=count($g['items']);$rep['relatedSources']=array_values(array_unique(array_map(fn($x)=>(string)($x['source']??''),$g['items'])));$rep['relatedItems']=array_map(fn($x)=>['source'=>$x['source']??'','url'=>$x['url']??'','region'=>$x['region']??''],array_slice($g['items'],0,8));$rep['jpCount']=count(array_filter($regions,fn($r)=>$r==='JP'));$rep['foreignCount']=count(array_filter($regions,fn($r)=>$r!==''&&$r!=='JP'));$rep['userState']=$sr?(string)$sr['state']:'';$out[]=$rep;}
usort($out,function($a,$b){$score=function($x){$age=ageH($x['publishedAt']??$x['firstSeenAt']??null);$fresh=max(0,72-min($age,144)*.75);$ahead=((int)($x['jpCount']??0)===0&&(int)($x['foreignCount']??0)>=2)?18:0;return priority($x)+$fresh+$ahead+min(20,max(0,((int)($x['relatedCount']??1)-1)*6));};return $score($b)<=>$score($a);});
$payload=['ok'=>true,'apiVersion'=>'2805','cached'=>false,'fetchedAt'=>date(DATE_ATOM),'items'=>array_slice($out,0,30),'count'=>count($out),'groupedCount'=>count($groups),'rawCount'=>count($items),'sourceHealth'=>$health];
$save=$pdo->prepare('INSERT INTO sanrio_trend_cache(cache_key,payload) VALUES(?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload),updated_at=CURRENT_TIMESTAMP');$save->execute(['trend',json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);respond($payload);
