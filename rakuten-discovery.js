/* No polling: collection starts only on the user's refresh button. */
(()=>{
  const el=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let items=[],used=new Set(),busy=false;
  function render(){
    let hidden={};try{hidden=JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')||'{}').hidden||{};}catch(e){}
    const visible=items.filter(item=>!hidden[item.url]&&!(item.productIds||[]).some(id=>used.has(id))&&(el('rakutenDiscoveryFilter').value!=='new'||item.discovered));
    el('rakutenDiscoveryList').innerHTML=visible.map(item=>'<article class="chart-card"><div class="cloud-sync-actions">'+(item.thumbnail?'<img src="'+escape(item.thumbnail)+'" alt="" width="96" height="96" loading="lazy" decoding="async">':'')+'<div><strong>'+escape(item.title)+'</strong><p class="backup-note">'+escape(item.shopName)+' ／ '+(item.discovered?'今回新しく発見':'比較用・既知の候補')+'</p><p class="backup-note">取得時の参考価格：'+Number(item.price).toLocaleString('ja-JP')+'円（種類・送料などは販売ページで確認）</p></div></div><button type="button" class="small-btn" data-rakuten-prepare="'+escape(item.url)+'">投稿準備</button></article>').join('')||(items.length?'<p class="backup-note">この表示条件に合う未紹介の候補はありません。</p>':'');
  }
  async function refresh(){
    if(busy)return;busy=true;el('rakutenDiscoveryRefresh').disabled=true;const status=el('rakutenDiscoveryStatus');status.textContent='楽天の候補を確認中…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
    try{
      const settings=cloudSettings();if(!settings.key)throw new Error('管理画面で同期キーを設定してください。');
      const url=new URL(settings.url);url.pathname=url.pathname.replace(/[^/]+$/,'lovely-watch.php');url.search='';url.hash='';url.searchParams.set('action','discover');url.searchParams.set('keyword',el('rakutenDiscoveryKeyword').value.trim());
      const res=await fetch(url,{headers:{Authorization:'Bearer '+settings.key},signal:controller.signal,cache:'no-store'});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'楽天の候補を取得できませんでした。');
      const history=await dbGetAll();used=lovelyWatch.usedIds(history);items=data.items||[];render();
      status.textContent='検索「'+data.keyword+'」 ／ '+items.length+'件取得 ／ '+new Date(data.fetchedAt).toLocaleString('ja-JP')+'。'+(data.initial?'初回の比較基準を保存しました。次回以降の変化を確認できます。':'今回新しく発見 '+items.filter(x=>x.discovered).length+'件。')+' 同じ検索は最大15分のキャッシュを使います。';
    }catch(e){status.textContent=e.name==='AbortError'?'取得がタイムアウトしました。再試行してください。':e.message;}finally{clearTimeout(timer);busy=false;el('rakutenDiscoveryRefresh').disabled=false;}
  }
  el('rakutenDiscoveryRefresh')?.addEventListener('click',refresh);
  el('rakutenDiscoveryFilter')?.addEventListener('change',render);
  el('rakutenDiscoveryList')?.addEventListener('click',e=>{const button=e.target.closest('[data-rakuten-prepare]');if(!button)return;const item=items.find(x=>x.url===button.dataset.rakutenPrepare);if(item)lovelyWatch.openRakuten({...item});});
  document.addEventListener('rakuten-candidates-changed',render);
})();
