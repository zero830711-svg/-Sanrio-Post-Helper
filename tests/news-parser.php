<?php
define('SPH_NEWS_TEST',true);
require __DIR__.'/../server/lolipop/news.php';
function check($v){if(!$v)throw new RuntimeException('News parser check failed');}
$url='https://prtimes.jp/main/html/rd/p/000000122.000013308.html';
$a=news_parse('<html><h1>サンリオ 新作</h1><div id="press-release-body"><p>10月上旬発売予定のコラボレーション商品です。</p><img src="https://prcdn.freetls.fastly.net/release_image/13308/122/test-1.png"><img src="https://evil.example/image.png"></div><img src="https://prcdn.freetls.fastly.net/release_image/13308/122/sidebar.png"></html>',$url);
check($a['title']==='サンリオ 新作');check(count($a['images'])===1);check(count($a['paragraphs'])===1);
check(news_url('https://prtimes.jp.evil.example/main/html/rd/p/1.2.html')==='');
check(news_url('https://user@prtimes.jp/main/html/rd/p/1.2.html')==='');
check(news_image_url('https://prcdn.freetls.fastly.net.evil.example/release_image/1/2/a.png')==='');
check(news_url($url)===$url);
$b=news_parse('<h1>公式商品</h1><section class="c-detail-head"><div class="c-detail-date">2026/10/01</div><p>10月7日から11月8日まで開催します。</p><img src="https://www.sanrio.co.jp/wp-content/uploads/2026/10/main.jpg"></section><section class="c-detail-content"><p>価格は1,290円（税込）です。</p><p>送料は500円です。</p><img src="https://www.sanrio.co.jp/wp-content/uploads/2026/10/sub.jpg"></section>','https://www.sanrio.co.jp/news/goods/test-20261001/');
check($b['date']==='2026/10/01');check(count($b['images'])===2);check(count($b['facts'])===2);
check($b['facts'][0]['kind']==='schedule');check($b['facts'][1]['text']==='価格は1,290円（税込）です。');
$c=news_parse('<h1>10/3（土）～順次発売！「クロミ当りくじ」</h1><section class="c-detail-head"><dl><dt>発売日</dt><dd>10月3日（土）～順次</dd></dl></section><section class="c-detail-content"><h3>価格：1回880円（税込み）</h3><p>送料は500円です。</p></section>','https://www.sanrio.co.jp/news/goods/ku-atarikuji-20260924/');
check(count($c['facts'])===2);check($c['facts'][0]['text']==='発売日：10月3日（土）～順次');check($c['facts'][1]['text']==='価格：1回880円（税込み）');
$d=news_parse('<h1>商品ニュース</h1><div id="press-release-body"><table><tr><th>発売日</th><td>2026年10月上旬予定</td></tr><tr><th>価格</th><td>各880円（税込）</td></tr></table><p>10月3日発売、価格は880円（税込）です。</p></div>',$url);
check(count($d['facts'])===2);check($d['facts'][0]['text']==='発売日：2026年10月上旬予定');check($d['facts'][1]['text']==='価格：各880円（税込）');
$e=news_parse('<h1>新作</h1><div id="press-release-body"><p>10月3日発売、価格は880円（税込）です。</p></div>',$url);
check(count($e['facts'])===2);
$cache=sys_get_temp_dir().'/sph-news-v8-'.hash('sha256',dirname(__DIR__).'/server/lolipop'.$url).'.json';
$previous=is_file($cache)?file_get_contents($cache):null;
try{
 file_put_contents($cache,json_encode($d));
 $metadata=news_list_metadata(['items'=>[['url'=>$url,'date'=>'2026-10-01','title'=>'新作']]]);
 check($metadata['items'][0]['facts']===$d['facts']);
 check($metadata['items'][0]['date']==='2026-10-01');
 check(!isset($metadata['items'][0]['paragraphs']));
}finally{if($previous===null)@unlink($cache);else file_put_contents($cache,$previous);}
echo "News parser and URL validation passed\n";

