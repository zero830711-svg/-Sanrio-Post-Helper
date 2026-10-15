<?php
declare(strict_types=1);
// Retired: never read stored tokens, return saved observations, or call X.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
http_response_code(410);
echo json_encode(['ok'=>false,'disabled'=>true,'apiVersion'=>'3533','items'=>[],'error'=>'Competitor analysis removed'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
