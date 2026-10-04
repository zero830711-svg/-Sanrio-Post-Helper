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
function ov_fetch(string $url,?array &$meta=null): string {
    $body='';
    $ch=curl_init($url);
    curl_setopt_array($ch,[
        CURLOPT_FOLLOWLOCATION=>true,
        CURLOPT_MAXREDIRS=>3,
        CURLOPT_CONNECTTIMEOUT=>6,
        CURLOPT_TIMEOUT=>15,
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_USERAGENT=>'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        CURLOPT_HTTPHEADER=>[
            'Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6',
            'Cache-Control: no-cache'
        ],
        CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$body){
            if(strlen($body)+strlen($chunk)>3500000)return 0;
            $body.=$chunk;return strlen($chunk);
        }
    ]);
    $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);$error=curl_error($ch);curl_close($ch);
    $meta=['status'=>$status,'bytes'=>strlen($body),'error'=>$error];
    return $ok!==false&&$status>=200&&$status<400?$body:'';
}
function ov_json_unescape(string $s): string {
    $decoded=json_decode('"'.str_replace(['"','\\"'],['\\"','"'],$s).'"',true);
    if(is_string($decoded))return $decoded;
    return stripcslashes($s);
}
function ov_instagram_items(string $html): array {
    if($html==='')return [];
    $items=[];
    if(preg_match_all('/"shortcode"\s*:\s*"([A-Za-z0-9_-]{5,40})"/',$html,$matches,PREG_OFFSET_CAPTURE)){
        foreach($matches[1] as $match){
            [$code,$pos]=$match;$start=max(0,$pos-5000);$chunk=substr($html,$start,12000);
            $caption='';$image='';$timestamp=null;
            if(preg_match('/"edge_media_to_caption"\s*:\s*\{.*?"text"\s*:\s*"((?:\\.|[^"\\])*)"/s',$chunk,$m))$caption=ov_clean(ov_json_unescape($m[1]));
            if($caption===''&&preg_match('/"caption"\s*:\s*\{.*?"text"\s*:\s*"((?:\\.|[^"\\])*)"/s',$chunk,$m))$caption=ov_clean(ov_json_unescape($m[1]));
            if(preg_match('/"display_url"\s*:\s*"((?:\\.|[^"\\])*)"/s',$chunk,$m))$image=ov_json_unescape($m[1]);
            if(preg_match('/"taken_at_timestamp"\s*:\s*(\d{9,12})/',$chunk,$m))$timestamp=(int)$m[1];
            elseif(preg_match('/"taken_at"\s*:\s*(\d{9,12})/',$chunk,$m))$timestamp=(int)$m[1];
            $url='https://www.instagram.com/p/'.$code.'/';
            if(isset($items[$url]))continue;
            $items[$url]=[
                'id'=>'instagram-sanrio-hk-'.$code,
                'source'=>'Sanrio Hong Kong Instagram',
                'sourceId'=>'sanrio.hk',
                'sourceType'=>'instagram',
                'region'=>'HK',
                'overseas'=>true,
                'title'=>$caption!==''?mb_substr($caption,0,90):'Sanrio Hong Kong Instagram 投稿',
                'summary'=>$caption,
                'url'=>$url,
                'thumbnail'=>preg_match('~^https://~i',$image)?$image:'',
                'publishedAt'=>$timestamp?date(DATE_ATOM,$timestamp):null,
                'needsReview'=>true
            ];
        }
    }
    if(!$items&&preg_match_all('~href=["\'](/p/([A-Za-z0-9_-]{5,40})/)["\']~',$html,$matches,PREG_SET_ORDER)){
        foreach($matches as $m){$url='https://www.instagram.com'.$m[1];$items[$url]=['id'=>'instagram-sanrio-hk-'.$m[2],'source'=>'Sanrio Hong Kong Instagram','sourceId'=>'sanrio.hk','sourceType'=>'instagram','region'=>'HK','overseas'=>true,'title'=>'Sanrio Hong Kong Instagram 投稿','summary'=>'','url'=>$url,'thumbnail'=>'','publishedAt'=>null,'needsReview'=>true];}
    }
    $rows=array_values($items);
    usort($rows,static fn($a,$b)=>strcmp((string)($b['publishedAt']??''),(string)($a['publishedAt']??'')));
    return array_slice($rows,0,12);
}

if(empty($config['sync_key'])||!ov_token()||!hash_equals((string)$config['sync_key'],ov_token()))ov_out(['ok'=>false,'error'=>'Unauthorized'],401);
if(($_SERVER['REQUEST_METHOD']??'')!=='GET')ov_out(['ok'=>false,'error'=>'Method not allowed'],405);
$action=$_GET['action']??'list';if(!in_array($action,['list','refresh'],true))ov_out(['ok'=>false,'error'=>'Unknown action'],400);

$profile='https://www.instagram.com/sanrio.hk/';$meta=[];$html=ov_fetch($profile,$meta);$items=ov_instagram_items($html);
$error='';
if($html==='')$error='Instagramに接続できませんでした。時間を置いて再試行してください。';
elseif(!$items)$error='Instagram側の取得制限で投稿一覧を読み取れませんでした。公式プロフィールから確認できます。';
ov_out([
    'ok'=>true,
    'apiVersion'=>'3435',
    'items'=>$items,
    'fetchedAt'=>date(DATE_ATOM),
    'profile'=>['label'=>'Sanrio Hong Kong','handle'=>'@sanrio.hk','region'=>'香港','url'=>$profile],
    'sourceHealth'=>[['label'=>'Sanrio Hong Kong Instagram','ok'=>count($items)>0,'count'=>count($items),'status'=>$meta['status']??0,'error'=>$error]],
    'warning'=>$error
]);
