<?php
declare(strict_types=1);
// Remove the withdrawn overseas snapshot using the existing private deployment configuration.
// Never print configuration, keys, headers, response text or exception details.
try {
    $path=$argv[1]??'';
    if(!$path||!is_file($path))throw new RuntimeException('Configuration missing');
    $config=require $path;$key=$config['sync_key']??'';
    if(!is_string($key)||!$key)throw new RuntimeException('Sync key missing');
    $base='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/overseas.php';
    foreach(['clear','list'] as $action){
        $body='';$ch=curl_init($base.'?action='.$action);
        curl_setopt_array($ch,[CURLOPT_POST=>$action==='clear',CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key],CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>30,CURLOPT_WRITEFUNCTION=>static function($ch,$part)use(&$body){if(strlen($body)+strlen($part)>10000)return 0;$body.=$part;return strlen($part);}]);
        $ok=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
        if(!$ok||$status!==200)throw new RuntimeException('Endpoint unavailable');
        $data=json_decode($body,true,512,JSON_THROW_ON_ERROR);
        if(($data['ok']??false)!==true||($data['disabled']??false)!==true||($data['apiVersion']??'')!=='3434'||($data['items']??null)!==[])throw new RuntimeException('Cleanup verification failed');
    }
    echo "Overseas snapshot cleared; collection disabled; live list empty.\n";
}catch(Throwable $e){fwrite(STDERR,"Overseas cleanup failed; private details withheld.\n");exit(1);}
