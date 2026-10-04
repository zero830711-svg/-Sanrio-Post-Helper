<?php
declare(strict_types=1);

$config=require __DIR__.'/config.php';
$origin=$_SERVER['HTTP_ORIGIN']??'';
if($origin&&in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if(($_SERVER['REQUEST_METHOD']??'')==='OPTIONS'){http_response_code(204);exit;}

function ov_out(array $data,int $status=200): never {
    http_response_code($status);
    echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    exit;
}
function ov_token(): string {
    $h=$_SERVER['HTTP_AUTHORIZATION']??'';
    return preg_match('/^Bearer\s+(.+)$/i',$h,$m)?trim($m[1]):'';
}
function ov_clean(string $s,int $max=1200): string {
    $s=html_entity_decode($s,ENT_QUOTES|ENT_HTML5,'UTF-8');
    $s=str_replace(['\\n','\\r','\\t'],["\n","\r","\t"],$s);
    $s=preg_replace('/\\u([0-9a-fA-F]{4})/', '&#x$1;', $s)??$s;
    $s=html_entity_decode($s,ENT_QUOTES|ENT_HTML5,'UTF-8');
    $s=preg_replace('/\s+/u',' ',trim($s))??trim($s);
    return mb_substr($s,0,$max);
}
function ov_fetch(string $url,array $headers=[],?array &$meta=null): string {
    $body='';
    $ch=curl_init($url);
    curl_setopt_array($ch,[
        CURLOPT_FOLLOWLOCATION=>true,
        CURLOPT_MAXREDIRS=>3,
        CURLOPT_CONNECTTIMEOUT=>8,
        CURLOPT_TIMEOUT=>20,
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_ENCODING=>'',
        CURLOPT_USERAGENT=>'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER=>array_merge([
            'Accept: */*',
            'Accept-Language: en-US,en;q=0.9,ja;q=0.8,ko;q=0.7',
            'Cache-Control: no-cache',
            'Pragma: no-cache',
            'Referer: https://www.instagram.com/sanrio.hk/'
        ],$headers),
        CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$body){
            if(strlen($body)+strlen($chunk)>5000000)return 0;
            $body.=$chunk;return strlen($chunk);
        }
    ]);
    $ok=curl_exec($ch);
    $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);
    $type=(string)curl_getinfo($ch,CURLINFO_CONTENT_TYPE);
    $error=curl_error($ch);
    curl_close($ch);
    $meta=['status'=>$status,'bytes'=>strlen($body),'type'=>$type,'error'=>$error];
    return $ok!==false&&$status>=200&&$status<400?$body:'';
}
function ov_json_unescape(string $s): string {
    $decoded=json_decode('"'.str_replace(['"','\\"'],['\\"','"'],$s).'"',true);
    return is_string($decoded)?$decoded:stripcslashes($s);
}
function ov_make_item(string $code,string $caption='',string $image='',?int $timestamp=null,string $typename=''): array {
    $caption=ov_clean($caption);
    $path=str_contains(strtolower($typename),'reel')?'reel':'p';
    return [
        'id'=>'instagram-sanrio-hk-'.$code,
        'source'=>'Sanrio Hong Kong Instagram',
        'sourceId'=>'sanrio.hk',
        'sourceType'=>'instagram',
        'region'=>'HK',
        'overseas'=>true,
        'title'=>$caption!==''?mb_substr($caption,0,90):'Sanrio Hong Kong Instagram 投稿',
        'summary'=>$caption,
        'url'=>'https://www.instagram.com/'.$path.'/'.$code.'/',
        'thumbnail'=>preg_match('~^https://~i',$image)?$image:'',
        'publishedAt'=>$timestamp?date(DATE_ATOM,$timestamp):null,
        'needsReview'=>true
    ];
}
function ov_items_from_api(string $json): array {
    $data=json_decode($json,true);
    if(!is_array($data))return [];
    $user=$data['data']['user']??null;
    if(!is_array($user))return [];
    $edges=$user['edge_owner_to_timeline_media']['edges']??[];
    if(!is_array($edges))return [];
    $items=[];
    foreach($edges as $edge){
        $node=$edge['node']??null;
        if(!is_array($node))continue;
        $code=(string)($node['shortcode']??'');
        if($code==='')continue;
        $caption='';
        $captionEdges=$node['edge_media_to_caption']['edges']??[];
        if(is_array($captionEdges)&&isset($captionEdges[0]['node']['text']))$caption=(string)$captionEdges[0]['node']['text'];
        $image=(string)($node['display_url']??($node['thumbnail_src']??''));
        $timestamp=isset($node['taken_at_timestamp'])?(int)$node['taken_at_timestamp']:null;
        $items[$code]=ov_make_item($code,$caption,$image,$timestamp,(string)($node['__typename']??''));
    }
    return array_values($items);
}
function ov_items_from_html(string $html): array {
    if($html==='')return [];
    $items=[];
    if(preg_match_all('/"shortcode"\s*:\s*"([A-Za-z0-9_-]{5,40})"/',$html,$matches,PREG_OFFSET_CAPTURE)){
        foreach($matches[1] as $match){
            [$code,$pos]=$match;
            if(isset($items[$code]))continue;
            $start=max(0,$pos-7000);$chunk=substr($html,$start,16000);
            $caption='';$image='';$timestamp=null;$typename='';
            if(preg_match('/"edge_media_to_caption"\s*:\s*\{.*?"text"\s*:\s*"((?:\\.|[^"\\])*)"/s',$chunk,$m))$caption=ov_json_unescape($m[1]);
            elseif(preg_match('/"caption"\s*:\s*\{.*?"text"\s*:\s*"((?:\\.|[^"\\])*)"/s',$chunk,$m))$caption=ov_json_unescape($m[1]);
            if(preg_match('/"display_url"\s*:\s*"((?:\\.|[^"\\])*)"/s',$chunk,$m))$image=ov_json_unescape($m[1]);
            if(preg_match('/"taken_at_timestamp"\s*:\s*(\d{9,12})/',$chunk,$m))$timestamp=(int)$m[1];
            elseif(preg_match('/"taken_at"\s*:\s*(\d{9,12})/',$chunk,$m))$timestamp=(int)$m[1];
            if(preg_match('/"__typename"\s*:\s*"([^"]+)"/',$chunk,$m))$typename=$m[1];
            $items[$code]=ov_make_item($code,$caption,$image,$timestamp,$typename);
        }
    }
    return array_values($items);
}
function ov_sort_items(array $items): array {
    usort($items,static fn($a,$b)=>strcmp((string)($b['publishedAt']??''),(string)($a['publishedAt']??'')));
    return array_slice($items,0,12);
}

