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
        && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port']) && !isset($parts['fragment']);
}

function capsule_title(string $title): bool {
    if (!preg_match('/ガチャ|ガシャポン|カプセルトイ|カプセル玩具|カプセルフィギュア|カプセルマスコット/u', $title)) return false;
    return !preg_match('/ガチャ詰め|ガチャ活|ガチャ本体|ガチャマシン|カプセルマシン|空カプセル|カプセルケース/u', $title);
}


function normalized_product_name(string $value, bool $stripCharacters = false): string {
    $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $value = mb_strtolower($value, 'UTF-8');
    $value = preg_replace('/再販|再生産|予約受付中|新発売|全[0-9]+(?:種|種類)/u', '', $value) ?? $value;
    if ($stripCharacters) {
        $characters = ['サンリオキャラクターズ', 'サンリオ', 'ハローキティ', 'ハロー・キティ',
            'マイメロディ', 'クロミ', 'シナモロール', 'ポムポムプリン', 'ポチャッコ',
            'ハンギョドン', 'けろけろけろっぴ', 'タキシードサム', 'あひるのペックル',
            'バッドばつ丸', 'こぎみゅん', 'はなまるおばけ', 'ウサハナ', 'ぐでたま',
            'キキララ', 'キキ＆ララ', 'リトルツインスターズ', 'ジュエルペット',
            'シュガーバニーズ', 'JOCHUM', 'Jochum', 'jochum'];
        $value = str_replace($characters, '', $value);
    }
    return preg_replace('/[^0-9a-zぁ-んァ-ヶ一-龠]/u', '', $value) ?? '';
}

