<?php
declare(strict_types=1);
$url='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/competitor.php';
foreach(['','?action=settings','?action=fetch'] as $query){
 $c=curl_init($url.$query);curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20,CURLOPT_FOLLOWLOCATION=>false]);
 $body=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);$d=json_decode((string)$body,true);
 if($status!==410||($d['disabled']??false)!==true||($d['items']??null)!==[]||($d['apiVersion']??'')!=='3533'){fwrite(STDERR,"Competitor endpoint retirement failed\n");exit(1);}
}
echo "Competitor endpoint retired: HTTP 410; settings and fetch disabled.\n";
