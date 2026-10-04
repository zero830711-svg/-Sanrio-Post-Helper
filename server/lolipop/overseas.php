<?php
declare(strict_types=1);
// Fixed public sources only. Discovery does not imply exclusivity or Japanese availability.
function ov_sources(): array {
    return [
        'toytron'=>['source'=>'Toytron公式（韓国）','region'=>'KR','url'=>'https://www.toytronmall.co.kr/goods/goods_list.php?cateCd=034005'],
        'tarts'=>['source'=>'T-ARTS KOREA公式','region'=>'KR','url'=>'https://www.tarts-korea.co.kr/sub/sub04_01.php?cat_no=40'],
        'hongkong'=>['source'=>'香港Sanrio Gift Gate公式','region'=>'HK','url'=>'https://www.sanriogiftgate.com.hk/en/'],
        'us'=>['source'=>'米国サンリオ公式','region'=>'US','url'=>'https://www.sanrio.com/collections/new/products.json?limit=50']
    ];
}
function ov_text(string $value): string {
    return mb_substr(trim(preg_replace('/\s+/u',' ',html_entity_decode($value,ENT_QUOTES|ENT_HTML5,'UTF-8'))??''),0,400);
}
function ov_doc(string $html): DOMXPath {
    $doc=new DOMDocument();$old=libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">'.$html,LIBXML_NONET);libxml_clear_errors();libxml_use_internal_errors($old);
    return new DOMXPath($doc);
}
function ov_product_url(string $url,string $source): string {
    $p=parse_url($url);if(!$p||($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['fragment']))return '';
    $host=$p['host']??'';$path=$p['path']??'';$query=$p['query']??'';
    if($source==='toytron'&&$host==='www.toytronmall.co.kr'&&$path==='/goods/goods_view.php'&&preg_match('/^goodsNo=[0-9]{5,15}$/D',$query))return $url;
    if($source==='tarts'&&$host==='www.tarts-korea.co.kr'&&$path==='/sub/sub04_01.php'&&preg_match('/^cat_no=40&mode=view&idx=[0-9]{1,8}$/D',$query))return $url;
    if($source==='us'&&$host==='www.sanrio.com'&&preg_match('~^/products/[a-z0-9-]+$~D',$path)&&$query==='')return $url;
    if($source==='hongkong'&&$host==='www.sanriogiftgate.com.hk'&&preg_match('~^/en/products/[a-z0-9-]+$~D',$path)&&$query==='')return $url;
    return '';
}
function ov_image_url(string $url): string {
    if(str_starts_with($url,'//'))$url='https:'.$url;
    $p=parse_url($url);if(!$p||($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['fragment']))return '';
    $host=$p['host']??'';$path=$p['path']??'';
    $allowed=($host==='www.tarts-korea.co.kr'&&preg_match('~^/uploaded/product/[0-9]+/[a-z0-9_.-]+\.(jpg|png|webp)$~iD',$path))
      ||($host==='godomall.speedycdn.net'&&preg_match('~^/3389a8ce9a60e19be9e9c1359129582d/goods/[0-9]+/image/(main|list)/[a-z0-9_.-]+\.(jpg|png|webp)$~iD',$path))
      ||($host==='cdn-pro-web-250-115.cdn-nhncommerce.com'&&preg_match('~^/toytron_godomall_com/data/goods/[0-9/]+/[a-z0-9_.-]+\.(jpg|png|webp)$~iD',$path))
      ||($host==='shoplineimg.com'&&preg_match('~^/5cc813ba527c4b0001a31e32/[a-z0-9]+/[a-z0-9_.-]+\.(png|jpg|webp)$~iD',$path))
      ||($host==='cdn.shopify.com'&&preg_match('~^/s/files/1/0416/8083/0620/(?:files|products)/[a-z0-9_.%+ -]+\.(jpg|jpeg|png|webp)$~iD',$path));
    return $allowed?$url:'';
}
function ov_item(string $source,string $url,string $title,string $image='',string $published=''): ?array {
    $meta=ov_sources()[$source]??null;$url=ov_product_url($url,$source);$title=ov_text($title);
    if(!$meta||!$url||!$title)return null;
    return ['source'=>$meta['source'],'sourceId'=>$source,'sourceType'=>'official','overseas'=>true,'region'=>$meta['region'],'url'=>$url,'title'=>$title,
      'date'=>$published,'publishedAt'=>$published?:null,'thumbnail'=>ov_image_url($image),'productIds'=>[],'products'=>[],'needsReview'=>true];
}
function ov_parse(string $source,string $body): array {
    $rows=[];$add=static function(?array $item)use(&$rows):void{if($item)$rows[$item['url']]=$item;};
    if($source==='us'){
        $data=json_decode($body,true,512,JSON_THROW_ON_ERROR);if(!isset($data['products'])||!is_array($data['products']))throw new RuntimeException('商品一覧の形式を確認できません。');if(!$data['products'])throw new RuntimeException('商品一覧が空です。');
        foreach(array_slice($data['products'],0,50) as $p){
            $add(ov_item($source,'https://www.sanrio.com/products/'.($p['handle']??''),(string)($p['title']??''),(string)($p['images'][0]['src']??'')));
        }
    }else{
        $x=ov_doc($body);
        if($source==='toytron'){
            foreach($x->query('//div[contains(concat(" ",normalize-space(@class)," ")," item_cont ")]') as $card){
                $a=$x->query('.//strong[contains(concat(" ",normalize-space(@class)," ")," item_name ")]/parent::a',$card)->item(0);
                if(!$a)continue;$title=ov_text($a->textContent);
                if(!preg_match('/산리오|마이멜로디|쿠로미|시나모|헬로키티|폼폼푸린|한교동/u',$title))continue;
                $href=$a->getAttribute('href');$url='https://www.toytronmall.co.kr/goods/'.basename($href);
                $img=$x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," item_photo_box ")]//img',$card)->item(0);
                $add(ov_item($source,$url,$title,$img?$img->getAttribute('src'):''));
            }
        }elseif($source==='tarts'){
            foreach($x->query('//li[.//div[@class="thumb"] and .//div[@class="title"]]') as $card){
                $a=$x->query('.//div[@class="title"]/a',$card)->item(0);$img=$x->query('.//div[@class="thumb"]//img',$card)->item(0);if(!$a)continue;
                $title=ov_text($a->textContent);$href=$a->getAttribute('href');
                $url=str_starts_with($href,'/sub/')?'https://www.tarts-korea.co.kr'.$href:$href;
                $image=$img?$img->getAttribute('src'):'';if(str_starts_with($image,'/uploaded/'))$image='https://www.tarts-korea.co.kr'.$image;
                $add(ov_item($source,$url,$title,$image));
            }
        }elseif($source==='hongkong'){
            foreach($x->query('//product-item/a[contains(concat(" ",normalize-space(@class)," ")," Product-item ")]') as $a){
                $node=$x->query('.//div[contains(concat(" ",normalize-space(@class)," ")," title ")]',$a)->item(0);
                $image='';foreach($x->query('.//*[@style]',$a) as $n){if(preg_match('~background-image:url\((https://shoplineimg\.com/[^)]+)\)~',$n->getAttribute('style'),$m)){$image=$m[1];break;}}
                $add(ov_item($source,$a->getAttribute('href'),$node?$node->textContent:'',$image));
            }
        }
        if(!$rows)throw new RuntimeException('商品一覧の構造を確認できません。');
    }
    return array_slice(array_values($rows),0,50);
}
function ov_validate_batches(array $input): array {
    $batches=[];
    foreach(ov_sources() as $id=>$meta){
        $batch=$input[$id]??[];$rows=[];
        if(($batch['ok']??false)!==true||!is_array($batch['items']??null)||!count($batch['items'])||count($batch['items'])>50){$batches[$id]=['ok'=>false];continue;}
        foreach($batch['items'] as $item){
            if(!is_array($item)||!is_string($item['title']??null)||!is_string($item['url']??null)||!is_string($item['thumbnail']??null))throw new RuntimeException('Invalid candidate');
            $row=ov_item($id,$item['url'],$item['title'],$item['thumbnail']);
            if(!$row||!$row['thumbnail'])throw new RuntimeException('Invalid source URL or image');$rows[$row['url']]=$row;
        }
        $batches[$id]=['ok'=>true,'items'=>array_values($rows)];
    }
    return $batches;
}
function ov_merge(array $previous,array $batches,string $now): array {
    $saved=$previous['sources']??[];
    foreach(ov_sources() as $id=>$meta){
        $old=$saved[$id]??[];$batch=$batches[$id]??['ok'=>false];
        if(empty($batch['ok'])){$saved[$id]=$old+['items'=>[],'seen'=>[],'initialized'=>false];$saved[$id]['health']=['label'=>$meta['source'],'ok'=>false,'attemptedAt'=>$now,'lastSuccessAt'=>$old['health']['lastSuccessAt']??null,'error'=>'取得失敗：前回の候補を保持しています。'];continue;}
        $seen=$old['seen']??[];$items=[];
        foreach($batch['items'] as $item){
            $url=$item['url'];if(!isset($seen[$url]))$seen[$url]=['at'=>$now,'baseline'=>empty($old['initialized'])];
            $item['firstSeenAt']=$seen[$url]['at'];$item['baseline']=$seen[$url]['baseline'];$items[]=$item;
        }
        $byUrl=[];foreach($items as $item)$byUrl[$item['url']]=$item;
        foreach($old['items']??[] as $item)if(!isset($byUrl[$item['url']])&&strtotime($item['firstSeenAt'])>=strtotime($now)-180*86400)$byUrl[$item['url']]=$item;
        $items=array_values($byUrl);usort($items,static fn($a,$b)=>strcmp($b['firstSeenAt'],$a['firstSeenAt']));$items=array_slice($items,0,300);
        // Retain discovery identities across list reorder/removal/reappearance.
        $retained=array_fill_keys(array_column($items,'url'),true);
        $seen=array_filter($seen,static fn($v,$url)=>isset($retained[$url])||strtotime($v['at'])>=strtotime($now)-180*86400,ARRAY_FILTER_USE_BOTH);
        $saved[$id]=['initialized'=>true,'seen'=>array_slice($seen,-2000,null,true),'items'=>$items,'health'=>['label'=>$meta['source'],'ok'=>true,'count'=>count($items),'attemptedAt'=>$now,'lastSuccessAt'=>$now]];
    }
    return ['sources'=>$saved,'lastAttemptAt'=>$now];
}
function ov_payload(array $snapshot,string $now): array {
    $items=[];$health=[];
    foreach($snapshot['sources']??[] as $source){
        $health[]=$source['health'];foreach($source['items']??[] as $item){$item['isNew']=empty($item['baseline'])&&strtotime($item['firstSeenAt'])>strtotime($now)-86400;$items[]=$item;}
    }
    usort($items,static fn($a,$b)=>strcmp($b['firstSeenAt'],$a['firstSeenAt'])?:strcmp($a['url'],$b['url']));
    return ['ok'=>true,'apiVersion'=>'3432','items'=>$items,'sourceHealth'=>$health,'fetchedAt'=>$snapshot['lastAttemptAt']??null,'nextPage'=>null,'cached'=>true];
}
function ov_collect(): array {
    $multi=curl_multi_init();$handles=[];$bodies=[];$batches=[];
    foreach(ov_sources() as $id=>$source){
        $bodies[$id]='';$ch=curl_init($source['url']);
        curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>12,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_USERAGENT=>'SanrioPostHelper/3431 (personal public discovery)',CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$bodies,$id){if(strlen($bodies[$id])+strlen($chunk)>2000000)return 0;$bodies[$id].=$chunk;return strlen($chunk);}]);
        $handles[$id]=$ch;curl_multi_add_handle($multi,$ch);
    }
    do{$code=curl_multi_exec($multi,$running);if($running)curl_multi_select($multi,0.2);}while($running&&$code===CURLM_OK);
    foreach($handles as $id=>$ch){
        try{if(curl_errno($ch)||curl_getinfo($ch,CURLINFO_HTTP_CODE)!==200)throw new RuntimeException('Source unavailable');$batches[$id]=['ok'=>true,'items'=>ov_parse($id,$bodies[$id])];}
        catch(Throwable $e){$batches[$id]=['ok'=>false];}
        curl_multi_remove_handle($multi,$ch);curl_close($ch);
    }
    curl_multi_close($multi);return $batches;
}
if(defined('OV_TEST_ONLY'))return;
$config=require __DIR__.'/config.php';$origin=$_SERVER['HTTP_ORIGIN']??'';
if($origin&&in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');
function ov_out(array $data,int $status=200): void {http_response_code($status);echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);exit;}
if(($_SERVER['REQUEST_METHOD']??'')==='OPTIONS'){http_response_code(204);exit;}
$token='';if(preg_match('/^Bearer\s+(.+)$/i',$_SERVER['HTTP_AUTHORIZATION']??'',$m))$token=trim($m[1]);
if(empty($config['sync_key'])||!$token||!hash_equals($config['sync_key'],$token))ov_out(['ok'=>false,'error'=>'Unauthorized'],401);
// Overseas discovery has been withdrawn. Never serve, refresh, ingest or proxy old candidates.
$method=$_SERVER['REQUEST_METHOD']??'';$action=$_GET['action']??'list';
if($method==='POST'&&$action==='clear'){
    try{
        $pdo=new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
        $exists=$pdo->query("SHOW TABLES LIKE 'sanrio_overseas_snapshot'")->fetchColumn();
        if($exists){
            if(!(int)$pdo->query("SELECT GET_LOCK('sph_overseas_collect',10)")->fetchColumn())ov_out(['ok'=>false,'error'=>'Cleanup busy'],503);
            try{$pdo->exec('DELETE FROM sanrio_overseas_snapshot WHERE id=1');}finally{$pdo->query("SELECT RELEASE_LOCK('sph_overseas_collect')");}
        }
    }catch(Throwable $e){error_log('Overseas cleanup: '.get_class($e));ov_out(['ok'=>false,'error'=>'Cleanup failed'],502);}
}elseif($method!=='GET')ov_out(['ok'=>false,'error'=>'Overseas discovery disabled'],410);
if($method==='GET'&&!in_array($action,['list','refresh'],true))ov_out(['ok'=>false,'error'=>'Overseas discovery disabled'],410);
ov_out(['ok'=>true,'apiVersion'=>'3434','disabled'=>true,'items'=>[],'sourceHealth'=>[],'fetchedAt'=>null,'nextPage'=>null,'cached'=>false]);
