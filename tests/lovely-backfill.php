<?php
define('LF_BACKFILL_TEST',true);
require __DIR__.'/../scripts/fetch-lovely-backfill.php';
$keyword=lf_keyword('ポムポムプリン x モンチッチ 巾着袋 ぬいぐるみきんちゃくポーチ');
if($keyword!=='ポムポムプリン モンチッチ 巾着袋 ぬいぐるみきんちゃくポーチ')throw new RuntimeException('Discovery keywords changed product terms');
$source=lw_product('https://item.rakuten.co.jp/cinemacollection/sst-example/');
$api=lw_rakuten_search_data(['items'=>[['itemCode'=>'cinemacollection:12345678','itemUrl'=>'https://item.rakuten.co.jp/cinemacollection/sst-example/']]]);
if($source['url']!==lw_product($api['items'][0]['itemUrl'])['url'])throw new RuntimeException('Source and API URL comparison failed');
echo "PASS: discovery title keywords and URL identity independent of API itemCode\n";
