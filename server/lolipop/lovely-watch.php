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
function lw_settings_path(): string { return __DIR__.'/.rakuten-settings.php'; }
function lw_settings(): array {
    $path=lw_settings_path();
    if(!is_file($path))return [];
    $data=require $path;return is_array($data)?$data:[];
}
function lw_validate_settings(array $data): array {
    $out=[];foreach(['applicationId','affiliateId','accessKey'] as $name)$out[$name]=trim((string)($data[$name]??''));
    if(!preg_match('/^[a-zA-Z0-9-]{8,100}$/D',$out['applicationId']))throw new RuntimeException('アプリIDを確認してください。');
    if(!preg_match('/^[a-fA-F0-9]{8}(?:\.[a-fA-F0-9]{8}){3}$/D',$out['affiliateId']))throw new RuntimeException('アフィリエイトIDを確認してください。');
    if(!preg_match('/^[a-zA-Z0-9._~+\/=:-]{16,512}$/D',$out['accessKey']))throw new RuntimeException('アクセスキーを確認してください。');
    return $out;
}
function lw_save_settings(array $data): void {
    $data=lw_validate_settings($data);$path=lw_settings_path();
    $tmp=tempnam(sys_get_temp_dir(),'sph-rak-settings-');if($tmp===false)throw new RuntimeException('設定保存先を作れません。');
    try {
        if(!chmod($tmp,0600)||file_put_contents($tmp,"<?php\n// Private runtime settings. Never deploy or commit this file.\nreturn ".var_export($data,true).";\n",LOCK_EX)===false||!rename($tmp,$path))throw new RuntimeException('設定を保存できませんでした。');
    } finally {if(is_file($tmp))unlink($tmp);}
}
function lw_affiliate_result(array $data,string $code,string $affiliateId): array {
    $items=$data['items']??$data['Items']??[];
    if(!is_array($items)||count($items)!==1)throw new RuntimeException('商品を1件に特定できませんでした。手動でリンクを入力してください。');
    $item=$items[0]['item']??$items[0]['Item']??$items[0];
    if(!is_array($item)||($item['itemCode']??'')!==$code)throw new RuntimeException('商品コードが一致しません。自動入力しませんでした。');
    $url=(string)($item['affiliateUrl']??'');$p=parse_url($url);
    if(!$p||($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port']))throw new RuntimeException('楽天APIの紹介リンクが安全なHTTPS形式ではありません（確認処理v3）。');
    if(strtolower($p['host']??'')!=='hb.afl.rakuten.co.jp')throw new RuntimeException('楽天APIの紹介リンクが対応ホストではありません（確認処理v3）。');
    // API-issued tracking IDs have their own format; do not impose account ID formatting.
    if(!preg_match('~^/hgc/[a-zA-Z0-9._-]{8,128}/?$~D',$p['path']??''))throw new RuntimeException('楽天APIの紹介リンクが対応パスではありません（確認処理v3）。');
    return ['url'=>$url,'itemCode'=>$code,'title'=>(string)($item['itemName']??''),'checkedAt'=>gmdate('c')];
}
function lw_rakuten_error(int $status,string $body): string {
    $data=json_decode($body,true);
    $description=is_array($data)?(string)($data['error_description']??$data['message']??''):'';
    $reason='送信項目を確認できませんでした。';
    // Classify known field names only; never return the provider body or credential values.
    if(preg_match('/access.?key/i',$description))$reason='アクセスキーが楽天に認識されませんでした。楽天のアプリ詳細からコピーし直し、設定を保存してください。';
    elseif(preg_match('/application.?id|app.?id/i',$description))$reason='アプリケーションIDが楽天に認識されませんでした。アクセスキーと同じアプリのIDか確認してください。';
    elseif(preg_match('/affiliate.?id/i',$description))$reason='アフィリエイトIDを確認してください。';
    elseif(preg_match('/item.?code/i',$description))$reason='商品コードが楽天APIに認識されませんでした。別の商品でも試してください。';
    elseif(preg_match('/origin|referer|domain|ip.address|website/i',$description))$reason='楽天の許可サイト・IP設定で接続元が認められていません。';
    elseif(preg_match('/scope|permission|authoriz/i',$description))$reason='楽天市場APIの利用権限を確認してください。';
    elseif($status===429)$reason='呼び出し回数の制限です。少し待って再試行してください。';
    elseif($status===400)$reason='楽天が送信パラメータを受け付けませんでした（原因項目は特定できません）。';
    return '楽天APIエラー（HTTP '.$status.'）。'.$reason;
}
function lw_resolve_result(array $data,string $code,string $affiliateId,string $target): array {
    $expected=lw_product($target);$matches=[];
    foreach(($data['items']??$data['Items']??[]) as $row){
        $item=$row['item']??$row['Item']??$row;
        if(!is_array($item))continue;
        $url=(string)($item['affiliateUrl']??'');$p=parse_url($url);$q=[];parse_str($p['query']??'',$q);
        $dest=lw_product((string)($q['pc']??$q['m']??$item['itemUrl']??''));
        if(!$expected||!$dest||$expected['id']!==$dest['id'])continue;
        $matches[$url]=$item;
    }
    if(count($matches)!==1)throw new RuntimeException('楽天APIで同じ商品ページを特定できませんでした。手動でリンクを入力してください。');
    $item=array_values($matches)[0];$apiCode=(string)($item['itemCode']??'');
    $result=lw_affiliate_result(['items'=>[$item]],$apiCode,$affiliateId);
    $result['apiItemCode']=$apiCode;$result['itemCode']=$code;return $result;
}
function lw_affiliate(string $code,array $settings,array $info=[]): array {
    if(!preg_match('/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/D',$code))throw new RuntimeException('商品コードを取得できませんでした。');
    $settings=lw_validate_settings($settings);
    $base=sys_get_temp_dir().'/sph-rakuten-'.hash('sha256',__DIR__.'|resolve-v2|'.json_encode($settings));
    $cache=$base.'-'.hash('sha256',$code).'.json';
    if(is_file($cache)&&filemtime($cache)>time()-900){$cached=json_decode((string)file_get_contents($cache),true);if(is_array($cached))return $cached;}
    $lock=fopen($base.'.lock','c');if(!$lock)throw new RuntimeException('APIの準備に失敗しました。');chmod($base.'.lock',0600);
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);throw new RuntimeException('楽天APIを利用中です。少し待って再試行してください。');}
    try {
        $last=(float)stream_get_contents($lock);if(microtime(true)-$last<1)throw new RuntimeException('1秒ほど待って再試行してください。');
        ftruncate($lock,0);rewind($lock);fwrite($lock,(string)microtime(true));fflush($lock);
        $parts=explode(':',$code,2);
        $keyword=preg_match('/^[0-9]{13}$/D',(string)($info['jan']??''))?(string)$info['jan']:$parts[1];
        $url='https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query(['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'shopCode'=>$parts[0],'keyword'=>$keyword,'availability'=>0,'formatVersion'=>2,'elements'=>'itemCode,itemName,itemUrl,affiliateUrl']);
        $ch=curl_init($url);$body='';
        curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/',CURLOPT_WRITEFUNCTION=>function($ch,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>500000)return 0;$body.=$bytes;return strlen($bytes);}]);
        $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
        if($ok===false)throw new RuntimeException('楽天APIへの接続に失敗しました。再試行してください。');
        if($status!==200)throw new RuntimeException(lw_rakuten_error($status,$body));
        $data=json_decode($body,true);if(!is_array($data))throw new RuntimeException('楽天APIの応答を確認できませんでした。');
        $result=lw_resolve_result($data,$code,$settings['affiliateId'],(string)($info['url']??''));
        $tmp=tempnam(sys_get_temp_dir(),'sph-rak-');if($tmp!==false){chmod($tmp,0600);file_put_contents($tmp,json_encode($result));rename($tmp,$cache);}
        return $result;
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}

