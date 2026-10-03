<?php
define('LW_TEST_ONLY',true);
require __DIR__.'/../server/lolipop/lovely-watch.php';
function lw_check($value){if(!$value)throw new RuntimeException('Linked product filtering failed');}
function fixture_article(string $id,string $links):string{
 return '<article class="post-list"><h2 class="entry-title">サンリオ新商品 '.$id.'</h2><a rel="bookmark" href="https://lovely-fancy.net/sanrio/2026/'.$id.'/">本文</a><time>2026.10.03</time><div class="btn-float">'.$links.'</div></article>';
}
$unsupported=fixture_article('100','<a href="https://www.animate-onlineshop.jp/products/detail.php?product_id=123">アニメイト通販</a>');
$search=fixture_article('101','<a href="https://www.amazon.co.jp/s?k=sanrio">Amazonで検索</a><a href="https://search.rakuten.co.jp/search/mall/sanrio/">楽天で検索</a>');
$rakuten=fixture_article('102','<a href="https://item.rakuten.co.jp/testshop/sanrio/">楽天</a>');
$amazon=fixture_article('103','<a href="https://www.amazon.co.jp/dp/B012345678">Amazon</a>');
$wrapped=fixture_article('104','<a href="https://af.moshimo.com/af/c/click?url='.rawurlencode('https://item.rakuten.co.jp/testshop/sanrio2/').'">楽天</a>');
$missing=fixture_article('105','');
$rows=lw_list($unsupported.$search.$rakuten.$amazon.$wrapped.$missing,true);
lw_check(count($rows)===3);
lw_check(array_column($rows,'url')===['https://lovely-fancy.net/sanrio/2026/102/','https://lovely-fancy.net/sanrio/2026/103/','https://lovely-fancy.net/sanrio/2026/104/']);
lw_check($rows[0]['productIds']===['rakuten:testshop:sanrio']);
lw_check($rows[1]['productIds']===['asin:B012345678']);
lw_check($rows[2]['productIds']===['rakuten:testshop:sanrio2']);
lw_check(lw_list($unsupported.$search.$missing,true)===[]);
lw_check(lw_next_page($unsupported.'<a class="next" href="/page/2/">次へ</a>',1)===2);
$rejected=false;try{lw_list('<p>構造が変わりました</p>',true);}catch(RuntimeException $e){$rejected=true;}lw_check($rejected);
echo "Amazon/Rakuten candidate filtering and empty-page pagination passed\n";
