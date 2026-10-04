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
    $hat=lw_hat_article_url($url);if($hat)return $hat;
    $gour=lw_gour_article_url($url);if($gour)return $gour;
    $skater=lw_skater_article_url($url);if($skater)return $skater;
    $p=parse_url($url);
    if (($p['scheme']??'')!=='https' || ($p['host']??'')!=='lovely-fancy.net' || isset($p['port']) || isset($p['user']) || isset($p['pass'])) return '';
    $path=$p['path']??'';
    return preg_match('~^/[a-z0-9-]+/[0-9]+/[0-9]+/$~D', $path) ? 'https://lovely-fancy.net'.$path : '';
}
function lw_page_url(int $page): string {
    if($page<1||$page>20)throw new RuntimeException('ページ番号が不正です。');
    return $page===1?'https://lovely-fancy.net/':'https://lovely-fancy.net/page/'.$page.'/';
}
function lw_list_url(string $url): bool {
    if($url==='https://lovely-fancy.net/')return true;
    return preg_match('~^https://lovely-fancy\.net/page/([2-9]|1[0-9]|20)/$~D',$url)===1;
}
function lw_next_page(string $html,int $page): ?int {
    if($page>=20)return null;
    $x=lw_doc($html);$expected=lw_page_url($page+1);
    foreach($x->query('//a[contains(concat(" ",normalize-space(@class)," ")," next ")] | //link[@rel="next"]') as $a){
        $href=$a->getAttribute('href');
        if($href===$expected||$href==='/page/'.($page+1).'/')return $page+1;
    }
    return null;
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
// List previews only; these URLs are never accepted by the image sharing proxy.
function lw_thumbnail_url(string $url): string {
    $url=html_entity_decode(trim($url),ENT_QUOTES|ENT_HTML5,'UTF-8');
    if(strpos($url,'//')===0)$url='https:'.$url;
    if(strpos($url,'/wp-content/uploads/')===0)$url='https://lovely-fancy.net'.$url;
    $parts=parse_url($url);
    if(($parts['scheme']??'')!=='https'||($parts['host']??'')!=='lovely-fancy.net'||isset($parts['port'])||isset($parts['user'])||isset($parts['pass']))return '';
    return preg_match('~^/wp-content/uploads/[0-9]{4}/[0-9]{2}/[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp|avif)$~D',$parts['path']??'')?$url:'';
}
function lw_list(string $html,bool $allowEmpty=false): array {
    $x=lw_doc($html); $rows=[];
    foreach ($x->query('//article[contains(concat(" ",normalize-space(@class)," ")," post-list ")]') as $article) {
        $heading=$x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," entry-title ")]',$article)->item(0);
        $title=lw_text($heading);
        if (!preg_match('/サンリオ|キティ|クロミ|マイメロ|シナモ|プリン|ポチャッコ|ハンギョドン|こぎみゅん|けろっぴ|けろけろ|タキシードサム|キキララ|リトルツイン|ばつ丸|シュガーバニ|ウサハナ|ぐでたま|チャーミー|ペックル|たあ坊|チョコキャット|ウィッシュミーメル|ぼんぼんりぼん|まるもふ|もんきち|マロンクリーム|ミュークル|はなまるおばけ/u',$title)) continue;
        $url=''; foreach ($x->query('.//a[@rel="bookmark"]',$article) as $a) { $url=lw_article_url($a->getAttribute('href')); if ($url) break; }
        if (!$url) continue;
        $ids=[]; foreach ($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," btn-float ")]//a[@href]',$article) as $a) { $p=lw_product($a->getAttribute('href')); if ($p) $ids[]=$p['id']; }
        // Unsupported stores and search links cannot identify an Amazon/Rakuten product.
        if (!$ids) continue;
        $thumbnail='';
        foreach($x->query('.//img[contains(concat(" ",normalize-space(@class)," ")," archives-eyecatch-image ") or contains(concat(" ",normalize-space(@class)," ")," wp-post-image ")]',$article) as $img){
            foreach(['data-src','src'] as $attr){$thumbnail=lw_thumbnail_url($img->getAttribute($attr));if($thumbnail)break;}
            if($thumbnail)break;
        }
        $rows[$url]=['thumbnail'=>$thumbnail,'url'=>$url,'title'=>$title,'date'=>str_replace('.','-',lw_text($x->query('.//time',$article)->item(0))),'productIds'=>array_values(array_unique($ids))];
    }
    if (!$rows && (!$allowEmpty || $x->query('//article[contains(concat(" ",normalize-space(@class)," ")," post-list ")]')->length===0)) throw new RuntimeException('新着の商品欄を取得できませんでした。サイトの構造変更やアクセス制限の可能性があります。');
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
    if(lw_gour_article_url($url))return lw_gour_enriched($html,$url);
    if(lw_skater_article_url($url))return lw_skater_enriched($html,$url);
    if(lw_hat_article_url($url)){
        $item=lw_hat_detail($html,$url);
        if(!$item['products'])throw new RuntimeException('楽天・Amazonの商品リンクがあるサンリオ商品ではありません。');
        $rakuten=array_values(array_filter($item['products'],function($p){return $p['store']==='楽天';}));
        $info=['title'=>$item['title'],'url'=>'','itemCode'=>'','jan'=>'','specs'=>[],'contents'=>[],'images'=>$item['manufacturerImages'],'checkedAt'=>gmdate('c')];
        if(count($rakuten)===1){
            $p=$rakuten[0];$info['url']=$p['url'];$info['itemCode']=substr($p['id'],8);$info['productId']=$p['id'];
            try{$shop=lw_rakuten(lw_fetch($p['url']),$p['url']);$info=array_merge($info,$shop);$info['images']=$item['manufacturerImages']?:$shop['images'];}catch(Throwable $e){$item['productError']='楽天の追加情報は取得できませんでした。メーカーの商品資料を表示しています。';}
        }
        $item['productInfo']=$info;return $item;
    }
    $item=lw_detail($html,$url);
    if(count($item['products'])!==1||$item['products'][0]['store']!=='楽天'){$item['productError']='楽天の主商品を1件に特定できませんでした。写真と補足を手動で追加できます。';return $item;}
    try{$item['productInfo']=lw_rakuten(lw_fetch($item['products'][0]['url']),$item['products'][0]['url']);}
    catch(Throwable $e){$item['productError']='商品情報を取得できませんでした。販売ページを確認し、写真と補足を追加してください。';}
    return $item;
}
function lw_fetch(string $url,int $limit=1500000,bool $image=false): string {
    $p=lw_product($url);
    if (!lw_list_url($url) && !lw_hat_list_url($url) && !lw_gour_list_url($url) && !lw_skater_list_url($url) && !lw_article_url($url) && !($p&&$p['store']==='楽天'&&$p['url']===$url) && !($image&&(lw_image_url($url)||lw_hat_image_url($url)))) throw new RuntimeException('対象外のURLです。');
    $ch=curl_init($url); $body='';
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>18,CURLOPT_USERAGENT=>'SanrioPostHelper/3389 (personal product discovery)',CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_WRITEFUNCTION=>function($ch,$data) use (&$body,$limit){ if(strlen($body)+strlen($data)>$limit)return 0; $body.=$data;return strlen($data); }]);
    $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    if ($ok===false || $status!==200) throw new RuntimeException('情報元に接続できませんでした。時間を置いて再試行してください。');
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
        $keyword=preg_match('/^[0-9]{13}$/D',(string)($info['jan']??''))?(string)$info['jan']:($info['searchKeyword']??$parts[1]);
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

