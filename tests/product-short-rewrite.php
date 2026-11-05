<?php
define('SPH_NEWS_TEST',true);
require __DIR__.'/../server/lolipop/news.php';
function expect($v){if(!$v)throw new RuntimeException('Product rewrite regression failed');}
$item=['title'=>'ウサハナ マスコットホルダー','paragraphs'=>["商品情報\n資料：ウサハナ マスコットホルダー\n耳あて付きのデザイン。\n※チーク部分は手作業で着色しているため風合いが異なります。"]];
$source=news_product_short_options($item);
expect(strpos($source['source'],'耳あて')!==false);
$draft=['identityMatch'=>true,'categories'=>['design'=>['耳あて付きのデザイン。'],'specification'=>[],'caution'=>['※チーク部分は手作業で着色しているため風合いが異なります。'],'other'=>[]],'body'=>'ウサハナのマスコットホルダー🎀 耳あて姿に注目💕','evidence'=>['耳あて付きのデザイン。']];
expect(news_product_short_result(json_encode($draft),$item,$source)['body']===$draft['body']);
foreach(['identity','quote','caution','empty','long','link'] as $case){
 $bad=$draft;
 if($case==='identity')$bad['identityMatch']=false;
 if($case==='quote')$bad['evidence']=['小物を収納できます'];
 if($case==='caution')$bad['body']='チーク部分は手作業で着色しています';
 if($case==='empty')$bad['body']='';
 if($case==='long')$bad['body']=str_repeat('あ',181);
 if($case==='link')$bad['body']='https://example.com';
 $rejected=false;try{news_product_short_result(json_encode($bad),$item,$source);}catch(RuntimeException $e){$rejected=true;}
 expect($rejected);
}
$links=['mode'=>'product','title'=>'ウサハナ','links'=>[['kind'=>'rakuten','url'=>'https://a.r10.to/example?x=1&y=2']]];
expect(strpos(ai_cute_suffix($links),$links['links'][0]['url'])!==false);
echo "Product rewrite validation: 8 checks passed (mock outputs, not live AI).\n";