$aiItem=['title'=>'ハローキティのバッグ','url'=>$url,'paragraphs'=>['価格は880円（税込）。本体（※1）とバッグ。参加費3,000円。']];
check(strpos(news_ai_validate('🎀 バッグが登場！価格880円（税込）',$aiItem),$url)!==false);
foreach(['バッグは990円','本体※1とバッグ','参加費3,000円','https://evil.example/'] as $invalid){
 $rejected=false;try{news_ai_validate($invalid,$aiItem);}catch(RuntimeException $ex){$rejected=true;}check($rejected);
}
echo "News AI output validation passed\n";

check(news_ai_key('  '.str_repeat('a',39).'  ')===str_repeat('a',39));
$opaque='test-auth.'.str_repeat('x',400).'_-/+=';
check(news_ai_key($opaque)===$opaque);
foreach(['short',str_repeat('a',30)."\r\nInjected",str_repeat('a',30).' space',str_repeat('x',2049)] as $bad){
 $rejected=false;try{news_ai_key($bad);}catch(RuntimeException $ex){$rejected=true;}check($rejected);
}
echo "Opaque API key validation passed\n";

check(strpos(news_ai_error(404,[]),'モデル')!==false);
check(strpos(news_ai_error(429,[]),'無料枠')!==false);
check(strpos(news_ai_error(403,[]),'アクセス')!==false);
check(strpos(news_ai_error(0,[],28),'時間切れ')!==false);
check(strpos(news_ai_error(400,['error'=>['message'=>'secret-key-must-not-leak','details'=>[['reason'=>'API_KEY_INVALID']]]]),'secret-key')===false);
echo "Safe AI diagnostics passed\n";

$prompt=news_ai_prompt($aiItem);
check(strpos($prompt,'長い正式名称')!==false);
check(strpos($prompt,'各1行に分ける')!==false);
check(strpos($prompt,'重要な限定条件')!==false);
$limit=max(0,190-ai_cute_length(ai_cute_suffix($aiItem)));
check(strpos($prompt,'改行は'.$limit.'文字以内')!==false);
$longItem=$aiItem;$longItem['url']=$url.str_repeat('a',50);
check(news_ai_prompt($longItem)===$prompt); // URLs count as 23 regardless of length.
$formatted="🎀 バッグが登場！\n\n価格：880円（税込）";
check(strpos(news_ai_validate($formatted,$aiItem),$formatted)===0);
echo "Readable AI prompt and URL-aware length checks passed\n";

$post=post_ai_input(['mode'=>'rewrite','title'=>'リボン付きバッグ','text'=>'リボン付きバッグ。価格880円（税込）。','links'=>[['url'=>'https://amzn.to/test'],['url'=>'https://search.rakuten.co.jp/search/mall/test/?scid=af_test']]]);
$out=post_ai_validate('🎀 リボン付きバッグを紹介します',$post);
check(strpos($out,"Amazon：https://amzn.to/test")!==false);
check(strpos($out,'楽天：https://search.rakuten.co.jp/search/mall/test/?scid=af_test')!==false);
check(substr($out,-3)==='#pr'&&mb_strlen($out)<=280);
check(strpos(post_ai_prompt($post),'書き出し・文順・言い回し')!==false);
$product=$post;$product['mode']='product';check(strpos(post_ai_prompt($product),'記事掲載日は発売日ではない')!==false);
check(strpos(post_ai_prompt($product),'写真は送られていない')!==false);
foreach(['価格999円','https://evil.example/','#pr','```text'] as $bad){try{post_ai_validate($bad,$post);check(false);}catch(RuntimeException $e){check($e->getMessage()!=='News parser check failed');}}
foreach(['https://amazon.co.jp.evil.example/test','https://user@amzn.to/test','javascript:alert(1)'] as $bad){try{post_ai_input(['mode'=>'product','title'=>'商品','text'=>'資料','links'=>[['url'=>$bad]]]);check(false);}catch(RuntimeException $e){check($e->getMessage()!=='News parser check failed');}}
$noLinks=post_ai_input(['mode'=>'rewrite','title'=>'商品','text'=>'資料','links'=>[]]);check(post_ai_validate('商品を紹介します',$noLinks)==="商品を紹介します\n#pr");
echo "Product and rewrite AI safety checks passed\n";