if (defined('LW_TEST_ONLY')) return;
$config=require __DIR__.'/config.php';
$cron=PHP_SAPI==='cli' && in_array('--refresh',$argv??[],true);
$origin=$_SERVER['HTTP_ORIGIN']??'';
if ($origin && in_array($origin,$config['allowed_origins']??[],true)) {header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD']??'')==='OPTIONS') {http_response_code(204);exit;}
function lw_out(array $data,int $code=200): void {http_response_code($code);echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
$expected=(string)($config['sync_key']??'');$token='';
if(preg_match('/^Bearer\s+(.+)$/i',$_SERVER['HTTP_AUTHORIZATION']??'',$m))$token=trim($m[1]);
if(!$cron && (!$expected || !$token || !hash_equals($expected,$token)))lw_out(['ok'=>false,'error'=>'Unauthorized'],401);
if(!$cron && ($_SERVER['REQUEST_METHOD']??'')!=='GET' && !(($_GET['action']??'')==='settings' && ($_SERVER['REQUEST_METHOD']??'')==='POST'))lw_out(['ok'=>false,'error'=>'GET required'],405);
try {
    if(!$cron && ($_GET['action']??'')==='settings'){
        if(($_SERVER['REQUEST_METHOD']??'')==='POST'){
            if(!in_array($origin,$config['allowed_origins']??[],true))lw_out(['ok'=>false,'error'=>'許可されたアプリから設定してください。'],403);
            $raw=file_get_contents('php://input',false,null,0,4097);if(strlen($raw)>4096)lw_out(['ok'=>false,'error'=>'設定が長すぎます。'],400);
            $input=json_decode($raw,true);if(!is_array($input))lw_out(['ok'=>false,'error'=>'設定を確認してください。'],400);
            lw_save_settings($input);
        }
        lw_out(['ok'=>true,'configured'=>count(lw_settings())===3]);
    }
    if(!class_exists('DOMDocument') || !function_exists('curl_init'))throw new RuntimeException('PHPのDOM・cURL拡張が必要です。');
    $action=$cron?'list':($_GET['action']??'list');
    if ($action==='list') $url='https://lovely-fancy.net/';
    elseif ($action==='detail'||$action==='image'||$action==='affiliate') {$url=lw_article_url((string)($_GET['url']??''));if(!$url)lw_out(['ok'=>false,'error'=>'記事URLが不正です。'],400);}
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
    if($action==='affiliate'){
        $info=$result['item']['productInfo']??null;
        if(!$info)lw_out(['ok'=>false,'error'=>'楽天の商品情報を確認できませんでした。リンクを手動で入力できます。'],400);
        $settings=lw_settings();if(!$settings)lw_out(['ok'=>false,'error'=>'楽天API設定を保存すると自動入力できます。'],400);
        lw_out(['ok'=>true,'affiliate'=>lw_affiliate((string)$info['itemCode'],$settings,$info)]);
    }
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

