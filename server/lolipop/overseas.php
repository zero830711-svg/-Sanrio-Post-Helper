<?php
declare(strict_types=1);
// Retired endpoint: no external requests, collection or stored candidate responses.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
http_response_code(410);
echo json_encode(['ok'=>false,'disabled'=>true,'apiVersion'=>'3438','items'=>[],'error'=>'Overseas discovery removed'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
