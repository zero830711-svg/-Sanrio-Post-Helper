<?php
declare(strict_types=1);
define('SPH_NEWS_TEST',true);
define('LW_TEST_ONLY',true);
require_once __DIR__.'/news.php';
require_once __DIR__.'/lovely-watch.php';

function pf_dir():string{
 $dir=sys_get_temp_dir().'/sph-product-flow-'.hash('sha256',__DIR__);
 if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new RuntimeException('下書きの保存先を準備できません。');
 chmod($dir,0700);return $dir;
}
function pf_read(string $name):array{
 $path=pf_dir().'/'.$name.'.json';if(!is_file($path))return [];
 $d=json_decode((string)file_get_contents($path),true);return is_array($d)?$d:[];
}
function pf_write(string $name,array $data):void{
 $path=pf_dir().'/'.$name.'.json';$tmp=tempnam(pf_dir(),'private-');
 if($tmp===false)throw new RuntimeException('下書きを保存できません。');
 try{chmod($tmp,0600);if(file_put_contents($tmp,json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),LOCK_EX)===false||!rename($tmp,$path))throw new RuntimeException('下書きを保存できません。');}finally{if(is_file($tmp))unlink($tmp);}
}
function pf_normal(string $s):string{return mb_strtolower(mb_convert_kana($s,'as','UTF-8'),'UTF-8');}
function pf_jan(string $s):bool{
 if(!preg_match('/^[0-9]{13}$/D',$s))return false;
 $sum=0;for($i=0;$i<12;$i++)$sum+=(int)$s[$i]*($i%2?3:1);
 return (10-$sum%10)%10===(int)$s[12];
}
function pf_identity(array $item,string $body=''):array{
 $source=pf_normal((string)$item['title']."\n".implode("\n",$item['paragraphs']??[]));
 preg_match_all('/(?<![0-9])[0-9]{13}(?![0-9])/',$source,$m);
 $jans=array_values(array_unique(array_filter($m[0],'pf_jan')));
 preg_match_all('/(?:型番|品番|商品番号|model)[\s：:#]*([a-z]{1,8}[-_][a-z0-9-]{2,24})(?![a-z0-9-])/iu',$source,$models);
 $codes=array_values(array_unique($models[1]));$jan=count($jans)===1?$jans[0]:'';
 $model=!$jan&&count($codes)===1?$codes[0]:'';
 $headline=explode("\n",$body?:$item['title'])[0];
 $headline=preg_replace('/[^\p{L}\p{N}\sー・-]/u',' ',$headline);
 $headline=preg_replace('/(?:新作|新商品|登場|発売|速報|お知らせ|コラボ速報)[！!]?/u','',$headline);
 $keyword=$jan?:($model?:trim(preg_replace('/\s+/u',' ',mb_substr($headline,0,64))));
 return ['jan'=>$jan,'model'=>$model,'keyword'=>$keyword,'ambiguous'=>count($jans)>1||count($codes)>1];
}
function pf_contains_code(string $text,string $code):bool{
 return (bool)preg_match('/(?<![a-z0-9])'.preg_quote(pf_normal($code),'/').'(?![a-z0-9])/u',pf_normal($text));
}
function pf_fallback_keyword(array $item,string $body):string{
 $text=$body."\n".$item['title']."\n".implode("\n",$item['paragraphs']??[]);
 $character='';$kind='';
 if(preg_match('/ハローキティ|マイメロディ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|バッドばつ丸|あひるのペックル|クロミ|キティ|けろけろけろっぴ/u',$text,$m))$character=$m[0];
 if(preg_match('/ぬいぐるみ|マスコット|キーホルダー|コレクトブック|フィギュア|ペンケース|ポーチ|バッグ|ケース|タオル|ステッカー|チャーム|ボールペン|食器|カップ/u',$text,$m))$kind=$m[0];
 return $character&&$kind?$character.' '.$kind:'';
}
function pf_exact(array $row,array $identity,string $sourceTitle):bool{
 $code=$identity['jan']?:$identity['model'];if(!$code||!empty($identity['ambiguous']))return false;
 $title=(string)($row['itemName']??'');
 // A single-item JAN must not promote mixed bundles, used listings, or accessories.
 foreach(['セット','BOX','ボックス','コンプリート','中古','互換','保護フィルム','対応ケース'] as $word)
  if(mb_stripos($title,$word)!==false&&mb_stripos($sourceTitle,$word)===false)return false;
 return pf_contains_code($title."\n".strip_tags((string)($row['itemCaption']??'')),$code);
}
function pf_affiliate(string $destination,string $affiliateId):string{
 if(!preg_match('/^[a-fA-F0-9]{8}(?:\.[a-fA-F0-9]{8}){3}$/D',$affiliateId))return '';
 $p=parse_url($destination);
 if(($p['scheme']??'')!=='https'||($p['host']??'')!=='search.rakuten.co.jp'||!preg_match('~^/search/mall/[^/]+/$~D',$p['path']??'')||isset($p['user'])||isset($p['pass'])||isset($p['port'])||isset($p['fragment'])||isset($p['query']))return '';
 return 'https://hb.afl.rakuten.co.jp/hgc/'.$affiliateId.'/?'.http_build_query(['pc'=>$destination,'m'=>$destination],'','&',PHP_QUERY_RFC3986);
}
function pf_search_url(string $keyword):string{return 'https://search.rakuten.co.jp/search/mall/'.rawurlencode($keyword).'/';}
function pf_safe_affiliate(string $url):bool{
 $p=parse_url($url);return ($p['scheme']??'')==='https'&&($p['host']??'')==='hb.afl.rakuten.co.jp'&&!isset($p['user'])&&!isset($p['pass'])&&!isset($p['port'])&&preg_match('~^/hgc/[a-zA-Z0-9._-]{8,128}/?$~D',$p['path']??'');
}
function pf_search(string $keyword,array $settings,int $page=1):array{
 if(mb_strlen($keyword)<2||mb_strlen($keyword)>80)throw new RuntimeException('楽天の検索語を2〜80文字で指定してください。');
 $settings=lw_validate_settings($settings);
 $cache='search-'.hash('sha256',$keyword.'|'.$page.json_encode($settings));$saved=pf_read($cache);
 if(($saved['at']??0)>time()-1800)return $saved['data'];
 $lock=fopen(pf_dir().'/rakuten.lock','c+');if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))throw new RuntimeException('楽天APIを利用中です。少し待ってください。');
 try{
  chmod(pf_dir().'/rakuten.lock',0600);$last=(float)stream_get_contents($lock);
  if(microtime(true)-$last<1)throw new RuntimeException('楽天の検索間隔をあけてください。');
  rewind($lock);ftruncate($lock,0);fwrite($lock,(string)microtime(true));fflush($lock);
  $url='https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query(['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'keyword'=>$keyword,'availability'=>1,'hits'=>30,'page'=>$page,'formatVersion'=>2,'elements'=>'count,itemCode,itemName,itemUrl,itemCaption,itemPrice,mediumImageUrls,affiliateUrl,shopCode,shopName']);
  $c=curl_init($url);$body='';
  curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/',CURLOPT_WRITEFUNCTION=>static function($c,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>1000000)return 0;$body.=$bytes;return strlen($bytes);}]);
  $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
  if($ok===false)throw new RuntimeException('楽天APIの通信が完了しませんでした。');
  if($status!==200)throw new RuntimeException(lw_rakuten_error($status,$body));
  $data=json_decode($body,true);if(!is_array($data))throw new RuntimeException('楽天APIの応答を確認できませんでした。');
  $data=lw_rakuten_search_data($data);pf_write($cache,['at'=>time(),'data'=>$data]);return $data;
 }finally{flock($lock,LOCK_UN);fclose($lock);}
}
function pf_match(array $data,array $identity,string $sourceTitle,array $settings):array{
 $rows=[];$exact=[];
 foreach(array_slice($data['items']??[],0,30) as $r){
  if(!is_array($r))continue;$p=lw_product((string)($r['itemUrl']??''));
  if(!$p||$p['store']!=='楽天'||($r['itemCode']??'')!==substr($p['id'],8))continue;
  $affiliate='';try{$affiliate=lw_affiliate_result(['items'=>[$r]],$r['itemCode'],$settings['affiliateId'])['url'];}catch(Throwable $e){}
  $images=$r['mediumImageUrls']??[];$image=$images?lw_image_url((string)($images[0]['imageUrl']??'')):'';
  $row=['code'=>$r['itemCode'],'title'=>mb_substr((string)$r['itemName'],0,500),'url'=>$p['url'],'affiliate'=>$affiliate,'image'=>$image,'shop'=>(string)($r['shopName']??explode(':',$r['itemCode'])[0]),'exact'=>pf_exact($r,$identity,$sourceTitle)];
  $rows[]=$row;if($row['exact']&&$affiliate)$exact[]=$row;
 }
 $shops=array_unique(array_map(static fn($r)=>explode(':',$r['code'])[0],$exact));
 $destination=pf_search_url($identity['jan']?:($identity['model']?:$identity['keyword']));$search=$exact?pf_affiliate($destination,$settings['affiliateId']):'';
 $link=count($shops)>=2?$search:($exact[0]['affiliate']??'');
 return ['candidates'=>$rows,'shopCount'=>count($shops),'searchUrl'=>$destination,'searchAffiliate'=>$search,'itemAffiliate'=>$exact[0]['affiliate']??'','link'=>$link,'linkMode'=>count($shops)>=2?'search':($link?'item':'none'),'matchStatus'=>$link?'JAN・型番で照合済み':'商品一致の確認待ち','checkedAt'=>gmdate('c')];
}
function pf_eligible(array $item,int $now):bool{
 $date=strtotime((string)($item['date']??''));if(!$date||$date<$now-30*86400||$date>$now+86400)return false;
 if(!empty($item['prize'])||!empty($item['tipsOnly']))return false;
 return (bool)preg_match('/商品|グッズ|ぬいぐるみ|マスコット|ポーチ|バッグ|ケース|キーホルダー|フィギュア|コレクション|タオル|ステッカー|文具|発売|新作|collection|plush|goods|키링|인형|新品|公仔/iu',(string)$item['title']);
}
function pf_resolve(array $item,string $body,array &$identity,array $settings):array{
 $data=pf_search($identity['keyword'],$settings);$fallback=pf_fallback_keyword($item,$body);
 if(empty($data['items'])&&!$identity['jan']&&!$identity['model']&&$fallback&&$fallback!==$identity['keyword']){
  usleep(1100000);$identity['keyword']=$fallback;$data=pf_search($fallback,$settings);
 }
 return pf_match($data,$identity,$item['title'],$settings);
}
function pf_stock_queries():array{
 return ['サンリオ','ハローキティ グッズ','マイメロディ グッズ','クロミ グッズ','シナモロール グッズ','ポムポムプリン グッズ','ポチャッコ グッズ','ハンギョドン グッズ','リトルツインスターズ グッズ','けろけろけろっぴ グッズ','タキシードサム グッズ','バッドばつ丸 グッズ','あひるのペックル グッズ','ぐでたま グッズ','こぎみゅん グッズ','ウィッシュミーメル グッズ','ぼんぼんりぼん グッズ','チョコキャット グッズ','チャーミーキティ グッズ','マロンクリーム グッズ','ミュークルドリーミー グッズ','まるもふびより グッズ','みんなのたあ坊 グッズ','おさるのもんきち グッズ','ウサハナ グッズ'];
}
function pf_stock_used(array $state,string $code):bool{
 if(isset($state['attempted']['rakuten-'.$code]))return true;
 foreach($state['entries']??[] as $e)if(($e['item']['rakutenCode']??'')===$code)return true;
 return false;
}
function pf_stock_related(array $r):bool{
 return (bool)preg_match('/サンリオ|Sanrio|ハローキティ|マイメロディ|クロミ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|リトルツインスターズ|キキララ|けろけろけろっぴ|タキシードサム|バッドばつ丸|あひるのペックル|ぐでたま|こぎみゅん|ウィッシュミーメル|ぼんぼんりぼん|チョコキャット|チャーミーキティ|マロンクリーム|ミュークルドリーミー|まるもふびより|みんなのたあ坊|おさるのもんきち|ウサハナ/iu',(string)($r['itemName']??'')."\n".strip_tags((string)($r['itemCaption']??'')));
}
function pf_stock_rows(array $data,array $settings,array $state):array{
 $rows=[];
 foreach(array_slice($data['items']??[],0,30) as $r){
  if(!is_array($r)||!pf_stock_related($r))continue;$p=lw_product((string)($r['itemUrl']??''));
  if(!$p||$p['store']!=='楽天'||($r['itemCode']??'')!==substr($p['id'],8))continue;
  $code=(string)$r['itemCode'];if(pf_stock_used($state,$code))continue;
  $affiliate='';try{$affiliate=lw_affiliate_result(['items'=>[$r]],$code,$settings['affiliateId'])['url'];}catch(Throwable $e){}
  $images=[];foreach(array_slice($r['mediumImageUrls']??[],0,8) as $im){$u=lw_image_url((string)($im['imageUrl']??''));if($u&&!in_array($u,$images,true))$images[]=$u;}
  if(!$images||!pf_safe_affiliate($affiliate))continue;
  $rows[]=['code'=>$code,'title'=>mb_substr((string)($r['itemName']??''),0,300),'url'=>$p['url'],'affiliate'=>$affiliate,'image'=>$images[0],'images'=>$images,'shop'=>(string)($r['shopName']??explode(':',$code)[0]),'price'=>(int)($r['itemPrice']??0),'caption'=>mb_substr(strip_tags((string)($r['itemCaption']??'')),0,1200),'sourceAt'=>time()];
 }
 return $rows;
}
function pf_stock_discover(array &$state):array{
 $settings=lw_settings();if(empty($settings['accessKey']))throw new RuntimeException('楽天API設定を保存してください。');
 $existing=array_values(array_filter($state['sources']??[],fn($r)=>is_array($r)&&!empty($r['code'])&&($r['sourceAt']??0)>time()-1800&&!pf_stock_used($state,(string)$r['code'])));
 if($existing)return $existing;
 $queries=pf_stock_queries();$qi=(int)($state['stockQueryIndex']??0);$page=(int)($state['stockPage']??1);
 if($qi>=count($queries)){$qi=0;$page=1;}
 $data=pf_search($queries[$qi],$settings,$page);$state['stockQueryIndex']=$qi;
 if($page*30>=max(0,(int)($data['count']??0))){$state['stockQueryIndex']=$qi+1;$state['stockPage']=1;}else $state['stockPage']=$page+1;
 $state['sources']=pf_stock_rows($data,$settings,$state);return $state['sources'];
}
function pf_prepare_stock(array $product,array &$state):array{
 $code=(string)($product['code']??'');if($code===''||empty($product['affiliate'])||!pf_safe_affiliate((string)$product['affiliate']))throw new RuntimeException('楽天の在庫商品を確認できません。');
 foreach($state['entries']??[] as $old)if(($old['item']['rakutenCode']??'')===$code)return $old;
 $images=array_values(array_filter(array_map('lw_image_url',$product['images']??[])));if(!$images&&$product['image'])$images=[lw_image_url((string)$product['image'])];$images=array_values(array_filter($images));
 if(!$images)throw new RuntimeException('この商品は写真を確認できません。');
 $id=hash('sha256','rakuten:'.$code);$title=(string)$product['title'];$shop=(string)$product['shop'];$price=(int)$product['price'];
 $paragraphs=[$title,'楽天市場の在庫あり検索で確認した商品です。','販売店：'.$shop];if($price>0)$paragraphs[]='掲載価格：'.number_format($price).'円（取得時点）';if(!empty($product['caption']))$paragraphs[]=(string)$product['caption'];
 $item=['url'=>(string)$product['url'],'source'=>'楽天市場・在庫あり商品','rakuten'=>true,'rakutenCode'=>$code,'sourceAt'=>(int)($product['sourceAt']??time()),'title'=>$title,'date'=>gmdate('Y-m-d'),'paragraphs'=>$paragraphs,'facts'=>$price>0?[['kind'=>'price','text'=>'掲載価格：'.number_format($price).'円（取得時点）']]:[],'images'=>$images,'links'=>[]];
 $warnings=['在庫・価格は検索時点の情報です。投稿前に楽天の商品ページで確認してください。'];$body='';
 try{$draft=news_groq_draft($item);$body=(string)($draft['text']??'');}catch(Throwable $e){$warnings[]='本文生成は保留：'.$e->getMessage();}
 $body=preg_replace('~https?://\\S+~u','',$body);$identity=pf_identity($item,$body);$affiliate=(string)$product['affiliate'];
 $candidate=['code'=>$code,'title'=>$title,'url'=>$item['url'],'affiliate'=>$affiliate,'image'=>$images[0],'shop'=>$shop,'exact'=>true];
 $match=['candidates'=>[$candidate],'shopCount'=>1,'searchUrl'=>pf_search_url($identity['keyword']),'searchAffiliate'=>'','itemAffiliate'=>$affiliate,'link'=>$affiliate,'linkMode'=>'item','matchStatus'=>'楽天市場の商品・在庫あり検索','checkedAt'=>gmdate('c')];
 $row=['id'=>$id,'item'=>$item,'body'=>trim($body),'selected'=>array_slice(array_keys($images),0,4),'identity'=>$identity,'match'=>$match,'warnings'=>$warnings,'createdAt'=>time(),'updatedAt'=>time(),'mark'=>'','edited'=>false];
 $state['entries'][$id]=$row;return $row;
}
function pf_settings():array{return array_replace(['enabled'=>true,'dailyLimit'=>20],pf_read('settings'));}
function pf_public(array $state):array{
 $rows=array_values($state['entries']??[]);usort($rows,static fn($a,$b)=>($b['createdAt']??0)<=>($a['createdAt']??0));
 return ['entries'=>$rows,'sources'=>$state['sources']??[],'enabled'=>pf_settings()['enabled'],'dailyLimit'=>20,'lastRun'=>$state['lastRun']??null,'lastError'=>$state['lastError']??'','rakutenConfigured'=>!empty(lw_settings()['accessKey']),'aiConfigured'=>!empty(news_groq_settings()['apiKey'])];
}
function pf_prepare(string $url,array &$state,string $keyword=''):array{
 $u=news_url($url);if(!$u)throw new RuntimeException('対応する公式記事・取得済みInstagramのURLを指定してください。');
 $id=hash('sha256',$u);if(isset($state['entries'][$id]))return $state['entries'][$id];
 $item=news_detail($u);$item['images']=array_slice($item['images']??[],0,20);
 $warnings=[];$material=$item;
 if(!empty($item['instagram'])&&$item['images']){
  $indices=array_slice(array_keys($item['images']),0,3);
  try{$read=news_photo_read($item,$indices);if(!empty($read['configured']))$material=news_photo_material($item,$indices);else $warnings[]='画像読取のAI設定がありません。';}
  catch(Throwable $e){$warnings[]='画像読取は保留：'.$e->getMessage();}
 }
 @set_time_limit(180);
 // OCR helps the Japanese draft, but never supplies an auto-approved identity.
 $identityBefore=pf_identity($item);
 foreach($state['entries']??[] as $oldId=>$old){
  $sameJan=$identityBefore['jan']!==''&&$identityBefore['jan']===($old['identity']['jan']??'');
  $sameTitle=mb_strlen($item['title'])>=12&&pf_normal($item['title'])===pf_normal($old['item']['title']);
  if($sameJan||$sameTitle){$state['entries'][$oldId]['sourceUrls']=array_values(array_unique(array_merge($old['sourceUrls']??[$old['item']['url']],[$u])));return $state['entries'][$oldId];}
 }
 $text='';try{$draft=news_groq_draft($material);$text=(string)($draft['text']??'');if(!$text)$warnings[]='AI設定を確認してください。';}catch(Throwable $e){$warnings[]='本文生成は保留：'.$e->getMessage();}
 // Original source links are for inspection only, never inserted in the X draft.
 $text=preg_replace('~https?://\S+~u','',$text);
 $text=preg_replace('/^(?:🔎\s*)?(?:詳細はこちら|元の投稿はこちら)\s*$/mu','',$text);
 $identity=pf_identity($item,$text);
 if($keyword!==''){$identity['keyword']=$keyword;$identity['jan']='';$identity['model']='';}
 $match=['candidates'=>[],'link'=>'','linkMode'=>'none','searchAffiliate'=>'','itemAffiliate'=>'','matchStatus'=>'楽天の照合待ち','shopCount'=>0,'searchUrl'=>pf_search_url($identity['keyword'])];
 try{
  $settings=lw_settings();if(!$settings)throw new RuntimeException('新着商品の楽天API設定を保存してください。');
  $match=pf_resolve($item,$text,$identity,$settings);
 }catch(Throwable $e){$warnings[]='楽天照合は保留：'.$e->getMessage();}
 $row=['id'=>$id,'item'=>$item,'body'=>trim($text),'selected'=>array_slice(array_keys($item['images']),0,4),'identity'=>$identity,'match'=>$match,'warnings'=>$warnings,'createdAt'=>time(),'updatedAt'=>time(),'mark'=>'','edited'=>false];
 $state['entries'][$id]=$row;return $row;
}
function pf_tick(array &$state):array{
 if(!pf_settings()['enabled'])return ['message'=>'自動準備は停止中です。'];
 if(empty(lw_settings()['accessKey'])||empty(news_groq_settings()['apiKey']))return ['message'=>'楽天API・AI設定を保存すると自動準備が始まります。'];
 if(($state['lastRun']??0)>time()-1500)return ['message'=>'次の自動準備を待っています。'];
 $day=gmdate('Y-m-d',time()+9*3600);if(($state['day']??'')!==$day){$state['day']=$day;$state['count']=0;}
 if(($state['count']??0)>=20)return ['message'=>'本日の自動準備は20件までです。'];
 $state['lastRun']=time();$state['lastError']='';
 try{$sources=pf_stock_discover($state);}catch(Throwable $e){$state['lastError']=$e->getMessage();return ['message'=>'楽天の在庫商品を取得できませんでした：'.$e->getMessage()];}
 foreach($sources as $product){
  $id='rakuten-'.$product['code'];if(pf_stock_used($state,(string)$product['code']))continue;
  $state['count']=($state['count']??0)+1;$state['attempted'][$id]=time();
  try{return ['entry'=>pf_prepare_stock($product,$state),'message'=>'楽天の在庫商品から下書きを1件準備しました。'];}catch(Throwable $e){$state['lastError']=$e->getMessage();return ['message'=>'準備を保留しました：'.$e->getMessage()];}
 }
 return ['message'=>'この検索ページに未準備の商品はありません。次回は次の商品ページを探します。'];
}

