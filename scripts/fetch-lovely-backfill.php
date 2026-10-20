<?php
declare(strict_types=1);
define('SPH_FLOW_TEST',true);
require __DIR__.'/../server/lolipop/product-flow.php';
function lf_keyword(string $title):string{
 $title=preg_replace('/[【\[][^】\]]*[】\]]/u',' ',$title);
 $title=preg_replace('/[^\p{L}\p{N}\sー]/u',' ',$title);
 $parts=preg_split('/\s+/u',trim($title),-1,PREG_SPLIT_NO_EMPTY);
 $parts=array_values(array_filter($parts,static fn($x)=>!in_array(mb_strtolower($x),['x','sanrio','sanrioキャラクターズ'],true)&&(mb_strlen($x)>=2||preg_match('/^\p{Han}$/u',$x))));
 return trim(mb_strcut(implode(' ',array_slice($parts,0,4)),0,120,'UTF-8'));
}
if(defined('LF_BACKFILL_TEST'))return;
if(!in_array($argc,[5,6],true)){fwrite(STDERR,"Usage: fetch-lovely-backfill.php SETTINGS STATE CANDIDATES NEXT_STATE [--discover-only|--verify-only]\n");exit(2);}
try{
 $settings=lw_validate_settings(require $argv[1]);
 $state=json_decode((string)file_get_contents($argv[2]),true,512,JSON_THROW_ON_ERROR);
 $known=array_fill_keys($state['known']??[],true);$existing=array_fill_keys($state['existingCodes']??[],true);
 $pending=$state['pending']??[];$cursor=(int)($state['cursor']??1);$scanned=0;$discovered=0;$unsupported=0;
 $scanBudget=($argv[5]??'')==='--verify-only'||count($pending)>=300?0:100;
 for($n=0;$n<$scanBudget&&!($state['finished']??false);$n++){
  $url=$cursor===1?'https://lovely-fancy.net/':'https://lovely-fancy.net/page/'.$cursor.'/';
  usleep(800000);$curl=curl_init($url);
  curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_USERAGENT=>'SanrioFanCatalogDiscovery/1.0']);
  $body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
  if($status===404){$state['finished']=true;break;}
  if($status!==200||!is_string($body))throw new RuntimeException('Discovery stopped at page '.$cursor.' (HTTP '.$status.'); cursor not advanced.');
  $rows=lw_list($body,true);
  foreach($rows as $row)foreach($row['productIds'] as $id){
   if(isset($known[$id]))continue;$known[$id]=true;$discovered++;
   if(!str_starts_with($id,'rakuten:')){$unsupported++;continue;}
   $code=substr($id,8);
   if(isset($existing[$code]))continue;
   $pending[]=['code'=>$code,'title'=>$row['title'],'source'=>$row['url']];
  }
  $x=lw_doc($body);$next=false;$expected='https://lovely-fancy.net/page/'.($cursor+1).'/';
  foreach($x->query('//a[contains(concat(" ",normalize-space(@class)," ")," next ")] | //link[@rel="next"]') as $a){
   if(in_array($a->getAttribute('href'),[$expected,'/page/'.($cursor+1).'/'],true))$next=true;
  }
  $scanned++;echo 'DISCOVERY page='.$cursor.' matched='.count($rows).' pending='.count($pending)."\n";
  $cursor++;if(!$next){$state['finished']=true;break;}
 }
 if(($argv[5]??'')==='--discover-only'){
  unset($state['existingCodes']);$state['cursor']=$cursor;$state['known']=array_keys($known);$state['pending']=$pending;
  $state['lastDiscovery']=['scannedPages'=>$scanned,'newSourceIds'=>$discovered,'unsupportedAmazon'=>$unsupported];
  $state['lastBatch']=$state['lastDiscovery']+['remaining'=>count($pending),'nextPage'=>$cursor,'phase'=>'discovered'];
  file_put_contents($argv[3],'[]');file_put_contents($argv[4],json_encode($state,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
  echo 'DISCOVERY CHECKPOINT '.json_encode($state['lastBatch'],JSON_UNESCAPED_UNICODE)."\n";exit(0);
 }
 $names=['サンリオ','Sanrio'];foreach(pf_catalog_characters() as [$primary,$aliases])$names=array_merge($names,$aliases);
 $items=[];$processed=0;$missing=0;$already=0;$remaining=[];
 foreach($pending as $entry){
  $code=$entry['code'];
  if(isset($existing[$code])){$already++;continue;}
  if($processed>=300){$remaining[]=$entry;continue;}
  [$shop,$urlItem]=explode(':',$code,2);
  $expected='https://item.rakuten.co.jp/'.$shop.'/'.$urlItem.'/';$keyword=lf_keyword((string)($entry['title']??$urlItem));
  if($keyword===''){$processed++;$missing++;continue;}
  $params=['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'shopCode'=>$shop,'keyword'=>$keyword,'availability'=>1,'imageFlag'=>1,'hits'=>30,'formatVersion'=>2];
  $data=null;
  for($attempt=0;$attempt<3;$attempt++){
   usleep($attempt?2000000*$attempt:1200000);
   $curl=curl_init('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query($params,'','&',PHP_QUERY_RFC3986));
   curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/']);
   $body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
   if($status===200&&is_string($body)){$data=json_decode($body,true);break;}
   if(!in_array($status,[0,429,500,502,503,504],true))break;
  }
  if(!is_array($data)&&$status===404)$data=['items'=>[]];
  if(!is_array($data)&&$status===400){
   $problem=json_decode(is_string($body)?$body:'',true);$description=(string)($problem['error_description']??$problem['message']??'');
   if(preg_match('/keyword|shop.?code/i',$description)&&!preg_match('/application|affiliate|access.?key/i',$description))$data=['items'=>[]];
  }
  if(!is_array($data))throw new RuntimeException('Rakuten verification stopped (HTTP '.$status.'): '.lw_rakuten_error($status,is_string($body)?$body:''));
  $data=lw_rakuten_search_data($data);$matched=null;
  foreach($data['items']??[] as $row){
   $product=lw_product((string)($row['itemUrl']??''));
   if(!$product||$product['url']!==$expected||!($row['availability']??0))continue;
   $matched=pf_catalog_candidate($row,$names);if($matched){$matched['discoveredFrom']=$entry['source'];break;}
  }
  $processed++;if($matched)$items[]=$matched;else $missing++;
  if($processed%25===0)echo 'VERIFIED queries='.$processed.' matched='.count($items).' skipped='.$missing."\n";
 }
 unset($state['existingCodes']);$state['cursor']=$cursor;$state['known']=array_keys($known);$state['pending']=$remaining;
 $state['lastBatch']=($state['lastDiscovery']??['scannedPages'=>$scanned,'newSourceIds'=>$discovered,'unsupportedAmazon'=>$unsupported])+['apiQueries'=>$processed,'apiMatched'=>count($items),'unavailableOrUnmatched'=>$missing,'alreadyCatalogued'=>$already,'remaining'=>count($remaining),'nextPage'=>$cursor];
 file_put_contents($argv[3],json_encode($items,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
 file_put_contents($argv[4],json_encode($state,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
 echo 'BACKFILL '.json_encode($state['lastBatch'],JSON_UNESCAPED_UNICODE)."\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
