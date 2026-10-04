<?php
declare(strict_types=1);
$config=require __DIR__.'/config.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Robots-Tag: noindex, nofollow, noarchive');

function h(string $s):string{return htmlspecialchars($s,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
function fail_page(string $msg,int $status=400):never{
  http_response_code($status);
  echo '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>共有ページ</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff7fb;color:#29252d;margin:0;padding:24px}.box{max-width:720px;margin:auto;background:#fff;border:1px solid #eadfe6;border-radius:18px;padding:20px;line-height:1.7}a{color:#7c4560}</style><div class="box"><h1>共有ページを開けませんでした</h1><p>'.h($msg).'</p></div></html>';
  exit;
}

$token=strtolower(trim((string)($_GET['token']??'')));
if(!preg_match('/^[a-f0-9]{64}$/',$token))fail_page('リンクが正しくありません。',400);
$syncKey=(string)($config['sync_key']??'');
if($syncKey==='')fail_page('共有機能の設定がありません。',503);
$expected=hash_hmac('sha256','sanrio-post-helper-private-share-token-v1',$syncKey);
if(!hash_equals($expected,$token))fail_page('この共有リンクは現在の設定と一致しません。アプリで共有リンクを作り直してください。',404);
try{
  $pdo=new PDO((string)$config['db_dsn'],$config['db_user'],$config['db_password'],[
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES=>false,
  ]);
  $ownerHash=hash_hmac('sha256','sanrio-post-helper-private-share-owner-v1',$syncKey);
  $q=$pdo->prepare('SELECT snapshot,updated_at FROM sanrio_post_helper_share WHERE owner_hash=? AND token_hash=?');
  $q->execute([$ownerHash,hash('sha256',$token)]);
  $row=$q->fetch();
}catch(Throwable $e){fail_page('共有データの保存先に接続できませんでした。',503);}
if(!$row)fail_page('固定共有リンクはまだ初期化されていません。Sanrio Post Helperで共有リンクを一度更新してください。',404);
$snapshot=json_decode((string)$row['snapshot'],true);
if(!is_array($snapshot))fail_page('共有データを読み込めませんでした。',500);
$posts=is_array($snapshot['posts']??null)?$snapshot['posts']:[];
$updated=(string)($row['updated_at']??'');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="theme-color" content="#fff7fb">
<title>Sanrio Post Helper 共有確認</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#29252d;background:#fff7fb}*{box-sizing:border-box}body{margin:0;padding:14px 10px 40px}main{max-width:760px;margin:auto}.head,.post{background:#fff;border:1px solid #eadfe6;border-radius:18px;padding:16px;margin-bottom:14px;box-shadow:0 4px 18px #33203308}.badge{display:inline-block;background:#f6e1eb;color:#7c4560;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700}h1{font-size:21px;margin:10px 0 6px}h2{font-size:18px;line-height:1.45;margin:0 0 6px}.meta{font-size:12px;color:#7f747d;margin-bottom:10px}.text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.media{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.media img{width:100%;height:auto;max-height:560px;object-fit:contain;border-radius:12px;background:#f7f3f6}.empty{color:#7f747d}a{color:#7c4560;overflow-wrap:anywhere}@media(max-width:520px){.media{grid-template-columns:1fr 1fr}}
</style>
</head>
<body><main>
<section class="head"><span class="badge">Sanrio Post Helper</span><h1>個人用確認ページ</h1><div class="meta">期限なし共有リンク<?= $updated!==''?' ・ 最終更新 '.h($updated):'' ?></div><div><?= count($posts) ?>件の投稿候補を表示しています。</div></section>
<?php if(!$posts): ?><section class="post empty">共有する投稿がありません。</section><?php endif; ?>
<?php foreach($posts as $post): if(!is_array($post))continue; ?>
<article class="post">
<h2><?= h((string)($post['title']??'投稿')) ?></h2>
<div class="meta"><?= h((string)($post['postedAt']??'')) ?></div>
<?php if((string)($post['text']??'')!==''): ?><div class="text"><?= h((string)$post['text']) ?></div><?php endif; ?>
<?php $images=is_array($post['images']??null)?$post['images']:[]; if($images): ?><div class="media"><?php foreach($images as $src): if(!is_string($src)||!preg_match('~^https://~i',$src))continue; ?><img src="<?= h($src) ?>" alt="投稿写真" loading="lazy"><?php endforeach; ?></div><?php endif; ?>
<?php if(!empty($post['xUrl'])&&is_string($post['xUrl'])): ?><p><a href="<?= h($post['xUrl']) ?>" target="_blank" rel="noopener noreferrer">Xで開く</a></p><?php endif; ?>
</article>
<?php endforeach; ?>
</main></body></html>
