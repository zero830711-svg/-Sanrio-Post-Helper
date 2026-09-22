<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = $config['allowed_origins'] ?? [];
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function token(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    return preg_match('/^Bearer\s+(.+)$/i', $h, $m) ? trim($m[1]) : '';
}
$expected = (string)($config['sync_key'] ?? '');
if ($expected === '' || !hash_equals($expected, token())) respond(['ok'=>false,'error'=>'Unauthorized'], 401);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(['ok'=>false,'error'=>'POST required'], 405);

$postId = trim((string)($_POST['post_id'] ?? ''));
if (!preg_match('/^[0-9]{1,64}$/', $postId)) respond(['ok'=>false,'error'=>'Valid post_id required'], 400);
if (!isset($_FILES['media']) || !is_uploaded_file($_FILES['media']['tmp_name'])) respond(['ok'=>false,'error'=>'media file required'], 400);

$file = $_FILES['media'];
if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) respond(['ok'=>false,'error'=>'Upload failed'], 400);
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: 'application/octet-stream';
$allowed = ['image/jpeg'=>'image','image/png'=>'image','image/gif'=>'gif','video/mp4'=>'video','video/quicktime'=>'video','video/webm'=>'video'];
if (!isset($allowed[$mime])) respond(['ok'=>false,'error'=>'Unsupported media type'], 415);

$hash = hash_file('sha256', $file['tmp_name']);
$ext = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));
$ext = preg_match('/^[a-z0-9]{1,8}$/', $ext) ? $ext : 'bin';
$stored = $hash . '.' . $ext;
$relative = 'media/' . $postId . '/' . $stored;
$root = rtrim((string)($config['media_root'] ?? ''), DIRECTORY_SEPARATOR);
if ($root === '') respond(['ok'=>false,'error'=>'Media storage is not configured'], 500);

$dir = $root . DIRECTORY_SEPARATOR . 'media' . DIRECTORY_SEPARATOR . $postId;
if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) respond(['ok'=>false,'error'=>'Storage unavailable'], 500);
$target = $dir . DIRECTORY_SEPARATOR . $stored;
if (!is_file($target) && !move_uploaded_file($file['tmp_name'], $target)) respond(['ok'=>false,'error'=>'Could not store media'], 500);

$pdo = new PDO((string)$config['db_dsn'], $config['db_user'], $config['db_password'], [
  PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false
]);
$stmt = $pdo->prepare('INSERT INTO sanrio_post_media
  (post_id, media_type, original_name, stored_name, storage_path, public_url, mime_type, byte_size, sha256)
  VALUES (:post_id,:media_type,:original_name,:stored_name,:storage_path,:public_url,:mime_type,:byte_size,:sha256)
  ON DUPLICATE KEY UPDATE public_url=VALUES(public_url), storage_path=VALUES(storage_path)');
$base = rtrim((string)($config['media_public_base'] ?? ''), '/');
$url = $base !== '' ? $base . '/' . $relative : null;
$stmt->execute([
  ':post_id'=>$postId, ':media_type'=>$allowed[$mime], ':original_name'=>basename((string)$file['name']),
  ':stored_name'=>$stored, ':storage_path'=>$relative, ':public_url'=>$url, ':mime_type'=>$mime,
  ':byte_size'=>(int)$file['size'], ':sha256'=>$hash
]);
respond(['ok'=>true,'postId'=>$postId,'sha256'=>$hash,'storagePath'=>$relative,'publicUrl'=>$url]);
