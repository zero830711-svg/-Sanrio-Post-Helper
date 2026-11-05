<?php
// Run manually/deployment verification only. Never prints authentication or saved links.
$config=require $argv[1];
$base='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/';
function api(string $path,?array $data=null):array{
 global $config,$base;
 $c=curl_init($base.$path);$headers=['Authorization: Bearer '.$config['sync_key'],'Origin: https://zero830711-svg.github.io'];
 if($data!==null){$headers[]='Content-Type: application/json';curl_setopt($c,CURLOPT_POSTFIELDS,json_encode($data,JSON_UNESCAPED_UNICODE));}
 curl_setopt_array($c,[CURLOPT_HTTPHEADER=>$headers,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>115,CURLOPT_CONNECTTIMEOUT=>10]);
 $raw=curl_exec($c);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
 $d=json_decode((string)$raw,true);if($status!==200||empty($d['ok']))throw new RuntimeException('API確認失敗 HTTP '.$status.' '.($d['error']??''));return $d;
}
$cases=[
 ['title'=>'ウサハナ マスコットホルダー（あったかキャラコーデ）','match'=>'ウサハナ','series'=>'あったかキャラコーデ','text'=>'※チーク部分は手作業で着色しているため、風合いが異なることがあります。'],
 ['title'=>'ポチャッコ マスコットホルダー（スウィートケーキコレクション）','match'=>'ポチャッコ','series'=>'スウィートケーキ','code'=>'sanrio:n-2603-231631','url'=>'https://item.rakuten.co.jp/sanrio/n-2603-231631/','text'=>'ケーキのデコレーションのようにさくらんぼをトッピングした帽子。バッグやリュックにつけて一緒にお出かけ。カラビナ取り外し可。'],
 ['title'=>'ぷちとも Sanrio characters みんなでクリスマス','match'=>'ぷちとも','series'=>'クリスマス','text'=>'かわいいお洋服付き ふわふわのフロッキードール。全19種（うちシークレット1種）。全キャラクターにきらきら表情もあるよ。いずれか1つが入っています。セット内容以外は別売りです。']
];
$catalog=[];
try{$catalog=api('lovely-watch.php?action=list&source=sanrio')['items']??[];}catch(Throwable $e){echo "Catalog unavailable; screenshot-transcribed fixtures will be used.\n";}
foreach($cases as $case){
 $material=$case['title']."\n".$case['text'];$source='ユーザー提供スクリーンショットの文字情報（見た目の推測は含めない）';
 foreach($catalog as $item)if(strpos($item['title']??'',$case['match'])!==false&&strpos($item['title']??'',$case['series'])!==false){$case['url']=$item['url'];$case['code']=$item['productInfo']['itemCode']??'';break;}
 if(!empty($case['code']))try{
  $item=api('lovely-watch.php?action=detail&url='.rawurlencode($case['url']).'&code='.rawurlencode($case['code']))['item']??null;
  if($item&&strpos($item['title'],$case['match'])!==false&&strpos($item['title'],$case['series'])!==false&&!empty($item['productInfo']['description'])){
   $material=$item['title']."\n販売ページの商品名：".$item['productInfo']['title']."\n楽天販売ページの商品説明：".$item['productInfo']['description'];$source=$case['url'];
  }
 }catch(Throwable $e){echo "Product detail unavailable; using screenshot fixture.\n";}
 try{
  // This is a test-only link; output only the body, never a ready-to-share test URL.
  $r=api('news.php?action=product-groq-draft',['mode'=>'product','extendedProduct'=>true,'title'=>$case['title'],'text'=>"商品情報\n資料：".$material,'links'=>[['kind'=>'rakuten','url'=>'https://www.rakuten.co.jp/']]]);
  if(($r['generation']??'')!=='verified-rewrite')throw new RuntimeException('検証済み生成の応答ではありません');
  $body=explode("\n\n楽天：",$r['text'])[0];
  echo json_encode(['product'=>$case['title'],'source'=>$source,'body'=>$body,'evidence'=>$r['evidence'],'model'=>$r['model']],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n";
 }catch(Throwable $e){echo json_encode(['product'=>$case['title'],'source'=>$source,'unverified'=>$e->getMessage()],JSON_UNESCAPED_UNICODE)."\n";}
}