if(defined('SPH_FLOW_TEST'))return;
function pf_image_out(string $source):void{
 $url=lw_image_url($source);if(!$url)pf_out(['ok'=>false,'error'=>'写真URLを確認できません。'],400);
 $bytes='';$c=curl_init($url);curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>12,CURLOPT_WRITEFUNCTION=>static function($c,$chunk)use(&$bytes){if(strlen($bytes)+strlen($chunk)>4000000)return 0;$bytes.=$chunk;return strlen($chunk);}]);
 $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);$type=strtolower((string)curl_getinfo($c,CURLINFO_CONTENT_TYPE));curl_close($c);
 if($ok===false||$status!==200||!preg_match('~^image/(?:jpeg|png|webp)(?:;|$)~',$type)||!$bytes)pf_out(['ok'=>false,'error'=>'楽天の商品写真を取得できませんでした。'],502);
 header('Content-Type: '.strtok($type,';'));header('Content-Length: '.strlen($bytes));header('Cache-Control: private, max-age=300');echo $bytes;exit;
}
function pf_out(array $data,int $status=200):void{http_response_code($status);header('Content-Type: application/json; charset=utf-8');echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);exit;}
$config=require __DIR__.'/config.php';$origin=$_SERVER['HTTP_ORIGIN']??'';
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
if(in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if(($_SERVER['REQUEST_METHOD']??'')==='OPTIONS')exit;
$token=preg_match('/^Bearer (.+)$/D',$_SERVER['HTTP_AUTHORIZATION']??'',$m)?$m[1]:'';
if(empty($config['sync_key'])||!hash_equals((string)$config['sync_key'],$token))pf_out(['ok'=>false,'error'=>'同期キーを設定してください。'],401);
try{
 $action=$_GET['action']??'list';$state=pf_read('state');
 if($action==='list'&&($_SERVER['REQUEST_METHOD']??'')==='GET')pf_out(['ok'=>true]+pf_public($state));
 if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!in_array($origin,$config['allowed_origins']??[],true))pf_out(['ok'=>false,'error'=>'許可されたアプリから実行してください。'],403);
 $raw=(string)file_get_contents('php://input',false,null,0,32769);$input=json_decode($raw,true);
 if(strlen($raw)>32768||!is_array($input))pf_out(['ok'=>false,'error'=>'入力内容を確認してください。'],400);
 $lock=fopen(pf_dir().'/prepare.lock','c+');if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))pf_out(['ok'=>false,'error'=>'新商品の準備中です。少し待ってください。'],409);
 chmod(pf_dir().'/prepare.lock',0600);$state=pf_read('state');@set_time_limit(220);$result=[];
 try{
  if($action==='image'){pf_image_out((string)($input['url']??''));}
  elseif($action==='prepare-stock'){
   $code=$input['code']??'';$product=null;foreach($state['sources']??[] as $candidate)if(($candidate['code']??'')===$code)$product=$candidate;
   if(!$product)throw new RuntimeException('一覧を更新して商品を選び直してください。');$result=['entry'=>pf_prepare_stock($product,$state)];
  }
  elseif($action==='settings'){if(!is_bool($input['enabled']??null))throw new RuntimeException('自動準備の設定を確認してください。');pf_write('settings',['enabled'=>$input['enabled']]);}
  elseif($action==='sources'){$state['sources']=pf_stock_discover($state);$result=['message'=>count($state['sources']).'件の楽天在庫商品が見つかりました。'];}
  elseif($action==='tick'){$result=pf_tick($state);}
  elseif($action==='prepare'){
   if(!is_string($input['url']??null))throw new RuntimeException('記事URLを確認してください。');
   $result=['entry'=>pf_prepare($input['url'],$state)];
  }else{
   $id=$input['id']??'';if(!is_string($id)||!isset($state['entries'][$id]))throw new RuntimeException('下書きを選択してください。');$row=&$state['entries'][$id];
   if($action==='save'){
    if(!is_string($input['body']??null)||mb_strlen($input['body'])>10000||!is_array($input['selected']??null)||count($input['selected'])>4)throw new RuntimeException('本文・写真を確認してください。');
    foreach($input['selected'] as $i)if(!is_int($i)||$i<0||!isset($row['item']['images'][$i]))throw new RuntimeException('写真の選択を確認してください。');
    $mode=$input['linkMode']??'none';if(!in_array($mode,['item','search','none'],true))throw new RuntimeException('リンクの選択を確認してください。');
    $row['match']['linkMode']=$mode;$row['match']['link']=$mode==='none'?'':($row['match'][$mode==='search'?'searchAffiliate':'itemAffiliate']??'');
    $row['body']=$input['body'];$row['selected']=array_values(array_unique($input['selected']));$row['edited']=true;
   }elseif($action==='mark'){
    if(!in_array($input['mark']??'', ['done','skip',''],true))throw new RuntimeException('状態を確認してください。');$row['mark']=$input['mark'];
   }elseif($action==='match'){
    $keyword=$input['keyword']??'';if(!is_string($keyword))throw new RuntimeException('検索語を確認してください。');
    $identity=$row['identity'];$identity['keyword']=trim($keyword);
    $settings=lw_settings();$row['match']=pf_match(pf_search($identity['keyword'],$settings),$identity,$row['item']['title'],$settings);$row['identity']=$identity;
   }elseif($action==='confirm'){
    $code=$input['code']??'';$candidates=$row['match']['candidates'];$found=null;
    foreach($candidates as $candidate)if($candidate['code']===$code)$found=$candidate;
    if(!$found||!pf_safe_affiliate($found['affiliate']))throw new RuntimeException('楽天の商品候補を選択してください。');
    $row['match']['itemAffiliate']=$found['affiliate'];$row['match']['searchAffiliate']=pf_affiliate(pf_search_url($row['identity']['keyword']),lw_settings()['affiliateId']??'');
    $row['match']['link']=$found['affiliate'];$row['match']['linkMode']='item';$row['match']['matchStatus']='商品一致を手動確認済み';
   }elseif($action==='retry'){
    if(!$row['body']){try{$draft=news_groq_draft($row['item']);$row['body']=$draft['text']??'';}catch(Throwable $e){throw new RuntimeException('本文生成は保留：'.$e->getMessage());}}
    $identity=pf_identity($row['item'],$row['body']);$settings=lw_settings();$row['match']=pf_resolve($row['item'],$row['body'],$identity,$settings);$row['identity']=$identity;
   }else throw new RuntimeException('操作を確認してください。');
   $row['updatedAt']=time();$result=['entry'=>$row];
  }
  // Preserve edited, posted and skipped records; avoid duplicate regeneration.
  if(count($state['entries']??[])>120){uasort($state['entries'],static fn($a,$b)=>($b['updatedAt']??0)<=>($a['updatedAt']??0));$state['entries']=array_slice($state['entries'],0,120,true);}
  $state['attempted']=array_filter($state['attempted']??[],static fn($at)=>$at>time()-30*86400);
  pf_write('state',$state);
 }finally{flock($lock,LOCK_UN);fclose($lock);}
 pf_out(['ok'=>true]+$result+pf_public($state)+['sources'=>$state['sources']??[]]);
}catch(Throwable $e){pf_out(['ok'=>false,'error'=>$e->getMessage()],502);}