foreach(['https://amzn.asia/d/test','https://a.co/d/test','https://www.amazon.co.jp/s?k=kitty&tag=mytag-22'] as $savedUrl){
 $saved=post_ai_input(['mode'=>'rewrite','title'=>'バッグ','text'=>'リボン付きバッグ','links'=>[['url'=>$savedUrl]]]);
 check($saved['links'][0]['url']===$savedUrl&&$saved['links'][0]['kind']==='amazon');
 check(strpos(post_ai_validate('リボン付きバッグを紹介します',$saved),$savedUrl)!==false);
}
check(post_ai_weight('abcあ🎀')===7);
check(post_ai_weight('https://amzn.to/x')===23);
$longUrl='https://hb.afl.rakuten.co.jp/hgc/test/?pc='.str_repeat('a',1200);
$longPost=post_ai_input(['mode'=>'product','title'=>'バッグ','text'=>'リボン付きバッグ','links'=>[['url'=>$longUrl],['url'=>'https://amzn.to/test']]]);
$shortPost=$longPost;$shortPost['links'][0]['url']='https://a.r10.to/test';
check(post_ai_limit($longPost)===post_ai_limit($shortPost));
check(strpos(post_ai_validate('リボン付きバッグを紹介します',$longPost),$longUrl)!==false);
check(post_ai_weight(post_ai_validate('リボン付きバッグを紹介します',$longPost))<=280);
echo "Saved Amazon formats and X-weighted long affiliate links passed\n";

$reportedLinks=['https://link.amazon/B05WRaCtu','https://a.r10.to/hPDrWT','https://amzn.to/4rkh5WG'];
$reported=post_ai_input(['mode'=>'rewrite','title'=>'クリア窓付きバッグ','text'=>'クリア窓付きショルダーバッグをご紹介。','links'=>array_map(static fn($url)=>['url'=>$url],$reportedLinks)]);
check(array_column($reported['links'],'kind')===['amazon','rakuten','amazon']);
$reportedOut=post_ai_validate('クリア窓付きショルダーバッグを紹介します',$reported);
foreach($reportedLinks as $link)check(strpos($reportedOut,$link)!==false);
check(post_ai_weight($reportedOut)<=280);
foreach(['https://link.amazon.evil.example/test','https://evil.link.amazon/test'] as $bad){try{post_ai_input(['mode'=>'rewrite','title'=>'バッグ','text'=>'資料','links'=>[['url'=>$bad]]]);check(false);}catch(RuntimeException $e){check($e->getMessage()!=='News parser check failed');}}
echo "Reported link.amazon, Rakuten and amzn.to links preserved; lookalikes rejected\n";

$cuteBodies=['🎀💖【リボン付きバッグ】💖🎀'."\n価格：880円（税込）",'💜✨【リボン付きバッグ】✨💜'."\n\n".str_repeat('💖 リボン付きバッグをご紹介。',25),'🌟💖【バッグの可愛い情報】💖🌟'."\n\n💖✨💖✨💖\nリボン付きバッグをご紹介。"];
$cuteJson=json_encode(['drafts'=>array_map(static fn($body)=>['body'=>$body],$cuteBodies)],JSON_UNESCAPED_UNICODE);
foreach([$post,$aiItem] as $cuteItem){
 $cute=ai_cute_validate($cuteJson,$cuteItem);
 check(count($cute['drafts'])===3&&$cute['premium']===true);
 check(ai_cute_length($cute['drafts'][0]['text'])<=200);
 check(post_ai_weight($cute['drafts'][1]['text'])>280);
 foreach($cute['drafts'] as $draft){
  check(preg_match('/[🎀💖💜🌟]/u',$draft['text'])===1);
  check(substr_count($draft['text'],'#')===(isset($cuteItem['mode'])?3:2));
  if(isset($cuteItem['mode'])){foreach($cuteItem['links'] as $link)check(strpos($draft['text'],$link['url'])!==false);check(substr($draft['text'],-3)==='#pr');}
  else check(strpos($draft['text'],$cuteItem['url'])!==false);
 }
}
$plainJson=json_encode(['drafts'=>array_fill(0,3,['body'=>'☆ リボン付きバッグ ♡'])],JSON_UNESCAPED_UNICODE);
$decorated=ai_cute_validate($plainJson,$post);
check(strpos($decorated['text'],'🎀💖')!==false&&strpos($decorated['text'],'☆')===false&&strpos($decorated['text'],'♡')===false);
foreach(['not json',json_encode(['drafts'=>[['body'=>'バッグ']]]),str_replace('880','999',$cuteJson),json_encode(['drafts'=>array_fill(0,3,['body'=>str_repeat('バッグ',80)])])] as $invalid){
 try{ai_cute_validate($invalid,$post);check(false);}catch(RuntimeException $e){check($e->getMessage()!=='News parser check failed');}
}
echo "Cute drafts: three choices, color decorations, short/premium lengths, fact checks and original links passed\n";

