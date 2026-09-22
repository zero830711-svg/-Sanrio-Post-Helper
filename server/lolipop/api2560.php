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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function bearerToken(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
        return trim($m[1]);
    }
    return '';
}

$token = bearerToken();
$expected = (string)($config['sync_key'] ?? '');
if ($expected === '' || $token === '' || !hash_equals($expected, $token)) {
    respond(['ok' => false, 'error' => 'Unauthorized'], 401);
}

try {
    $pdo = new PDO(
        $config['db_dsn'],
        $config['db_user'],
        $config['db_password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (Throwable $e) {
    respond(['ok' => false, 'error' => 'Database connection failed'], 500);
}

$action = $_GET['action'] ?? 'ping';

if ($action === 'ping') {
    respond([
        'ok' => true,
        'apiVersion' => '2560',
        'serverTime' => date('Y-m-d H:i:s'),
    ]);
}

if ($action === 'pull') {
    $rows = $pdo->query('SELECT payload FROM sanrio_post_sync ORDER BY updated_at ASC')->fetchAll();
    $items = [];
    foreach ($rows as $row) {
        $decoded = json_decode($row['payload'], true);
        if (is_array($decoded)) $items[] = $decoded;
    }
    respond(['ok' => true, 'items' => $items, 'count' => count($items)]);
}

if ($action === 'push') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['ok' => false, 'error' => 'POST required'], 405);
    }

    $raw = file_get_contents('php://input');
    $body = null;
    $jsonError = '';

    // 1) Base64 field (shared-hosting safe path)
    if (isset($_POST['payload_b64'])) {
        $decoded = base64_decode((string)$_POST['payload_b64'], true);
        if ($decoded !== false) {
            $body = json_decode($decoded, true);
            if (!is_array($body)) $jsonError = json_last_error_msg();
        }
    }

    // 2) Normal form field fallback
    if (!is_array($body) && isset($_POST['payload'])) {
        $body = json_decode((string)$_POST['payload'], true);
        if (!is_array($body)) $jsonError = json_last_error_msg();
    }

    // 3) Raw JSON fallback
    if (!is_array($body) && $raw !== '') {
        $body = json_decode($raw, true);
        if (!is_array($body)) $jsonError = json_last_error_msg();
    }

    $items = is_array($body) ? ($body['items'] ?? null) : null;
    if (!is_array($items)) {
        respond([
            'ok' => false,
            'error' => 'items array required',
            'contentType' => $_SERVER['CONTENT_TYPE'] ?? '',
            'rawLength' => strlen((string)$raw),
            'hasFormPayload' => isset($_POST['payload']),
            'apiVersion' => '2560',
        ], 400);
    }
    if (count($items) > 200) {
        respond(['ok' => false, 'error' => 'Maximum 200 items per request'], 400);
    }

    $sql = 'INSERT INTO sanrio_post_sync (id, canonical_key, payload, client_updated_at)
            VALUES (:id, :canonical_key, :payload, :client_updated_at)
            ON DUPLICATE KEY UPDATE
              canonical_key = VALUES(canonical_key),
              payload = VALUES(payload),
              client_updated_at = VALUES(client_updated_at)';
    $stmt = $pdo->prepare($sql);

    $pdo->beginTransaction();
    try {
        foreach ($items as $item) {
            if (!is_array($item) || empty($item['id'])) continue;

            // 画像データはサーバーへ保存しない
            unset($item['images'], $item['image']);

            $canonicalKey = null;
            if (!empty($item['postId'])) {
                $canonicalKey = 'post:' . (string)$item['postId'];
            } elseif (!empty($item['xUrl']) && preg_match('~/status/(\d+)~', (string)$item['xUrl'], $m)) {
                $canonicalKey = 'post:' . $m[1];
            }

            $clientDate = $item['updatedAt'] ?? $item['savedAt'] ?? $item['postedAt'] ?? null;
            $clientUpdatedAt = null;
            if ($clientDate) {
                $ts = strtotime((string)$clientDate);
                if ($ts !== false) $clientUpdatedAt = date('Y-m-d H:i:s', $ts);
            }

            $stmt->execute([
                ':id' => (string)$item['id'],
                ':canonical_key' => $canonicalKey,
                ':payload' => json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ':client_updated_at' => $clientUpdatedAt,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(['ok' => false, 'error' => 'Save failed'], 500);
    }

    respond(['ok' => true, 'count' => count($items)]);
}

respond(['ok' => false, 'error' => 'Unknown action'], 404);