if(empty($config['sync_key'])||!ov_token()||!hash_equals((string)$config['sync_key'],ov_token()))ov_out(['ok'=>false,'error'=>'Unauthorized'],401);
if(($_SERVER['REQUEST_METHOD']??'')!=='GET')ov_out(['ok'=>false,'error'=>'Method not allowed'],405);
$action=$_GET['action']??'list';if(!in_array($action,['list','refresh'],true))ov_out(['ok'=>false,'error'=>'Unknown action'],400);

$profile='https://www.instagram.com/sanrio.hk/';
$attempts=[];$items=[];

// 1) Instagram's public web profile JSON endpoint. This usually contains the latest timeline media.
$apiMeta=[];
$apiUrl='https://www.instagram.com/api/v1/users/web_profile_info/?username='.rawurlencode('sanrio.hk');
$apiBody=ov_fetch($apiUrl,[
    'X-IG-App-ID: 936619743392459',
    'X-ASBD-ID: 129477',
    'X-Requested-With: XMLHttpRequest',
    'Sec-Fetch-Dest: empty',
    'Sec-Fetch-Mode: cors',
    'Sec-Fetch-Site: same-origin'
],$apiMeta);
$attempts[]=['method'=>'web_profile_info','status'=>$apiMeta['status']??0,'bytes'=>$apiMeta['bytes']??0];
if($apiBody!=='')$items=ov_items_from_api($apiBody);

// 2) Fallback to public profile HTML because Instagram occasionally changes the JSON endpoint behavior.
if(!$items){
    $htmlMeta=[];
    $html=ov_fetch($profile,['Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],$htmlMeta);
    $attempts[]=['method'=>'profile_html','status'=>$htmlMeta['status']??0,'bytes'=>$htmlMeta['bytes']??0];
    if($html!=='')$items=ov_items_from_html($html);
}

$items=ov_sort_items($items);
$error='';
if(!$items)$error='Instagram側の取得制限で投稿一覧を読み取れませんでした。更新しても同じ場合は公式プロフィールから確認してください。';
ov_out([
    'ok'=>true,
    'apiVersion'=>'3437',
    'items'=>$items,
    'fetchedAt'=>date(DATE_ATOM),
    'profile'=>['label'=>'Sanrio Hong Kong','handle'=>'@sanrio.hk','region'=>'香港','url'=>$profile],
    'sourceHealth'=>[['label'=>'Sanrio Hong Kong Instagram','ok'=>count($items)>0,'count'=>count($items),'error'=>$error,'attempts'=>$attempts]],
    'warning'=>$error
]);