function lw_hat_article_url(string $url): string {
    $p=parse_url($url);
    if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.hatakeyamashoji.jp'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['query']))return '';
    return preg_match('~^/news/[a-zA-Z0-9_-]+/$~D',$p['path']??'')?'https://www.hatakeyamashoji.jp'.$p['path']:'';
}
function lw_hat_page_url(int $page): string {
    if($page<1||$page>20)throw new RuntimeException('ページ番号が不正です。');
    return 'https://www.hatakeyamashoji.jp/news/'.($page===1?'':'page/'.$page.'/');
}
function lw_hat_list_url(string $url): bool {
    return $url==='https://www.hatakeyamashoji.jp/news/'||preg_match('~^https://www\.hatakeyamashoji\.jp/news/page/([2-9]|1[0-9]|20)/$~D',$url)===1;
}
function lw_hat_image_url(string $url): string {
    $p=parse_url($url);
    if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.hatakeyamashoji.jp'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['query'])||isset($p['fragment']))return '';
    return preg_match('~^/wp/wp-content/uploads/(?:[0-9]{4}/[0-9]{2}/)?[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$~iD',$p['path']??'')?$url:'';
}
function lw_hat_list(string $html,int $page): array {
    $x=lw_doc($html);$boxes=$x->query('//div[contains(concat(" ",normalize-space(@class)," ")," top_news_box ")]//div[contains(concat(" ",normalize-space(@class)," ")," listbox ")]');
    if(!$boxes->length)throw new RuntimeException('畑山商事の新着一覧を取得できませんでした。');
    $urls=[];
    foreach($boxes as $box){
        $a=$x->query('.//a[@href]',$box)->item(0);$url=$a?lw_hat_article_url($a->getAttribute('href')):'';
        if($url)$urls[$url]=true;
        if(count($urls)>=20)break;
    }
    $next=null;
    if($page<20)foreach($x->query('//a[contains(concat(" ",normalize-space(@class)," ")," next ")]') as $a)if($a->getAttribute('href')===lw_hat_page_url($page+1))$next=$page+1;
    return ['urls'=>array_keys($urls),'nextPage'=>$next];
}
function lw_hat_detail(string $html,string $url): array {
    if(!lw_hat_article_url($url))throw new RuntimeException('畑山商事の記事URLが不正です。');
    $x=lw_doc($html);$canon=$x->query('//link[@rel="canonical"]');
    if($canon->length!==1||lw_hat_article_url($canon->item(0)->getAttribute('href'))!==$url)throw new RuntimeException('畑山商事の記事が一致しません。');
    $main=$x->query('//*[@id="main"]/div[contains(concat(" ",normalize-space(@class)," ")," list_news ")]');
    if($main->length!==1)throw new RuntimeException('メーカーの商品記事を特定できませんでした。');
    $node=$main->item(0);$body=$x->query('./div[contains(concat(" ",normalize-space(@class)," ")," textBox ")]',$node);
    $title=lw_text($x->query('./h3',$node)->item(0));
    if($body->length!==1||!$title)throw new RuntimeException('メーカーの商品資料を取得できませんでした。');
    $text=lw_text($body->item(0));$products=[];$images=[];$facts=[];$lines=[];
    // Confirm the product brand inside the article, never from site-wide headings.
    $sanrio=preg_match('/サンリオ/u',$title)&&preg_match('/ブランド\s*[：:]\s*サンリオ/u',$text);
    foreach($x->query('.//p',$body->item(0)) as $p){$line=lw_text($p);if($line)$lines[]=$line;if(preg_match('/^(ブランド|商品名|発売時期|素材|サイズ|発売元)\s*[：:]\s*(.{1,150})$/u',$line,$m))$facts[$m[1]]=$m[2];}
    if($sanrio)foreach($x->query('.//a[@href]',$body->item(0)) as $a){$p=lw_product($a->getAttribute('href'));if($p)$products[$p['id']]=$p;}
    foreach($x->query('.//img[@src]',$body->item(0)) as $img){$image=lw_hat_image_url($img->getAttribute('src'));if($image&&(!is_numeric($img->getAttribute('width'))||(int)$img->getAttribute('width')>=200)&&!preg_match('~/(?:ico_|logo|banner)~i',$image))$images[$image]=true;}
    $date=lw_text($x->query('./p[contains(concat(" ",normalize-space(@class)," ")," tar ")]',$node)->item(0));
    $date=preg_match('/([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/u',$date,$m)?sprintf('%04d-%02d-%02d',$m[1],$m[2],$m[3]):'';
    return ['source'=>'畑山商事','url'=>$url,'title'=>$title,'date'=>$date,'products'=>array_values($products),'productIds'=>array_keys($products),'needsReview'=>count(array_filter($products,function($p){return $p['store']==='楽天';}))>1,'thumbnail'=>array_key_first($images)??'','manufacturerImages'=>array_slice(array_keys($images),0,12),'manufacturerInfo'=>['facts'=>$facts,'text'=>(preg_match('/^.{0,6000}/us',implode("\n",$lines),$excerpt)?$excerpt[0]:''),'checkedAt'=>gmdate('c')]];
}
function lw_hat_discover(string $html,int $page): array {
    $list=lw_hat_list($html,$page);$items=[];$pending=[];$failed=0;
    // The list titles are truncated. Read each article once, with a short shared cache.
    foreach($list['urls'] as $url){
        $cache=sys_get_temp_dir().'/sph-hat-'.hash('sha256',__DIR__.'|3415|'.$url).'.json';
        $item=is_file($cache)&&filemtime($cache)>time()-900?json_decode((string)file_get_contents($cache),true):null;
        if(is_array($item)){if($item['products'])$items[]=$item;continue;}
        $pending[$url]=$cache;
    }
    foreach(array_chunk($pending,5,true) as $batch){
        $multi=curl_multi_init();$handles=[];$bodies=[];
        foreach($batch as $url=>$cache){
            $bodies[$url]='';$ch=curl_init($url);$handles[$url]=$ch;
            curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_TIMEOUT=>6,CURLOPT_USERAGENT=>'SanrioPostHelper/3415 (personal product discovery)',CURLOPT_WRITEFUNCTION=>function($ch,$bytes)use(&$bodies,$url){if(strlen($bodies[$url])+strlen($bytes)>1500000)return 0;$bodies[$url].=$bytes;return strlen($bytes);}]);curl_multi_add_handle($multi,$ch);
        }
        do{$code=curl_multi_exec($multi,$active);if($active)curl_multi_select($multi,0.2);}while($active&&$code===CURLM_OK);
        foreach($handles as $url=>$ch){
            try{
                if(curl_errno($ch)||curl_getinfo($ch,CURLINFO_HTTP_CODE)!==200)throw new RuntimeException('article unavailable');
                $item=lw_hat_detail($bodies[$url],$url);$tmp=tempnam(sys_get_temp_dir(),'sph-hat-');
                if($tmp!==false){chmod($tmp,0600);file_put_contents($tmp,json_encode($item,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));rename($tmp,$batch[$url]);}
                if($item['products'])$items[]=$item;
            }catch(Throwable $e){$failed++;}
            curl_multi_remove_handle($multi,$ch);curl_close($ch);
        }curl_multi_close($multi);
    }
    return ['items'=>$items,'nextPage'=>$list['nextPage'],'partial'=>$failed>0,'failedArticles'=>$failed];
}

