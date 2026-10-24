<?php
declare(strict_types=1);

if ($argc !== 4) {
    fwrite(STDERR, "Usage: php resolve-gacha-affiliate.php CONFIG ARTICLE OUTPUT\n");
    exit(2);
}
try {
    $config = require $argv[1];
    $syncKey = is_array($config) ? trim((string)($config['sync_key'] ?? '')) : '';
    if ($syncKey === '') {
        throw new RuntimeException('The affiliate search key is not configured.');
    }
    $article = json_decode((string)file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    $keyword = trim((string)($article['rakuten_search_query'] ?? ''));
    if ($keyword === '' || strlen($keyword) > 240) {
        throw new RuntimeException('The Rakuten search phrase is missing or invalid.');
    }

    $url = 'https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/product-flow.php?action=affiliate-search';
    $payload = json_encode(['keywords' => $keyword, 'page' => 1], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    $body = '';
    $curl = curl_init($url);
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
            if (strlen($body) + strlen($chunk) > 1000000) {
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    $ok = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($ok === false || $status !== 200) {
        throw new RuntimeException('Rakuten affiliate search did not complete.');
    }
    $result = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    $affiliate = (string)($result['searchAffiliate'] ?? '');
    $parts = parse_url($affiliate);
    if (empty($result['ok'])
        || ($parts['scheme'] ?? '') !== 'https'
        || strtolower((string)($parts['host'] ?? '')) !== 'hb.afl.rakuten.co.jp'
        || !preg_match('~^/hgc/[a-zA-Z0-9._-]{8,128}/?$~D', (string)($parts['path'] ?? ''))
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) {
        throw new RuntimeException('The Rakuten affiliate search URL could not be verified.');
    }

    $output = json_encode(['rakuten_affiliate_url' => $affiliate], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    if (file_put_contents($argv[3], $output, LOCK_EX) === false) {
        throw new RuntimeException('Could not save the private affiliate result.');
    }
    chmod($argv[3], 0600);
    fwrite(STDOUT, "Rakuten affiliate search link resolved.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error instanceof RuntimeException ? $error->getMessage() : 'Affiliate link resolution failed.');
    fwrite(STDERR, "\n");
    exit(1);
}
