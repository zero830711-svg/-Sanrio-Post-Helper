<?php
declare(strict_types=1);
// The private configuration is downloaded over FTPS and deleted by the runner.
// Never print configuration, keys, headers, response text, or exception details.
try {
    $path=$argv[1]??'';
    if(!$path||!is_file($path))throw new RuntimeException('Private configuration missing');
    $config=require $path;$key=$config['sync_key']??'';
    if(!is_string($key)||!$key)throw new RuntimeException('Sync key missing');
    $base='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/overseas.php';
    $fetch=static function(string $query)use($base,$key):array{
        $body='';$ch=curl_init($base.'?'.$query);
        curl_setopt_array($ch,[CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key],CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>45,CURLOPT_WRITEFUNCTION=>static function($ch,$part)use(&$body){if(strlen($body)+strlen($part)>3000000)return 0;$body.=$part;return strlen($part);}]);
        $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
        if(!$ok||$status!==200)throw new RuntimeException('Endpoint unavailable');
        $data=json_decode($body,true,512,JSON_THROW_ON_ERROR);
        if(empty($data['ok']))throw new RuntimeException('Invalid snapshot');return $data;
    };
    $data=$fetch('action=refresh');$fresh=$fetch('action=list');
    if(($fresh['apiVersion']??'')!=='3431'||empty($fresh['items']))throw new RuntimeException('Snapshot unavailable');
    $healthy=0;
    foreach($fresh['sourceHealth']??[] as $source){
        if(!empty($source['ok']))$healthy++;
        echo (!empty($source['ok'])?'OK':'RETAINED').': '.$source['label'].' candidates='.(int)($source['count']??0)."\n";
    }
    echo 'Snapshot candidates: '.count($fresh['items'])."\n";
    if($healthy<3)throw new RuntimeException('Multiple sources failed');
    if(in_array('--verify-images',$argv,true)){
        $seen=[];
        foreach($fresh['items'] as $item){
            $id=$item['sourceId'];if(isset($seen[$id]))continue;$seen[$id]=true;
            $ch=curl_init($base.'?'.http_build_query(['action'=>'image','url'=>$item['url'],'index'=>0]));$bytes='';
            curl_setopt_array($ch,[CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key],CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_TIMEOUT=>25,CURLOPT_WRITEFUNCTION=>static function($ch,$part)use(&$bytes){if(strlen($bytes)+strlen($part)>6000000)return 0;$bytes.=$part;return strlen($part);}]);
            $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
            if(!$ok||$status!==200||!@getimagesizefromstring($bytes))throw new RuntimeException('Live image proxy failed');
            $detail=$fetch('action=detail&url='.rawurlencode($item['url']));
            if(($detail['item']['url']??'')!==$item['url']||empty($detail['item']['overseas']))throw new RuntimeException('Live detail mismatch');
            echo 'Image and detail verified: '.$id."\n";
        }
    }
}catch(Throwable $e){fwrite(STDERR,"Overseas collection/verification failed; private details withheld.\n");exit(1);}
