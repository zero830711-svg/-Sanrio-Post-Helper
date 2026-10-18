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
function pf_search(string $keyword,array $settings,int $page=1,bool $imageOnly=false):array{
 if(mb_strlen($keyword)<2||mb_strlen($keyword)>80)throw new RuntimeException('楽天の検索語を2〜80文字で指定してください。');
 $settings=lw_validate_settings($settings);
 $cache='search-broad-v2-'.hash('sha256',$keyword.'|'.$page.'|'.($imageOnly?'image':'all').json_encode($settings));$saved=pf_read($cache);
 if(($saved['at']??0)>time()-1800)return $saved['data'];
 $lock=fopen(pf_dir().'/rakuten-api.lock','c+');if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('楽天APIを利用中です。少し待ってください。');
 try{
  chmod(pf_dir().'/rakuten-api.lock',0600);rewind($lock);$last=(float)stream_get_contents($lock);$wait=1.1-(microtime(true)-$last);if($wait>0)usleep((int)($wait*1000000));
  rewind($lock);ftruncate($lock,0);fwrite($lock,(string)microtime(true));fflush($lock);
  $params=['applicationId'=>$settings['applicationId'],'affiliateId'=>$settings['affiliateId'],'keyword'=>$keyword,'availability'=>1,'field'=>0,'hits'=>30,'page'=>$page,'formatVersion'=>2,'elements'=>'count,itemCode,itemName,itemUrl,itemCaption,itemPrice,mediumImageUrls,affiliateUrl,shopCode,shopName'];if($imageOnly)$params['imageFlag']=1;$url='https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?'.http_build_query($params,'','&',PHP_QUERY_RFC3986);
  $c=curl_init($url);$body='';
  curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/',CURLOPT_WRITEFUNCTION=>static function($c,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>1000000)return 0;$body.=$bytes;return strlen($bytes);}]);
  $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
  if($ok===false)throw new RuntimeException('楽天APIの通信が完了しませんでした。');
  if($status!==200)throw new RuntimeException(lw_rakuten_error($status,$body));
  $data=json_decode($body,true);if(!is_array($data))throw new RuntimeException('楽天APIの応答を確認できませんでした。');
  $data=lw_rakuten_search_data($data);pf_write($cache,['at'=>time(),'data'=>$data]);return $data;
 }finally{flock($lock,LOCK_UN);fclose($lock);}
}

function pf_catalog_candidate(array $row):?array{
 $title=trim((string)($row['itemName']??''));$caption=strip_tags((string)($row['itemCaption']??''));
 if($title===''||!preg_match('/シナモロール|Cinnamoroll/i',$title."\n".$caption))return null;
 $code=(string)($row['itemCode']??'');if(!preg_match('/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/D',$code))return null;
 $product=lw_product((string)($row['itemUrl']??''));if(!$product||$product['store']!=='楽天')return null;
 $affiliate=(string)($row['affiliateUrl']??'');if(!pf_safe_affiliate($affiliate))return null;
 $image='';
 foreach($row['mediumImageUrls']??[] as $entry){
  $candidate=pf_image_url((string)(is_array($entry)?($entry['imageUrl']??''):$entry));if(!$candidate)continue;
  $full=pf_image_fetch_candidates($candidate)[0]??'';if(pf_image_url($full)){$image=$full;break;}
 }
 if($image==='')return null;
 return ['code'=>$code,'title'=>mb_substr($title,0,300),'image'=>$image,'affiliate'=>$affiliate,'shop'=>mb_substr((string)($row['shopName']??''),0,100)];
}

