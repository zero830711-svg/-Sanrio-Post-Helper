<?php
declare(strict_types=1);
// Lovely Fancy discovery only. No remote images, tracking clicks or arbitrary URL fetching.
function lw_doc(string $html): DOMXPath {
    $doc=new DOMDocument();
    $prev=libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">'.$html, LIBXML_NONET);
    libxml_clear_errors(); libxml_use_internal_errors($prev);
    return new DOMXPath($doc);
}
function lw_text(?DOMNode $node): string { return trim(preg_replace('/\s+/u',' ', $node ? $node->textContent : '') ?? ''); }
function lw_article_url(string $url): string {
    $p=parse_url($url);
    if (($p['scheme']??'')!=='https' || ($p['host']??'')!=='lovely-fancy.net' || isset($p['port']) || isset($p['user']) || isset($p['pass'])) return '';
    $path=$p['path']??'';
    return preg_match('~^/[a-z0-9-]+/[0-9]+/[0-9]+/$~D', $path) ? 'https://lovely-fancy.net'.$path : '';
}
function lw_product(string $href): ?array {
    $url=html_entity_decode(trim($href), ENT_QUOTES|ENT_HTML5,'UTF-8');
    if (strpos($url,'//')===0) $url='https:'.$url;
    for ($i=0; $i<3; $i++) {
        $p=parse_url($url); $host=strtolower($p['host']??'');
        $params=[]; parse_str($p['query']??'', $params);
        $key=$host==='af.moshimo.com'?'url':($host==='ck.jp.ap.valuecommerce.com'?'vc_url':($host==='affiliate.suruga-ya.jp'?'goods_url':''));
        if (!$key) break;
        if (!isset($params[$key]) || !is_string($params[$key])) return null;
        $url=$params[$key];
    }
    $p=parse_url($url); $host=strtolower($p['host']??''); $path=$p['path']??'';
    if (($p['scheme']??'')!=='https' || isset($p['user']) || isset($p['pass']) || isset($p['port'])) return null;
    if ($host==='item.rakuten.co.jp' && preg_match('~^/([a-zA-Z0-9_-]+)/([a-zA-Z0-9_-]+)/?$~D',$path,$m)) {
        return ['id'=>'rakuten:'.$m[1].':'.$m[2],'url'=>'https://item.rakuten.co.jp/'.$m[1].'/'.$m[2].'/','store'=>'楽天','kind'=>'product'];
    }
    if (in_array($host,['amazon.co.jp','www.amazon.co.jp'],true) && preg_match('~/(?:dp|gp/product|gp/aw/d)/([A-Z0-9]{10})(?:/|$)~i',$path,$m)) {
        return ['id'=>'asin:'.strtoupper($m[1]),'url'=>'https://www.amazon.co.jp/dp/'.strtoupper($m[1]),'store'=>'Amazon','kind'=>'product'];
    }
    // Search links must never be promoted to product links.
    return null;
}
function lw_list(string $html): array {
    $x=lw_doc($html); $rows=[];
    foreach ($x->query('//article[contains(concat(" ",normalize-space(@class)," ")," post-list ")]') as $article) {
        $heading=$x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," entry-title ")]',$article)->item(0);
        $title=lw_text($heading);
        if (!preg_match('/サンリオ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ|ハンギョドン|こぎみゅん|けろっぴ|けろけろ|タキシードサム|キキララ|リトルツイン|ばつ丸|シュガーバニ|ウサハナ|ぐでたま|チャーミー|ペックル|たあ坊|チョコキャット|ウィッシュミーメル|ぼんぼんりぼん|まるもふ|もんきち|マロンクリーム|ミュークル|はなまるおばけ/u',$title)) continue;
        $url=''; foreach ($x->query('.//a[@rel="bookmark"]',$article) as $a) { $url=lw_article_url($a->getAttribute('href')); if ($url) break; }
        if (!$url) continue;
        $ids=[]; foreach ($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," btn-float ")]//a[@href]',$article) as $a) { $p=lw_product($a->getAttribute('href')); if ($p) $ids[]=$p['id']; }
        $rows[$url]=['url'=>$url,'title'=>$title,'date'=>str_replace('.','-',lw_text($x->query('.//time',$article)->item(0))),'productIds'=>array_values(array_unique($ids))];
    }
    if (!$rows) throw new RuntimeException('新着の商品欄を取得できませんでした。サイトの構造変更やアクセス制限の可能性があります。');
    return array_values($rows);
}
function lw_detail(string $html,string $url): array {
    $x=lw_doc($html);
    $articles=$x->query('//article[starts-with(@id,"post-")]');
    if ($articles->length!==1) throw new RuntimeException('記事の範囲を特定できませんでした。');
    $article=$articles->item(0);
    $title=lw_text($x->query('.//h1[contains(concat(" ",normalize-space(@class)," ")," entry-title ")]',$article)->item(0));
    $body=$x->query('./section[contains(concat(" ",normalize-space(@class)," ")," entry-content ")]',$article)->item(0);
    if (!$body || !$title) throw new RuntimeException('主商品欄を特定できませんでした。');
    $products=[];
    // Current template: main product, then "他のお店" search block. Fail closed on extra containers.
    foreach ($body->childNodes as $child) {
        if (!($child instanceof DOMElement)) continue;
        $text=lw_text($child);
        if (preg_match('/他のお店|こちらも|おすすめ|関連記事|関連商品|あわせて/u',$text)) break;
        if (strtolower($child->tagName)!=='p') break;
        foreach ($x->query('.//a[@href]',$child) as $a) {
            $p=lw_product($a->getAttribute('href'));
            if ($p) $products[$p['id']]=$p;
        }
    }
    return ['url'=>$url,'title'=>$title,'date'=>str_replace('.','-',lw_text($x->query('.//time',$article)->item(0))),'products'=>array_values($products),'needsReview'=>count($products)!==1];
}
function lw_fetch(string $url): string {
    if ($url!=='https://lovely-fancy.net/' && !lw_article_url($url)) throw new RuntimeException('対象外のURLです。');
    $ch=curl_init($url); $body='';
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_USERAGENT=>'SanrioPostHelper/3388 (personal product discovery)',CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_WRITEFUNCTION=>function($ch,$data) use (&$body){ if(strlen($body)+strlen($data)>1500000)return 0; $body.=$data;return strlen($data); }]);
    $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    if ($ok===false || $status!==200) throw new RuntimeException('ブログに接続できませんでした。時間を置いて再試行してください。');
    return $body;
}
if (defined('LW_TEST_ONLY')) return;
$config=require __DIR__.'/config.php';
$cron=PHP_SAPI==='cli' && in_array('--refresh',$argv??[],true);
$origin=$_SERVER['HTTP_ORIGIN']??'';
if ($origin && in_array($origin,$config['allowed_origins']??[],true)) {header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, OPTIONS');header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD']??'')==='OPTIONS') {http_response_code(204);exit;}
function lw_out(array $data,int $code=200): void {http_response_code($code);echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
$expected=(string)($config['sync_key']??'');$token='';
if(preg_match('/^Bearer\s+(.+)$/i',$_SERVER['HTTP_AUTHORIZATION']??'',$m))$token=trim($m[1]);
if(!$cron && (!$expected || !$token || !hash_equals($expected,$token)))lw_out(['ok'=>false,'error'=>'Unauthorized'],401);
if(!$cron && ($_SERVER['REQUEST_METHOD']??'')!=='GET')lw_out(['ok'=>false,'error'=>'GET required'],405);
try {
    if(!class_exists('DOMDocument') || !function_exists('curl_init'))throw new RuntimeException('PHPのDOM・cURL拡張が必要です。');
    $action=$cron?'list':($_GET['action']??'list');
    if ($action==='list') $url='https://lovely-fancy.net/';
    elseif ($action==='detail') {$url=lw_article_url((string)($_GET['url']??''));if(!$url)lw_out(['ok'=>false,'error'=>'記事URLが不正です。'],400);}
    else lw_out(['ok'=>false,'error'=>'Unknown action'],400);
    // Shared public discovery cache lives outside the web directory. At most one fetch per URL per 15 minutes.
    $cache=sys_get_temp_dir().'/sph-lw-'.hash('sha256',__DIR__.'|'.$url).'.json';
    $lock=fopen($cache.'.lock','c');if(!$lock || !flock($lock,LOCK_EX))throw new RuntimeException('キャッシュを準備できませんでした。');
    $result=!$cron && is_file($cache)&&filemtime($cache)>time()-900?json_decode((string)file_get_contents($cache),true):null;
    if (!is_array($result)) {
        $html=lw_fetch($url);
        $result=['ok'=>true,'fetchedAt'=>gmdate('c'),'source'=>'Lovely Fancy'];
        if($action==='list')$result['items']=lw_list($html);else $result['item']=lw_detail($html,$url);
        $tmp=$cache.'.tmp';file_put_contents($tmp,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));chmod($tmp,0600);rename($tmp,$cache);
    }
    flock($lock,LOCK_UN);fclose($lock);lw_out($result);
} catch (Throwable $e) { lw_out(['ok'=>false,'error'=>$e->getMessage()],502); }
