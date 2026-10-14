(()=>{
'use strict';
const $=id=>document.getElementById(id),LIST='sphAmazonScoutCandidatesV1',PROVIDER='sphProductSearchProviderV1';
let current=null,busy=false,newsSource='',storageOK=true,autoBusy=false,autoLoaded=false,autoItems=[],autoTag='',autoNextAt=0;
let searchPage=0,searchKeyword='',searchItems=[],searchTag='',searchMore=false,searchReadyAt=0,searchTimer=null;
const text=v=>String(v||'').trim();
function amazonUrl(value){try{const raw=String(value||'').trim(),u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.amazon.co.jp','amazon.co.jp','amzn.to','amzn.asia'].includes(u.hostname)?raw:'';}catch{return '';}}
function imageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['m.media-amazon.com','images-na.ssl-images-amazon.com','images-fe.ssl-images-amazon.com'].includes(u.hostname)?u.href:'';}catch{return '';}}
function rows(){try{const a=JSON.parse(localStorage.getItem(LIST)||'[]');if(!Array.isArray(a))throw new Error();return a;}catch{storageOK=false;$('amazonFlowStatus').textContent='保存済み下書きを読み込めません。保存データを確認してください。';return [];}}
function write(list){try{localStorage.setItem(LIST,JSON.stringify(list));storageOK=true;return true;}catch{storageOK=false;$('amazonFlowEditorStatus').textContent='下書きを保存できませんでした。端末の空き容量を確認してください。';return false;}}
function searchLink(title,tag){if(!/^[a-zA-Z0-9_-]{1,80}-22$/.test(tag||''))return '';const u=new URL('https://www.amazon.co.jp/s');u.searchParams.set('k',title);u.searchParams.set('tag',tag);return u.href;}
function link(){return !current||$('amazonFlowMode').value==='none'?'':$('amazonFlowMode').value==='search'?current.searchUrl:current.itemUrl;}
function finalText(){const body=$('amazonFlowBody').value.trim().replace(/\s*#pr\b/giu,'').trim();return [body,link()?'🛍️ Amazonでチェック\n'+link():'',link()?'#pr':''].filter(Boolean).join('\n\n');}
function update(){
 const url=link();$('amazonFlowLink').value=url;$('amazonFlowFinal').value=finalText();
 $('amazonFlowToNews').hidden=!newsSource||!url;
 for(const id of ['amazonFlowCopy','amazonFlowShare','amazonFlowDone'])$(id).disabled=!current||!$('amazonFlowBody').value.trim()||!storageOK;
 $('amazonFlowCopyLink').disabled=!url;
}
function save(mark){
 if(!current)return false;const list=rows();if(!storageOK)return false;
 current.body=$('amazonFlowBody').value;current.linkMode=$('amazonFlowMode').value;current.affiliateUrl=link();current.draft=finalText();
 if(mark)current.status=mark;
 const index=list.findIndex(r=>r.id===current.id);if(index<0)list.push({...current});else list[index]={...list[index],...current};
 const ok=write(list);if(ok){$('amazonFlowEditorStatus').textContent='下書きを保存しました。';renderDrafts();renderAuto();}update();return ok;
}
function button(label,fn){const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=label;b.onclick=fn;return b;}
function open(row){
 current={...row};current.itemUrl=amazonUrl(row.itemUrl||row.affiliateUrl);current.searchUrl=amazonUrl(row.searchUrl)||(row.manual?'':searchLink(row.title,row.partnerTag||localStorage.getItem('sphAmazonAssociateTagV1')||'ononbrothers2-22'));
 if(!current.itemUrl){$('amazonFlowStatus').textContent='保存済み商品のAmazonリンクを確認してください。';current=null;return;}
 $('amazonFlowEditor').hidden=false;$('amazonFlowTitle').textContent=current.title;$('amazonFlowSource').href=current.itemUrl;
 $('amazonFlowBody').value=row.body??text(row.draft||'').split(row.affiliateUrl||'\u0000').join('').replace(/🛍️ Amazonでチェック\s*/gu,'').replace(/\s*#pr\b/giu,'').trim();
 $('amazonFlowMode').value=['item','search','none'].includes(row.linkMode)?row.linkMode:'item';
 for(const option of $('amazonFlowMode').options)option.disabled=option.value==='search'&&!current.searchUrl;
 $('amazonFlowEditorStatus').textContent='';update();$('amazonFlowEditor').scrollIntoView({block:'start',behavior:'instant'});
}
function prepare(item,tag,manual=false){
 const itemUrl=amazonUrl(item.url);if(!itemUrl||!text(item.title))return;
 const asin=productAsin(itemUrl);
 const list=rows();if(!storageOK)return;
 const existing=list.find(row=>row.itemUrl===itemUrl||row.affiliateUrl===itemUrl||(asin&&productAsin(row.itemUrl||row.affiliateUrl)===asin));
 const pastedSearch=manual&&['www.amazon.co.jp','amazon.co.jp'].includes(new URL(itemUrl).hostname)&&/^\/s\/?$/.test(new URL(itemUrl).pathname);
 open(existing||{id:crypto.randomUUID(),title:text(item.title),itemUrl,affiliateUrl:itemUrl,searchUrl:manual?(pastedSearch?itemUrl:''):searchLink(item.title,tag),partnerTag:tag,sourceUrl:newsSource,manual,createdAt:new Date().toISOString(),status:'未投稿',body:'🎀 '+text(item.title),linkMode:pastedSearch?'search':'item'});return save();
}
function renderDrafts(){
 const host=$('amazonFlowDrafts');host.replaceChildren();const filter=$('amazonFlowFilter').value;
 const list=rows().filter(row=>(row.status||'未投稿')===filter).slice().reverse();
 for(const row of list){const card=document.createElement('article');card.className='flow-card';const title=document.createElement('h3');title.textContent=row.title;card.append(title,button('確認・共有',()=>open(row)));host.append(card);}
 if(!list.length){const p=document.createElement('p');p.className='backup-note';p.textContent='該当するAmazon下書きはありません。';host.append(p);}
}
function productAsin(value){const u=amazonUrl(value);return u?new URL(u).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase()||'':'';}
function renderAuto(){
 const host=$('amazonAutoResults');host.replaceChildren();const used=new Set(rows().filter(r=>['投稿済み','見送り'].includes(r.status)).map(r=>productAsin(r.itemUrl||r.affiliateUrl)).filter(Boolean));
 const unique=new Map();for(const item of autoItems){const id=productAsin(item.url);if(id&&!used.has(id)&&Number(item.fetchedAt||0)*1000>Date.now()-86400000&&amazonUrl(item.url)&&text(item.title))unique.set(id,item);}
 for(const item of unique.values())renderProduct(item,autoTag,host);
 if(!unique.size){const p=document.createElement('p');p.className='backup-note';p.textContent='現在の未投稿候補はありません。自動検索が進むとここに表示されます。';host.append(p);}
}
function renderProduct(item,tag,host){
 const card=document.createElement('article');card.className='flow-card flow-source-card';const photo=imageUrl(item.image);if(photo){const img=document.createElement('img');img.src=photo;img.alt='商品照合用写真';img.loading='lazy';img.referrerPolicy='no-referrer';card.classList.add('has-image');card.append(img);}
 const title=document.createElement('h3');title.textContent=item.title;const a=document.createElement('a');a.href=item.url;a.textContent='Amazonで確認';a.className='small-btn link-btn';a.target='_blank';a.rel='sponsored nofollow noopener noreferrer';const actions=document.createElement('div');actions.className='flow-source-actions';actions.append(a,button('投稿準備',()=>prepare(item,tag)));card.append(title,actions);host.append(card);
}
async function amazonRequest(action,data){
 const key=cloudSettings().key;if(!key)throw new Error('管理画面で同期キーを設定してください。');
 const endpoint=new URL((cloudSettings().url||DEFAULT_CLOUD_API_URL).replace(/\/api[0-9]*\.php(?:\?.*)?$/,'/amazon-creators.php'));endpoint.searchParams.set('action',action);
 const r=await fetch(endpoint.href,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',signal:AbortSignal.timeout(65000)});
 const d=await r.json();if(!r.ok||!d.ok){const stage=['authentication','product-search'].includes(d.stage)&&Number.isInteger(d.upstreamStatus)?'（'+(d.stage==='authentication'?'認証':'商品検索')+'／HTTP '+d.upstreamStatus+'）':'';throw new Error((d.error||'Amazonの商品を取得できませんでした。')+stage);}return d;
}
function applyAuto(d){
 autoItems=Array.isArray(d.items)?d.items:[];autoTag=d.partnerTag||'';autoNextAt=Number(d.nextAt||0)*1000;renderAuto();
 const time=d.updatedAt?new Date(d.updatedAt*1000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未取得';
 $('amazonAutoStatus').textContent=autoItems.length+'件を取得済み ・ 最終成功：'+time+(d.autoError?' ・ '+d.autoError:'');
 $('amazonAutoProgress').textContent=(d.lastQuery?'前回の検索：'+d.lastQuery+' ・ ':'')+(d.nextQuery?'次の検索：'+d.nextQuery:'')+'（30分ごとに検索語を切替）';
}
async function loadAuto(){
 if(autoBusy||busy||$('flowProvider').value!=='amazon')return;
 autoBusy=true;$('amazonAutoRefresh').disabled=true;$('amazonFlowSearch').disabled=true;
 try{
  const d=await amazonRequest('candidates');applyAuto(d);autoLoaded=true;
  if(d.configured===false)throw new Error('管理画面のAmazon接続設定を確認してください。');
  if(autoNextAt<=Date.now()){
   $('amazonAutoStatus').textContent+=' ・ 新しい候補を検索中…';
   const next=await amazonRequest('discover',{});applyAuto(next);
  }
 }catch(e){$('amazonAutoStatus').textContent='自動検索を完了できませんでした：'+e.message+' 取得済み候補は保持しています。';}
 finally{autoBusy=false;$('amazonAutoRefresh').disabled=false;searchControls();}
}
function searchControls(){
 $('amazonFlowSearch').disabled=busy||autoBusy;
 $('amazonFlowMore').hidden=!searchMore;$('amazonFlowMore').disabled=busy||autoBusy||Date.now()<searchReadyAt||$('amazonFlowQuery').value.trim()!==searchKeyword;
 clearTimeout(searchTimer);if(Date.now()<searchReadyAt)searchTimer=setTimeout(searchControls,searchReadyAt-Date.now()+20);
 const u=new URL('https://www.amazon.co.jp/s');u.searchParams.set('k',$('amazonFlowQuery').value.trim()||'サンリオ');$('amazonSearchExternal').href=u.href;
}
async function search(more=false){
 if(busy||autoBusy)return;const keywords=$('amazonFlowQuery').value.trim();if(!keywords||keywords.length>120){$('amazonFlowStatus').textContent='商品名を120文字以内で入力してください。';return;}
 if(more&&(!searchMore||keywords!==searchKeyword||searchPage>=10))return;
 if(Date.now()<searchReadyAt){$('amazonFlowStatus').textContent='続けて検索する場合は5秒以上間隔をあけてください。取得済み結果は保持しています。';return;}
 const key=cloudSettings().key;if(!key){$('amazonFlowStatus').textContent='管理画面で同期キーを設定してください。';return;}
 const page=more?searchPage+1:1,started=Date.now();busy=true;searchControls();$('amazonFlowStatus').textContent='「'+keywords+'」の'+page+'ページ目を検索しています…';
 try{
  const d=await amazonRequest('search',{keywords,page});
  const items=(d.items||[]).filter(item=>amazonUrl(item.url)&&text(item.title));
  const unique=new Map((more?searchItems:[]).map(i=>[productAsin(i.url)||i.url,i]));for(const item of items){const id=productAsin(item.url)||item.url;if(!unique.has(id))unique.set(id,item);}
  searchItems=[...unique.values()];searchPage=page;searchKeyword=keywords;searchTag=d.partnerTag||'';searchMore=d.hasMore===true&&page<10;searchReadyAt=started+5000;
  $('amazonFlowResults').replaceChildren();for(const item of searchItems)renderProduct(item,searchTag,$('amazonFlowResults'));
  $('amazonFlowStatus').textContent=searchItems.length?searchItems.length+'件を取得しました（重複を除く・'+page+'ページ取得済み／1回最大10件）。'+(searchMore?'次の10件を追加検索できます。':page===10?'APIの検索範囲は10ページまでです。':'この検索結果の取得は完了しました。')+'価格・在庫は商品ページで確認してください。':'条件に合う商品はありませんでした。検索語を変えるか、Amazonで探したリンクを下から追加してください。';
 }catch(e){$('amazonFlowStatus').textContent=e.name==='TimeoutError'?'Amazonへの接続が時間切れになりました。もう一度検索してください。':e.message;}
 finally{busy=false;searchControls();}
}
function manualAdd(){
 const title=$('amazonManualTitle').value.trim(),url=amazonUrl($('amazonManualUrl').value);
 if(!title||title.length>500){$('amazonManualStatus').textContent='商品名を500文字以内で入力してください。';return;}
 if(!url||new URL(url).pathname==='/'){$('amazonManualStatus').textContent='日本のAmazon商品・検索結果・紹介リンクを入力してください。';return;}
 if(!$('amazonManualConfirmed').checked){$('amazonManualStatus').textContent='商品名とリンク先の一致を確認してください。';return;}
 const ok=prepare({title,url},'',true);$('amazonManualStatus').textContent=ok?'候補を保存しました。紹介リンクは貼り付けたURLのままです。':$('amazonFlowEditorStatus').textContent||'保存済みデータを確認してください。';if(ok)$('amazonManualConfirmed').checked=false;
}
function provider(){const amazon=$('flowProvider').value==='amazon';$('flowProviderRakuten').setAttribute('aria-pressed',String(!amazon));$('flowProviderAmazon').setAttribute('aria-pressed',String(amazon));$('amazonSearchArea').hidden=!amazon;$('flowRakutenArea').hidden=amazon;try{localStorage.setItem(PROVIDER,amazon?'amazon':'rakuten');}catch{}if(amazon){renderDrafts();if(!$('productFlowPanel').hidden&&(!autoLoaded||autoNextAt<=Date.now()))loadAuto();}else document.dispatchEvent(new Event('sph-product-flow-tab'));}
for(const [id,value] of [['flowProviderRakuten','rakuten'],['flowProviderAmazon','amazon']])$(id).onclick=()=>{$('flowProvider').value=value;provider();};
$('amazonAutoRefresh').onclick=loadAuto;
document.addEventListener('sph-product-flow-tab',()=>{if($('flowProvider').value==='amazon')loadAuto();});
setInterval(()=>{if(!document.hidden&&!$('productFlowPanel').hidden&&$('flowProvider').value==='amazon'&&autoNextAt<=Date.now())loadAuto();},60000);
$('amazonFlowSearch').onclick=()=>search();$('amazonFlowMore').onclick=()=>search(true);$('amazonFlowQuery').oninput=searchControls;$('amazonFlowQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search();}};
$('amazonManualAdd').onclick=manualAdd;for(const id of ['amazonManualTitle','amazonManualUrl'])$(id).oninput=()=>{$('amazonManualConfirmed').checked=false;};
$('amazonFlowFilter').onchange=renderDrafts;
$('amazonFlowBody').oninput=()=>{update();save();};$('amazonFlowMode').onchange=()=>{update();save();};$('amazonFlowSave').onclick=()=>save();
$('amazonFlowCopy').onclick=()=>{if(save())copyTextFromClick(finalText(),$('amazonFlowCopy'),'本文をコピーしました');};
$('amazonFlowCopyLink').onclick=()=>copyTextFromClick(link(),$('amazonFlowCopyLink'),'Amazonリンクをコピーしました');
$('amazonFlowShare').onclick=async()=>{if(!save())return;try{if(navigator.share)await navigator.share({text:finalText()});else copyTextFromClick(finalText(),$('amazonFlowShare'),'本文をコピーしました');}catch(e){if(e.name!=='AbortError')$('amazonFlowEditorStatus').textContent='共有できませんでした。本文コピーをご利用ください。';}};
$('amazonFlowDone').onclick=()=>{if(save('投稿済み')){$('amazonFlowEditor').hidden=true;current=null;}};$('amazonFlowSkip').onclick=()=>{if(save('見送り')){$('amazonFlowEditor').hidden=true;current=null;}};
$('amazonFlowToNews').onclick=()=>{if(save()&&link())document.dispatchEvent(new CustomEvent('sph-amazon-news-link',{detail:{sourceUrl:newsSource,link:link()}}));};
document.addEventListener('sph-amazon-product-search',event=>{newsSource=text(event.detail?.sourceUrl);$('amazonFlowQuery').value=text(event.detail?.title).slice(0,120)||'サンリオ';$('flowProvider').value='amazon';provider();setHomeView('flow');searchControls();update();$('amazonFlowQuery').scrollIntoView({block:'center',behavior:'instant'});});
try{if(localStorage.getItem(PROVIDER)==='amazon'){$('flowProvider').value='amazon';provider();}}catch{}
searchControls();
})();
