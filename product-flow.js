(()=>{
'use strict';
const el=id=>document.getElementById(id);
let entries=[],sources=[],current=null,busy=false,files=[],dirty=false,requestSeq=0;
function endpoint(action){const u=new URL((cloudSettings().url||DEFAULT_CLOUD_API_URL).replace(/\/api[0-9]*\.php(?:\?.*)?$/,'/product-flow.php'));u.searchParams.set('action',action);return u.href;}
async function api(action,data){
 const {key}=cloudSettings();if(!key)throw new Error('管理画面で同期キーを設定してください。');
 const r=await fetch(endpoint(action),{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',signal:AbortSignal.timeout(240000)});
 let d;try{d=await r.json();}catch{throw new Error('準備結果を確認できませんでした。「一覧を更新」で保存済み下書きを確認してください。');}
 if(!r.ok||d.ok===false)throw new Error(d.error||'下書きの準備を完了できませんでした。');return d;
}
function status(s){el('flowStatus').textContent=s;}
function button(text,fn){const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=text;b.onclick=fn;return b;}
function anchor(text,url){const a=document.createElement('a');a.textContent=text;a.className='small-btn link-btn';a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function safeURL(s,roots){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&roots.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
function ready(row){return !!row.body&&!!row.match.link&&row.item.images?.length>0;}
function apply(d){
 entries=d.entries||entries;if(d.sources)sources=d.sources;
 if(typeof d.enabled==='boolean')el('flowAuto').checked=d.enabled;
 el('flowSettingsHint').textContent=[d.rakutenConfigured===false?'「楽天API設定」を保存してください。':'',d.aiConfigured===false?'新作ニュースの「AI設定」でGroqを設定してください。':''].filter(Boolean).join(' ');
 if(d.lastRun)el('flowLastRun').textContent='最終確認：'+new Date(d.lastRun*1000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
 render();if(d.lastError)status(d.lastError);
}
function render(){
 const filter=el('flowFilter').value,rows=entries.filter(r=>filter==='done'?r.mark==='done':filter==='skip'?r.mark==='skip':!r.mark&&(filter!=='ready'||ready(r)));
 el('flowList').replaceChildren();el('flowCount').textContent=rows.length+'件';
 for(const row of rows){
  const card=document.createElement('article');card.className='flow-card';
  const title=document.createElement('h3');title.textContent=row.item.title;
  const info=document.createElement('p');info.className='backup-note';info.textContent=(ready(row)?'リンク付き下書き':'確認待ち')+' ・ '+row.item.source+' ・ '+(row.match.linkMode==='search'?'楽天検索リンク':row.match.matchStatus);
  const actions=document.createElement('div');actions.className='cloud-sync-actions';actions.append(button('確認・共有',()=>open(row.id)));
  card.append(title,info,actions);el('flowList').append(card);
 }
 if(!rows.length){const p=document.createElement('p');p.className='backup-note';p.textContent='自動準備した下書きがここに並びます。「次の1件を自動準備」から始められます。';el('flowList').append(p);}
 el('flowSources').replaceChildren();
 for(const item of sources.slice(0,30)){
  if(entries.some(r=>r.item.rakutenCode===item.code))continue;
  const row=document.createElement('div');row.className='flow-source';const title=document.createElement('span');title.textContent=item.title+' ・ '+item.shop+(item.price?' ・ '+Number(item.price).toLocaleString('ja-JP')+'円':'');
  row.append(title,button('この商品で下書き',()=>run('prepare-stock',{code:item.code},true)));el('flowSources').append(row);
 }
}
async function run(action,data,show=false){
 if(busy)return;busy=true;for(const b of el('productFlowPanel').querySelectorAll('button,input,select,textarea'))b.disabled=true;
 status(action==='tick'||action==='prepare'?'原文・写真を確認し、楽天照合と本文生成を進めています…':'保存・確認中…');
 try{const d=await api(action,data);apply(d);status(d.message||'保存しました。');if(show&&d.entry)await open(d.entry.id);return d;}
 catch(e){status(e.message);}
 finally{busy=false;for(const b of el('productFlowPanel').querySelectorAll('button,input,select,textarea'))b.disabled=false;updateFinal();}
}
async function rakutenImageRequest(url){
 const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');
 const r=await fetch(endpoint('image'),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({url}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!r.ok){let d={};try{d=await r.json();}catch{}throw new Error(d.error||'楽天の商品写真を取得できませんでした。');}
 const blob=await r.blob();return new File([blob],'rakuten-product.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[blob.type]||'jpg'),{type:blob.type});
}
async function getProductPhoto(row,index){return row.item.rakuten?rakutenImageRequest(row.item.images[index]):newsRequest('image',row.item.url,index);}
async function load(){
 if(busy)return;
 try{
  apply(await api('list'));
  if(!sources.length){const d=await api('sources',{});apply(d);status(d.message||'楽天の在庫商品を読み込みました。');}
  else status('保存済み下書きと楽天候補を読み込みました。');
 }catch(e){status(e.message);}
}
function updateFinal(){
 if(!current)return;current.body=el('flowBody').value;const mode=el('flowLinkMode').value;
 const link=mode==='none'?'':current.match[mode==='search'?'searchAffiliate':'itemAffiliate']||'';
 el('flowLink').value=link;
 const body=current.body.replace(/(?:\s*#pr)+\s*$/iu,'').trim();
 el('flowFinal').value=body+(link?'\n\n🛍️ 楽天でチェック\n'+link+'\n\n#pr':'');
 const count=current.selected.length;el('flowPhotoStatus').textContent=count+'枚選択 ・ '+files.filter(Boolean).length+'枚準備済み';
 el('flowShare').disabled=busy||!body||!count||current.selected.some(i=>!files[i]);
 el('flowSavePhotos').disabled=busy||!count||current.selected.some(i=>!files[i]);
 el('flowCopy').disabled=busy||!body;
}
async function open(id){
 const row=entries.find(r=>r.id===id);if(!row)return;
 if(dirty&&current&&current.id!==id){status('編集中の本文を「下書きを保存」で保存してから切り替えてください。');return;}
 current=structuredClone(row);dirty=false;files=[];const seq=++requestSeq;
 el('flowBrowse').hidden=true;el('flowEditor').hidden=false;el('flowTitle').textContent=row.item.title;
 el('flowBody').value=row.body;el('flowKeyword').value=row.identity.keyword;
 el('flowOriginal').textContent=(row.item.paragraphs||[]).join('\n\n');
 el('flowEvidence').textContent=[row.identity.jan?'JAN：'+row.identity.jan:'',row.identity.model?'型番：'+row.identity.model:'',row.match.matchStatus,row.match.shopCount?'一致したショップ：'+row.match.shopCount+'店':'',...(row.warnings||[])].filter(Boolean).join('\n');
 el('flowSourceLink').href=row.item.url;
 el('flowLinkMode').value=row.match.linkMode;for(const o of el('flowLinkMode').options)o.disabled=o.value!=='none'&&!row.match[o.value==='search'?'searchAffiliate':'itemAffiliate'];
 el('flowSearchLink').href=row.match.searchUrl||'https://search.rakuten.co.jp/';
 renderPhotos();renderCandidates();updateFinal();el('flowEditor').scrollIntoView({block:'start',behavior:'instant'});
 await Promise.allSettled(current.selected.map(async i=>{try{const f=await getProductPhoto(row,i);if(seq!==requestSeq)return;files[i]=f;updateFinal();}catch(e){if(seq===requestSeq)status('写真'+(i+1)+'を準備できませんでした。「写真を再取得」を押してください。');}}));
}
function renderPhotos(){
 el('flowPhotos').replaceChildren();
 for(const [i,url] of current.item.images.entries()){
  const label=document.createElement('label');label.className='flow-photo';
  const img=document.createElement('img');img.src=newsApiUrl('image',current.item.url,i);
  // The protected image endpoint needs a Bearer header. Use a source preview;
  // downloadable files are fetched separately with newsRequest.
  if(row.item.rakuten&&safeURL(url,['rakuten.co.jp','r10s.jp']))img.src=url;else if(safeURL(url,['sanrio.co.jp','prtimes.jp','prcdn.freetls.fastly.net','cdninstagram.com','fbcdn.net','bandai.co.jp','akamaihd.net','takaratomy-arts.co.jp','re-ment.co.jp','gashapon.jp','makeshop-multi-images.akamaized.net','shopify.com']))img.src=url;
  else img.removeAttribute('src');
  img.alt='写真'+(i+1);img.loading='lazy';img.referrerPolicy='no-referrer';
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=current.selected.includes(i);
  checkbox.onchange=async()=>{
   if(checkbox.checked&&current.selected.length>=4){checkbox.checked=false;status('写真は4枚まで選択できます。');return;}
   if(checkbox.checked)current.selected.push(i);else current.selected=current.selected.filter(n=>n!==i);
   dirty=true;updateFinal();const seq=requestSeq;
   if(checkbox.checked&&!files[i])try{const f=await getProductPhoto(current,i);if(seq===requestSeq){files[i]=f;updateFinal();}}catch{status('写真を準備できませんでした。');}
  };
  label.append(img,checkbox,document.createTextNode('写真'+(i+1)));el('flowPhotos').append(label);
 }
}
function renderCandidates(){
 el('flowCandidates').replaceChildren();
 for(const c of current.match.candidates.slice(0,10)){
  const row=document.createElement('article');row.className='flow-candidate';
  if(c.image&&safeURL(c.image,['rakuten.co.jp','r10s.jp'])){const img=document.createElement('img');img.src=c.image;img.alt='';img.loading='lazy';row.append(img);}
  const p=document.createElement('p');p.textContent=c.title+'（'+c.shop+'）';
  row.append(p);if(safeURL(c.url,['item.rakuten.co.jp']))row.append(anchor('商品ページで確認',c.url));
  if(c.affiliate)row.append(button('写真・商品が一致するので採用',async()=>{
   if(dirty){status('本文・写真の変更を先に「下書きを保存」で保存してください。');return;}
   await run('confirm',{id:current.id,code:c.code},true);
  }));
  el('flowCandidates').append(row);
 }
}
el('flowRefresh').onclick=load;
el('flowNext').onclick=()=>run('tick',{manual:true},true);
el('flowDiscover').onclick=()=>run('sources',{});
el('flowPrepareUrl').onclick=()=>run('prepare',{url:el('flowUrl').value.trim()},true);
el('flowAuto').onchange=()=>run('settings',{enabled:el('flowAuto').checked});
el('flowFilter').onchange=render;
el('flowBody').oninput=()=>{dirty=true;updateFinal();};
el('flowLinkMode').onchange=()=>{dirty=true;updateFinal();};
el('flowSave').onclick=async()=>{
 if(!current)return;const d=await run('save',{id:current.id,body:el('flowBody').value,selected:current.selected,linkMode:el('flowLinkMode').value});
 if(d){dirty=false;status('下書きを保存しました。');}
};
el('flowMatch').onclick=async()=>{
 if(dirty){status('編集内容を先に保存してください。');return;}
 await run('match',{id:current.id,keyword:el('flowKeyword').value.trim()},true);
};
el('flowRetry').onclick=async()=>{if(dirty){status('編集内容を先に保存してください。');return;}await run('retry',{id:current.id},true);};
el('flowPhotoRetry').onclick=async()=>{
 const seq=requestSeq;await Promise.allSettled(current.selected.map(async i=>{try{const f=await newsRequest('image',current.item.url,i);if(seq===requestSeq)files[i]=f;}catch{status('写真'+(i+1)+'を取得できませんでした。');}}));updateFinal();
};
el('flowBack').onclick=()=>{if(dirty){status('変更を先に「下書きを保存」で保存してください。');return;}++requestSeq;current=null;files=[];el('flowEditor').hidden=true;el('flowBrowse').hidden=false;render();};
el('flowCopy').onclick=()=>copyTextFromClick(el('flowFinal').value,el('flowCopy'),'リンク付き本文をコピーしました');
el('flowShare').onclick=async()=>{
 const text=el('flowFinal').value,data={text,files:current.selected.map(i=>files[i]).filter(Boolean)};
 try{if(navigator.canShare?.(data))await navigator.share(data);else if(navigator.share)await navigator.share({text});else copyTextFromClick(text,el('flowCopy'),'本文をコピーしました');}
 catch(e){if(e.name!=='AbortError')status('共有できませんでした。本文コピー・写真保存を利用してください。');}
};
el('flowSavePhotos').onclick=()=>{for(const i of current.selected){const f=files[i];if(!f)continue;const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}};
for(const [id,mark] of [['flowDone','done'],['flowSkip','skip']])el(id).onclick=async()=>{
 if(dirty){status('編集内容を先に保存してください。');return;}const d=await run('mark',{id:current.id,mark});if(d)el('flowBack').click();
};
document.addEventListener('sph-product-flow-tab',load);
if(location.hash==='#new-product')setHomeView('flow');
})();