// Manufacturer discovery is separate from retailer identity and shareable photos.
function lw_gour_article_url(string $url): string {
    $p=parse_url($url);
    if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.gourmandise.jp'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['fragment']))return '';
    if(isset($p['query'])&&$p['query']!=='category_page_id=items')return '';
    return preg_match('~^/view/item/[0-9]{12}$~D',$p['path']??'')?'https://www.gourmandise.jp'.$p['path']:'';
}
function lw_gour_page_url(int $page): string {
    if($page<1||$page>20)throw new RuntimeException('ページ番号が不正です。');
    return 'https://www.gourmandise.jp/view/category/items'.($page===1?'':'?page='.$page);
}
function lw_gour_list_url(string $url): bool {
    return $url===lw_gour_page_url(1)||preg_match('~^https://www\.gourmandise\.jp/view/category/items\?page=([2-9]|1[0-9]|20)$~D',$url)===1;
}
function lw_gour_sanrio(string $title): bool {
    return preg_match('/サンリオ|ハローキティ|クロミ|マイメロディ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|こぎみゅん|けろけろけろっぴ|タキシードサム|リトルツインスターズ|ウサハナ|ぐでたま|あひるのペックル|バッドばつ丸/u',$title)===1;
}
function lw_gour_thumbnail_url(string $url): string {
    $url=html_entity_decode(trim($url),ENT_QUOTES|ENT_HTML5,'UTF-8');
    if(strpos($url,'//')===0)$url='https:'.$url;
    $p=parse_url($url);
    if(($p['scheme']??'')!=='https'||($p['host']??'')!=='makeshop-multi-images.akamaized.net'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['fragment']))return '';
    if(isset($p['query'])&&!preg_match('/^[0-9]+$/D',$p['query']))return '';
    return preg_match('~^/gourmandise/itemimages/[0-9]{12}[0-9]*_[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$~iD',$p['path']??'')?$url:'';
}
function lw_gour_list(string $html,int $page): array {
    $x=lw_doc($html);$boxes=$x->query('//div[contains(concat(" ",normalize-space(@class)," ")," product-list-wrap ")]');
    if($boxes->length!==1)throw new RuntimeException('グルマンディーズの商品一覧を取得できませんでした。');
    $rows=[];
    foreach($x->query('./a[contains(concat(" ",normalize-space(@class)," ")," product-list-item ")]',$boxes->item(0)) as $a){
        $href=$a->getAttribute('href');if(strpos($href,'/view/item/')===0)$href='https://www.gourmandise.jp'.$href;
        $url=lw_gour_article_url($href);$title=lw_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," product-name ")]',$a)->item(0));
        if(!$url||!lw_gour_sanrio($title))continue;
        // List-only thumbnails must never enter the image sharing proxy.
        $thumbnail='';
        foreach($x->query('.//img',$a) as $img){
            foreach(['data-src','src'] as $attr){$thumbnail=lw_gour_thumbnail_url($img->getAttribute($attr));if($thumbnail)break;}
            if($thumbnail)break;
        }
        $rows[$url]=['source'=>'グルマンディーズ','url'=>$url,'title'=>$title,'date'=>'','thumbnail'=>$thumbnail,'productIds'=>[],'products'=>[],'needsReview'=>true];
    }
    $next=null;
    if($page<20)foreach($x->query('//div[contains(concat(" ",normalize-space(@class)," ")," pager-wrap ")]//a[@href]') as $a){
        if($a->getAttribute('href')==='/view/category/items?page='.($page+1))$next=$page+1;
    }
    return ['items'=>array_values($rows),'nextPage'=>$next];
}
function lw_gour_detail(string $html,string $url): array {
    $url=lw_gour_article_url($url);if(!$url)throw new RuntimeException('メーカーの商品URLが不正です。');
    $x=lw_doc($html);$canon=$x->query('//link[@rel="canonical"]');$titles=$x->query('//h2[contains(concat(" ",normalize-space(@class)," ")," product-title ")]');
    if($canon->length!==1||lw_gour_article_url($canon->item(0)->getAttribute('href'))!==$url||$titles->length!==1)throw new RuntimeException('メーカーの商品を特定できませんでした。');
    $title=lw_text($titles->item(0));if(!lw_gour_sanrio($title))throw new RuntimeException('サンリオの商品ではありません。');
    $variants=[];$grids=$x->query('//dl[contains(concat(" ",normalize-space(@class)," ")," sku-grid ")]');
    if($grids->length===1){
        $codes=$x->query('./dd[@class="sku-id"]',$grids->item(0));$names=$x->query('./dd[@class="sku-name"]',$grids->item(0));$jans=$x->query('./dd[@class="sku-jan"]',$grids->item(0));
        if($codes->length!==$names->length||$codes->length!==$jans->length||$codes->length>30)throw new RuntimeException('型番とJANの対応を確認できませんでした。');
        for($i=0;$i<$codes->length;$i++){
            $model=strtoupper(lw_text($codes->item($i)));$jan=lw_text($jans->item($i));$name=lw_text($names->item($i));
            if(!preg_match('/^[A-Z0-9]{2,16}-[A-Z0-9-]{2,24}$/D',$model)||!preg_match('/^[0-9]{13}$/D',$jan))continue;
            $variants[]=['model'=>$model,'jan'=>$jan,'name'=>$name];
        }
    }
    $facts=['商品名'=>$title];
    if(preg_match('/([0-9]{1,2}月(?:上旬|中旬|下旬|[0-9]{1,2}日)?発売予定)/u',$title,$m))$facts['発売時期']=$m[1];
    if($variants)$facts['ラインナップ']=implode(' / ',array_column($variants,'name'));
    return ['source'=>'グルマンディーズ','url'=>$url,'title'=>$title,'date'=>'','thumbnail'=>'','products'=>[],'productIds'=>[],'variants'=>$variants,'needsReview'=>true,'manufacturerImages'=>[],
        'manufacturerInfo'=>['facts'=>$facts,'text'=>'','checkedAt'=>gmdate('c')],
        'productInfo'=>['title'=>$title,'url'=>'','itemCode'=>'','jan'=>'','specs'=>[],'contents'=>[],'images'=>[],'checkedAt'=>gmdate('c')]];
}
function lw_gour_keyword(array $variants): string {
    if(!$variants)return '';
    $first=$variants[0]['model'];
    if(count($variants)===1)return $first;
    // Manufacturer families use a numeric base plus a character suffix.
    if(!preg_match('/^([A-Z0-9]+-[0-9]+)[A-Z]+$/D',$first,$m))return '';
    foreach($variants as $v)if(!preg_match('/^'.preg_quote($m[1],'/').'[A-Z]+$/D',$v['model']))return '';
    return $m[1];
}
function lw_gour_match(array $data,array $variants): ?array {
    if(!$variants)return null;
    $rows=$data['items']??$data['Items']??[];
    if(!is_array($rows)||count($rows)>30||(int)($data['count']??count($rows))>count($rows))return null;
    $matches=[];
    foreach($rows as $row){
        $item=$row['item']??$row['Item']??$row;if(!is_array($item))continue;
        $p=lw_product((string)($item['itemUrl']??''));
        if(!$p||strpos($p['id'],'rakuten:gourmandise:')!==0||!preg_match('/^gourmandise:[a-zA-Z0-9_-]+$/D',(string)($item['itemCode']??'')))continue;
        $keyword=lw_gour_keyword($variants);
        $identity=strtoupper((string)($item['itemName']??'').' '.basename(rtrim($p['url'],'/')));
        if(!$keyword||!preg_match('/(?<![A-Z0-9-])'.preg_quote($keyword,'/').'(?![A-Z0-9-])/D',$identity))continue;
        $text=strtoupper(html_entity_decode(strip_tags((string)($item['itemName']??'').' '.(string)($item['itemCaption']??'')),ENT_QUOTES|ENT_HTML5,'UTF-8'));
        $all=true;
        foreach($variants as $v){
            $model=preg_match('/(?<![A-Z0-9-])'.preg_quote($v['model'],'/').'(?![A-Z0-9-])/D',$text);
            $jan=preg_match('/(?<![0-9])'.preg_quote($v['jan'],'/').'(?![0-9])/D',$text);
            if(!$model&&!$jan){$all=false;break;}
        }
        if($all)$matches[$p['id']]=$item;
    }
    return count($matches)===1?array_values($matches)[0]:null;
}
function lw_gour_search(string $keyword,array $settings,string $shopCode='gourmandise'): array {
    if(!in_array($shopCode,['gourmandise','casmin'],true))throw new RuntimeException('対象外の楽天ショップです。');
    $settings=lw_validate_settings($settings);
    $base=sys_get_temp_dir().'/sph-rakuten-'.hash('sha256',__DIR__.'|resolve-v2|'.json_encode($settings));
    $lock=fopen($base.'.lock','c');if(!$lock)throw new RuntimeException('楽天APIを準備できませんでした。');chmod($base.'.lock',0600);
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);throw new RuntimeException('楽天APIを利用中です。少し待って再試行してください。');}
    try{
        $last=(float)stream_get_contents($lock);if(microtime(true)-$last<1)throw new RuntimeException('1秒ほど待って再試行してください。');
        ftruncate($lock,0);rewind($lock);fwrite($lock,(string)microtime(true));fflush($lock);
        $url='https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query(['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'shopCode'=>$shopCode,'keyword'=>$keyword,'availability'=>0,'hits'=>30,'formatVersion'=>2,'elements'=>'count,itemCode,itemName,itemUrl,itemCaption,mediumImageUrls,affiliateUrl']);
        $ch=curl_init($url);$body='';
        curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/',CURLOPT_WRITEFUNCTION=>function($ch,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>500000)return 0;$body.=$bytes;return strlen($bytes);}]);
        $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
        if($ok===false)throw new RuntimeException('楽天APIに接続できませんでした。');
        if($status!==200)throw new RuntimeException(lw_rakuten_error($status,$body));
        $data=json_decode($body,true);if(!is_array($data))throw new RuntimeException('楽天APIの応答を確認できませんでした。');
        return $data;
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}
function lw_gour_enriched(string $html,string $url): array {
    $item=lw_gour_detail($html,$url);$item['retailerStatus']='楽天掲載待ち・要確認';
    $keyword=lw_gour_keyword($item['variants']);$settings=lw_settings();
    if(strpos($item['title'],'公式オンラインショップ限定')!==false){$item['retailerStatus']='メーカー公式限定';return $item;}
    if(!$keyword){$item['retailerStatus']='型番の確認が必要です';return $item;}
    if(!$settings){$item['retailerStatus']='楽天API設定を保存すると公式店を照合できます';return $item;}
    try{
        $match=lw_gour_match(lw_gour_search($keyword,$settings),$item['variants']);if(!$match)return $item;
        $p=lw_product($match['itemUrl']);$item['products']=[$p];$item['productIds']=[$p['id']];$item['needsReview']=false;$item['retailerStatus']='楽天公式店：型番・JANで照合済み';
        $images=[];
        foreach($match['mediumImageUrls']??[] as $row){$image=lw_image_url(is_array($row)?(string)($row['imageUrl']??''):(string)$row);if($image)$images[]=preg_replace('/([?&])_ex=[^&]+/','$1_ex=1200x1200',$image);}
        $item['productInfo']=['title'=>$match['itemName'],'url'=>$p['url'],'productId'=>$p['id'],'itemCode'=>$match['itemCode'],'jan'=>count($item['variants'])===1?$item['variants'][0]['jan']:'','searchKeyword'=>$keyword,'specs'=>[],'contents'=>array_column($item['variants'],'name'),'images'=>array_values(array_unique($images)),'checkedAt'=>gmdate('c')];
        // Reuse the validated link from this response; avoid a second API request within one second.
        try{$item['matchedAffiliate']=lw_affiliate_result(['items'=>[$match]],$match['itemCode'],$settings['affiliateId']);}catch(Throwable $e){}
    }catch(Throwable $e){$item['retailerStatus']='楽天公式店を照合できませんでした：'.$e->getMessage();$item['retryRetailer']=true;}
    return $item;
}

