<?php
declare(strict_types=1);
// Credentials are temporary runner files; never print keys, headers or affiliate URLs.
try {
    define('LW_TEST_ONLY',true);require __DIR__.'/../server/lolipop/lovely-watch.php';
    $settings=require $argv[1];
    $data=lw_gour_search('4973307721236',$settings,'casmin');
    $match=lw_skater_match($data,'4973307721236');
    if(!$match||$match['itemUrl']!=='https://item.rakuten.co.jp/casmin/72123-6-sdpc4/')throw new RuntimeException('Identity mismatch');
    $affiliate=lw_affiliate_result(['items'=>[$match]],$match['itemCode'],$settings['affiliateId']);
    $images=[];foreach($match['mediumImageUrls']??[] as $row){$url=is_array($row)?(string)($row['imageUrl']??''):(string)$row;echo 'API image host: '.(parse_url($url,PHP_URL_HOST)?:'missing')."\n";$image=lw_image_url($url);if($image)$images[]=$image;}
    if(!$images)throw new RuntimeException('No verified image');
    $bytes=lw_fetch($images[0],6000000,true);if(!@getimagesizefromstring($bytes))throw new RuntimeException('Photo unavailable');
    echo "Live API: exact casmin product + JAN + own affiliate link + photo verified.\n";
    if(isset($argv[2])){
        $config=require $argv[2];$body='';
        $ch=curl_init('https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/lovely-watch.php?'.http_build_query(['action'=>'detail','url'=>'https://www.skater-onlineshop.com/shop/g/g4973307721236/','refresh'=>'1']));
        curl_setopt_array($ch,[CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$config['sync_key']],CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_TIMEOUT=>55,CURLOPT_RETURNTRANSFER=>true]);
        $body=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);$result=json_decode((string)$body,true);
        $item=$result['item']??[];
        if($status!==200||($item['productInfo']['url']??'')!==$match['itemUrl']||($item['needsReview']??true)||empty($item['productInfo']['images'])||empty($item['matchedAffiliate']['url']))throw new RuntimeException('Deployed endpoint mismatch');
        echo "Deployed detail: same product URL, verified retailer images and own affiliate link available.\n";
    }
}catch(Throwable $e){fwrite(STDERR,"Skater identity/photo verification failed; private details withheld.\n");exit(1);}