// Expanded official categories, API pagination rows, and independent source quotas.
check(news_url('https://www.sanrio.co.jp/news/campaign/test-20261001/')!=='');
check(news_url('https://www.sanrio.co.jp/news/spots/test-20261001/')!=='');
check(news_url('https://www.sanrio.co.jp/news/campaign/')==='');
check(news_url('https://www.sanrio.co.jp/news/campaign/../secret/')==='');
check(news_url('https://www.sanrio.co.jp.evil.example/news/campaign/test/')==='');
$official=news_official_rows(json_encode([
 ['link'=>'https://www.sanrio.co.jp/news/campaign/test-20261001/','title'=>['rendered'=>'新作 &amp; コラボ情報'],'acf'=>['publication_dt'=>'2026/10/01','base'=>['image_main'=>['url'=>'https://www.sanrio.co.jp/wp-content/uploads/2026/10/main.jpg']]]],
 ['link'=>'https://www.sanrio.co.jp/news/goods/hidden/','title'=>['rendered'=>'非表示の記事です'],'acf'=>['invisible'=>true]],
 ['link'=>'https://evil.example/news/goods/test/','title'=>['rendered'=>'偽のニュースです']]
]));
check(count($official)===1);check($official[0]['title']==='新作 & コラボ情報');check($official[0]['image']!=='');check($official[0]['date']==='2026/10/01');
$html='<article><a href="/main/html/rd/p/1.2.html" title="サンリオ新商品情報" style="background-image:url(/i/2/1/thumb/118x78/test.jpg)"></a><h3><a href="/main/html/rd/p/1.2.html">サンリオ新商品情報</a></h3><time datetime="2026-10-02T13:00:09+0900"></time></article>';
$pr=news_html_rows($html.$html);check(count($pr)===1);check($pr[0]['date']==='2026-10-02T13:00:09+0900');check($pr[0]['image']!=='');
$many=[];for($i=1;$i<=70;$i++)$many[]=['url'=>'https://www.sanrio.co.jp/news/goods/item-'.$i.'/','title'=>'公式ニュース','date'=>'2026/10/01','source'=>'サンリオ公式','image'=>''];
$stale=$pr[0];$stale['url']='https://prtimes.jp/main/html/rd/p/9.2.html';$stale['date']='2026-01-01';
$unknown=$pr[0];$unknown['url']='https://prtimes.jp/main/html/rd/p/8.2.html';$unknown['date']='';
$merged=news_merge_feeds([$many,$pr,$pr,[$stale,$unknown]],strtotime('2026-10-03'));
check(count($merged)===62);check($merged[0]['source']==='PR TIMES');check(count(array_filter($merged,fn($item)=>$item['source']==='PR TIMES'))===2);
check(count(news_feeds())===21);$eikohFeeds=array_values(array_filter(news_feeds(),fn($feed)=>$feed['kind']==='eikoh'));check(count($eikohFeeds)===1);check($eikohFeeds[0]['url']==='https://www.eikoh-prize.jp/shopbrand/ct200');check(count(array_filter(news_feeds(),fn($feed)=>$feed['kind']==='furyu'))===2);check(strpos(news_feeds()[2]['url'],'page=2')!==false);
echo "Expanded news sources, deduplication and quotas passed\n";

