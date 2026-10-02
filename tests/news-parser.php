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
$cache=sys_get_temp_dir().'/sph-news-v5-'.hash('sha256',dirname(__DIR__).'/server/lolipop'.$url).'.json';
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
$limit=min(210,280-mb_strlen("\n\n詳細：\n".$url."\n#サンリオ"));
check(strpos($prompt,'本文のみ'.$limit.'文字以内')!==false);
$longItem=$aiItem;$longItem['url']=$url.str_repeat('a',50);
check(news_ai_prompt($longItem)!==$prompt);
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
