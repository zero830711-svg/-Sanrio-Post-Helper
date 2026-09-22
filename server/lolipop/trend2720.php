<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = $config['allowed_origins'] ?? [];
if ($origin && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond(array $data, int $status=200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}
function bearerToken(): string {
    $header=$_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if(preg_match('/^Bearer\\s+(.+)$/i',$header,$m)) return trim($m[1]);
    return '';
}
function fetchUrl(string $url, int $timeout=10): string {
    $ctx=stream_context_create(['http'=>[
        'timeout'=>$timeout,
        'user_agent'=>'SanrioPostHelper/2720 (+personal trend reader)',
        'header'=>"Accept: application/json, application/rss+xml, application/xml, text/xml, text/html\r\n"
    ]]);
    $body=@file_get_contents($url,false,$ctx);
    return $body===false?'':$body;
}
function cleanText(string $s): string {
    $s=html_entity_decode(strip_tags($s),ENT_QUOTES|ENT_HTML5,'UTF-8');
    $s=preg_replace('/\\s+/u',' ',trim($s));
    return mb_substr($s,0,500);
}
function isoDate(?string $s): ?string {
    if(!$s)return null;
    $t=strtotime($s);
    return $t===false?null:date(DATE_ATOM,$t);
}
function itemId(string $source,string $url,string $title): string {
    return substr(hash('sha256',$source.'|'.$url.'|'.$title),0,24);
}
function addUnique(array &$items,array $item,array &$seen): void {
    $key=strtolower(trim(($item['url']??'').'|'.($item['title']??'')));
    if($key==='|'||isset($seen[$key]))return;
    $seen[$key]=true;$items[]=$item;
}
function parseRss(string $xml,string $source,string $region,array &$items,array &$seen): void {
    if($xml==='')return;
    libxml_use_internal_errors(true);
    $rss=simplexml_load_string($xml,'SimpleXMLElement',LIBXML_NOCDATA);
    if(!$rss)return;
    foreach(($rss->channel->item??[]) as $node){
        $title=cleanText((string)$node->title);$url=trim((string)$node->link);
        if($title===''||$url==='')continue;
        addUnique($items,[
            'id'=>itemId($source,$url,$title),'source'=>$source,'sourceType'=>'news','region'=>$region,
            'title'=>$title,'summary'=>cleanText((string)$node->description),'url'=>$url,
            'publishedAt'=>isoDate((string)$node->pubDate),'votes'=>0,'comments'=>0
        ],$seen);
    }
}
function parseReddit(string $json,string $subreddit,array &$items,array &$seen): void {
    if($json==='')return;
    $data=json_decode($json,true);
    foreach(($data['data']['children']??[]) as $row){
        $d=$row['data']??[];$title=cleanText((string)($d['title']??''));
        if($title==='')continue;
        $permalink=(string)($d['permalink']??'');
        $url=$permalink?('https://www.reddit.com'.$permalink):(string)($d['url']??'');
        addUnique($items,[
            'id'=>itemId('Reddit r/'.$subreddit,$url,$title),'source'=>'Reddit r/'.$subreddit,
            'sourceType'=>'reddit','region'=>'GLOBAL','title'=>$title,
            'summary'=>cleanText((string)($d['selftext']??'')),'url'=>$url,
            'publishedAt'=>!empty($d['created_utc'])?date(DATE_ATOM,(int)$d['created_utc']):null,
            'votes'=>(int)($d['score']??0),'comments'=>(int)($d['num_comments']??0)
        ],$seen);
    }
}
function parseOfficialLinks(string $html,string $base,string $source,string $region,array &$items,array &$seen): void {
    if($html==='')return;
    libxml_use_internal_errors(true);$dom=new DOMDocument();
    if(!@$dom->loadHTML($html,LIBXML_NOWARNING|LIBXML_NOERROR))return;
    $xp=new DOMXPath($dom);
    foreach($xp->query('//a[@href]') as $a){
        $title=cleanText($a->textContent??'');$href=trim($a->getAttribute('href'));
        if(mb_strlen($title)<12)continue;
        if(!preg_match('/sanrio|hello kitty|kuromi|my melody|cinnamoroll|pompompurin|pochacco|サンリオ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ/iu',$title))continue;
        if(str_starts_with($href,'/'))$href=rtrim($base,'/').$href;
        elseif(!preg_match('~^https?://~i',$href))continue;
        addUnique($items,[
            'id'=>itemId($source,$href,$title),'source'=>$source,'sourceType'=>'official','region'=>$region,
            'title'=>$title,'summary'=>'','url'=>$href,'publishedAt'=>null,'votes'=>0,'comments'=>0
        ],$seen);
    }
}
function titleWords(string $title): array {
    $s=mb_strtolower($title,'UTF-8');
    $s=preg_replace('/\\s+-\\s+[^-]{2,40}$/u',' ',$s);
    $s=preg_replace('/[^\\p{L}\\p{N}]+/u',' ',$s);
    $stop=['sanrio','characters','character','news','global','launches','launch','release','released','debut','new','the','and','with','for','in','on','to','of','a','an'];
    $parts=preg_split('/\\s+/u',trim($s))?:[];
    return array_values(array_unique(array_filter($parts,function($w)use($stop){
        return mb_strlen($w,'UTF-8')>=3&&!in_array($w,$stop,true);
    })));
}
function titleSimilarity(string $a,string $b): float {
    $wa=titleWords($a);$wb=titleWords($b);if(!$wa||!$wb)return 0.0;
    $inter=count(array_intersect($wa,$wb));$union=count(array_unique(array_merge($wa,$wb)));
    return $union?($inter/$union):0.0;
}
function topicPriority(array $item): int {
    $t=mb_strtolower(($item['title']??'').' '.($item['summary']??''),'UTF-8');$score=0;
    if(preg_match('/collab|collaboration|コラボ|新作|new collection|plush|ぬい|goods|グッズ|限定|limited|pop.?up|ポップアップ|発売|release|再販|restock|キャンペーン|campaign/u',$t))$score+=30;
    if(($item['sourceType']??'')==='official')$score+=20;
    if(($item['region']??'')==='JP')$score+=12;
    if(preg_match('/game|rhythm|mobile game|ゲーム|決算|earnings|financial|corporate|株主/u',$t))$score-=18;
    return $score;
}
function groupTopics(array $items): array {
    usort($items,function($a,$b){return topicPriority($b)<=>topicPriority($a);});
    $groups=[];
    foreach($items as $item){
        $placed=false;
        foreach($groups as &$g){
            if(titleSimilarity((string)$item['title'],(string)$g['representative']['title'])>=0.42){
                $g['items'][]=$item;
                if(topicPriority($item)>topicPriority($g['representative']))$g['representative']=$item;
                $placed=true;break;
            }
        }
        unset($g);
        if(!$placed)$groups[]=['representative'=>$item,'items'=>[$item]];
    }
    return $groups;
}
function ageHours(?string $date): float {
    if(!$date)return 9999;$t=strtotime($date);
    return $t===false?9999:max(0,(time()-$t)/3600);
}

$expected=(string)($config['sync_key']??'');$token=bearerToken();
if($expected===''||$token===''||!hash_equals($expected,$token))respond(['ok'=>false,'error'=>'Unauthorized'],401);
try{
    $pdo=new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false
    ]);
}catch(Throwable $e){respond(['ok'=>false,'error'=>'Database connection failed'],500);}

