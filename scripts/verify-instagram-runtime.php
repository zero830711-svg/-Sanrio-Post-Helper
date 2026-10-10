<?php
declare(strict_types=1);
try {
    $config = require $argv[1];
    $name = $argv[2];
    if (!preg_match('/^ig-probe-[a-f0-9]{24}\.php$/D', $name)) throw new RuntimeException();
    $ch = curl_init('https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/'.$name);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_FOLLOWLOCATION=>false, CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS, CURLOPT_TIMEOUT=>45, CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$config['sync_key']]]);
    $body = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    $data = json_decode((string)$body, true);
    if ($status !== 200 || empty($data['ok'])) throw new RuntimeException();
    // Output only the deliberately limited runtime capability report.
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)."\n";
    file_put_contents($argv[3], json_encode($data, JSON_PRETTY_PRINT));
} catch (Throwable $e) {
    fwrite(STDERR, "Instagram runtime check failed; private details withheld.\n"); exit(1);
}