function product_name_matches(string $seed, string $title): bool {
    foreach ([false, true] as $stripCharacters) {
        $left = normalized_product_name($seed, $stripCharacters);
        $right = normalized_product_name($title, $stripCharacters);
        if ($left === '' || $right === '') continue;
        if (str_contains($left, $right) || str_contains($right, $left)) return true;
        $leftChars = preg_split('//u', $left, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $rightChars = preg_split('//u', $right, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (count($leftChars) < 5) continue;
        $grams = [];
        for ($i = 0; $i < count($leftChars) - 1; $i++) $grams[$leftChars[$i] . $leftChars[$i + 1]] = true;
        $matched = [];
        for ($i = 0; $i < count($rightChars) - 1; $i++) {
            $gram = $rightChars[$i] . $rightChars[$i + 1];
            if (isset($grams[$gram])) $matched[$gram] = true;
        }
        if (count($matched) / count($grams) >= 0.70) return true;
    }
    return false;
}

function sanrio_title(string $title): bool {
    return (bool)preg_match('/サンリオ|ハローキティ|ハロー・キティ|マイメロディ|クロミ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|けろけろけろっぴ|タキシードサム|あひるのペックル|バッドばつ丸|こぎみゅん|はなまるおばけ|ウサハナ|ぐでたま|キキララ|キキ＆ララ|リトルツインスターズ|ジュエルペット|ウィッシュミーメル|ぼんぼんりぼん|チョコキャット|マロンクリーム|がおぱわるぅ|まるもふびより|おさるのもんきち|みんなのたあ坊|JOCHUM|Jochum|jochum/u', $title);
}

try {
    $config = require $argv[1];
    $syncKey = is_array($config) ? trim((string)($config['sync_key'] ?? '')) : '';
    if ($syncKey === '') throw new RuntimeException('Product flow sync key is not configured.');

    $queryData = json_decode((string)file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    $productNameSearch = is_array($queryData['product_names'] ?? null);
    $queries = $productNameSearch ? $queryData['product_names'] : ($queryData['queries'] ?? null);
    if (!is_array($queries) || !$queries) throw new RuntimeException('Rakuten search queries are missing.');
    $queries = array_values(array_unique(array_filter($queries, static fn($q) =>
        is_string($q) && mb_strlen(trim($q)) >= 2 && mb_strlen(trim($q)) <= 80
    )));
    if (count($queries) > 180) throw new RuntimeException('Too many Rakuten search queries.');

    $items = [];
    $seenCodes = [];
    $requests = 0;
    $rawRows = 0;
    $sampleSummary = '';
    $rejected = ['missing_code' => 0, 'missing_title' => 0, 'not_capsule' => 0, 'not_sanrio' => 0, 'not_product_name_match' => 0, 'bad_image' => 0, 'bad_affiliate' => 0, 'bad_product_url' => 0, 'duplicate' => 0];
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
                $rawRows++;
                // Rakuten API formatVersion=1 wraps each result under "item";
                // formatVersion=2 and normalized caches return the fields directly.
                $nativeItem = $item['item'] ?? $item['Item'] ?? $item;
                if (!is_array($nativeItem)) continue;

                $code = trim((string)($nativeItem['code'] ?? $nativeItem['itemCode'] ?? $nativeItem['item_code'] ?? ''));
                $title = trim((string)($nativeItem['title'] ?? $nativeItem['itemName'] ?? ''));
                $discoveryText = html_entity_decode(strip_tags(
                    (string)($nativeItem['itemName'] ?? '') . ' '
                    . (string)($nativeItem['catchcopy'] ?? '') . ' '
                    . (string)($nativeItem['itemCaption'] ?? '')
                ), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                if ($sampleSummary === '') {
                    $sampleSummary = 'fields=' . implode(',', array_slice(array_map('strval', array_keys($nativeItem)), 0, 30))
                        . '; title=' . mb_substr($title, 0, 100)
                        . '; itemUrl=' . (isset($nativeItem['itemUrl']) ? 'yes' : 'no')
                        . '; affiliateUrl=' . (isset($nativeItem['affiliateUrl']) ? 'yes' : 'no')
                        . '; imageField=' . (isset($nativeItem['mediumImageUrls']) ? 'mediumImageUrls' : (isset($nativeItem['image']) ? 'image' : 'none'));
                }
                $image = trim((string)($nativeItem['image'] ?? $nativeItem['imageUrl'] ?? ''));
                if ($image === '') {
                    foreach (['mediumImageUrls', 'largeImageUrls', 'smallImageUrls'] as $imageKey) {
                        $imageRows = $nativeItem[$imageKey] ?? [];
                        if (!is_array($imageRows)) continue;
                        foreach ($imageRows as $imageRow) {
                            $candidateImage = is_array($imageRow)
                                ? (string)($imageRow['imageUrl'] ?? '')
                                : (string)$imageRow;
                            if ($candidateImage !== '') {
                                $image = trim($candidateImage);
                                break 2;
                            }
                        }
                    }
                }
                $affiliate = trim((string)($nativeItem['affiliate'] ?? $nativeItem['affiliateUrl'] ?? ''));
                $url = trim((string)($nativeItem['url'] ?? $nativeItem['itemUrl'] ?? ''));
                if (!safe_product_url($url) && safe_affiliate_url($affiliate)) {
                    $affiliateParts = parse_url($affiliate);
                    parse_str((string)($affiliateParts['query'] ?? ''), $affiliateQuery);
                    foreach (['pc', 'm'] as $destinationKey) {
                        $destination = (string)($affiliateQuery[$destinationKey] ?? '');
                        if (safe_product_url($destination)) {
                            $url = $destination;
                            break;
                        }
                    }
                }
                $shop = trim((string)($nativeItem['shop'] ?? $nativeItem['shopName'] ?? ''));

                if ($code === '') { $rejected['missing_code']++; continue; }
                if ($title === '') { $rejected['missing_title']++; continue; }
                if ($productNameSearch) {
                    if (!product_name_matches($query, $title)) {
                        $rejected['not_product_name_match']++;
                        continue;
                    }
                } else {
                    if (!capsule_title($discoveryText)) { $rejected['not_capsule']++; continue; }
                    if (!sanrio_title($discoveryText)) { $rejected['not_sanrio']++; continue; }
                }
                if (!safe_image_url($image)) { $rejected['bad_image']++; continue; }
                if (!safe_affiliate_url($affiliate)) { $rejected['bad_affiliate']++; continue; }
                if (!safe_product_url($url)) { $rejected['bad_product_url']++; continue; }
                if (isset($seenCodes[$code])) { $rejected['duplicate']++; continue; }

                $seenCodes[$code] = true;
                $items[] = [
                    'code' => $code,
                    'title' => mb_substr($title, 0, 500),
                    'image' => $image,
                    'affiliate' => $affiliate,
                    'url' => $url,
                    'shop' => mb_substr($shop, 0, 120),
                    'source_product_name' => $productNameSearch ? mb_substr($query, 0, 160) : '',
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
    fwrite(STDOUT, 'Rakuten API search finished: ' . $rawRows . ' raw rows, ' . count($items) . ' filtered candidates from ' . $requests . " requests.\n");
    if ($sampleSummary !== '') fwrite(STDOUT, 'Rakuten API sample (sanitized): ' . $sampleSummary . "\n");
    fwrite(STDOUT, 'Rakuten API rejected rows: ' . json_encode($rejected, JSON_UNESCAPED_UNICODE) . "\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error instanceof RuntimeException ? $error->getMessage() : 'Rakuten gacha candidate search failed.');
    fwrite(STDERR, "\n");
    exit(1);
}
