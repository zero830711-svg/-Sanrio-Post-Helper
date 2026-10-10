<?php
declare(strict_types=1);
// Temporarily uploaded beside config.php by the diagnostic workflow, then removed.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$config = require __DIR__.'/config.php';
$token = '';
if (preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) $token = trim($m[1]);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET' || empty($config['sync_key']) || !hash_equals((string)$config['sync_key'], $token)) {
    http_response_code(401); echo json_encode(['ok'=>false]); exit;
}
@set_time_limit(45);
$report = ['ok'=>true, 'php'=>PHP_VERSION, 'processExecution'=>function_exists('proc_open'), 'runtimes'=>[]];
if ($report['processExecution']) {
    $candidates = array_merge(glob('/usr/local/python/*/bin/python') ?: [], glob('/usr/local/python/*/bin/python3') ?: [], ['/usr/bin/python3']);
    $code = 'import sys,json,importlib.util; print(json.dumps({"version":sys.version.split()[0],"instaloader":importlib.util.find_spec("instaloader") is not None,"instagrapi":importlib.util.find_spec("instagrapi") is not None,"pip":importlib.util.find_spec("pip") is not None,"venv":importlib.util.find_spec("venv") is not None}))';
    foreach (array_slice(array_unique($candidates), 0, 12) as $bin) {
        if (!is_file($bin) || !is_executable($bin)) continue;
        $pipes = [];
        $process = @proc_open([$bin, '-c', $code], [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']], $pipes);
        if (!is_resource($process)) continue;
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
        $output = ''; $deadline = microtime(true) + 3;
        do {
            $output .= stream_get_contents($pipes[1], 4096);
            stream_get_contents($pipes[2], 4096); // Discard error output: never expose environment details.
            $status = proc_get_status($process);
            if (!$status['running']) break;
            usleep(20000);
        } while (microtime(true) < $deadline);
        if ($status['running']) proc_terminate($process, 9);
        $output .= stream_get_contents($pipes[1], 4096);
        fclose($pipes[1]); fclose($pipes[2]); proc_close($process);
        $data = json_decode($output, true);
        if (is_array($data) && isset($data['version'])) $report['runtimes'][] = $data;
    }
}
echo json_encode($report, JSON_UNESCAPED_UNICODE);