$pdo->exec("CREATE TABLE IF NOT EXISTS sanrio_trend_cache (
 cache_key VARCHAR(64) NOT NULL PRIMARY KEY,payload LONGTEXT NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("CREATE TABLE IF NOT EXISTS sanrio_trend_seen (
 topic_key VARCHAR(64) NOT NULL PRIMARY KEY,first_seen_at DATETIME NOT NULL,last_seen_at DATETIME NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$force=isset($_GET['refresh'])&&$_GET['refresh']==='1';
$stmt=$pdo->prepare('SELECT payload,updated_at FROM sanrio_trend_cache WHERE cache_key=? LIMIT 1');
$stmt->execute(['trend2720']);$cached=$stmt->fetch();
if(!$force&&$cached&&(time()-strtotime((string)$cached['updated_at']))<1800){
    $payload=json_decode((string)$cached['payload'],true);
    if(is_array($payload)){$payload['ok']=true;$payload['cached']=true;respond($payload);}
}

$items=[];$seen=[];
parseOfficialLinks(fetchUrl('https://corporate.sanrio.co.jp/news/2026.html'),'https://corporate.sanrio.co.jp','Sanrio Japan','JP',$items,$seen);
parseOfficialLinks(fetchUrl('https://corporate.sanrio.co.jp/en/news/2026.html'),'https://corporate.sanrio.co.jp','Sanrio Global','GLOBAL',$items,$seen);
parseOfficialLinks(fetchUrl('https://www.sanrio.com/pages/press-releases'),'https://www.sanrio.com','Sanrio US','US',$items,$seen);
$queries=[
 ['Sanrio OR "Hello Kitty" OR Kuromi OR "My Melody" OR Cinnamoroll','en-US','US','US:en','Google News US','US'],
 ['サンリオ OR ハローキティ OR クロミ OR マイメロ OR シナモロール','ja','JP','JP:ja','Google News JP','JP'],
 ['산리오 OR 헬로키티 OR 쿠로미 OR 마이멜로디 OR 시나모롤','ko','KR','KR:ko','Google News KR','KR']
];
foreach($queries as [$q,$hl,$gl,$ceid,$source,$region]){
    $url='https://news.google.com/rss/search?q='.rawurlencode($q).'&hl='.$hl.'&gl='.$gl.'&ceid='.rawurlencode($ceid);
    parseRss(fetchUrl($url),$source,$region,$items,$seen);
}
parseReddit(fetchUrl('https://www.reddit.com/r/sanrio/hot.json?limit=25&raw_json=1'),'sanrio',$items,$seen);
parseReddit(fetchUrl('https://www.reddit.com/r/HelloKitty/hot.json?limit=20&raw_json=1'),'HelloKitty',$items,$seen);

$items=array_values(array_filter($items,function($x){
    $age=ageHours($x['publishedAt']??null);
    if(($x['sourceType']??'')==='reddit'){
        $eng=(int)($x['votes']??0)+(int)($x['comments']??0)*3;
        return $age<=48&&$eng>=12;
    }
    if(!empty($x['publishedAt']))return $age<=168;
    return ($x['sourceType']??'')==='official';
}));

$groups=groupTopics($items);$out=[];$sourceCounts=[];
$seenStmt=$pdo->prepare('SELECT first_seen_at FROM sanrio_trend_seen WHERE topic_key=?');
$upsertSeen=$pdo->prepare('INSERT INTO sanrio_trend_seen(topic_key,first_seen_at,last_seen_at) VALUES(?,NOW(),NOW())
 ON DUPLICATE KEY UPDATE last_seen_at=NOW()');

foreach($groups as $g){
    $rep=$g['representative'];
    $topicWords=titleWords((string)$rep['title']);
    $topicKey=substr(hash('sha256',implode('|',$topicWords)),0,40);
    $seenStmt->execute([$topicKey]);$row=$seenStmt->fetch();
    $firstSeen=$row?(string)$row['first_seen_at']:date('Y-m-d H:i:s');
    $upsertSeen->execute([$topicKey]);

    $regions=array_map(fn($x)=>(string)($x['region']??''),$g['items']);
    $jpCount=count(array_filter($regions,fn($r)=>$r==='JP'));
    $foreignCount=count(array_filter($regions,fn($r)=>$r!==''&&$r!=='JP'));

    $rep['firstSeenAt']=date(DATE_ATOM,strtotime($firstSeen));
    $rep['isNew']=(time()-strtotime($firstSeen))<86400;
    $rep['relatedCount']=count($g['items']);
    $rep['relatedSources']=array_values(array_unique(array_map(fn($x)=>(string)($x['source']??''),$g['items'])));
    $rep['relatedRegions']=array_values(array_unique($regions));
    $rep['jpCount']=$jpCount;
    $rep['foreignCount']=$foreignCount;
    $rep['topicPriority']=topicPriority($rep);
    $out[]=$rep;
}

usort($out,function($a,$b){
    $score=function($x){
        $age=ageHours($x['publishedAt']??$x['firstSeenAt']??null);
        $fresh=max(0,72-min($age,144)*0.75);
        $ahead=((int)($x['jpCount']??0)===0&&(int)($x['foreignCount']??0)>=2)?18:0;
        return topicPriority($x)+$fresh+$ahead+min(20,max(0,((int)($x['relatedCount']??1)-1)*6));
    };
    return $score($b)<=>$score($a);
});

$diverse=[];
foreach($out as $x){
    $src=(string)($x['source']??'other');$count=$sourceCounts[$src]??0;
    if($count>=2)continue;
    $sourceCounts[$src]=$count+1;$diverse[]=$x;
    if(count($diverse)>=20)break;
}

$payload=['ok'=>true,'apiVersion'=>'2720','cached'=>false,'fetchedAt'=>date(DATE_ATOM),
 'items'=>$diverse,'count'=>count($diverse),'groupedCount'=>count($groups),'rawCount'=>count($items)];
$save=$pdo->prepare('INSERT INTO sanrio_trend_cache(cache_key,payload) VALUES(?,?)
 ON DUPLICATE KEY UPDATE payload=VALUES(payload),updated_at=CURRENT_TIMESTAMP');
$save->execute(['trend2720',json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);
respond($payload);
