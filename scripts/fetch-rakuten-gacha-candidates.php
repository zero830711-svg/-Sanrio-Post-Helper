<?php
declare(strict_types=1);

if ($argc !== 4) {
    fwrite(STDERR, "Usage: php fetch-rakuten-gacha-candidates.php CONFIG QUERIES_JSON OUTPUT\n");
    exit(2);
}

function safe_affiliate_url(string $url): bool {
    $parts = parse_url($url);
    return ($parts['scheme'] ?? '') === 'https'
        && strtolower((string)($parts['host'] ?? '')) === 'hb.afl.rakuten.co.jp'
        && preg_match('~^/hgc/[a-zA-Z0-9._-]{8,128}/?$~D', (string)($parts['path'] ?? ''))
        && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port']) && !isset($parts['fragment']);
}

function safe_product_url(string $url): bool {
    $parts = parse_url($url);
    return ($parts['scheme'] ?? '') === 'https'
        && strtolower((string)($parts['host'] ?? '')) === 'item.rakuten.co.jp'
        && str_starts_with((string)($parts['path'] ?? ''), '/')
        && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port']) && !isset($parts['fragment']);
}

function safe_image_url(string $url): bool {
    $parts = parse_url($url);
    return ($parts['scheme'] ?? '') === 'https'
        && in_array(strtolower((string)($parts['host'] ?? '')), ['image.rakuten.co.jp', 'shop.r10s.jp', 'tshop.r10s.jp'], true)
        && str_starts_with((string)($parts['path'] ?? ''), '/')
        && !isset($parts['user'], $parts['pass'], $parts['port']);
}

function capsule_title(string $title): bool {
    if (!preg_match('/ガチャ|ガシャポン|カプセルトイ|カプセル玩具|カプセルフィギュア|カプセルマスコット/u', $title)) return false;
    return !preg_match('/ガチャ詰め|ガチャ活|ガチャ本体|ガチャマシン|カプセルマシン|空カプセル|カプセルケース/u', $title);
}

function sanrio_title(string $title): bool {
    return (bool)preg_match('/サンリオ|ハローキティ|ハロー・キティ|マイメロディ|クロミ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|けろけろけろっぴ|タキシードサム|あひるのペックル|バッドばつ丸|こぎみゅん|はなまるおばけ|ウサハナ|ぐでたま|キキララ|キキ＆ララ|リトルツインスターズ|ジュエルペット|ウィッシュミーメル|ぼんぼんりぼん|チョコキャット|マロンクリーム|がおぱわるぅ|まるもふびより|おさるのもんきち|みんなのたあ坊/u', $title);
}

try {
    $config = require $argv[1];
    $syncKey = is_array($config) ? trim((string)($config['sync_key'] ?? '')) : '';
    if ($syncKey === '') throw new RuntimeException('Product flow sync key is not configured.');

    $queryData = json_decode((string)file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    $queries = $queryData['queries'] ?? null;
    if (!is_array($queries) || !$queries) throw new RuntimeException('Rakuten search queries are missing.');
    $queries = array_values(array_unique(array_filter($queries, static fn($q) =>
        is_string($q) && mb_strlen(trim($q)) >= 2 && mb_strlen(trim($q)) <= 80
    )));
    if (count($queries) > 180) throw new RuntimeException('Too many Rakuten search queries.');

    $items = [];
    $seenCodes = [];
    $requests = 0;
    $endpoint = 'https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/product-flow.php?action=affiliate-search';

    foreach ($queries as $query) {
        $query = trim($query);
        for ($page = 1; $page <= 2; $page++) {
            $payload = json_encode(['keywords' => $query, 'page' => $page], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            $body = '';
            $curl = curl_init($endpoint);
            curl_setopt_array($curl, [
                CURLOPT_RETURNTRANSFER => false,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT => 45,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_HTTPHEADER => [
                    'Authorization: Bearer ' . $syncKey,
                    'Origin: https://zero830711-svg.github.io',
                    'Content-Type: application/json',
                    'Accept: application/json',
                ],
                CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
                    if (strlen($body) + strlen($chunk) > 1500000) return 0;
                    $body .= $chunk;
                    return strlen($chunk);
                },
            ]);
            $ok = curl_exec($curl);
            $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            curl_close($curl);
            $requests++;
            if ($ok === false || $status !== 200) {
                if ($page === 1) {
                    fwrite(STDERR, 'Rakuten product search failed for a query (HTTP ' . $status . ").\n");
                    continue 2;
                }
                break;
            }

            $response = json_decode($body, true);
            if (!is_array($response) || empty($response['ok']) || !is_array($response['items'] ?? null)) {
                fwrite(STDERR, "Rakuten product search returned an invalid response.\n");
                continue 2;
            }

            foreach ($response['items'] as $item) {
                if (!is_array($item)) continue;
                $code = (string)($item['code'] ?? '');
                $title = trim((string)($item['title'] ?? ''));
                $image = (string)($item['image'] ?? '');
                $affiliate = (string)($item['affiliate'] ?? '');
                $url = (string)($item['url'] ?? '');
                if ($code === '' || isset($seenCodes[$code]) || $title === ''
                    || !capsule_title($title) || !sanrio_title($title)
                    || !safe_image_url($image) || !safe_affiliate_url($affiliate) || !safe_product_url($url)) continue;
                $seenCodes[$code] = true;
                $items[] = [
                    'code' => $code,
                    'title' => mb_substr($title, 0, 500),
                    'image' => $image,
                    'affiliate' => $affiliate,
                    'url' => $url,
                    'shop' => mb_substr(trim((string)($item['shop'] ?? '')), 0, 120),
                ];
            }
            if (empty($response['hasMore'])) break;
        }
        usleep(150000);
    }

    $output = json_encode([
        'queries_used' => $requests,
        'candidates' => $items,
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (file_put_contents($argv[3], $output, LOCK_EX) === false) throw new RuntimeException('Could not save the candidate file.');
    chmod($argv[3], 0600);
    fwrite(STDOUT, 'Rakuten API search finished: ' . count($items) . ' filtered candidates from ' . $requests . " requests.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error instanceof RuntimeException ? $error->getMessage() : 'Rakuten gacha candidate search failed.');
    fwrite(STDERR, "\n");
    exit(1);
}
