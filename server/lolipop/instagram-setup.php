<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
function ig_worker(array $input): array {
    $bins = array_merge(glob('/usr/local/python/*/bin/python') ?: [], ['/usr/bin/python3']);
    $input['privateDir'] = sys_get_temp_dir().'/sph-ig-'.hash('sha256', __DIR__);
    foreach ($bins as $bin) {
        if (!is_file($bin) || !is_executable($bin)) continue;
        $lock = fopen($input['privateDir'].'.lock', 'c+');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return ['ok'=>false,'message'=>'処理中です。しばらくお待ちください。'];
        @chmod($input['privateDir'].'.lock', 0600);
        $pipes = [];
        try {
            $process = proc_open([$bin, __DIR__.'/instagram-worker.py'], [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']], $pipes);
            if (!is_resource($process)) continue;
            fwrite($pipes[0], json_encode($input)); fclose($pipes[0]);
            stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
            $body = ''; $deadline = microtime(true) + 70;
            do {
                $body .= stream_get_contents($pipes[1], 32768);
                stream_get_contents($pipes[2], 8192);
                $status = proc_get_status($process);
                if (!$status['running']) break;
                usleep(50000);
            } while (microtime(true) < $deadline && strlen($body) < 65536);
            if ($status['running']) proc_terminate($process, 9);
            $body .= stream_get_contents($pipes[1], 32768);
            fclose($pipes[1]); fclose($pipes[2]); proc_close($process);
            $result = json_decode($body, true);
            return is_array($result) ? $result : ['ok'=>false,'message'=>'処理が時間切れになりました。自動再試行はしません。'];
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }
    return ['ok'=>false,'message'=>'Pythonの実行環境が見つかりません。'];
}
$config = require __DIR__.'/config.php';
$token = '';
if (preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) $token = trim($m[1]);
if ($token && !empty($config['sync_key']) && hash_equals((string)$config['sync_key'], $token)) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(ig_worker(['action'=>'runtime']), JSON_UNESCAPED_UNICODE); exit;
}
session_name('sph_ig_setup');
session_set_cookie_params(['lifetime'=>1800, 'path'=>parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), 'secure'=>true, 'httponly'=>true, 'samesite'=>'Strict']);
session_start();
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
$message = ''; $result = [];
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $validCsrf = is_string($_POST['csrf'] ?? null) && hash_equals($_SESSION['csrf'], $_POST['csrf']);
    if (!in_array($origin, ['', 'null', 'https://fan-info.zombie.jp'], true) || !$validCsrf) {
        http_response_code(403);
        $message = '画面の確認ができませんでした。このページを開き直して、もう一度入力してください。';
    } else {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) { http_response_code(413); exit; }
    if (($_POST['action'] ?? '') === 'unlock') {
        if (!empty($config['sync_key']) && hash_equals((string)$config['sync_key'], (string)($_POST['sync_key'] ?? ''))) {
            session_regenerate_id(true); $_SESSION['unlockedUntil'] = time()+1800; $_SESSION['csrf'] = bin2hex(random_bytes(24));
        } else { $message='同期キーが一致しません。'; }
    } elseif (($_SESSION['unlockedUntil'] ?? 0) > time() && hash_equals((string)($_SESSION['csrf'] ?? ''), (string)($_POST['csrf'] ?? ''))) {
        @set_time_limit(85);
        $action = $_POST['action'] ?? '';
        if (in_array($action, ['login','two_factor','collect'], true)) {
            if (time() - (int)($_SESSION['lastAttempt'] ?? 0) < 30) $result=['ok'=>false,'message'=>'30秒以上間隔を空けてください。'];
            else {
                $_SESSION['lastAttempt'] = time();
                $result = ig_worker(['action'=>$action,'username'=>substr((string)($_POST['username'] ?? ''),0,100),'password'=>substr((string)($_POST['password'] ?? ''),0,1024),'code'=>substr((string)($_POST['code'] ?? ''),0,20)]);
                $_SESSION['state'] = $result['state'] ?? 'blocked';
            }
            $message = $result['message'] ?? '';
        }
    } else { http_response_code(403); $message='画面の有効時間が切れました。'; }
    }
}
$unlocked = ($_SESSION['unlockedUntil'] ?? 0) > time();
function ig_h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
?>
<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram収集の初回設定</title>
<style>body{font-family:system-ui;background:#fff7fb;color:#302a35;margin:24px auto;padding:0 20px;max-width:560px}label{display:block;margin:16px 0}input,button{box-sizing:border-box;width:100%;padding:14px;border:1px solid #ddd;border-radius:12px;font:inherit}button{background:#f8ddea;font-weight:bold}.status{padding:16px;background:white;border-radius:12px}small{color:#756977}</style>
<h1>Instagram収集の初回設定</h1><p>friendcharactersの写真と本文を、サーバーから取得できるか検証します。</p>
<p><small>Instagramの認証情報はこのサーバーからInstagramへ送信します。パスワードは保存せず、成功したログイン状態だけを非公開領域に保存します。追加認証やアクセス制限が出た場合は停止します。</small></p>
<?php if ($message): ?><p class="status"><?=ig_h($message)?></p><?php endif; ?>
<?php if (!$unlocked): ?>
<form method="post"><input type="hidden" name="action" value="unlock"><input type="hidden" name="csrf" value="<?=ig_h($_SESSION['csrf'])?>"><label>アプリの同期キー<input name="sync_key" type="password" autocomplete="off" required></label><button type="submit">設定画面を開く</button></form>
<?php elseif (($_SESSION['state'] ?? '') === 'two_factor'): ?>
<form method="post"><input type="hidden" name="action" value="two_factor"><input type="hidden" name="csrf" value="<?=ig_h($_SESSION['csrf'])?>"><label>二段階認証コード<input name="code" type="text" autocomplete="one-time-code" required></label><button type="submit">認証する</button></form>
<?php elseif (in_array($_SESSION['state'] ?? '', ['authenticated','collected'], true)): ?>
<?php if (($result['state'] ?? '') === 'collected'): ?><p>取得できた写真：<?=(int)$result['photoCount']?>枚／本文：<?=(int)$result['captionLength']?>文字</p><p>投稿URL：<?=ig_h($result['postUrl'])?></p><?php endif; ?>
<form method="post"><input type="hidden" name="action" value="collect"><input type="hidden" name="csrf" value="<?=ig_h($_SESSION['csrf'])?>"><button type="submit">投稿1件の取得を検証</button></form>
<?php else: ?>
<form method="post"><input type="hidden" name="action" value="login"><input type="hidden" name="csrf" value="<?=ig_h($_SESSION['csrf'])?>"><label>Instagramユーザーネーム<input name="username" type="text" autocomplete="username" required></label><label>Instagramパスワード<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Instagramで認証する</button></form>
<?php endif; ?></html>
