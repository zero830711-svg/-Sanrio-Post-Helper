<?php
declare(strict_types=1);

try {
    $config = require $argv[1];
    $key = (string)($config['sync_key'] ?? '');
    if ($key === '') {
        throw new RuntimeException('Sync configuration unavailable.');
    }
    $outputPath = '';
    foreach (array_slice($argv, 2) as $arg) {
        if (str_starts_with($arg, '--output=')) {
            $outputPath = substr($arg, 9);
        }
    }
    if ($outputPath === '') {
        throw new RuntimeException('Pass --output=<temporary-file>.');
    }

    $endpoint = 'https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/product-flow.php';
    $request = static function (string $action, ?int $offset = null, bool $post = false) use ($endpoint, $key): array {
        $url = $endpoint . '?action=' . rawurlencode($action);
        if ($offset !== null) {
            $url .= '&offset=' . $offset;
        }
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => $post ? 180 : 35,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $key,
                'Origin: https://zero830711-svg.github.io',
                'Content-Type: application/json',
            ],
        ]);
        if ($post) {
            curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => '{}']);
        }
        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        $data = is_string($body) ? json_decode($body, true) : null;
        if ($status !== 200 || !is_array($data) || empty($data['ok'])) {
            throw new RuntimeException('Rakuten sync endpoint returned HTTP ' . $status . '.');
        }
        foreach (['secret', 'credentialId', 'access_token', 'sync_key', 'accessKey'] as $field) {
            if (isset($data[$field])) {
                throw new RuntimeException('Private field returned by Rakuten sync endpoint.');
            }
        }
        return $data;
    };

    try {
        $scan = $request('sources', null, true);
        echo 'Rakuten source refresh completed.' . PHP_EOL;
    } catch (Throwable $error) {
        fwrite(STDERR, 'Rakuten refresh failed; exporting only the saved unexpired source pool.' . PHP_EOL);
    }

    $items = [];
    $seen = [];
    $now = time();
    for ($offset = 0; $offset < 10000; $offset += 500) {
        $page = $request('list', $offset);
        foreach ($page['sources'] ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $service = (string)($item['service'] ?? '');
            if (!in_array($service, ['market', 'books'], true)) {
                continue;
            }
            $code = (string)($item['code'] ?? '');
            $title = trim((string)($item['title'] ?? ''));
            $sourceAt = (int)($item['sourceAt'] ?? 0);
            $url = (string)($item['url'] ?? '');
            $host = strtolower((string)parse_url($url, PHP_URL_HOST));
            $validHost = $service === 'books'
                ? $host === 'books.rakuten.co.jp'
                : $host === 'item.rakuten.co.jp';
            if (!preg_match('/^[A-Za-z0-9._:-]{1,200}$/D', $code)
                || $title === '' || strlen($title) > 1200
                || !$validHost || parse_url($url, PHP_URL_SCHEME) !== 'https'
                || $sourceAt > $now || $sourceAt <= $now - 14 * 86400) {
                continue;
            }
            if (isset($seen[$code])) {
                continue;
            }
            $seen[$code] = true;
            $items[] = ['code' => $code, 'title' => $title, 'service' => $service, 'sourceAt' => $sourceAt];
        }
        if (empty($page['sourceHasMore'])) {
            break;
        }
    }

    usort($items, static fn(array $a, array $b): int => $b['sourceAt'] <=> $a['sourceAt']);
    if (file_put_contents($outputPath, json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), LOCK_EX) === false) {
        throw new RuntimeException('Rakuten candidate export failed.');
    }
    chmod($outputPath, 0600);
    echo count($items) . ' current Rakuten catalog candidates exported; price, stock, images and URLs excluded.' . PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