$groqItem=['title'=>'クロミのリボンバッグ','url'=>'https://www.sanrio.co.jp/news/goods/test-20261003/','paragraphs'=>['リボン付きバッグ。価格は880円（税込）。']];
$out=news_groq_validate(json_encode(['body'=>'🎀 クロミのリボンバッグ 💜' . "\n価格：880円（税込）"],JSON_UNESCAPED_UNICODE),$groqItem);
check(mb_strlen($out)<=300);check(strpos($out,$groqItem['url'])!==false);check(strpos(news_groq_prompt($groqItem),'1案だけ')!==false);
foreach(['not json',json_encode(['body'=>'🎀 価格：999円']),json_encode(['body'=>str_repeat('可愛い',120)]),json_encode(['body'=>'🎀 https://evil.example/']),json_encode(['body'=>'☆ クロミ ♡'])] as $bad){
 try{news_groq_validate($bad,$groqItem);check(false);}catch(RuntimeException $e){check($e->getMessage()!=='News parser check failed');}
}
echo "Groq single draft: 300 characters, original link, unsupported numbers and invalid output checked\n";

$groqProduct=post_ai_input(['mode'=>'product','title'=>'ウサハナ コスメポーチ','text'=>'サイズ：約200×130×55mm','links'=>[['kind'=>'rakuten','url'=>'https://hb.afl.rakuten.co.jp/hgc/'.str_repeat('a',500)]]]);
$groqProduct['url']='product';
$productText=news_groq_validate(json_encode(['body'=>'🎀 ウサハナのポーチ ✨' . "\nサイズ：約200×130×55mm"],JSON_UNESCAPED_UNICODE),$groqProduct);
check(ai_cute_length($productText)<=300);check(strpos($productText,$groqProduct['links'][0]['url'])!==false);check(substr($productText,-3)==='#pr');check(strpos(news_groq_prompt($groqProduct),'新規の商品紹介')!==false);
foreach(['🎀 素材：ポリエステル','🎀 価格未確認','🎀 在庫あります','🎀 サイズ：999mm',str_repeat('可愛い',120)] as $bad){
 try{news_groq_validate(json_encode(['body'=>$bad],JSON_UNESCAPED_UNICODE),$groqProduct);check(false);}catch(RuntimeException $e){check($e->getMessage()!=='News parser check failed');}
}
echo "Groq product draft: shared provider, 300 characters, long affiliate links and no material/price/stock passed\n";

