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
        'user_agent'=>'SanrioPostHelper/2700 (+personal trend reader)',
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
    $seen[$key]=true;
    $items[]=$item;
}
function parseRss(string $xml,string $source,string $region,array &$items,array &$seen): void {
    if($xml==='')return;
    libxml_use_internal_errors(true);
    $rss=simplexml_load_string($xml,'SimpleXMLElement',LIBXML_NOCDATA);
    if(!$rss)return;
    $nodes=$rss->channel->item ?? [];
    foreach($nodes as $node){
        $title=cleanText((string)$node->title);
        $url=trim((string)$node->link);
        if($title===''||$url==='')continue;
        $desc=cleanText((string)$node->description);
        addUnique($items,[
            'id'=>itemId($source,$url,$title),
            'source'=>$source,
            'sourceType'=>'news',
            'region'=>$region,
            'title'=>$title,
            'summary'=>$desc,
            'url'=>$url,
            'publishedAt'=>isoDate((string)$node->pubDate),
            'votes'=>0,
            'comments'=>0
        ],$seen);
        if(count($items)>=120)return;
    }
}
function parseReddit(string $json,string $subreddit,array &$items,array &$seen): void {
    if($json==='')return;
    $data=json_decode($json,true);
    $children=$data['data']['children'] ?? [];
    foreach($children as $row){
        $d=$row['data'] ?? [];
        $title=cleanText((string)($d['title']??''));
        if($title==='')continue;
        $permalink=(string)($d['permalink']??'');
        $url=$permalink?('https://www.reddit.com'.$permalink):(string)($d['url']??'');
        $published=!empty($d['created_utc'])?date(DATE_ATOM,(int)$d['created_utc']):null;
        addUnique($items,[
            'id'=>itemId('Reddit r/'.$subreddit,$url,$title),
            'source'=>'Reddit r/'.$subreddit,
            'sourceType'=>'reddit',
            'region'=>'GLOBAL',
            'title'=>$title,
            'summary'=>cleanText((string)($d['selftext']??'')),
            'url'=>$url,
            'publishedAt'=>$published,
            'votes'=>(int)($d['score']??0),
            'comments'=>(int)($d['num_comments']??0)
        ],$seen);
    }
}
function parseOfficialLinks(string $html,string $base,string $source,string $region,array &$items,array &$seen): void {
    if($html==='')return;
    libxml_use_internal_errors(true);
    $dom=new DOMDocument();
    if(!@$dom->loadHTML($html,LIBXML_NOWARNING|LIBXML_NOERROR))return;
    $xp=new DOMXPath($dom);
    foreach($xp->query('//a[@href]') as $a){
        $title=cleanText($a->textContent ?? '');
        $href=trim($a->getAttribute('href'));
        if(mb_strlen($title)<12)continue;
        if(!preg_match('/sanrio|hello kitty|kuromi|my melody|cinnamoroll|pompompurin|pochacco|サンリオ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ/iu',$title))continue;
        if(str_starts_with($href,'/'))$href=rtrim($base,'/').$href;
        elseif(!preg_match('~^https?://~i',$href))continue;
        addUnique($items,[
            'id'=>itemId($source,$href,$title),
            'source'=>$source,
            'sourceType'=>'official',
            'region'=>$region,
            'title'=>$title,
            'summary'=>'',
            'url'=>$href,
            'publishedAt'=>null,
            'votes'=>0,
            'comments'=>0
        ],$seen);
    }
}
function freshSort(array $a,array $b): int {
    $ta=strtotime((string)($a['publishedAt']??'')) ?: 0;
    $tb=strtotime((string)($b['publishedAt']??'')) ?: 0;
    if(($a['sourceType']??'')==='reddit' || ($b['sourceType']??'')==='reddit'){
        $sa=(int)($a['votes']??0)+(int)($a['comments']??0)*3;
        $sb=(int)($b['votes']??0)+(int)($b['comments']??0)*3;
        if($sa!==$sb)return $sb<=>$sa;
    }
    return $tb<=>$ta;
}

$expected=(string)($config['sync_key']??'');
$token=bearerToken();
if($expected===''||$token===''||!hash_equals($expected,$token))respond(['ok'=>false,'error'=>'Unauthorized'],401);

try{
    $pdo=new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES=>false
    ]);
}catch(Throwable $e){respond(['ok'=>false,'error'=>'Database connection failed'],500);}

$pdo->exec("CREATE TABLE IF NOT EXISTS sanrio_trend_cache (
    cache_key VARCHAR(64) NOT NULL PRIMARY KEY,
    payload LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$force=isset($_GET['refresh'])&&$_GET['refresh']==='1';
$stmt=$pdo->prepare('SELECT payload, updated_at FROM sanrio_trend_cache WHERE cache_key = ? LIMIT 1');
$stmt->execute(['trend2700']);
$cached=$stmt->fetch();
if(!$force && $cached){
    $age=time()-strtotime((string)$cached['updated_at']);
    if($age<1800){
        $payload=json_decode((string)$cached['payload'],true);
        if(is_array($payload)){
            $payload['ok']=true;
            $payload['cached']=true;
            respond($payload);
        }
    }
}

$items=[];$seen=[];

// Official Sanrio pages.
parseOfficialLinks(fetchUrl('https://corporate.sanrio.co.jp/news/2026.html'),'https://corporate.sanrio.co.jp','Sanrio Japan','JP',$items,$seen);
parseOfficialLinks(fetchUrl('https://corporate.sanrio.co.jp/en/news/2026.html'),'https://corporate.sanrio.co.jp','Sanrio Global','GLOBAL',$items,$seen);
parseOfficialLinks(fetchUrl('https://www.sanrio.com/pages/press-releases'),'https://www.sanrio.com','Sanrio US','US',$items,$seen);

// Google News public RSS: Japan / US / Korea.
$queries=[
    ['Sanrio OR "Hello Kitty" OR Kuromi OR "My Melody" OR Cinnamoroll','en-US','US','US:en','Google News US','US'],
    ['サンリオ OR ハローキティ OR クロミ OR マイメロ OR シナモロール','ja','JP','JP:ja','Google News JP','JP'],
    ['산리오 OR 헬로키티 OR 쿠로미 OR 마이멜로디 OR 시나모롤','ko','KR','KR:ko','Google News KR','KR']
];
foreach($queries as [$q,$hl,$gl,$ceid,$source,$region]){
    $url='https://news.google.com/rss/search?q='.rawurlencode($q).'&hl='.$hl.'&gl='.$gl.'&ceid='.rawurlencode($ceid);
    parseRss(fetchUrl($url),$source,$region,$items,$seen);
}

// Reddit public JSON.
parseReddit(fetchUrl('https://www.reddit.com/r/sanrio/hot.json?limit=25&raw_json=1'),'sanrio',$items,$seen);
parseReddit(fetchUrl('https://www.reddit.com/r/HelloKitty/hot.json?limit=20&raw_json=1'),'HelloKitty',$items,$seen);

usort($items,'freshSort');
$items=array_slice($items,0,80);

$payload=[
    'ok'=>true,
    'apiVersion'=>'2700',
    'cached'=>false,
    'fetchedAt'=>date(DATE_ATOM),
    'items'=>$items,
    'count'=>count($items)
];

$save=$pdo->prepare('INSERT INTO sanrio_trend_cache (cache_key,payload) VALUES (?,?)
    ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=CURRENT_TIMESTAMP');
$save->execute(['trend2700',json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);

respond($payload);
