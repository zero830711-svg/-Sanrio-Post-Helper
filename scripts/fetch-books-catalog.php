<?php
declare(strict_types=1);
// Private credentials are read from the existing server configuration, never printed.
if ($argc!==4) {fwrite(STDERR,"Usage: fetch-books-catalog.php SETTINGS QUERIES OUTPUT\n");exit(2);}
try {
 $s=require $argv[1];
 foreach(['applicationId','accessKey','affiliateId'] as $k)if(empty($s[$k]))throw new RuntimeException('Missing Rakuten setting: '.$k);
 $queries=json_decode(file_get_contents($argv[2]),true,512,JSON_THROW_ON_ERROR);
 $rows=[];$requests=0;
 foreach($queries as $keyword)foreach(['001','007'] as $genre){
  $pages=$keyword==='サンリオ'?3:1;
  for($page=1;$page<=$pages;$page++){
   $params=['applicationId'=>$s['applicationId'],'affiliateId'=>$s['affiliateId'],'keyword'=>$keyword,'booksGenreId'=>$genre,'hits'=>30,'page'=>$page,'sort'=>'-releaseDate','outOfStockFlag'=>0,'formatVersion'=>2];
   $data=null;$status=0;
   for($attempt=0;$attempt<3;$attempt++){
    usleep($attempt?3000000:1300000);
    $curl=curl_init('https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404?'.http_build_query($params,'','&',PHP_QUERY_RFC3986));
    curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['accessKey: '.$s['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/']);
    $body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);$requests++;
    if($status===404){$data=['Items'=>[]];break;}
    if($status===200){$data=json_decode((string)$body,true,512,JSON_THROW_ON_ERROR);break;}
    if(!in_array($status,[0,429,500,502,503,504],true))break;
   }
   if(!is_array($data)||isset($data['error']))throw new RuntimeException('Books API failed HTTP '.$status.'; no WordPress writes performed.');
   $items=$data['Items']??$data['items']??null;
   if(!is_array($items))throw new RuntimeException('Unexpected Books response schema');
   foreach($items as $row){$row=$row['Item']??$row['item']??$row;$rows[]=$row;}
   if($page>=($data['pageCount']??1)||count($items)<30)break;
  }
 }
 file_put_contents($argv[3],json_encode($rows,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
 echo 'BOOKS FETCH '.json_encode(['requests'=>$requests,'rows'=>count($rows)])."\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