$foreign=post_ai_input(['mode'=>'product','overseas'=>true,'region'=>'KR','title'=>'韓国のサンリオ商品','text'=>'韓国の公式一覧に掲載。国内発売・海外限定は未確認。','links'=>[]]);
check($foreign['overseas']===true&&$foreign['links']===[]);
check(str_contains(news_groq_prompt($foreign),'日本からの購入可否は未確認'));
$domestic=post_ai_input(['mode'=>'product','overseas'=>true,'region'=>'JP','title'=>'商品','text'=>'商品情報','links'=>[]]);check($domestic['overseas']===false);
// FURYU prizes: identity and schedule come from the requested body, never related items.
$furyuUrl='https://furyuprize.com/item/22561';
check(news_url($furyuUrl.'/')===$furyuUrl);
foreach(['https://furyuprize.com.evil.example/item/22561','https://furyuprize.com/item/22561/shoplist','https://furyuprize.com/item/22561?next=evil','http://furyuprize.com/item/22561'] as $bad)check(news_url($bad)==='');
check(news_image_url('https://furyuprize.com/files/images/prz/pi-main-22561.webp')!=='');
check(news_image_url('https://furyuprize.com/files/images/prz/pc-67.jpg')==='');
$frows=news_furyu_rows(file_get_contents(__DIR__.'/furyu-list.html'));check(count($frows)===3);check($frows[0]['prize']===true);check($frows[0]['date']==='');check($frows[0]['schedule']==='2026年10月2週');
$fd=news_parse(file_get_contents(__DIR__.'/furyu-detail.html'),$furyuUrl);check($fd['title']==='クロミ たれ耳ロリータBIGぬいぐるみ');check($fd['schedule']==='2026年10月2週');check($fd['date']==='');check(count($fd['images'])===1);check(strpos($fd['images'][0],'22561')!==false);check(in_array('種類：1種',$fd['paragraphs'],true));
$failed=false;try{news_parse(file_get_contents(__DIR__.'/furyu-detail.html'),'https://furyuprize.com/item/99999');}catch(RuntimeException $e){$failed=true;}check($failed);
check(strpos(ai_cute_suffix($fd),'https://')===false);check(strpos(ai_cute_suffix($fd),'詳細')===false);check(strpos(ai_cute_suffix($fd),'#pr')===false);
$good=news_groq_validate(json_encode(['body'=>'💜 クロミのたれ耳ロリータBIGぬいぐるみ✨\n2026年10月2週登場予定。店舗により時期が前後します。'],JSON_UNESCAPED_UNICODE),$fd);check(strpos($good,'https://')===false);
foreach(['💜 10月2日登場','💜 10月2週登場予定','💜 詳細はこちら','💜 価格は1円'] as $bad){$failed=false;try{news_groq_validate(json_encode(['body'=>$bad],JSON_UNESCAPED_UNICODE),$fd);}catch(RuntimeException $e){$failed=true;}check($failed);}
echo "FURYU identity, weekly schedule, photo scope and URL-free draft checks passed\n";
$artsUrl='https://www.takaratomy-arts.co.jp/items/item.html?n=Y111372';$rementUrl='https://www.re-ment.co.jp/product/r70125';
check(news_url($artsUrl)===$artsUrl);check(news_url($rementUrl)===$rementUrl);
foreach(['https://www.takaratomy-arts.co.jp/items/item.html?n=Y111372&next=evil','https://www.re-ment.co.jp.evil.example/product/r70125','https://www.re-ment.co.jp/product/../r70125','https://www.takaratomy-arts.co.jp/items/item.html?n=Y111372#test'] as $bad)check(news_url($bad)==='');
$rows=news_arts_rows(file_get_contents(__DIR__.'/arts-news-list.json'),strtotime('2026-10-05'));check(count($rows)===2);check($rows[0]['date']==='');check($rows[0]['schedule']==='発売時期：2026年10月');check($rows[0]['tipsOnly']===true);
check(!news_extra_recent('2025年10月',strtotime('2026-10-05')));
$arts=news_parse(file_get_contents(__DIR__.'/arts-news-detail.html'),$artsUrl);check($arts['schedule']==='発売時期：2026年10月');check(count($arts['images'])===3);check(strpos(implode(' ',$arts['images']),'Y099999')===false);
$rr=news_rement_rows(file_get_contents(__DIR__.'/rement-news-list.html'));check(count($rr)===8);check($rr[0]['url']===$rementUrl);
$rm=news_parse(file_get_contents(__DIR__.'/rement-news-detail.html'),$rementUrl);check($rm['title']==='タキシードサムのおしゃれなおうち TUXEDOSAM ROOM');check($rm['schedule']==='発売時期：2026年10月26日');check(count($rm['images'])===8);check($rm['date']==='');
$failed=false;try{news_parse(file_get_contents(__DIR__.'/rement-news-detail.html'),'https://www.re-ment.co.jp/product/r99999');}catch(RuntimeException $e){$failed=true;}check($failed);
check(strpos(ai_cute_suffix($arts),'http')===false);check(strpos(ai_cute_suffix($rm),'詳細')===false);
foreach(['🎀 2026年10月10日発売','🎀 詳細はこちら'] as $body){$failed=false;try{news_groq_validate(json_encode(['body'=>$body],JSON_UNESCAPED_UNICODE),$arts);}catch(RuntimeException $e){$failed=true;}check($failed);}
echo "Manufacturer identities, date precision, recent products and image scopes passed\n";