function pf_external_search(string $service,string $keyword,array $settings,int $page=1):array{
 $settings=lw_validate_settings($settings);$page=max(1,min(100,$page));$cache='external-'.hash('sha256',$service.'|'.$keyword.'|'.$page.'|'.$settings['affiliateId']);$saved=pf_read($cache);
 if(($saved['at']??0)>time()-1800)return $saved['data'];
 if(!in_array($service,['books','travel'],true))throw new RuntimeException('楽天サービスを確認できません。');
 if($service==='books'){
  $base='https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404?';
  $params=['applicationId'=>$settings['applicationId'],'title'=>$keyword,'availability'=>1,'outOfStockFlag'=>0,'hits'=>30,'page'=>$page,'formatVersion'=>2,'affiliateId'=>$settings['affiliateId'],'elements'=>'title,itemCaption,itemPrice,itemUrl,affiliateUrl,mediumImageUrl,largeImageUrl,isbn,availability'];
 }else{
  $base='https://openapi.rakuten.co.jp/engine/api/Travel/KeywordHotelSearch/20260731?';
  $params=['applicationId'=>$settings['applicationId'],'keyword'=>$keyword,'hits'=>30,'page'=>$page,'format'=>'json','formatVersion'=>2,'responseType'=>'middle','affiliateId'=>$settings['affiliateId']];
 }
 $lock=fopen(pf_dir().'/rakuten-api.lock','c+');if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('楽天APIを利用中です。少し待ってください。');
 try{
  chmod(pf_dir().'/rakuten-api.lock',0600);rewind($lock);$last=(float)stream_get_contents($lock);$wait=1.1-(microtime(true)-$last);if($wait>0)usleep((int)($wait*1000000));
  rewind($lock);ftruncate($lock,0);fwrite($lock,(string)microtime(true));fflush($lock);
  $url=$base.http_build_query($params,'','&',PHP_QUERY_RFC3986);$body='';$c=curl_init($url);
  curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['accessKey: '.$settings['accessKey'],'Origin: https://fan-info.zombie.jp'],CURLOPT_REFERER=>'https://fan-info.zombie.jp/',CURLOPT_WRITEFUNCTION=>static function($c,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>1000000)return 0;$body.=$bytes;return strlen($bytes);}]);
  $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
  if($ok===false)throw new RuntimeException('楽天APIの通信が完了しませんでした。');
  if($status!==200)throw new RuntimeException(lw_rakuten_error($status,$body));
  $data=json_decode($body,true);if(!is_array($data))throw new RuntimeException('楽天APIの応答を確認できませんでした。');
  pf_write($cache,['at'=>time(),'data'=>$data]);return $data;
 }finally{flock($lock,LOCK_UN);fclose($lock);}
}
function pf_image_url(string $url):string{
 $safe=lw_image_url($url);if($safe)return $safe;
 $p=parse_url($url);$host=strtolower((string)($p['host']??''));$path=(string)($p['path']??'');
 if(($p['scheme']??'')==='https'&&!isset($p['user'])&&!isset($p['pass'])&&!isset($p['port'])&&$host==='img.travel.rakuten.co.jp'&&preg_match('~\\.(?:jpe?g|png|webp)$~iD',$path))return $url;
 return '';
}
function pf_image_fetch_candidates(string $url):array{
 $p=parse_url($url);$host=strtolower((string)($p['host']??''));$path=(string)($p['path']??'');$query=rawurldecode((string)($p['query']??''));
 if(($p['scheme']??'')==='https'&&!isset($p['user'])&&!isset($p['pass'])&&!isset($p['port'])&&$host==='image.rakuten.co.jp'&&preg_match('~^/(?:[a-zA-Z0-9_-]+)/cabinet/[a-zA-Z0-9_/-]+\\.(?:jpe?g|png|webp)$~iD',$path)&&preg_match('/^_ex=[0-9]{1,4}x[0-9]{1,4}$/D',$query))return ['https://'.$host.$path];
 if(($p['scheme']??'')==='https'&&!isset($p['user'])&&!isset($p['pass'])&&!isset($p['port'])&&$host==='tshop.r10s.jp'&&preg_match('~^/[a-zA-Z0-9_-]+/cabinet/[a-zA-Z0-9_/-]+\\.(?:jpe?g|png|webp)$~iD',$path)&&preg_match('/^(?:fitin|downsize)=[0-9]{1,4}:(?:[0-9]{1,4}|\\*)$/D',$query))return ['https://'.$host.$path];
 return [$url];
}
function pf_rakuten_book_images_from_html(string $html,string $isbn):array{
 $isbn=strtoupper(preg_replace('/[^0-9X]/i','',$isbn));if(!preg_match('/^[0-9]{13}$/D',$isbn))return [];
 $html=html_entity_decode($html,ENT_QUOTES|ENT_HTML5,'UTF-8');
 $html=str_replace(['\\/','\\u002F','\\u002f','\\u003F','\\u003f','\\u0026'],['/','/','/','?','?','&'],$html);
 $pattern='~https?://(?:shop|tshop)\\.r10s\\.jp/[^"<>\\s\\\\]*'.preg_quote($isbn,'~').'[^"<>\\s\\\\]*\\.(?:jpe?g|png|webp)(?:\\?[^"<>\\s\\\\]*)?~i';
 preg_match_all($pattern,$html,$matches);$candidates=[];
 foreach($matches[0]??[] as $raw){
  $raw=html_entity_decode($raw,ENT_QUOTES|ENT_HTML5,'UTF-8');$p=parse_url($raw);
  $host=strtolower((string)($p['host']??''));$path=(string)($p['path']??'');
  if(!in_array($host,['shop.r10s.jp','tshop.r10s.jp'],true)||!str_contains($path,$isbn)||!preg_match('~\\.(?:jpe?g|png|webp)$~iD',$path))continue;
  $base=basename($path);$rank=4;
  if(preg_match('/'.preg_quote($isbn,'/').'_1_2\\.(?:jpe?g|png|webp)$/iD',$base))$rank=0;
  elseif(preg_match('/'.preg_quote($isbn,'/').'(?:_1)?\\.(?:jpe?g|png|webp)$/iD',$base))$rank=1;
  elseif(preg_match('/'.preg_quote($isbn,'/').'_1_[0-9]+\\.(?:jpe?g|png|webp)$/iD',$base))$rank=2;
  $candidate='https://'.$host.$path;
  if(!isset($candidates[$candidate])||$rank<$candidates[$candidate])$candidates[$candidate]=$rank;
 }
 if(!$candidates)return [];
 asort($candidates,SORT_NUMERIC);return array_slice(array_keys($candidates),0,8);
}
function pf_rakuten_book_cover_from_html(string $html,string $isbn):string{
 return pf_rakuten_book_images_from_html($html,$isbn)[0]??'';
}
function pf_rakuten_books_images(string $productUrl,string $isbn):array{
 $isbn=strtoupper(preg_replace('/[^0-9X]/i','',$isbn));$p=parse_url($productUrl);
 if(!preg_match('/^[0-9]{13}$/D',$isbn)||($p['scheme']??'')!=='https'||strtolower((string)($p['host']??''))!=='books.rakuten.co.jp'||!preg_match('~^/rb/[0-9]+/?$~D',$p['path']??'')||isset($p['user'])||isset($p['pass'])||isset($p['port']))return [];
 $key='rakuten-book-gallery-'.hash('sha256',$isbn.'|'.$p['path']);$cached=pf_read($key);
 if(($cached['at']??0)>time()-86400)return array_values(array_filter($cached['images']??[],'is_string'));
 $body='';$c=curl_init('https://books.rakuten.co.jp'.$p['path']);
 curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>8,CURLOPT_ENCODING=>'',CURLOPT_HTTPHEADER=>['Accept: text/html,application/xhtml+xml','Accept-Language: ja,en;q=0.5'],CURLOPT_USERAGENT=>'Mozilla/5.0 (compatible; SanrioPostHelper/1.0)',CURLOPT_WRITEFUNCTION=>static function($c,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>2000000)return 0;$body.=$bytes;return strlen($bytes); }]);
 $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);$images=[];
 if($ok!==false&&$status===200)$images=pf_rakuten_book_images_from_html($body,$isbn);
 pf_write($key,['at'=>time(),'images'=>$images]);return $images;
}
function pf_rakuten_books_cover(string $productUrl,string $isbn):string{
 return pf_rakuten_books_images($productUrl,$isbn)[0]??'';
}
function pf_google_books_cover(string $isbn):string{
 $isbn=strtoupper(preg_replace('/[^0-9X]/i','',$isbn));
 if(!preg_match('/^(?:[0-9]{13}|[0-9]{9}[0-9X])$/D',$isbn))return '';
 $key='google-cover-'.hash('sha256',$isbn);$cached=pf_read($key);
 if(($cached['at']??0)>time()-86400)return (string)($cached['url']??'');
 $url='https://www.googleapis.com/books/v1/volumes?'.http_build_query(['q'=>'isbn:'.$isbn,'maxResults'=>3,'fields'=>'items(volumeInfo(title,industryIdentifiers,imageLinks))'],'','&',PHP_QUERY_RFC3986);
 $body='';$c=curl_init($url);curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_TIMEOUT=>6,CURLOPT_WRITEFUNCTION=>static function($c,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>500000)return 0;$body.=$bytes;return strlen($bytes);}]);
 $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);$cover='';
 if($ok!==false&&$status===200){$data=json_decode($body,true);foreach($data['items']??[] as $book){
  $identifiers=$book['volumeInfo']['industryIdentifiers']??[];$match=false;
  foreach($identifiers as $identifier)if(strtoupper(preg_replace('/[^0-9X]/i','',(string)($identifier['identifier']??'')))===$isbn){$match=true;break;}
  if(!$match)continue;
  $images=$book['volumeInfo']['imageLinks']??[];
  foreach(['extraLarge','large','medium'] as $size){$candidate=(string)($images[$size]??'');if($candidate==='')continue;
   if(str_starts_with($candidate,'http://'))$candidate='https://'.substr($candidate,7);
   $p=parse_url($candidate);$host=strtolower((string)($p['host']??''));
   if(($p['scheme']??'')==='https'&&in_array($host,['books.google.com','books.googleusercontent.com'],true)&&str_starts_with((string)($p['path']??''),'/books/content')){$cover=$candidate;break 2;}
  }
 }}
 pf_write($key,['at'=>time(),'url'=>$cover]);return $cover;
}
function pf_books_rows(array $data,array $state):array{
 $rows=[];foreach(array_slice($data['Items']??$data['items']??[],0,30) as $entry){
  $r=$entry['Item']??$entry['item']??$entry;if(!is_array($r))continue;
  $title=(string)($r['title']??'');$caption=(string)($r['itemCaption']??'');if(!pf_stock_related(['itemName'=>$title,'itemCaption'=>$caption]))continue;
  $url=(string)($r['itemUrl']??'');$p=parse_url($url);if(($p['scheme']??'')!=='https'||($p['host']??'')!=='books.rakuten.co.jp')continue;
  $affiliate=(string)($r['affiliateUrl']??'');if(!pf_safe_affiliate($affiliate))continue;
  $image=pf_image_url((string)($r['largeImageUrl']??$r['mediumImageUrl']??''));if(!$image)continue;
  $isbn=preg_replace('/[^0-9Xx]/','',(string)($r['isbn']??''));$code='books:'.($isbn?:hash('sha256',$url));$dedupeKey=pf_product_dedupe_key(['code'=>$code,'title'=>$title,'isbn'=>$isbn]);
  if(pf_stock_used($state,$code,$dedupeKey))continue;
  $rows[]=['code'=>$code,'dedupeKey'=>$dedupeKey,'service'=>'books','sourceLabel'=>'楽天ブックス・在庫あり','title'=>mb_substr($title,0,300),'url'=>$url,'affiliate'=>$affiliate,'image'=>$image,'images'=>[$image],'shop'=>'楽天ブックス','price'=>(int)($r['itemPrice']??0),'caption'=>mb_substr(strip_tags($caption),0,1200),'sourceAt'=>time()];
 }return $rows;
}
function pf_travel_rows(array $data,array $state):array{
 $rows=[];$hotels=$data['hotels']??[];if(isset($hotels['hotel']))$hotels=[$hotels];
 foreach(array_slice($hotels,0,30) as $group){
  $hotel=$group['hotel']??[];if(isset($hotel['hotelBasicInfo']))$hotel=[$hotel];
  foreach($hotel as $detail){$b=$detail['hotelBasicInfo']??$detail;if(!is_array($b))continue;
   $title=(string)($b['hotelName']??'');$caption=(string)($b['hotelSpecial']??'');if(!pf_stock_related(['itemName'=>$title,'itemCaption'=>$caption]))continue;
   $no=preg_replace('/\\D/','',(string)($b['hotelNo']??''));if($no==='')continue;$code='travel:'.$no;$dedupeKey='code:'.$code;if(pf_stock_used($state,$code,$dedupeKey))continue;
   $affiliate=(string)($b['hotelInformationUrl']??'');if(!pf_safe_affiliate($affiliate))continue;
   $image=pf_image_url((string)($b['hotelThumbnailUrl']??$b['hotelImageUrl']??''));if(!$image)continue;$images=[$image];
   $url='https://travel.rakuten.co.jp/HOTEL/'.$no.'/'.$no.'.html';
   $rows[]=['code'=>$code,'dedupeKey'=>$dedupeKey,'service'=>'travel','sourceLabel'=>'楽天トラベル・宿泊施設（空室未確認）','title'=>mb_substr($title,0,300),'url'=>$url,'affiliate'=>$affiliate,'image'=>$image,'images'=>$images,'shop'=>'楽天トラベル','price'=>(int)($b['hotelMinCharge']??0),'caption'=>mb_substr(strip_tags($caption),0,1200),'sourceAt'=>time()];
  }
 }return $rows;
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
function pf_stock_characters():array{
 return ['ハローキティ','マイメロディ','クロミ','シナモロール','ポムポムプリン','ポチャッコ','ハンギョドン','リトルツインスターズ','キキララ','けろけろけろっぴ','タキシードサム','バッドばつ丸','あひるのペックル','ぐでたま','こぎみゅん','ウィッシュミーメル','ぼんぼんりぼん','チョコキャット','チャーミーキティ','マロンクリーム','ミュークルドリーミー','まるもふびより','みんなのたあ坊','おさるのもんきち','ウサハナ','はなまるおばけ','がおぱわるぅ','シュガーバニーズ','ジュエルペット'];
}
function pf_stock_kinds():array{
 return ['グッズ','ぬいぐるみ','マスコット','キーホルダー','フィギュア','シール','文房具','ポーチ','バッグ','タオル','食器','スマホケース','ガチャ','一番くじ','カードケース','ぬい服','ランチ','靴下','パジャマ'];
}
function pf_stock_queries():array{
 $characters=pf_stock_characters();$kinds=pf_stock_kinds();$queries=['サンリオ'];
 foreach($kinds as $kind)$queries[]='サンリオ '.$kind;
 foreach($characters as $character){$queries[]=$character;foreach($kinds as $kind)$queries[]=$character.' '.$kind;}
 return array_values(array_unique($queries));
}
function pf_stock_book_queries():array{
 $characters=pf_stock_characters();$kinds=['絵本','児童書','図鑑','シールブック','ぬりえ','手帳','カレンダー','知育','パズル','折り紙','迷路','ドリル'];
 $queries=['サンリオ'];
 foreach($kinds as $kind)$queries[]='サンリオ '.$kind;
 foreach($characters as $character){$queries[]=$character;foreach($kinds as $kind)$queries[]=$character.' '.$kind;}
 return array_values(array_unique($queries));
}
function pf_product_dedupe_key(array $row):string{
 $isbn=strtoupper(preg_replace('/[^0-9X]/i','',(string)($row['isbn']??'')));
 if(pf_jan($isbn))return 'id:'.$isbn;
 $title=pf_normal((string)($row['title']??$row['itemName']??''));
 $title=preg_replace('/[\s\p{P}\p{S}]+/u','',$title);
 if(mb_strlen($title)>=16)return 'title:'.hash('sha256',$title);
 return 'code:'.(string)($row['code']??$row['itemCode']??'');
}
function pf_stock_used(array $state,string $code,string $dedupeKey=''):bool{
 if(isset($state['attempted']['rakuten-'.$code])||($dedupeKey!==''&&isset($state['attempted']['dedupe-'.$dedupeKey])))return true;
 foreach($state['entries']??[] as $e){
  if(($e['item']['rakutenCode']??'')===$code)return true;
  if($dedupeKey!==''&&($e['item']['rakutenDedupeKey']??'')===$dedupeKey)return true;
  $oldJan=(string)($e['identity']['jan']??'');if($dedupeKey!==''&&pf_jan($oldJan)&&$dedupeKey==='id:'.$oldJan)return true;
  if($dedupeKey!==''&&empty($e['item']['rakutenDedupeKey'])&&pf_product_dedupe_key(['title'=>$e['item']['title']??'','isbn'=>str_starts_with((string)($e['item']['rakutenCode']??''),'books:')?substr((string)$e['item']['rakutenCode'],6):'','code'=>(string)($e['item']['rakutenCode']??'')])===$dedupeKey)return true;
 }
 return false;
}
function pf_stock_related(array $r):bool{
 return (bool)preg_match('/サンリオ|Sanrio|'.implode('|',array_map(static fn($name)=>preg_quote($name,'/'),pf_stock_characters())).'/iu',(string)($r['itemName']??'')."\n".strip_tags((string)($r['itemCaption']??'')));
}
function pf_stock_rows(array $data,array $settings,array $state):array{
 $rows=[];
 foreach(array_slice($data['items']??[],0,30) as $r){
  if(!is_array($r)||!pf_stock_related($r))continue;$p=lw_product((string)($r['itemUrl']??''));
  if(!$p||$p['store']!=='楽天'||($r['itemCode']??'')!==substr($p['id'],8))continue;
  $code=(string)$r['itemCode'];$title=(string)($r['itemName']??'');$caption=strip_tags((string)($r['itemCaption']??''));$janMatches=[];preg_match_all('/(?<![0-9])[0-9]{13}(?![0-9])/',$title."\n".$caption,$janFound);foreach($janFound[0]??[] as $jan)if(pf_jan($jan))$janMatches[]=$jan;$janMatches=array_values(array_unique($janMatches));$dedupeKey=count($janMatches)===1?'id:'.$janMatches[0]:pf_product_dedupe_key(['code'=>$code,'title'=>$title]);if(pf_stock_used($state,$code,$dedupeKey))continue;
  $affiliate='';try{$affiliate=lw_affiliate_result(['items'=>[$r]],$code,$settings['affiliateId'])['url'];}catch(Throwable $e){}
  $images=[];foreach(array_slice($r['mediumImageUrls']??[],0,8) as $im){$raw=is_array($im)?(string)($im['imageUrl']??$im['url']??''):(is_string($im)?$im:'');$u=pf_image_url($raw);if($u&&!in_array($u,$images,true))$images[]=$u;}
  if(!$images||!pf_safe_affiliate($affiliate))continue;
  $rows[]=['code'=>$code,'dedupeKey'=>$dedupeKey,'service'=>'market','sourceLabel'=>'楽天市場・在庫あり','title'=>mb_substr($title,0,300),'url'=>$p['url'],'affiliate'=>$affiliate,'image'=>$images[0],'images'=>$images,'shop'=>(string)($r['shopName']??explode(':',$code)[0]),'price'=>(int)($r['itemPrice']??0),'caption'=>mb_substr(strip_tags((string)($r['itemCaption']??'')),0,1200),'sourceAt'=>time()];
 }
 return $rows;
}
function pf_stock_expire_prices(array $rows,?int $now=null):array{
 $now=$now??time();foreach($rows as &$row){if(!is_array($row)||!array_key_exists('price',$row))continue;$priceAt=(int)($row['priceAt']??$row['sourceAt']??0);if($priceAt<=0||$priceAt<=$now-86400){unset($row['price'],$row['priceAt']);if(str_contains((string)($row['sourceLabel']??''),'在庫あり'))$row['sourceLabel']=($row['service']??'')==='books'?'楽天ブックスの商品候補':'楽天市場の商品候補';}else{$row['priceAt']=$priceAt;}}unset($row);return $rows;
}
function pf_stock_discover(array &$state):array{
 $settings=lw_settings();if(empty($settings['accessKey']))throw new RuntimeException('楽天API設定を保存してください。');
 $pool=pf_stock_expire_prices($state['sourcePool']??$state['sources']??[]);
 $existing=array_values(array_filter($pool,fn($r)=>is_array($r)&&!empty($r['code'])&&($r['sourceAt']??0)>time()-14*86400&&!pf_stock_used($state,(string)$r['code'],(string)($r['dedupeKey']??''))));
 $queries=pf_stock_queries();$bookQueries=pf_stock_book_queries();
 if(($state['stockSearchMode']??'')!=='catalog-round-robin-v3'){
  $state['stockQueryIndex']=0;$state['stockQueryPages']=[];$state['booksQueryIndex']=0;$state['booksQueryPages']=[];
  $state['stockSearchMode']='catalog-round-robin-v3';
 }
 $qi=max(0,(int)($state['stockQueryIndex']??0))%count($queries);$queryPages=$state['stockQueryPages']??[];
 $bqi=max(0,(int)($state['booksQueryIndex']??0))%count($bookQueries);$bookPages=$state['booksQueryPages']??[];
 $travelPage=max(1,min(100,(int)($state['travelPage']??1)));
 $rows=[];$errors=[];
 for($scan=0;$scan<8;$scan++){
  $query=$queries[$qi];$page=max(1,min(100,(int)($queryPages[$query]??1)));
  try{
   $data=pf_search($query,$settings,$page);
   $rows=array_merge($rows,pf_stock_rows($data,$settings,$state));
   $pageCount=max(1,min(100,(int)($data['pageCount']??100)));
   $queryPages[$query]=$page>=$pageCount?1:$page+1;
   $qi=($qi+1)%count($queries);
  }catch(Throwable $e){
   $errors[]='楽天市場（'.$query.'）：'.$e->getMessage();$qi=($qi+1)%count($queries);
   if(strpos($e->getMessage(),'HTTP 404')===false)break;
  }
 }
 $state['stockQueryIndex']=$qi;$state['stockQueryPages']=$queryPages;
 $bookQuery=$bookQueries[$bqi];$bookPage=max(1,min(100,(int)($bookPages[$bookQuery]??1)));
 try{
  $data=pf_external_search('books',$bookQuery,$settings,$bookPage);
  $rows=array_merge($rows,pf_books_rows($data,$state));
  $bookPageCount=max(1,min(100,(int)($data['pageCount']??100)));
  $bookPages[$bookQuery]=$bookPage>=$bookPageCount?1:$bookPage+1;
  $bqi=($bqi+1)%count($bookQueries);
 }catch(Throwable $e){$errors[]='楽天ブックス（'.$bookQuery.'）：'.$e->getMessage();$bqi=($bqi+1)%count($bookQueries);}
 $state['booksQueryIndex']=$bqi;$state['booksQueryPages']=$bookPages;
 try{
  $data=pf_external_search('travel','サンリオ',$settings,$travelPage);
  $rows=array_merge($rows,pf_travel_rows($data,$state));
  $travelPageCount=max(1,min(100,(int)($data['pageCount']??100)));
  $travelPage=$travelPage>=$travelPageCount?1:$travelPage+1;
 }catch(Throwable $e){$errors[]='楽天トラベル：'.$e->getMessage();$travelPage=$travelPage>=100?1:$travelPage+1;}
 $state['travelPage']=$travelPage;
 $unique=[];foreach(array_merge($existing,$rows) as $r)$unique[$r['code']]=$r;
 $poolRows=pf_stock_expire_prices(array_values($unique));usort($poolRows,static fn($a,$b)=>(int)($b['sourceAt']??0)<=>(int)($a['sourceAt']??0));
 $state['sourcePool']=array_slice($poolRows,0,10000);$state['sources']=$state['sourcePool'];$state['sourcesAt']=time();
 if(!$state['sources']&&count($errors)===3)throw new RuntimeException(implode(' / ',$errors));
 $state['sourceErrors']=$errors;return $state['sources'];
}
function pf_generated_body(string $text):string{
 $text=preg_replace('~https?://\S+~u','',$text);
 $text=preg_replace('/^\s*(?:🔎|🔍|🛍️)?\s*(?:詳細|詳細はこちら|楽天でチェック)[：:]?\s*$/mu','',$text);
 $text=trim(preg_replace('/\n{3,}/u',"\n\n",$text));
 if($text==='')throw new RuntimeException('有効な生成本文がありません。');
 return $text;
}
function pf_prepare_stock(array $product,array &$state):array{
 $code=(string)($product['code']??'');if($code===''||empty($product['affiliate'])||!pf_safe_affiliate((string)$product['affiliate']))throw new RuntimeException('楽天の在庫商品を確認できません。');
 foreach($state['entries']??[] as $old)if(($old['item']['rakutenCode']??'')===$code||(!empty($product['dedupeKey'])&&($old['item']['rakutenDedupeKey']??'')===$product['dedupeKey']))return $old;
 $images=array_values(array_filter(array_map('pf_image_url',$product['images']??[])));if(!$images&&!empty($product['image']))$images=[pf_image_url((string)$product['image'])];$images=array_values(array_filter($images));$galleryCheckedAt=0;
 if(($product['service']??'')==='books'&&str_starts_with($code,'books:')){$gallery=pf_rakuten_books_images((string)$product['url'],substr($code,6));if($gallery)$images=array_values(array_unique(array_merge($gallery,$images)));$galleryCheckedAt=time();}
 if(!$images)throw new RuntimeException('この商品は写真を確認できません。');
 $id=hash('sha256','rakuten:'.$code);$title=(string)$product['title'];$shop=(string)$product['shop'];$price=(int)$product['price'];$sourceLabel=(string)($product['sourceLabel']??'楽天市場・在庫あり');
 $fact=$product['service']==='travel'?'楽天トラベルのサンリオ関連施設候補です。空室は未確認です。':$sourceLabel.'で確認した商品です。';$paragraphs=[$title,$fact,'販売店：'.$shop];if($price>0)$paragraphs[]='掲載価格：'.number_format($price).'円（取得時点）';if(!empty($product['caption']))$paragraphs[]=(string)$product['caption'];
 $item=['url'=>(string)$product['url'],'source'=>$sourceLabel,'rakuten'=>true,'rakutenService'=>(string)($product['service']??'market'),'rakutenCode'=>$code,'rakutenDedupeKey'=>(string)($product['dedupeKey']??pf_product_dedupe_key($product)),'sourceAt'=>(int)($product['sourceAt']??time()),'galleryCheckedAt'=>$galleryCheckedAt,'title'=>$title,'date'=>gmdate('Y-m-d'),'paragraphs'=>$paragraphs,'facts'=>$price>0?[['kind'=>'price','text'=>'掲載価格：'.number_format($price).'円（取得時点）']]:[],'images'=>$images,'links'=>[]];
 $warnings=['在庫・価格は検索時点の情報です。投稿前に楽天の商品ページで確認してください。'];$body='';
 $body=preg_replace('~https?://\\S+~u','',$body);$identity=pf_identity($item,$body);$affiliate=(string)$product['affiliate'];
 $candidate=['code'=>$code,'title'=>$title,'url'=>$item['url'],'affiliate'=>$affiliate,'image'=>$images[0],'shop'=>$shop,'exact'=>true];
 $match=['candidates'=>[$candidate],'shopCount'=>1,'searchUrl'=>pf_search_url($identity['keyword']),'searchAffiliate'=>'','itemAffiliate'=>$affiliate,'link'=>$affiliate,'linkMode'=>'item','matchStatus'=>'楽天市場の商品・在庫あり検索','checkedAt'=>gmdate('c')];
 $row=['id'=>$id,'item'=>$item,'body'=>trim($body),'selected'=>array_slice(array_keys($images),0,4),'identity'=>$identity,'match'=>$match,'warnings'=>$warnings,'createdAt'=>time(),'updatedAt'=>time(),'mark'=>'','edited'=>false,'generatedOnRequest'=>false];
 $state['entries'][$id]=$row;return $row;
}
function pf_settings():array{return array_replace(['enabled'=>true,'dailyLimit'=>20],pf_read('settings'));}
function pf_source_progress(array $state):array{
 $marketQueries=pf_stock_queries();$bookQueries=pf_stock_book_queries();
 $marketIndex=max(0,(int)($state['stockQueryIndex']??0))%count($marketQueries);
 $bookIndex=max(0,(int)($state['booksQueryIndex']??0))%count($bookQueries);
 $marketQuery=$marketQueries[$marketIndex];$bookQuery=$bookQueries[$bookIndex];
 return ['marketTermIndex'=>$marketIndex+1,'marketTermCount'=>count($marketQueries),'marketPage'=>max(1,(int)(($state['stockQueryPages']??[])[$marketQuery]??1)),'booksTermIndex'=>$bookIndex+1,'booksTermCount'=>count($bookQueries),'booksPage'=>max(1,(int)(($state['booksQueryPages']??[])[$bookQuery]??1)),'travelPage'=>max(1,(int)($state['travelPage']??1))];
}
function pf_public(array $state,int $offset=0,int $limit=500):array{
 $rows=array_values($state['entries']??[]);usort($rows,static fn($a,$b)=>($b['createdAt']??0)<=>($a['createdAt']??0));
 $pool=pf_stock_expire_prices($state['sourcePool']??$state['sources']??[]);
 $available=array_values(array_filter($pool,fn($r)=>is_array($r)&&!empty($r['code'])&&($r['sourceAt']??0)>time()-14*86400&&!pf_stock_used($state,(string)$r['code'],(string)($r['dedupeKey']??''))));
 usort($available,static fn($a,$b)=>(int)($b['sourceAt']??0)<=>(int)($a['sourceAt']??0));
 $sourceCount=count($available);$serviceCounts=['market'=>0,'books'=>0,'travel'=>0];$groups=[];
 foreach($available as $r){
  $service=(string)($r['service']??'');if(isset($serviceCounts[$service]))$serviceCounts[$service]++;
  $key=(string)($r['dedupeKey']??pf_product_dedupe_key($r));$r['dedupeKey']=$key;
  if(!isset($groups[$key])){$r['services']=[$service];$r['offerCount']=1;$r['shops']=empty($r['shop'])?[]:[(string)$r['shop']];$groups[$key]=$r;continue;}
  $group=&$groups[$key];$group['offerCount']++;
  if($service!==''&&!in_array($service,$group['services'],true))$group['services'][]=$service;
  if(!empty($r['shop'])&&!in_array((string)$r['shop'],$group['shops'],true))$group['shops'][]=(string)$r['shop'];
  // Prefer a book listing for exact ISBN matches so its higher-resolution gallery is available.
  if($service==='books'&&($group['service']??'')!=='books'){$services=$group['services'];$shops=$group['shops'];$offers=$group['offerCount'];$group=$r;$group['services']=$services;$group['shops']=$shops;$group['offerCount']=$offers;}
  unset($group);
 }
 $uniqueProducts=array_values($groups);$uniqueCount=count($uniqueProducts);$duplicateCount=max(0,$sourceCount-$uniqueCount);
 $offset=max(0,min($uniqueCount,(int)$offset));$limit=max(1,min(500,(int)$limit));$page=array_slice($uniqueProducts,$offset,$limit);$publicSources=[];
 foreach($page as $r){$item=[];foreach(['code','dedupeKey','service','services','offerCount','shops','sourceLabel','title','url','image','shop','price','sourceAt'] as $key)if(array_key_exists($key,$r))$item[$key]=$r[$key];$publicSources[]=$item;}
 return ['entries'=>$rows,'sourceUpdatedAt'=>$state['sourcesAt']??null,'sourceErrors'=>$state['sourceErrors']??[],'sourceScanProgress'=>pf_source_progress($state),'sources'=>$publicSources,'sourcePoolCount'=>$sourceCount,'sourceServiceCounts'=>$serviceCounts,'sourceUniqueCount'=>$uniqueCount,'sourceDuplicateCount'=>$duplicateCount,'sourceOffset'=>$offset,'sourcePageSize'=>$limit,'sourceHasMore'=>$offset+count($page)<$uniqueCount,'enabled'=>pf_settings()['enabled'],'dailyLimit'=>20,'lastRun'=>$state['lastRun']??null,'lastError'=>$state['lastError']??'','rakutenConfigured'=>!empty(lw_settings()['accessKey']),'aiConfigured'=>!empty(news_groq_settings()['apiKey'])];
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
function pf_tick(array &$state,bool $manual=false):array{
 if(!pf_settings()['enabled'])return ['message'=>'自動準備は停止中です。'];
 if(empty(lw_settings()['accessKey']))return ['message'=>'楽天API設定を保存すると候補の自動準備が始まります。'];
 if(!$manual&&($state['lastRun']??0)>time()-1500)return ['message'=>'次の自動準備を待っています。'];
 $day=gmdate('Y-m-d',time()+9*3600);if(($state['day']??'')!==$day){$state['day']=$day;$state['count']=0;}
 if(($state['count']??0)>=20)return ['message'=>'本日の自動準備は20件までです。'];
 $state['lastRun']=time();$state['lastError']='';
 try{$sources=pf_stock_discover($state);}catch(Throwable $e){$state['lastError']=$e->getMessage();return ['message'=>'楽天の在庫商品を取得できませんでした：'.$e->getMessage()];}
 foreach($sources as $product){
  $id='rakuten-'.$product['code'];if(pf_stock_used($state,(string)$product['code']))continue;
  $state['count']=($state['count']??0)+1;$state['attempted'][$id]=time();if(!empty($product['dedupeKey']))$state['attempted']['dedupe-'.$product['dedupeKey']]=time();
  try{return ['entry'=>pf_prepare_stock($product,$state),'message'=>'楽天の在庫商品から下書きを1件準備しました。'];}catch(Throwable $e){$state['lastError']=$e->getMessage();return ['message'=>'準備を保留しました：'.$e->getMessage()];}
 }
 return ['message'=>'この検索ページに未準備の商品はありません。次回は次の商品ページを探します。'];
}

function pf_image_large_enough(array $info):bool{
 $width=(int)($info[0]??0);$height=(int)($info[1]??0);
 return min($width,$height)>=600&&max($width,$height)>=900;
}
if(defined('SPH_FLOW_TEST'))return;
function pf_image_out(string $source,string $isbn='',string $productUrl=''):void{
 $url=pf_image_url($source);if($isbn!==''){$gallery=pf_rakuten_books_images($productUrl,$isbn);$selected='';foreach($gallery as $image)if($image===$source){$selected=$image;break;}$cover=$selected?:($gallery[0]??'');if(!$cover)$cover=pf_google_books_cover($isbn);if($cover)$url=$cover;}if(!$url)pf_out(['ok'=>false,'error'=>'写真URLを確認できません。'],400);
 $rejectedSize='';
 foreach(pf_image_fetch_candidates($url) as $candidate){
  $bytes='';$c=curl_init($candidate);curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>true,CURLOPT_MAXREDIRS=>4,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_REDIR_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>12,CURLOPT_USERAGENT=>'Mozilla/5.0 (compatible; SanrioPostHelper/1.0)',CURLOPT_WRITEFUNCTION=>static function($c,$chunk)use(&$bytes){if(strlen($bytes)+strlen($chunk)>4000000)return 0;$bytes.=$chunk;return strlen($chunk);}]);
  $ok=curl_exec($c);$status=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
  $imageInfo=$bytes?@getimagesizefromstring($bytes):false;$type=strtolower((string)($imageInfo['mime']??''));
  if($ok===false||$status!==200||!in_array($type,['image/jpeg','image/png','image/webp'],true)||!$bytes)continue;
  if(!pf_image_large_enough($imageInfo)){$rejectedSize=(int)$imageInfo[0].'×'.(int)$imageInfo[1];continue;}
  header('X-Image-Dimensions: '.(int)$imageInfo[0].'x'.(int)$imageInfo[1]);
  header('Content-Type: '.$type);header('Content-Length: '.strlen($bytes));header('Cache-Control: private, max-age=300');echo $bytes;exit;
 }
 if($rejectedSize!=='')pf_out(['ok'=>false,'error'=>'楽天の写真は'.$rejectedSize.'pxで投稿用には小さすぎます（目安：短辺600px・長辺900px以上）。商品ページで大きい写真を確認してください。'],422);
 pf_out(['ok'=>false,'error'=>'楽天の商品写真を取得できませんでした。楽天の高画質画像が利用できない場合は、商品ページから写真を保存してください。'],502);
}
function pf_out(array $data,int $status=200):void{http_response_code($status);header('Content-Type: application/json; charset=utf-8');echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);exit;}
$config=require __DIR__.'/config.php';$origin=$_SERVER['HTTP_ORIGIN']??'';
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
if(in_array($origin,$config['allowed_origins']??[],true)){header('Access-Control-Allow-Origin: '.$origin);header('Vary: Origin');}
header('Access-Control-Allow-Headers: Authorization, Content-Type');header('Access-Control-Expose-Headers: X-Image-Dimensions');header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if(($_SERVER['REQUEST_METHOD']??'')==='OPTIONS')exit;
$token=preg_match('/^Bearer (.+)$/D',$_SERVER['HTTP_AUTHORIZATION']??'',$m)?$m[1]:'';
if(empty($config['sync_key'])||!hash_equals((string)$config['sync_key'],$token))pf_out(['ok'=>false,'error'=>'同期キーを設定してください。'],401);
try{
 $action=$_GET['action']??'list';$state=pf_read('state');
 if($action==='list'&&($_SERVER['REQUEST_METHOD']??'')==='GET')pf_out(['ok'=>true]+pf_public($state,max(0,(int)($_GET['offset']??0))));
 if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!in_array($origin,$config['allowed_origins']??[],true))pf_out(['ok'=>false,'error'=>'許可されたアプリから実行してください。'],403);
 $raw=(string)file_get_contents('php://input',false,null,0,32769);$input=json_decode($raw,true);
 if(strlen($raw)>32768||!is_array($input))pf_out(['ok'=>false,'error'=>'入力内容を確認してください。'],400);
 $lock=fopen(pf_dir().'/prepare.lock','c+');if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))pf_out(['ok'=>false,'error'=>'新商品の準備中です。少し待ってください。'],409);
 chmod(pf_dir().'/prepare.lock',0600);$state=pf_read('state');@set_time_limit(220);$result=[];
 try{
  if($action==='image'){pf_image_out((string)($input['url']??''),(string)($input['isbn']??''),(string)($input['productUrl']??''));}
  elseif($action==='catalog-search'){
   $queries=['シナモロール ぬいぐるみ','シナモロール バッグ','シナモロール ポーチ','シナモロール 文房具','シナモロール キーホルダー','シナモロール タオル','シナモロール 食器','シナモロール 生活雑貨','シナモロール マスコット','シナモロール ファッション'];
   $settings=lw_settings();$items=[];$seen=[];
   foreach($queries as $keyword){$data=pf_search($keyword,$settings,1,true);foreach($data['items']??[] as $row){if(!is_array($row))continue;$item=pf_catalog_candidate($row);if(!$item||isset($seen[$item['code']]))continue;$seen[$item['code']]=true;$items[]=$item;}}
   $result=['catalogItems'=>array_slice($items,0,90),'queriesUsed'=>count($queries)];
  }
  elseif($action==='prepare-stock'){
   $code=$input['code']??'';$product=null;foreach($state['sources']??[] as $candidate)if(($candidate['code']??'')===$code)$product=$candidate;
   if(!$product)throw new RuntimeException('一覧を更新して商品を選び直してください。');$result=['entry'=>pf_prepare_stock($product,$state)];
  }
  elseif($action==='settings'){if(!is_bool($input['enabled']??null))throw new RuntimeException('自動準備の設定を確認してください。');pf_write('settings',['enabled'=>$input['enabled']]);}
  elseif($action==='sources'){$state['sources']=pf_stock_discover($state);$result=['message'=>count($state['sources']).'件の楽天候補を自動検索しました。'];}
  elseif($action==='tick'){$result=pf_tick($state,!empty($input['manual']));}
  elseif($action==='prepare'){
   if(!is_string($input['url']??null))throw new RuntimeException('記事URLを確認してください。');
   $result=['entry'=>pf_prepare($input['url'],$state)];
  }else{
   $id=$input['id']??'';if(!is_string($id)||!isset($state['entries'][$id]))throw new RuntimeException('下書きを選択してください。');$row=&$state['entries'][$id];
   if($action==='gallery'){
    if(($row['item']['rakutenService']??'')!=='books'||!str_starts_with((string)($row['item']['rakutenCode']??''),'books:'))throw new RuntimeException('楽天ブックスの商品写真ではありません。');
    $images=pf_rakuten_books_images((string)$row['item']['url'],substr((string)$row['item']['rakutenCode'],6));$previous=$row['item']['images']??[];
    if($images)$row['item']['images']=array_values(array_unique(array_merge($images,$previous)));
    $row['item']['galleryCheckedAt']=time();
    if(empty($row['edited'])&&count($previous)<=1)$row['selected']=array_slice(array_keys($row['item']['images']),0,4);
    $row['updatedAt']=time();$result=['entry'=>$row,'message'=>'楽天ブックスの商品ページの写真候補を更新しました。'];
   }elseif($action==='save'){
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
    if(!empty($input['generateBody'])){try{$draft=news_groq_draft($row['item']);$text=trim((string)($draft['text']??''));if($text==='')throw new RuntimeException('AI設定または生成結果を確認してください。');$row['body']=pf_generated_body($text);$row['generatedOnRequest']=true;$row['warnings']=array_values(array_filter($row['warnings']??[],static fn($warning)=>!str_starts_with($warning,'本文生成は保留：')));}catch(Throwable $e){throw new RuntimeException('本文生成は保留：'.$e->getMessage().' 現在の本文は保持しています。');}}
    $identity=pf_identity($row['item'],$row['body']);$row['identity']=$identity;
    if(empty($row['item']['rakuten'])){$settings=lw_settings();$row['match']=pf_resolve($row['item'],$row['body'],$identity,$settings);}
   }else throw new RuntimeException('操作を確認してください。');
   $row['updatedAt']=time();$result=['entry'=>$row];
  }
  // Preserve edited, posted and skipped records; avoid duplicate regeneration.
  if(count($state['entries']??[])>120){uasort($state['entries'],static fn($a,$b)=>($b['updatedAt']??0)<=>($a['updatedAt']??0));$state['entries']=array_slice($state['entries'],0,120,true);}
  $state['attempted']=array_filter($state['attempted']??[],static fn($at)=>$at>time()-30*86400);
  pf_write('state',$state);
 }finally{flock($lock,LOCK_UN);fclose($lock);}
 pf_out(['ok'=>true]+$result+pf_public($state));
}catch(Throwable $e){pf_out(['ok'=>false,'error'=>$e->getMessage()],502);}