function lw_skater_article_url(string $url): string {
    $p=parse_url($url);
    if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.skater-onlineshop.com'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['query'])||isset($p['fragment']))return '';
    return preg_match('~^/shop/g/g[0-9]{13}/$~D',$p['path']??'')?$url:'';
}
function lw_skater_page_url(int $page): string {
    if($page<1||$page>20)throw new RuntimeException('ページ番号が不正です。');
    return 'https://www.skater-onlineshop.com/shop/c/c30_dT_srd'.($page===1?'':'_p'.$page).'/';
}
function lw_skater_list_url(string $url): bool {
    return $url===lw_skater_page_url(1)||preg_match('~^https://www\.skater-onlineshop\.com/shop/c/c30_dT_srd_p([2-9]|1[0-9]|20)/$~D',$url)===1;
}
function lw_skater_thumbnail_url(string $url): string {
    if(strpos($url,'/img/goods/')===0)$url='https://www.skater-onlineshop.com'.$url;
    $p=parse_url($url);
    if(($p['scheme']??'')!=='https'||($p['host']??'')!=='www.skater-onlineshop.com'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['query'])||isset($p['fragment']))return '';
    return preg_match('~^/img/goods/(?:[SL]|[0-9])/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$~iD',$p['path']??'')?$url:'';
}
function lw_skater_list(string $html,int $page): array {
    $x=lw_doc($html);$boxes=$x->query('//div[contains(concat(" ",normalize-space(@class)," ")," block-category-list--goods ")]');
    if($boxes->length!==1)throw new RuntimeException('スケーターの商品一覧を取得できませんでした。');
    $rows=[];
    foreach($x->query('.//dl[contains(concat(" ",normalize-space(@class)," ")," block-thumbnail-t--goods ")]',$boxes->item(0)) as $row){
        $a=$x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," block-thumbnail-t--goods-name ")]/a',$row)->item(0);
        if(!$a||$a->getAttribute('data-category1')!=='サンリオ(30)')continue;
        $href=$a->getAttribute('href');if(strpos($href,'/shop/g/')===0)$href='https://www.skater-onlineshop.com'.$href;
        $url=lw_skater_article_url($href);if(!$url)continue;
        $name=lw_text($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," variation-name ")]',$row)->item(0));
        $title=$name?trim($name,"（）() \t\n\r\0\x0B"):lw_text($a);if(!$title)continue;
        $thumbnail='';foreach($x->query('.//dt//img',$row) as $img){foreach(['data-src','src'] as $attr){$thumbnail=lw_skater_thumbnail_url($img->getAttribute($attr));if($thumbnail)break;}if($thumbnail)break;}
        preg_match('~/g([0-9]{13})/$~',$url,$m);
        $rows[$url]=['source'=>'スケーター','url'=>$url,'title'=>$title,'date'=>'','jan'=>$m[1],'thumbnail'=>$thumbnail,'productIds'=>[],'products'=>[],'needsReview'=>true];
    }
    $next=null;
    if($page<20)foreach($x->query('.//li[contains(concat(" ",normalize-space(@class)," ")," pager-next ")]/a',$boxes->item(0)) as $a){
        $href=$a->getAttribute('href');if($href==='/shop/c/c30_dT_srd_p'.($page+1).'/'||$href===lw_skater_page_url($page+1))$next=$page+1;
    }
    return ['items'=>array_values($rows),'nextPage'=>$next];
}
function lw_skater_detail(string $html,string $url): array {
    $url=lw_skater_article_url($url);if(!$url)throw new RuntimeException('メーカーの商品URLが不正です。');
    preg_match('~/g([0-9]{13})/$~',$url,$m);$jan=$m[1];$x=lw_doc($html);
    $boxes=$x->query('//div[contains(concat(" ",normalize-space(@class)," ")," block-goods-detail ")]');
    $meta=$x->query('//meta[@property="etm:goods_detail"]');
    if($boxes->length!==1||$meta->length!==1)throw new RuntimeException('メーカーの商品を特定できませんでした。');
    $box=$boxes->item(0);$info=json_decode($meta->item(0)->getAttribute('content'),true);
    $hidden=$x->query('.//input[@id="hidden_goods"]',$box);$code=$x->query('.//*[@id="spec_goods"]',$box);
    $titles=$x->query('.//h1[contains(concat(" ",normalize-space(@class)," ")," block-goods-name--text ")]',$box);
    // Some variant pages have a stale canonical. Use the scoped displayed goods ID plus metadata instead.
    if(!is_array($info)||($info['goods']??'')!==$jan||($info['category_code1']??'')!=='30'||$hidden->length!==1||$hidden->item(0)->getAttribute('value')!==$jan||$code->length!==1||lw_text($code->item(0))!==$jan||$titles->length!==1)throw new RuntimeException('メーカーの商品とJANが一致しません。');
    $title=trim(preg_replace('/\s+/u',' ',(string)($info['variation_name1']??'').' '.(string)($info['variation_name2']??'')));
    if(!$title)$title=lw_text($titles->item(0));
    $facts=['商品名'=>$title];
    $description=$x->query('.//dl[contains(concat(" ",normalize-space(@class)," ")," block-goods-comment1 ")]/dd',$box)->item(0);
    // Keep short, explicit usage facts. Never add prices, availability, inferred dates or material sections.
    if($description){
        $lines=[];foreach($description->childNodes as $child){if($child->nodeType===XML_TEXT_NODE){$text=lw_text($child);if($text)$lines[]=$text;}elseif($child instanceof DOMElement&&$child->tagName==='br')continue;}
        $features=[];foreach($lines as $line){if(preg_match('/品質|素材|樹脂|耐熱|耐冷|柄名|商品サイズ|サイズ/u',$line))break;if(preg_match('/^[■☆※≪]/u',$line))break;if(preg_match_all("/./us",$line)>100)break;$features[]=$line;if(count($features)===2)break;}
        if($features)$facts['特徴']=implode(' ',$features);
    }
    $thumbnail='';foreach($x->query('.//*[contains(concat(" ",normalize-space(@class)," ")," js-goods-img-item ")]//img',$box) as $img){$thumbnail=lw_skater_thumbnail_url($img->getAttribute('src'));if($thumbnail)break;}
    return ['source'=>'スケーター','url'=>$url,'title'=>$title,'date'=>'','jan'=>$jan,'thumbnail'=>$thumbnail,'products'=>[],'productIds'=>[],'needsReview'=>true,'manufacturerImages'=>[],
        'manufacturerInfo'=>['facts'=>$facts,'text'=>'','checkedAt'=>gmdate('c')],
        'productInfo'=>['title'=>$title,'url'=>'','itemCode'=>'','jan'=>$jan,'searchKeyword'=>$jan,'specs'=>[],'contents'=>[],'images'=>[],'checkedAt'=>gmdate('c')]];
}
function lw_skater_match(array $data,string $jan): ?array {
    if(!preg_match('/^[0-9]{13}$/D',$jan))return null;
    $rows=$data['items']??$data['Items']??[];
    if(!is_array($rows)||count($rows)>30||(int)($data['count']??count($rows))>count($rows))return null;
    $matches=[];
    foreach($rows as $row){
        $item=$row['item']??$row['Item']??$row;if(!is_array($item))continue;
        $p=lw_product((string)($item['itemUrl']??''));
        if(!$p||strpos($p['id'],'rakuten:casmin:')!==0||!preg_match('/^casmin:[a-zA-Z0-9_-]+$/D',(string)($item['itemCode']??'')))continue;
        $text=html_entity_decode(strip_tags((string)($item['itemName']??'').' '.(string)($item['itemCaption']??'').' '.basename(rtrim($p['url'],'/'))),ENT_QUOTES|ENT_HTML5,'UTF-8');
        preg_match_all('/(?<![0-9])[0-9]{13}(?![0-9])/',$text,$ids);
        if(array_values(array_unique($ids[0]))!==[$jan])continue;
        $matches[$p['id']]=$item;
    }
    return count($matches)===1?array_values($matches)[0]:null;
}
function lw_skater_enriched(string $html,string $url): array {
    $item=lw_skater_detail($html,$url);$item['retailerStatus']='楽天掲載待ち・要確認';$settings=lw_settings();
    if(!$settings){$item['retailerStatus']='楽天API設定を保存すると公式店を照合できます';return $item;}
    try{
        $match=lw_skater_match(lw_gour_search($item['jan'],$settings,'casmin'),$item['jan']);if(!$match)return $item;
        $p=lw_product($match['itemUrl']);$item['products']=[$p];$item['productIds']=[$p['id']];$item['needsReview']=false;$item['retailerStatus']='楽天公式店 casmin：JANで照合済み';
        $images=[];foreach($match['mediumImageUrls']??[] as $row){$image=lw_image_url(is_array($row)?(string)($row['imageUrl']??''):(string)$row);if($image)$images[]=preg_replace('/([?&])_ex=[^&]+/','$1_ex=1200x1200',$image);}
        $item['productInfo']=array_merge($item['productInfo'],['title'=>$match['itemName'],'url'=>$p['url'],'productId'=>$p['id'],'itemCode'=>$match['itemCode'],'images'=>array_values(array_unique($images))]);
        try{$item['matchedAffiliate']=lw_affiliate_result(['items'=>[$match]],$match['itemCode'],$settings['affiliateId']);}catch(Throwable $e){}
    }catch(Throwable $e){$item['retailerStatus']='楽天公式店を照合できませんでした：'.$e->getMessage();$item['retryRetailer']=true;}
    return $item;
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
    if ($action==='list') {
        $page=$cron?1:filter_var($_GET['page']??1,FILTER_VALIDATE_INT);
        if($page===false||$page<1||$page>20)lw_out(['ok'=>false,'error'=>'ページ番号が不正です。'],400);
        $source=(string)($_GET['source']??'lovely');if(!in_array($source,['lovely','hatakeyama','gourmandise','skater'],true))lw_out(['ok'=>false,'error'=>'情報元が不正です。'],400);
        $url=$source==='skater'?lw_skater_page_url($page):($source==='gourmandise'?lw_gour_page_url($page):($source==='hatakeyama'?lw_hat_page_url($page):lw_page_url($page)));
    }
    elseif ($action==='detail'||$action==='image'||$action==='affiliate') {$url=lw_article_url((string)($_GET['url']??''));if(!$url)lw_out(['ok'=>false,'error'=>'記事URLが不正です。'],400);}
    else lw_out(['ok'=>false,'error'=>'Unknown action'],400);
    // Shared public discovery cache lives outside the web directory. At most one fetch per URL per 15 minutes.
    $cacheRevision=lw_gour_list_url($url)?'3422-thumbnails':'3420-manufacturer';
    $cache=sys_get_temp_dir().'/sph-lw-'.hash('sha256',__DIR__.'|'.$cacheRevision.'|'.$url.'|'.(lw_gour_article_url($url)||lw_skater_article_url($url)?hash('sha256',json_encode(lw_settings())):'')).'.json';
    $lock=fopen($cache.'.lock','c');if(!$lock || !flock($lock,LOCK_EX))throw new RuntimeException('キャッシュを準備できませんでした。');
    $result=!$cron && is_file($cache)&&filemtime($cache)>time()-900?json_decode((string)file_get_contents($cache),true):null;
    if(is_array($result)&&!empty($result['partial'])&&filemtime($cache)<=time()-60)$result=null;
    if(is_array($result)&&!empty($result['item']['retryRetailer'])&&filemtime($cache)<=time()-5)$result=null;
    if (!is_array($result)) {
        $html=lw_fetch($url);
        $result=['ok'=>true,'fetchedAt'=>gmdate('c'),'source'=>lw_skater_article_url($url)||lw_skater_list_url($url)?'スケーター':(lw_gour_article_url($url)||lw_gour_list_url($url)?'グルマンディーズ':(lw_hat_article_url($url)||lw_hat_list_url($url)?'畑山商事':'Lovely Fancy'))];
        if($action==='list'){
            if($source==='hatakeyama')$result=array_merge($result,lw_hat_discover($html,$page));
            elseif($source==='gourmandise')$result=array_merge($result,lw_gour_list($html,$page));
            elseif($source==='skater')$result=array_merge($result,lw_skater_list($html,$page));
            else{$result['items']=lw_list($html,true);$result['nextPage']=lw_next_page($html,$page);}
            $result['page']=$page;
        }else $result['item']=lw_enriched($html,$url);
        $tmp=$cache.'.tmp';file_put_contents($tmp,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));chmod($tmp,0600);rename($tmp,$cache);
    }
    flock($lock,LOCK_UN);fclose($lock);
    if($action==='affiliate'){
        $info=$result['item']['productInfo']??null;
        if(!$info)lw_out(['ok'=>false,'error'=>'楽天の商品情報を確認できませんでした。リンクを手動で入力できます。'],400);
        $settings=lw_settings();if(!$settings)lw_out(['ok'=>false,'error'=>'楽天API設定を保存すると自動入力できます。'],400);
        if(!empty($result['item']['matchedAffiliate']))lw_out(['ok'=>true,'affiliate'=>$result['item']['matchedAffiliate']]);
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