$eikohList='<a href="/shopdetail/000000002622/ct200/page1/recommend/"><img src="https://makeshop-multi-images.akamaized.net/eikoh/shopimages/01/00/main_2622.jpg">サンリオキャラクターズ ラブレターフォーユーマスコット1</a>';
$eikohRows=news_eikoh_rows($eikohList);check(count($eikohRows)===1);check($eikohRows[0]['source']==='エイコープライズ');check($eikohRows[0]['date']==='');check($eikohRows[0]['tipsOnly']===true);
$eikohUrl='https://www.eikoh-prize.jp/shopdetail/000000002622/ct200/page1/recommend/';
$eikohDetail='<meta property="og:url" content="https://www.eikoh-prize.jp/shopdetail/000000002622/"><h1>サンリオキャラクターズ ラブレターフォーユーマスコット1</h1><p>9月1週より順次登場</p><img src="https://makeshop-multi-images.akamaized.net/eikoh/shopimages/01/00/main_2622.jpg">';
$eikohItem=news_parse($eikohDetail,$eikohUrl);check($eikohItem['schedule']==='登場時期：9月1週より順次登場');check($eikohItem['date']==='');check($eikohItem['tipsOnly']===true);
check(news_url('https://www.eikoh-prize.jp.evil.example/shopdetail/000000002622/ct200/page1/recommend/')==='');check(news_eikoh_identity_matches($eikohUrl,'https://www.eikoh-prize.jp/shopdetail/000000002622/'));check(!news_eikoh_identity_matches($eikohUrl,'https://www.eikoh-prize.jp/shopdetail/000000002657/'));check(news_image_url('https://makeshop-multi-images.akamaized.net/eikoh/shopimages/01/00/main_2622.jpg?cmsp_timestamp=1')==='https://makeshop-multi-images.akamaized.net/eikoh/shopimages/01/00/main_2622.jpg');
check(news_image_url('https://makeshop-multi-images.akamaized.net.eikoh/shopimages/01/00/main_2622.jpg')==='');check(news_url('https://www.eikoh-prize.jp/shopdetail/000000002657/ct200/page1/recommend/')==='https://www.eikoh-prize.jp/shopdetail/000000002657/ct200/page1/recommend/');check($eikohItem['image']==='https://makeshop-multi-images.akamaized.net/eikoh/shopimages/01/00/main_2622.jpg');
check(news_feed_source(['kind'=>'html','url'=>'https://prtimes.jp/topics/keywords/test'])==='PR TIMES');
check(news_feed_source(['kind'=>'html','url'=>'https://www.sanrio.co.jp/news/'])==='サンリオ公式');check(news_feed_source(['kind'=>'eikoh','url'=>'https://www.eikoh-prize.jp/shopbrand/ct200/'])==='エイコープライズ');
$status=news_source_statuses(['サンリオ公式'=>['ok'=>2,'failed'=>1],'サンキューマート'=>['ok'=>0,'failed'=>1],'フリュー'=>['ok'=>1,'failed'=>0],'エイコープライズ'=>['ok'=>1,'failed'=>0]],[['source'=>'サンリオ公式']]);
check($status['サンリオ公式']['state']==='partial');check($status['サンリオ公式']['count']===1);check($status['サンキューマート']['state']==='failed');check($status['フリュー']['state']==='ok');check($status['エイコープライズ']['state']==='ok');
check(news_source_statuses(['リーメント'=>['ok'=>1,'failed'=>2]],[])['リーメント']['state']==='failed');
echo "Per-source partial, failed and empty successful feed states passed\n";

// Regression: live MakeShop structure has EUC-JP and separate image/name anchors.
$legacy='<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP"><div class="innerBox"><a href="/shopdetail/000000002657/ct200/page1/recommend/"><img alt="サンリオキャラクターズ マスコット" src="https://makeshop-multi-images.akamaized.net/eikohprize/itemimages/000000002657_test.jpg"></a><p><a href="/shopdetail/000000002657/ct200/page1/recommend/">サンリオキャラクターズ マスコット</a></p></div>';
$legacyRows=news_eikoh_rows(mb_convert_encoding($legacy,'EUC-JP','UTF-8'));check(count($legacyRows)===1);check($legacyRows[0]['title']==='サンリオキャラクターズ マスコット');check($legacyRows[0]['image']!=='');
echo "Eikoh EUC-JP and split-anchor regression passed\n";
