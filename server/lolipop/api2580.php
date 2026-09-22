<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = $config['allowed_origins'] ?? [];
if ($origin && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function bearerToken(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\\s+(.+)$/i', $header, $m)) return trim($m[1]);
    return '';
}
function readPayload(): array {
    $body = null;
    if (isset($_POST['payload_b64'])) {
        $decoded = base64_decode((string)$_POST['payload_b64'], true);
        if ($decoded !== false) $body = json_decode($decoded, true);
    }
    if (!is_array($body) && isset($_POST['payload'])) $body = json_decode((string)$_POST['payload'], true);
    if (!is_array($body)) {
        $raw = file_get_contents('php://input');
        if ($raw !== '') $body = json_decode($raw, true);
    }
    return is_array($body) ? $body : [];
}
function safeMediaUrls($value): array {
    if (!is_array($value)) return [];
    $out=[];
    foreach($value as $url){
        if(!is_string($url))continue;$url=trim($url);
        if($url!=='' && preg_match('~^https?://~i',$url))$out[]=$url;
    }
    return array_values(array_unique($out));
}
function newestClientDate(array $item): ?string {
    $keys = ['updatedAt','lastRepostedAt','candidateExcludedChangedAt','skippedAt','revenueRecommendedAt','recommendedAt','savedAt','postedAt','deletedAt'];
    $best = 0;
    foreach ($keys as $key) {
        if (empty($item[$key])) continue;
        $t = strtotime((string)$item[$key]);
        if ($t !== false && $t > $best) $best = $t;
    }
    return $best ? date('Y-m-d H:i:s', $best) : null;
}

$token = bearerToken();
$expected = (string)($config['sync_key'] ?? '');
if ($expected === '' || $token === '' || !hash_equals($expected, $token)) respond(['ok'=>false,'error'=>'Unauthorized'],401);

try {
    $pdo = new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES=>false,
    ]);
} catch (Throwable $e) { respond(['ok'=>false,'error'=>'Database connection failed'],500); }

$action = $_GET['action'] ?? 'ping';

if ($action === 'ping') {
    respond(['ok'=>true,'apiVersion'=>'2580','serverTime'=>date('Y-m-d H:i:s')]);
}

if ($action === 'pull') {
    $rows=$pdo->query('SELECT payload FROM sanrio_post_sync ORDER BY updated_at ASC')->fetchAll();
    $items=[];
    foreach($rows as $row){
        $decoded=json_decode($row['payload'],true);
        if(is_array($decoded))$items[]=$decoded;
    }
    respond(['ok'=>true,'apiVersion'=>'2580','items'=>$items,'count'=>count($items)]);
}

if ($action === 'delete') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(['ok'=>false,'error'=>'POST required'],405);
    $body=readPayload();
    $ids=$body['ids'] ?? null;
    if(!is_array($ids))respond(['ok'=>false,'error'=>'ids array required','apiVersion'=>'2580'],400);
    $deletedAt=(string)($body['deletedAt'] ?? gmdate('c'));
    $clientDate=date('Y-m-d H:i:s',strtotime($deletedAt) ?: time());
    $sql='INSERT INTO sanrio_post_sync (id, canonical_key, payload, client_updated_at)
          VALUES (:id, NULL, :payload, :client_updated_at)
          ON DUPLICATE KEY UPDATE
            canonical_key = IF(client_updated_at IS NULL OR VALUES(client_updated_at) >= client_updated_at, NULL, canonical_key),
            payload = IF(client_updated_at IS NULL OR VALUES(client_updated_at) >= client_updated_at, VALUES(payload), payload),
            client_updated_at = GREATEST(COALESCE(client_updated_at, VALUES(client_updated_at)), VALUES(client_updated_at))';
    $stmt=$pdo->prepare($sql);
    $pdo->beginTransaction();
    try{
        foreach($ids as $id){
            $id=(string)$id; if($id==='')continue;
            $payload=json_encode(['id'=>$id,'_deleted'=>true,'deletedAt'=>$deletedAt],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
            $stmt->execute([':id'=>$id,':payload'=>$payload,':client_updated_at'=>$clientDate]);
        }
        $pdo->commit();
    }catch(Throwable $e){
        if($pdo->inTransaction())$pdo->rollBack();
        respond(['ok'=>false,'error'=>'Delete sync failed'],500);
    }
    respond(['ok'=>true,'apiVersion'=>'2580','count'=>count($ids)]);
}

if ($action === 'push') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(['ok'=>false,'error'=>'POST required'],405);
    $body=readPayload();
    $items=$body['items'] ?? null;
    if(!is_array($items))respond(['ok'=>false,'error'=>'items array required','apiVersion'=>'2580'],400);
    if(count($items)>200)respond(['ok'=>false,'error'=>'Maximum 200 items per request'],400);

    $sql='INSERT INTO sanrio_post_sync (id, canonical_key, payload, client_updated_at)
          VALUES (:id, :canonical_key, :payload, :client_updated_at)
          ON DUPLICATE KEY UPDATE
            canonical_key = IF(client_updated_at IS NULL OR VALUES(client_updated_at) >= client_updated_at, VALUES(canonical_key), canonical_key),
            payload = IF(client_updated_at IS NULL OR VALUES(client_updated_at) >= client_updated_at, VALUES(payload), payload),
            client_updated_at = GREATEST(COALESCE(client_updated_at, VALUES(client_updated_at)), VALUES(client_updated_at))';
    $stmt=$pdo->prepare($sql);
    $pdo->beginTransaction();
    try{
        foreach($items as $item){
            if(!is_array($item)||empty($item['id']))continue;
            $images=safeMediaUrls($item['images'] ?? []);
            if(empty($images) && !empty($item['image']) && is_string($item['image']) && preg_match('~^https?://~i',$item['image']))$images[]=$item['image'];
            $item['images']=$images;
            $item['videos']=safeMediaUrls($item['videos'] ?? []);
            unset($item['image']);
            $canonicalKey=null;
            if(!empty($item['postId']))$canonicalKey='post:'.(string)$item['postId'];
            elseif(!empty($item['xUrl'])&&preg_match('~/status/(\\d+)~',(string)$item['xUrl'],$m))$canonicalKey='post:'.$m[1];
            $clientUpdatedAt=newestClientDate($item);
            $stmt->execute([
                ':id'=>(string)$item['id'],
                ':canonical_key'=>$canonicalKey,
                ':payload'=>json_encode($item,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),
                ':client_updated_at'=>$clientUpdatedAt,
            ]);
        }
        $pdo->commit();
    }catch(Throwable $e){
        if($pdo->inTransaction())$pdo->rollBack();
        respond(['ok'=>false,'error'=>'Save failed'],500);
    }
    respond(['ok'=>true,'apiVersion'=>'2580','count'=>count($items)]);
}

respond(['ok'=>false,'error'=>'Unknown action'],404);
