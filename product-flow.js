(()=>{
'use strict';
const el=id=>document.getElementById(id);
let entries=[],sources=[],sourceErrors=[],sourcePoolCount=0,sourceDisplayLimit=60,current=null,busy=false,files=[],dirty=false,requestSeq=0,sourceUpdatedAt=0,saveTimer=null,saving=false,photoPreviewEls=[],photoLabelEls=[],photoPreviewUrls=[],preparingPhotos=false,photoPreparationSeq=0;
function endpoint(action){const u=new URL((cloudSettings().url||DEFAULT_CLOUD_API_URL).replace(/\/api[0-9]*\.php(?:\?.*)?$/,'/product-flow.php'));u.searchParams.set('action',action);return u.href;}
async function api(action,data){
 const {key}=cloudSettings();if(!key)throw new Error('管理画面で同期キーを設定してください。');
 const r=await fetch(endpoint(action),{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',signal:AbortSignal.timeout(240000)});
 let d;try{d=await r.json();}catch{throw new Error('準備結果を確認できませんでした。「一覧を更新」で保存済み下書きを確認してください。');}
 if(!r.ok||d.ok===false)throw new Error(d.error||'下書きの準備を完了できませんでした。');return d;
}
function status(s){el('flowStatus').textContent=s;const editor=el('flowEditorStatus');if(editor)editor.textContent=s;}
function queueAutoSave(){clearTimeout(saveTimer);status('編集内容を自動保存します…');saveTimer=setTimeout(()=>{saveDraft(false);},1000);}
async function saveDraft(showMessage=true){
 if(!current||!dirty)return true;
 if(busy||saving){queueAutoSave();return false;}
 clearTimeout(saveTimer);saving=true;
 const id=current.id,body=el('flowBody').value,selected=[...current.selected],linkMode=el('flowLinkMode').value;
 try{
  const d=await api('save',{id,body,selected,linkMode});apply(d);
  const unchanged=current?.id===id&&el('flowBody').value===body&&el('flowLinkMode').value===linkMode&&JSON.stringify(current.selected)===JSON.stringify(selected);
  dirty=!unchanged;
  status(showMessage?(d.message||'下書きを保存しました。'):'自動保存しました。');
  return !dirty;
 }catch(e){status('自動保存できませんでした。'+e.message);return false;}
 finally{saving=false;if(dirty)queueAutoSave();if(current?.id===id)updateFinal();}
}
function closeEditor(){clearTimeout(saveTimer);++requestSeq;current=null;files=[];resetPhotoPreviews();el('flowEditor').hidden=true;el('flowBrowse').hidden=false;render();}
function button(text,fn){const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=text;b.onclick=fn;return b;}
function anchor(text,url){const a=document.createElement('a');a.textContent=text;a.className='small-btn link-btn';a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function safeURL(s,roots){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&roots.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
const FLOW_SHORT_KEY='sphRakutenFlowShortLinksV1';
function flowShortMap(){try{return JSON.parse(localStorage.getItem(FLOW_SHORT_KEY)||'{}')||{};}catch{return {};}}
function flowShortKey(row){return String(row?.item?.code||row?.item?.url||'').slice(0,2048);}
function flowShort(row){return flowShortMap()[flowShortKey(row)]||'';}
function validFlowShort(value){try{const u=new URL(value.trim());return u.protocol==='https:'&&u.hostname==='a.r10.to'&&u.pathname!=='/'&&!u.username&&!u.password&&!u.port;}catch{return false;}}
function saveFlowShort(value){
 if(!current)throw new Error('候補を開いてから操作してください。');
 const url=String(value||'').trim();if(!validFlowShort(url))throw new Error('楽天アフィリエイトで作成したa.r10.toの短縮URLを貼り付けてください。');
 const map=flowShortMap();map[flowShortKey(current)]=url;
 try{localStorage.setItem(FLOW_SHORT_KEY,JSON.stringify(map));}catch{throw new Error('短縮URLを端末に保存できませんでした。空き容量を確認してください。');}
 if([...el('flowLinkMode').options].some(o=>o.value==='item'&&!o.disabled))el('flowLinkMode').value='item';
 dirty=true;syncAffiliateBody();updateFinal();el('flowShortUrlStatus').textContent='短縮URLを保存して投稿本文に反映しました。';queueAutoSave();
}
function ready(row){return !!row.body&&!!row.match.link&&row.item.images?.length>0;}
function apply(d){
 entries=d.entries||entries;if(d.sources)sources=d.sources;if(Array.isArray(d.sourceErrors))sourceErrors=d.sourceErrors;if(Number.isFinite(Number(d.sourcePoolCount)))sourcePoolCount=Number(d.sourcePoolCount);if(d.sourceUpdatedAt)sourceUpdatedAt=Number(d.sourceUpdatedAt)*1000;
 if(typeof d.enabled==='boolean')el('flowAuto').checked=d.enabled;
 el('flowSettingsHint').textContent=[d.rakutenConfigured===false?'「楽天API設定」を保存してください。':'',d.aiConfigured===false?'新作ニュースの「AI設定」でGroqを設定してください。':''].filter(Boolean).join(' ');
 if(d.lastRun)el('flowLastRun').textContent='最終確認：'+new Date(d.lastRun*1000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
 render();if(d.lastError)status(d.lastError);
}

function renderSources(){
 const host=el('flowSources');if(!host)return;host.replaceChildren();
 const rows=sources.filter(r=>r&&r.code);
 const counts={market:0,books:0,travel:0};for(const row of rows)if(Object.prototype.hasOwnProperty.call(counts,row.service))counts[row.service]++;
 el('flowSourcesCount').textContent=(sourcePoolCount||rows.length)+'件を保管中（表示 '+rows.length+'件／楽天市場 '+counts.market+'・ブックス '+counts.books+'・トラベル '+counts.travel+'）';
 if(sourceErrors.length){const warning=document.createElement('p');warning.className='backup-note';warning.textContent='取得できないサービス：'+sourceErrors.join(' / ');host.append(warning);}
 if(!rows.length){const p=document.createElement('p');p.className='backup-note';p.textContent='自動検索中です。候補が見つかるとここに表示されます。';host.append(p);return;}
 for(const item of rows.slice(0,sourceDisplayLimit)){
  const card=document.createElement('article');card.className='flow-card flow-source-card';
  if(item.image&&safeURL(item.image,['r10s.jp','rakuten.co.jp','img.travel.rakuten.co.jp'])){const img=document.createElement('img');img.src=item.image;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';card.classList.add('has-image');card.append(img);}
  const title=document.createElement('h3');title.textContent=item.title||'商品名を確認できません';card.append(title);
  const meta=document.createElement('p');meta.className='backup-note';meta.textContent=(item.sourceLabel||'楽天')+(item.shop?' ・ '+item.shop:'')+(item.price>0?' ・ '+(item.service==='travel'?'最安料金目安：':'価格：')+Number(item.price).toLocaleString('ja-JP')+'円'+(item.service==='travel'?'／泊':''):'');card.append(meta);
  const actions=document.createElement('div');actions.className='flow-source-actions';
  if(item.url&&safeURL(item.url,['item.rakuten.co.jp','books.rakuten.co.jp','travel.rakuten.co.jp','hb.afl.rakuten.co.jp']))actions.append(anchor('掲載ページを見る',item.url));
  actions.append(button('投稿準備',()=>run('prepare-stock',{code:item.code},true)));
  card.append(actions);host.append(card);
 }
 if(rows.length>sourceDisplayLimit){host.append(button('さらに60件表示',()=>{sourceDisplayLimit+=60;renderSources();}));}
}

function render(){
 const filter=el('flowFilter').value,stockEntries=entries.filter(r=>r.item?.rakuten===true),rows=stockEntries.filter(r=>filter==='done'?r.mark==='done':filter==='skip'?r.mark==='skip':!r.mark&&(filter!=='ready'||ready(r)));
 el('flowList').replaceChildren();el('flowCount').textContent=rows.length+'件の楽天在庫下書き';
 for(const row of rows){
  const card=document.createElement('article');card.className='flow-card';
  const title=document.createElement('h3');title.textContent=row.item.title;
  const info=document.createElement('p');info.className='backup-note';info.textContent=(ready(row)?'リンク付き下書き':'確認待ち')+' ・ '+row.item.source+' ・ '+(row.match.linkMode==='search'?'楽天検索リンク':row.match.matchStatus);
  const actions=document.createElement('div');actions.className='cloud-sync-actions';actions.append(button('確認・共有',()=>open(row.id)));
  card.append(title,info,actions);el('flowList').append(card);
 }
 if(!rows.length){const p=document.createElement('p');p.className='backup-note';p.textContent='自動検索した候補から下書きを追加すると、ここに表示されます。';el('flowList').append(p);}
 renderSources();
}
async function run(action,data,show=false){
 if(busy)return;busy=true;for(const b of el('productFlowPanel').querySelectorAll('button,input,select,textarea'))b.disabled=true;
 status(data?.generateBody?'AIで本文を生成しています…':action==='tick'||action==='prepare'?'原文・写真を確認し、楽天照合と本文生成を進めています…':'保存・確認中…');
 try{const d=await api(action,data);apply(d);status(d.message||'保存しました。');if(show&&d.entry)await open(d.entry.id);return d;}
 catch(e){status(e.message);}
 finally{busy=false;for(const b of el('productFlowPanel').querySelectorAll('button,input,select,textarea'))b.disabled=false;updateFinal();}
}
async function rakutenImageRequest(url,isbn='',productUrl=''){
 const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');
 const r=await fetch(endpoint('image'),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({url,isbn,productUrl}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!r.ok){let d={};try{d=await r.json();}catch{}throw new Error(d.error||'楽天の商品写真を取得できませんでした。');}
 const blob=await r.blob(),file=new File([blob],'rakuten-product.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[blob.type]||'jpg'),{type:blob.type});
 file.imageDimensions=r.headers.get('X-Image-Dimensions')||'';return file;
}
async function getProductPhoto(row,index){const code=String(row.item.rakutenCode||'');const isbn=row.item.rakutenService==='books'&&code.startsWith('books:')?code.slice(6):'';return row.item.rakuten?rakutenImageRequest(row.item.images[index],isbn,row.item.url):newsRequest('image',row.item.url,index);}
function resetPhotoPreviews(){photoPreviewUrls.forEach(url=>{try{URL.revokeObjectURL(url);}catch{}});photoPreviewUrls=[];photoPreviewEls=[];photoLabelEls=[];}
function showPhotoFile(index,file){files[index]=file;const label=photoLabelEls[index];if(label&&/^\d+x\d+$/.test(file.imageDimensions||''))label.textContent='写真'+(index+1)+'（'+file.imageDimensions.replace('x','×')+'px・解像度確認済み）';const img=photoPreviewEls[index];if(!img)return;if(photoPreviewUrls[index])URL.revokeObjectURL(photoPreviewUrls[index]);const url=URL.createObjectURL(file);photoPreviewUrls[index]=url;img.src=url;}
async function load(forceSources=false){
 if(busy||el('flowProvider')?.value==='amazon')return;
 try{
  const d=await api('list');apply(d);
  if(d.rakutenConfigured===false){status('楽天API設定を確認してください。');return;}
  const fresh=Number(d.sourceUpdatedAt||0)*1000>Date.now()-30*60*1000;
  if(forceSources||!fresh){const next=await api('sources',{});apply(next);status(next.message||((next.sources||[]).length+'件の候補を自動取得しました。'));if(next.sourceErrors?.length)status((next.message||'候補を取得しました。')+' 一部サービス：'+next.sourceErrors.join(' / '));}
  else status('自動取得した候補を表示しています。');
 }catch(e){status(e.message);}
}
function syncAffiliateBody(){
 if(!current?.generatedOnRequest)return;
 updateFinal();el('flowBody').value=el('flowFinal').value;current.body=el('flowBody').value;
}
function updateFinal(){
 if(!current)return;current.body=el('flowBody').value;const mode=el('flowLinkMode').value;
 const link=mode==='none'?'':(mode==='item'?(flowShort(current)||current.match.itemAffiliate||''):current.match.searchAffiliate||'');
 el('flowLink').value=link;
 const source=current.body.replace(/https?:\/\/\S+/gu,'').replace(/\r\n?/g,'\n');
 const tags=[],seenTags=new Set();let hasPr=/#pr\b/iu.test(source);
 for(const match of source.matchAll(/#[\p{L}\p{N}_]+/gu)){
  const tag=match[0],key=tag.toLocaleLowerCase();
  if(key==='#pr'||seenTags.has(key))continue;
  seenTags.add(key);tags.push(tag);
 }
 const withoutTags=source.replace(/#[\p{L}\p{N}_]+/gu,'').replace(/[ \t]+$/gm,'');
 const lines=withoutTags.split('\n'),clean=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trimEnd();
  if(/^\s*(?:🔎|🔍|🛍️)?\s*(?:詳細|詳細はこちら|楽天でチェック)[：:]?\s*$/u.test(line)){
   const next=lines.slice(i+1).find(x=>x.trim());
   if(!next||/^\s*🛍️/u.test(next))continue;
  }
  if(!line.trim()&&!clean.length)continue;
  if(!line.trim()&&!clean.at(-1)?.trim())continue;
  clean.push(line);
 }
 const body=clean.join('\n').trim();
 const finalTags=[...tags,...(link||hasPr?['#pr']:[])].join(' ');
 el('flowFinal').value=[body,...(link?['🛍️ 楽天でチェック\n'+link]:[]),finalTags].filter(Boolean).join('\n\n');
 const count=current.selected.length;el('flowPhotoStatus').textContent=count+'枚選択 ・ '+files.filter(Boolean).length+'枚準備済み'+(preparingPhotos?' ・ 写真を取得中…':'');
 el('flowShare').disabled=busy||saving||preparingPhotos||dirty||!body||!count||!el('flowConfirm').checked;
 el('flowSavePhotos').disabled=busy||!count||current.selected.some(i=>!files[i]);
 el('flowCopy').disabled=busy||!body;
}
async function open(id){
 let row=entries.find(r=>r.id===id);if(!row)return;
 if(dirty&&current&&current.id!==id){status('編集中の本文を「下書きを保存」で保存してから切り替えてください。');return;}
 if(row.item.rakutenService==='books'&&Date.now()-Number(row.item.galleryCheckedAt||0)>24*60*60*1000){
  status('楽天ブックスの商品ページから写真候補を確認しています…');
  try{const data=await api('gallery',{id});apply(data);row=entries.find(r=>r.id===id)||row;}
  catch(e){status('追加写真を確認できませんでした：'+e.message);}
 }
 resetPhotoPreviews();preparingPhotos=false;photoPreparationSeq++;current=structuredClone(row);dirty=false;files=[];const seq=++requestSeq;
 el('flowBrowse').hidden=true;el('flowEditor').hidden=false;el('flowTitle').textContent=row.item.title;
 el('flowBody').value=row.edited===false&&!row.generatedOnRequest?'':row.body;
 el('flowConfirm').checked=false;
 el('flowOriginal').textContent=(row.item.paragraphs||[]).join('\n\n');
 el('flowItemUrl').value=row.item.url||'';
 const rakutenAppOpen=el('flowRakutenAppOpen');
 if(rakutenAppOpen){rakutenAppOpen.href=row.item.url||'https://www.rakuten.co.jp/';rakutenAppOpen.hidden=!/^https:\/\/item\.rakuten\.co\.jp\//i.test(row.item.url||'');}
 el('flowShortUrlStatus').textContent=flowShort(row)?'この候補に保存済みの短縮URLがあります。':'';
 const affiliateOpen=el('flowRakutenAffiliateOpen');
 if(/iPad|iPhone|iPod/.test(navigator.userAgent||'')){affiliateOpen.href='googlechromes://affiliate.rakuten.co.jp/';affiliateOpen.removeAttribute('target');affiliateOpen.textContent='楽天アフィリエイトをChromeで開く';}
 el('flowEvidence').textContent=[row.identity.jan?'JAN：'+row.identity.jan:'',row.identity.model?'型番：'+row.identity.model:'',row.match.matchStatus,row.match.shopCount?'一致したショップ：'+row.match.shopCount+'店':'',...(row.warnings||[])].filter(Boolean).join('\n');
 el('flowSourceLink').href=row.item.url;
 el('flowLinkMode').value=row.match.linkMode;for(const o of el('flowLinkMode').options)o.disabled=o.value!=='none'&&!row.match[o.value==='search'?'searchAffiliate':'itemAffiliate'];
 renderPhotos();updateFinal();syncAffiliateBody();document.dispatchEvent(new CustomEvent('sph-blog-product',{detail:{getProduct:()=>structuredClone(current)}}));el('flowEditor').scrollIntoView({block:'start',behavior:'instant'});
 await prepareSelectedPhotos();
}
async function prepareSelectedPhotos(){
 if(!current)return false;
 const missing=current.selected.filter(i=>!files[i]);if(!missing.length)return true;
 const row=current,seq=requestSeq,job=++photoPreparationSeq;preparingPhotos=true;updateFinal();status('写真を準備しています。完了後、もう一度「本文＋写真を共有」を押してください。');
 const results=await Promise.all(missing.map(async i=>{try{return {i,file:await getProductPhoto(row,i)};}catch(error){return {i,error};}}));
 if(seq!==requestSeq||job!==photoPreparationSeq)return false;
 for(const result of results)if(result.file)showPhotoFile(result.i,result.file);
 preparingPhotos=false;updateFinal();
 const failed=results.filter(result=>result.error);
 if(failed.length){status('写真'+failed.map(result=>result.i+1).join('・')+'を取得できませんでした：'+(failed[0].error?.message||'通信を確認してください。')+' 「写真を再取得」をお試しください。');return false;}
 status('写真を準備しました。もう一度「本文＋写真を共有」を押してください。');return true;
}
function renderPhotos(){
 el('flowPhotos').replaceChildren();
 for(const [i,url] of current.item.images.entries()){
  const label=document.createElement('label');label.className='flow-photo';
  const img=document.createElement('img');photoPreviewEls[i]=img;img.src=newsApiUrl('image',current.item.url,i);
  // The protected image endpoint needs a Bearer header. Use a source preview;
  // downloadable files are fetched separately with newsRequest.
  if(current.item.rakuten&&safeURL(url,['rakuten.co.jp','r10s.jp','img.travel.rakuten.co.jp']))img.src=url;else if(safeURL(url,['sanrio.co.jp','prtimes.jp','prcdn.freetls.fastly.net','cdninstagram.com','fbcdn.net','bandai.co.jp','akamaihd.net','takaratomy-arts.co.jp','re-ment.co.jp','gashapon.jp','makeshop-multi-images.akamaized.net','shopify.com']))img.src=url;
  else img.removeAttribute('src');
  img.alt='写真'+(i+1);img.loading='lazy';img.referrerPolicy='no-referrer';
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=current.selected.includes(i);
  checkbox.onchange=async()=>{
   if(checkbox.checked&&current.selected.length>=4){checkbox.checked=false;status('写真は4枚まで選択できます。');return;}
   if(checkbox.checked)current.selected.push(i);else current.selected=current.selected.filter(n=>n!==i);
   dirty=true;updateFinal();queueAutoSave();const seq=requestSeq;
   if(checkbox.checked&&!files[i])try{const f=await getProductPhoto(current,i);if(seq===requestSeq){showPhotoFile(i,f);updateFinal();status('写真'+(i+1)+'を準備しました。');}}catch(error){status('写真'+(i+1)+'を準備できませんでした：'+(error?.message||'通信を確認してください。'));}
  };
  const photoLabel=document.createElement('span');photoLabel.textContent='写真'+(i+1);photoLabelEls[i]=photoLabel;
  label.append(img,checkbox,photoLabel);el('flowPhotos').append(label);
 }
}
el('flowItemUrlCopy').onclick=async()=>{
 const input=el('flowItemUrl'),message=el('flowShortUrlStatus');if(!input.value)return;
 try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(input.value);else{input.focus();input.select();if(!document.execCommand('copy'))throw new Error('copy');}message.textContent='商品URLをコピーしました。楽天アフィリエイトで短縮URLを作成してください。';}
 catch{input.focus();input.select();input.setSelectionRange(0,input.value.length);message.textContent='コピーできませんでした。選択された商品URLを長押ししてコピーしてください。';}
};
el('flowShortUrlPaste').onclick=async()=>{
 const button=el('flowShortUrlPaste'),input=el('flowLink'),message=el('flowShortUrlStatus');button.disabled=true;
 try{if(!navigator.clipboard?.readText)throw new Error('clipboard');const text=await navigator.clipboard.readText();saveFlowShort(text);}
 catch(error){if(error.message==='clipboard'||error.name==='NotAllowedError'||error.name==='NotReadableError'){input.focus();input.select();message.textContent='クリップボードを読めません。楽天アフィリエイトで短縮URLをコピーし、このリンク欄に貼り付けてください。';}else message.textContent=error.message;}
 finally{button.disabled=false;}
};
el('flowLink').addEventListener('change',event=>{
 const value=event.currentTarget.value.trim();if(!value)return;
 try{saveFlowShort(value);}catch(error){el('flowShortUrlStatus').textContent=error.message;updateFinal();}
});
el('flowRefresh').onclick=()=>load(true);



el('flowAuto').onchange=()=>run('settings',{enabled:el('flowAuto').checked});
el('flowFilter').onchange=render;
el('flowBody').oninput=()=>{dirty=true;updateFinal();queueAutoSave();};
el('flowLinkMode').onchange=()=>{dirty=true;syncAffiliateBody();updateFinal();queueAutoSave();};
el('flowConfirm').onchange=updateFinal;
el('flowSave').onclick=()=>saveDraft(true);
el('flowGenerate').onclick=async()=>{
 if(!current||busy||saving)return;
 if(dirty&&!await saveDraft(true))return;
 el('flowConfirm').checked=false;
 const result=await run('retry',{id:current.id,generateBody:true},true);
 if(result){current.generatedOnRequest=true;syncAffiliateBody();dirty=true;await saveDraft(false);status('AIで本文を生成し、選択中のアフィリエイトリンクを反映しました。');}
};
el('flowRetry').onclick=async()=>{if(dirty){status('編集内容を先に保存してください。');return;}await run('retry',{id:current.id},true);};
el('flowPhotoRetry').onclick=async()=>{if(!current||preparingPhotos)return;for(const i of current.selected)files[i]=undefined;await prepareSelectedPhotos();};
el('flowBack').onclick=async()=>{if(dirty&&!await saveDraft(true))return;closeEditor();};
el('flowCopy').onclick=()=>copyTextFromClick(el('flowFinal').value,el('flowCopy'),'リンク付き本文をコピーしました');
el('flowShare').onclick=async()=>{
 if(!el('flowConfirm').checked){status('商品・掲載内容・在庫・リンク・写真を確認してください。');return;}
 if(dirty||saving){status('編集内容を保存中です。自動保存後に共有できます。');queueAutoSave();return;}
 if(current.selected.some(i=>!files[i])){await prepareSelectedPhotos();return;}
 const text=el('flowFinal').value,data={text,files:current.selected.map(i=>files[i])};
 try{
  if(navigator.canShare?.(data)){await navigator.share(data);status('共有画面を閉じました。Xで投稿後、「投稿済みにして次へ」を押してください。');}
  else if(navigator.share){await navigator.share({text});status('本文を共有しました。写真は別に保存してください。');}
  else copyTextFromClick(text,el('flowCopy'),'本文をコピーしました');
 }catch(e){if(e.name!=='AbortError')status('共有できませんでした。本文コピー・写真保存を利用してください。');}
};
el('flowSavePhotos').onclick=()=>{for(const i of current.selected){const f=files[i];if(!f)continue;const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}};
async function markCurrent(mark){
 if(!current)return;
 if(dirty&&!await saveDraft(true))return;
 const id=current.id,code=current.item?.code;
 const d=await run('mark',{id,mark});if(!d)return;
 if(mark==='done'){
  const nextDraft=entries.find(row=>row.id!==id&&!row.mark);
  if(nextDraft){await open(nextDraft.id);status('次の準備済み候補を開きました。');return;}
  const prepared=new Set(entries.map(row=>row.item?.code).filter(Boolean));
  const nextSource=sources.find(item=>item?.code&&item.code!==code&&!prepared.has(item.code));
  if(nextSource){await run('prepare-stock',{code:nextSource.code},true);return;}
 }
 closeEditor();
 if(mark==='done')status('投稿済みにしました。次に準備できる候補はありません。');
}
el('flowDone').onclick=()=>markCurrent('done');
el('flowSkip').onclick=()=>markCurrent('skip');
document.addEventListener('sph-product-flow-tab',load);
setInterval(()=>{if(!document.hidden&&!el('productFlowPanel').hidden)load();},5*60*1000);
if(location.hash==='#new-product')setHomeView('flow');
})();

