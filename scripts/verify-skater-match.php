<?php
declare(strict_types=1);
try {
    define('LW_TEST_ONLY',true);require __DIR__.'/../server/lolipop/lovely-watch.php';
    $settings=require $argv[1];
    foreach(['4973307721236','72123-6','SDPC4 マイメロディ'] as $keyword){
        $data=lw_gour_search($keyword,$settings,'casmin');
        echo 'Query '.$keyword.' count='.(int)($data['count']??0).' matched='.(lw_skater_match($data,'4973307721236')?'yes':'no')."\n";
        foreach($data['items']??[] as $row){$item=$row['item']??$row;preg_match_all('/(?<![0-9])[0-9]{13}(?![0-9])/',strip_tags((string)($item['itemName']??'').' '.(string)($item['itemCaption']??'')),$ids);echo json_encode(['itemCode'=>$item['itemCode']??'','url'=>$item['itemUrl']??'','jan'=>array_values(array_unique($ids[0]))],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n";}
        usleep(1200000);
    }
}catch(Throwable $e){fwrite(STDERR,"Skater verification failed; private details withheld.\n");exit(1);}
