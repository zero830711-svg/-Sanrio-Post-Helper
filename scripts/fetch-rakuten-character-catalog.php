<?php
declare(strict_types=1);
if ($argc !== 4) {fwrite(STDERR,"Usage: php fetch-rakuten-character-catalog.php CONFIG CHARACTER OUTPUT\n");exit(2);}
$characters=['cinnamoroll','kuromi','mymelody','pompompurin','pochacco','hellokitty','hangyodon','little-twin-stars','kirimi-chan','osaru-no-monkichi','gaopoweru','corocorokuririn','goropikadon','jewelpet','sugar-bunnies','charmmy-kitty','chococat','dear-daniel','hanamaru-obake','bonbonribbon','marshmallow-fuwafuwa-nyanko','marumofubiyori','marroncream','minna-no-taabou','little-forest-fellow','ruroromannic','tuxedo-sam','ahiru-no-pekkle','bad-badtz-maru','cogimyun','usahana','kerokerokeroppi','gudetama','wish-me-mell','my-sweet-piano','jochum'];
$character=$argv[2];if(!in_array($character,$characters,true)){fwrite(STDERR,"Unsupported character catalog.\n");exit(2);}
$config=require $argv[1];$key=is_array($config)?(string)($config['sync_key']??''):'';
if($key===''){fwrite(STDERR,"Product flow sync key is not configured.\n");exit(1);}
$url='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/product-flow.php?action=catalog-search';$items=[];$seen=[];$queries=0;
for($batch=0;$batch<4;$batch++){
 $data=null;
 for($attempt=0;$attempt<3;$attempt++){
  if($attempt)usleep(2000000*$attempt);
  $curl=curl_init($url);
  curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode(['character'=>$character,'expand'=>true,'batch'=>$batch],JSON_THROW_ON_ERROR),CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>120,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$key,'Origin: https://zero830711-svg.github.io','Content-Type: application/json','Accept: application/json']]);
  $response=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
  if(is_string($response)&&$status===200){$data=json_decode($response,true);break;}
  if(!in_array($status,[0,409,429,500,502,503,504],true))break;
 }
 if(!is_array($data)||empty($data['ok'])||($data['character']??'')!==$character||($data['expansionVersion']??0)!==1||($data['batch']??-1)!==$batch||!is_array($data['catalogItems']??null)){
  fwrite(STDERR,"Expanded catalog search failed for ".$character." batch ".$batch." (HTTP ".$status."). Existing page unchanged.\n");exit(1);
 }
 $queries+=(int)($data['queriesUsed']??0);
 foreach($data['catalogItems'] as $item){$code=(string)($item['code']??'');if($code!==''&&!isset($seen[$code])){$seen[$code]=true;$items[]=$item;}}
 if(empty($data['hasMore']))break;
}
if(file_put_contents($argv[3],json_encode($items,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),LOCK_EX)===false){fwrite(STDERR,"Could not save private catalog candidates.\n");exit(1);}
chmod($argv[3],0600);fwrite(STDOUT,"Fetched ".count($items)." unique private candidates for ".$character." using ".$queries." expanded queries. Credentials were not printed.\n");
