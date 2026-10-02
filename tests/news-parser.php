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
