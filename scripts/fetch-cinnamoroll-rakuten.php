<?php
declare(strict_types=1);

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php fetch-cinnamoroll-rakuten.php CONFIG_JSON\n");
    exit(2);
}
$config = require $argv[1];
$syncKey = is_array($config) ? (string)($config['sync_key'] ?? '') : '';
if ($syncKey === '') {
    fwrite(STDERR, "Product flow sync key is not configured.\n");
    exit(1);
}
$url = 'https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/product-flow.php?action=catalog-search';
$body = '';
$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => '{}',
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 240,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $syncKey,
        'Origin: https://zero830711-svg.github.io',
        'Content-Type: application/json',
        'Accept: application/json',
    ],
]);
$response = curl_exec($curl);
$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
curl_close($curl);
if (!is_string($response) || $status !== 200) {
    fwrite(STDERR, "Private Rakuten catalog search failed (HTTP " . $status . ").\n");
    exit(1);
}
$data = json_decode($response, true);
$items = is_array($data) ? ($data['catalogItems'] ?? null) : null;
if (empty($data['ok']) || !is_array($items)) {
    fwrite(STDERR, "Rakuten catalog search returned an invalid response.\n");
    exit(1);
}
$encoded = json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
if (file_put_contents($argv[2], $encoded, LOCK_EX) === false) {
    fwrite(STDERR, "Could not save temporary catalog candidates.\n");
    exit(1);
}
chmod($argv[2], 0600);
fwrite(STDOUT, "Fetched " . count($items) . " private Rakuten candidates. Credentials were not printed.\n");
