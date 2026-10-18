<?php
/**
 * Plugin Name: Sanrio Product Import
 * Description: Sanrio Post Helperの商品を重複確認して下書きに取り込みます。
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) exit;

function sph_product_clean($p) {
    if (!is_array($p) || !is_string($p['title']??null) || !is_string($p['source']??null)) return new WP_Error('invalid_product', '商品データが不正です。', ['status'=>400]);
    $title = sanitize_text_field($p['title'] ?? '');
    $source = esc_url_raw($p['source'] ?? '', ['https']);
    if (!$title || !$source) return new WP_Error('missing_product', '商品名とHTTPSの出典URLが必要です。', ['status'=>400]);
    $jan = preg_replace('/\D/', '', (string)($p['jan'] ?? ''));
    if ($jan && !preg_match('/^(\d{8}|\d{12}|\d{13}|\d{14})$/', $jan)) return new WP_Error('invalid_jan', 'JAN・GTINの桁数を確認してください。', ['status'=>400]);
    $model = sanitize_text_field($p['model'] ?? '');
    $character = sanitize_text_field($p['character'] ?? '');
    $key = $jan ? 'jan-'.$jan : 'source-'.substr(hash('sha256', preg_replace('/#.*$/', '', rtrim($source,'/'))),0,24);
    return ['title'=>$title,'source'=>$source,'jan'=>$jan,'model'=>$model,'character'=>$character,'key'=>$key,'raw'=>$p];
}
function sph_product_duplicates($p) {
    global $wpdb;
    $statuses = array_diff(get_post_stati(), ['auto-draft','inherit']);
    $where = "post_type = 'post' AND post_status IN (".implode(',',array_fill(0,count($statuses),'%s')).")";
    $needles = [$p['source']];
    if ($p['jan']) $needles[] = $p['jan'];
    $parts=[];$args=array_values($statuses);
    foreach ($needles as $needle) {
        $parts[]='(post_content LIKE %s OR post_title LIKE %s)';
        $like='%'.$wpdb->esc_like($needle).'%';$args[]=$like;$args[]=$like;
    }
    if ($p['model'] && $p['character']) {
        $parts[]='((post_title LIKE %s OR post_content LIKE %s) AND (post_title LIKE %s OR post_content LIKE %s))';
        foreach ([$p['model'],$p['character']] as $needle) { $like='%'.$wpdb->esc_like($needle).'%';$args[]=$like;$args[]=$like; }
    }
    $parts[]='post_name = %s';$args[]='goods-'.$p['key'];
    $parts[]='post_title = %s';$args[]=$p['title'];
    $ids=$wpdb->get_col($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE $where AND (".implode(' OR ',$parts).') LIMIT 10',$args));
    $meta=get_posts(['post_type'=>'post','post_status'=>$statuses,'meta_key'=>'_sph_product_key','meta_value'=>$p['key'],'fields'=>'ids','posts_per_page'=>10]);
    return array_map(function($id){return ['id'=>(int)$id,'title'=>get_the_title($id),'status'=>get_post_status($id),'edit'=>get_edit_post_link($id,'raw'),'url'=>get_permalink($id)];},array_unique(array_merge($ids,$meta)));
}
function sph_product_body($p) {
    $raw=$p['raw'];
    // The editor may supply a reviewed article. Never accept scripts or embeds.
    if (!empty($raw['content']) && is_string($raw['content'])) return wp_kses_post($raw['content']);
    $html='<p><small>広告：アフィリエイトリンクを含む場合があります。</small></p><h2>確認した商品情報</h2>';
    foreach (array_slice((array)($raw['facts']??[]),0,15) as $fact) $html.='<p>'.nl2br(esc_html(wp_html_excerpt((string)$fact,3000,''))).'</p>';
    $html.='<p>JAN：'.esc_html($p['jan']).' ／ 型番：'.esc_html($p['model']).'</p>';
    $html.='<p><a href="'.esc_url($p['source']).'" target="_blank" rel="noopener">商品情報の出典を確認する</a></p>';
    $link=esc_url_raw($raw['affiliate']??'', ['https']);
    if ($link) $html.='<p><a href="'.esc_url($link).'" target="_blank" rel="sponsored nofollow noopener">紹介リンクで商品を確認する</a></p>';
    return $html.'<p>価格・在庫・送料は購入先でご確認ください。公開前に仕様と画像の使用条件を確認してください。</p>';
}
add_action('rest_api_init',function(){
    foreach (['check','import'] as $action) register_rest_route('sph/v1','/products/'.$action,[
        'methods'=>'POST','permission_callback'=>function(){return current_user_can('edit_posts');},
        'callback'=>function($request) use ($action){
            $p=sph_product_clean($request->get_json_params());if(is_wp_error($p))return $p;
            $duplicates=sph_product_duplicates($p);
            if ($action==='check') return ['duplicates'=>$duplicates,'key'=>$p['key']];
            if ($duplicates) return new WP_Error('duplicate_product','同じ商品の記事があります。',['status'=>409,'duplicates'=>$duplicates]);
            $lock='sph_import_'.hash('sha256',$p['key']);
            if (!add_option($lock,time(),'','no')) return new WP_Error('import_busy','この商品は取り込み中です。しばらくして確認してください。',['status'=>409]);
            try {
                $duplicates=sph_product_duplicates($p);
                if ($duplicates) return new WP_Error('duplicate_product','同じ商品の記事があります。',['status'=>409,'duplicates'=>$duplicates]);
                $term=get_term_by('slug','shopping-products','category');
                $id=wp_insert_post(wp_slash(['post_type'=>'post','post_status'=>'draft','post_title'=>$p['title'],'post_name'=>'goods-'.$p['key'],'post_content'=>sph_product_body($p),'post_author'=>get_current_user_id(),'post_category'=>$term?[(int)$term->term_id]:[]]),true);
                if(is_wp_error($id))return $id;
                update_post_meta($id,'_sph_product_key',$p['key']);update_post_meta($id,'_sph_source',$p['source']);
                update_post_meta($id,'_sph_candidate_images',array_values(array_filter(array_map(function($url){return esc_url_raw($url,['https']);},array_slice((array)($p['raw']['images']??[]),0,4)))));
                return ['id'=>$id,'status'=>'draft','edit'=>get_edit_post_link($id,'raw')];
            } finally {delete_option($lock);}
        }
    ]);
});
add_shortcode('sph_product_import',function(){
    if (!current_user_can('edit_posts')) return '<p>商品取り込みを使うにはWordPressへログインしてください。</p><p><a href="'.esc_url(wp_login_url(get_permalink())).'">ログイン</a></p>';
    wp_enqueue_script('sph-product-import',plugins_url('import.js',__FILE__),[], '1.0.0',true);
    wp_localize_script('sph-product-import','SPHImportConfig',['root'=>rest_url('sph/v1/products/'),'nonce'=>wp_create_nonce('wp_rest')]);
    return '<div id="sph-import"><p>Post Helperで保存したJSONを選んでください。重複を確認し、公開前の下書きとして取り込みます。</p><input type="file" id="sph-import-file" accept=".json,application/json"><div id="sph-import-list" aria-live="polite"></div></div>';
});
register_activation_hook(__FILE__,function(){
    if (!get_page_by_path('product-import')) wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>'商品取り込み','post_name'=>'product-import','post_content'=>'[sph_product_import]']);
});
