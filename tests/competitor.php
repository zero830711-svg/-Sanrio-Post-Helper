<?php
define('SPH_COMPETITOR_TEST',true);require __DIR__.'/../server/lolipop/competitor.php';
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
$now=strtotime('2026-10-14T08:00:00Z');$settings=ca_settings([],['token'=>'test-token','monthlyLimit'=>100]);
check(ca_public($settings,[],$now)['configured']===true,'configured');check(!isset(ca_public($settings,[],$now)['token']),'token must not be public');
$state=ca_reserve([],$settings,$now);check($state['used']===100,'reserve maximum page');
foreach([$now+1,$now+86401] as $time){try{ca_reserve($state,$settings,$time);throw new LogicException('limits bypassed');}catch(RuntimeException $e){check(!$e instanceof LogicException,'cooldown / monthly cap');}}
check(ca_reserve($state,$settings,strtotime('2026-11-01T00:00:00Z'))['used']===100,'new month');
check(ca_settings($settings,['token'=>'','monthlyLimit'=>100])['token']==='test-token','blank preserves token');check(ca_settings($settings,['clearToken'=>true,'monthlyLimit'=>100])['token']==='','clear token');
$rows=ca_rows([['id'=>'123','text'=>'新作','public_metrics'=>['like_count'=>0]]],$now);check($rows[0]['likes']===0&&$rows[0]['impressions']===null&&$rows[0]['reposts']===null,'unknown is not zero');
check(ca_month(strtotime('2026-10-31T16:00:00Z'))==='2026-11','Tokyo month');
echo "Competitor budget, cooldown, credentials and missing metrics passed\n";
