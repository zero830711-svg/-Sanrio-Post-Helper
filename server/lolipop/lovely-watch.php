<?php
declare(strict_types=1);
// Scoped discovery and verified Rakuten page parsing. No tracking clicks or arbitrary URL fetching.
function lw_doc(string $html): DOMXPath {
    if (preg_match('/charset\s*=\s*["\']?(EUC-JP|Shift_JIS|SJIS|Windows-31J)/i',substr($html,0,5000),$m)) {
        if (!function_exists('iconv')) throw new RuntimeException('商品ページの文字コード変換にiconvが必要です。');
        $converted=@iconv($m[1],'UTF-8',$html);
        if ($converted===false) throw new RuntimeException('商品ページの文字コードを変換できませんでした。');
        $html=preg_replace('/charset\s*=\s*["\']?(?:EUC-JP|Shift_JIS|SJIS|Windows-31J)/i','charset=UTF-8',$converted);
    }
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
function lw_image_url(string $url): string {
    $p=parse_url($url);$host=$p['host']??'';
    if(($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port']))return '';
    if(!in_array($host,['shop.r10s.jp','image.rakuten.co.jp','tshop.r10s.jp'],true))return '';
    return preg_match('~\.(?:jpe?g|png|webp)$~i',$p['path']??'')?$url:'';
}
function lw_meta(DOMXPath $x,string $attr,string $name): string {
    $nodes=$x->query('//meta[@'.$attr.'="'.$name.'"]');
    if($nodes->length!==1)return '';
    return trim(preg_replace('/\s+/u',' ',$nodes->item(0)->getAttribute('content'))??'');
}
function lw_rakuten(string $html,string $url): array {
    $product=lw_product($url);if(!$product||$product['store']!=='楽天')throw new RuntimeException('楽天の主商品ではありません。');
    $x=lw_doc($html);
    $canon=$x->query('//link[@rel="canonical"]');
    if($canon->length!==1 || (lw_product($canon->item(0)->getAttribute('href'))['id']??'')!==$product['id'])throw new RuntimeException('楽天ページの商品を特定できませんでした。');
    $sku=lw_meta($x,'itemprop','sku');
    if($sku && 'rakuten:'.$sku!==$product['id'])throw new RuntimeException('楽天ページの商品番号が一致しません。');
    $name=lw_meta($x,'itemprop','name')?:lw_meta($x,'property','og:title');
    if(!$name)throw new RuntimeException('商品名を取得できませんでした。');
    $specs=[];$contents=[];
    // Only one dedicated item description; do not scan recommendations or the whole page.
    $desc=$x->query('//span[contains(concat(" ",normalize-space(@class)," ")," item_desc ")]');
    if($desc->length===1){
        $node=$desc->item(0)->cloneNode(true);
        foreach(iterator_to_array($node->getElementsByTagName('br')) as $br)$br->parentNode->replaceChild($node->ownerDocument->createTextNode("\n"),$br);
        $lines=preg_split('/\R/u',$node->textContent);$inContents=false;
        foreach($lines as $line){
            $line=trim($line);if(!$line)continue;
            if(preg_match('/^[◆■●]?\s*(?:内容|セット内容|ラインナップ)\s*[：:]\s*(.*)$/u',$line,$m)){$inContents=true;if($m[1])$contents[]=$m[1];continue;}
            if(preg_match('/^[◆■●]?\s*(メーカー(?:名)?|ブランド|型番|品番|素材|材質|サイズ|対象年齢|[ＪJ][ＡA][ＮN])\s*[：:]\s*(.{1,100})$/u',$line,$m)){$specs[$m[1]]=$m[2];$inContents=false;continue;}
            if($inContents&&preg_match('/^(?:＜|<|[①-⑳]|[0-9]+[.)、]|・)/u',$line))$contents[]=$line;
            else $inContents=false;
        }
    }
    $images=[];
    foreach([lw_meta($x,'property','og:image'),lw_meta($x,'itemprop','image')] as $image){$image=lw_image_url($image);if($image)$images[]=$image;}
    return ['title'=>$name,'url'=>$product['url'],'productId'=>$product['id'],'itemCode'=>$sku?:substr($product['id'],8),'jan'=>lw_meta($x,'itemprop','gtin13'),'specs'=>array_slice($specs,0,8,true),'contents'=>array_slice($contents,0,12),'images'=>array_values(array_unique($images)),'checkedAt'=>gmdate('c')];
}
function lw_enriched(string $html,string $url): array {
    $item=lw_detail($html,$url);
    if(count($item['products'])!==1||$item['products'][0]['store']!=='楽天'){$item['productError']='楽天の主商品を1件に特定できませんでした。写真と補足を手動で追加できます。';return $item;}
    try{$item['productInfo']=lw_rakuten(lw_fetch($item['products'][0]['url']),$item['products'][0]['url']);}
    catch(Throwable $e){$item['productError']='商品情報を取得できませんでした。販売ページを確認し、写真と補足を追加してください。';}
    return $item;
}
function lw_fetch(string $url,int $limit=1500000,bool $image=false): string {
    $p=lw_product($url);
    if ($url!=='https://lovely-fancy.net/' && !lw_article_url($url) && !($p&&$p['store']==='楽天'&&$p['url']===$url) && !($image&&lw_image_url($url))) throw new RuntimeException('対象外のURLです。');
    $ch=curl_init($url); $body='';
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>18,CURLOPT_USERAGENT=>'SanrioPostHelper/3389 (personal product discovery)',CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_WRITEFUNCTION=>function($ch,$data) use (&$body,$limit){ if(strlen($body)+strlen($data)>$limit)return 0; $body.=$data;return strlen($data); }]);
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
    elseif ($action==='detail'||$action==='image') {$url=lw_article_url((string)($_GET['url']??''));if(!$url)lw_out(['ok'=>false,'error'=>'記事URLが不正です。'],400);}
    else lw_out(['ok'=>false,'error'=>'Unknown action'],400);
    // Shared public discovery cache lives outside the web directory. At most one fetch per URL per 15 minutes.
    $cache=sys_get_temp_dir().'/sph-lw-'.hash('sha256',__DIR__.'|3389|'.$url).'.json';
    $lock=fopen($cache.'.lock','c');if(!$lock || !flock($lock,LOCK_EX))throw new RuntimeException('キャッシュを準備できませんでした。');
    $result=!$cron && is_file($cache)&&filemtime($cache)>time()-900?json_decode((string)file_get_contents($cache),true):null;
    if (!is_array($result)) {
        $html=lw_fetch($url);
        $result=['ok'=>true,'fetchedAt'=>gmdate('c'),'source'=>'Lovely Fancy'];
        if($action==='list')$result['items']=lw_list($html);else $result['item']=lw_enriched($html,$url);
        $tmp=$cache.'.tmp';file_put_contents($tmp,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));chmod($tmp,0600);rename($tmp,$cache);
    }
    flock($lock,LOCK_UN);fclose($lock);
    if($action==='image'){
        $index=filter_var($_GET['index']??null,FILTER_VALIDATE_INT);
        $images=$result['item']['productInfo']['images']??[];
        if($index===false||$index===null||!isset($images[$index]))lw_out(['ok'=>false,'error'=>'商品画像が見つかりません。'],400);
        $bytes=lw_fetch($images[$index],6000000,true);$size=@getimagesizefromstring($bytes);
        if(!$size||!in_array($size['mime']??'',['image/jpeg','image/png','image/webp'],true)||$size[0]*$size[1]>30000000)lw_out(['ok'=>false,'error'=>'この画像は共有用に取得できません。'],400);
        header('Content-Type: '.$size['mime']);header('X-Content-Type-Options: nosniff');echo $bytes;exit;
    }
    lw_out($result);
} catch (Throwable $e) { lw_out(['ok'=>false,'error'=>$e->getMessage()],502); }
