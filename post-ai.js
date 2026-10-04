/* Text-only Gemini drafts. Images stay in the browser; native share is synchronous. */
window.postAi=(()=>{
 function weightedLength(text){
  let count=0;
  const rest=String(text).replace(/https?:\/\/[^\s<>]+/gu,()=>{count+=23;return '';});
  for(const char of rest){const n=char.codePointAt(0);count+=n<=4351||(n>=8192&&n<=8205)||(n>=8208&&n<=8223)||(n>=8242&&n<=8247)?1:2;}
  return count;
 }
 const sessions={},el=id=>document.getElementById(id);
 function mount(kind){
  const prefix=kind==='today'?'todayAi':'productAi',root=el(prefix+'Panel');
  if(!root)return;
  root.innerHTML='<button type="button" class="small-btn primary" id="'+prefix+'Generate">'+(kind==='today'?'AIで焼き直し文を作る':'AIで投稿文を作る')+'</button>'+
   '<details class="backup-note"><summary>AIに送る情報・設定</summary><p>商品情報・元投稿・補足をGeminiへ送信します。写真・分析数値は送りません。写真との一致はご確認ください。設定は「新作ニュース」の文章AI設定と共通です。</p></details>'+
   '<div id="'+prefix+'Editor" hidden><label id="'+prefix+'ChoiceLabel" hidden>投稿案<select id="'+prefix+'Choice" aria-label="使う投稿案"><option value="0">1. シンプル情報系（200文字以内）</option><option value="1">2. 華やかな紹介系</option><option value="2">3. 目を引く可愛い系</option></select></label><label>X投稿文（編集できます）<textarea id="'+prefix+'Text" rows="7"></textarea></label><p id="'+prefix+'Count" class="backup-note"></p><div class="cloud-sync-actions"><button type="button" class="small-btn primary" id="'+prefix+'Share">本文＋写真を共有</button><button type="button" class="small-btn" id="'+prefix+'Copy">投稿文をコピー</button></div></div>'+
   '<p id="'+prefix+'Status" class="backup-note" role="status" aria-live="polite"></p>';
  const session={prefix,revision:0,requestId:0,busy:false,context:null,item:null};sessions[kind]=session;
  el(prefix+'Generate').addEventListener('click',()=>generate(kind));
  el(prefix+'Text').addEventListener('input',()=>{session.revision++;if(session.drafts?.length)session.drafts[session.choice].text=el(prefix+'Text').value;count(session);});
  el(prefix+'Choice').addEventListener('change',()=>{if(!session.drafts?.length)return;session.drafts[session.choice].text=el(prefix+'Text').value;session.choice=Number(el(prefix+'Choice').value);session.revision++;el(prefix+'Text').value=session.drafts[session.choice].text;count(session);});
  el(prefix+'Share').addEventListener('click',()=>share(kind));
  el(prefix+'Copy').addEventListener('click',()=>copy(kind));
 }
 function reset(kind,item=null){
  const s=sessions[kind];s.revision++;s.requestId++;s.item=item;s.context=null;s.busy=false;
  el(s.prefix+'Generate').disabled=false;el(s.prefix+'Editor').hidden=true;
  el(s.prefix+'Text').value='';el(s.prefix+'Status').textContent='';
  s.drafts=[];s.choice=0;s.premium=false;el(s.prefix+'ChoiceLabel').hidden=true;el(s.prefix+'Choice').value='0';
 }
 function context(kind){
  if(kind==='product')return lovelyWatch.aiContext();
  const item=detailCurrentItem;
  if(!item||item!==sessions.today.item||el('todayDetailModal').classList.contains('hidden'))throw new Error('今日の候補を開いてください。');
  return {mode:'rewrite',title:String(item.title||shortLabel(item)).slice(0,500),text:String(item.text||''),links:todayAffiliateLinks(item)};
 }
 function count(s){el(s.prefix+'Count').textContent=s.premium?visibleLength(el(s.prefix+'Text').value)+'文字（URLは23換算）・Xプレミアム向け':weightedLength(el(s.prefix+'Text').value)+' / 280（URLは23、日本語は2で換算・複合絵文字は安全側の目安）';}
 function visibleLength(text){let n=0;const rest=String(text).replace(/https?:\/\/[^\s<>]+/gu,()=>{n+=23;return '';});return n+Array.from(rest).length;}
 async function generate(kind){
  const s=sessions[kind],status=el(s.prefix+'Status');if(s.busy)return;
  let input;try{input=context(kind);if(!input.text.trim())throw new Error('元投稿・確認した商品情報を確認してください。');}catch(e){status.textContent=e.message;return;}
  if(el(s.prefix+'Text').value.trim()&&!confirm('現在の投稿文をAIで作り直しますか？'))return;
  const revision=s.revision,requestId=++s.requestId,before=el(s.prefix+'Text').value,signature=JSON.stringify(input);
  const current=()=>s.revision===revision&&(()=>{try{return JSON.stringify(context(kind))===signature}catch{return false}})();
  s.busy=true;el(s.prefix+'Generate').disabled=true;status.textContent='AIで文章を作成中…（編集した本文は上書きしません）';
  try{
   let result;
   for(let attempt=0;attempt<3;attempt++){
    if(!current())return;
    try{result=await newsAiPost('post-ai-draft',input);break;}
    catch(e){
     if(!e.retryable||attempt===2)throw e;
     if(!current())return;
     const delay=attempt===0?3000:6000;
     status.textContent='Googleが混雑しています。'+delay/1000+'秒後に再試行します（'+(attempt+1)+'/2）…';
     await new Promise(resolve=>setTimeout(resolve,delay));
    }
   }
   if(!current()||el(s.prefix+'Text').value!==before)return;
   if(!result?.configured)throw new Error('AI未設定です。「新作ニュース」の文章AI設定でキーを保存してください。');
   if(typeof result.text!=='string'||!result.text.trim())throw new Error('AI文を取得できませんでした。');
   s.context=JSON.parse(signature);s.drafts=Array.isArray(result.drafts)&&result.drafts.length===3&&result.drafts.every(d=>typeof d.text==='string'&&d.text.trim())?result.drafts.map(d=>({...d})):[];s.choice=0;s.premium=result.premium===true;el(s.prefix+'Choice').value='0';el(s.prefix+'ChoiceLabel').hidden=!s.drafts.length;el(s.prefix+'Text').value=s.drafts[0]?.text||result.text;el(s.prefix+'Editor').hidden=false;count(s);
   status.textContent=(s.drafts.length?'可愛い投稿案を3つ作成しました。':'AI作成済み：')+'元情報・写真との一致、価格・日程・条件を確認して共有してください。';
  }catch(e){if(s.revision===revision)status.textContent='AI未調整：'+(e.name==='TimeoutError'||e.name==='AbortError'?'通信が時間切れになりました。もう一度お試しください。':e.message);}
  finally{
   if(s.requestId===requestId){
    s.busy=false;el(s.prefix+'Generate').disabled=false;
    if(!current())status.textContent='手動編集・商品情報の変更を優先し、AI文は反映していません。必要なら作り直してください。';
   }
  }
 }
 function checkedText(kind){
  const s=sessions[kind],input=context(kind),text=el(s.prefix+'Text').value.trim();
  if(!s.context||JSON.stringify(input)!==JSON.stringify(s.context))throw new Error('商品情報・紹介リンクが変わりました。AI文を作り直してください。');
  if(!text||(!s.premium&&weightedLength(text)>280))throw new Error('投稿文をX換算で280以内にしてください。');
  if(!/#pr\s*$/i.test(text)||(text.match(/#pr\b/gi)||[]).length!==1)throw new Error('末尾に #pr を1回付けてください。');
  const urls=text.match(/https?:\/\/[^\s]+/gi)||[];
  if(input.links.some(l=>!urls.includes(l.url))||urls.some(url=>!input.links.some(l=>l.url===url)))throw new Error('紹介リンクを元のURLのまま残してください。');
  return text;
 }
 async function copy(kind){
  const s=sessions[kind];try{
   const text=checkedText(kind);
   if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else if(!legacyCopyText(text))throw new Error('本文を長押ししてコピーしてください。');
   el(s.prefix+'Status').textContent='投稿文をコピーしました。';
  }catch(e){el(s.prefix+'Status').textContent=e.message;}
 }
 function share(kind){
  const s=sessions[kind],status=el(s.prefix+'Status');
  try{
   const text=checkedText(kind);let files;
   if(kind==='product')files=lovelyWatch.aiFiles();
   else{
    const item=detailCurrentItem;
    if(detailPhotoSelection.some(i=>!detailImageBlobs[i]))throw new Error('選んだ写真の準備が終わっていません。取得失敗の写真は選択を外してください。');
    files=detailPhotoSelection.map((i,pos)=>{const b=detailImageBlobs[i],ext=b.type.includes('png')?'png':b.type.includes('webp')?'webp':'jpg';return new File([b],safeImageName(item,pos,ext),{type:b.type||'image/jpeg'});});
   }
   const data=files.length?{text,files}:{text};
   if(!navigator.share||(navigator.canShare&&!navigator.canShare(data)))throw new Error('このブラウザーでは共有できません。投稿文のコピーと既存の写真保存を使ってください。');
   if(kind==='today')closeTodayDetail();
   const revision=s.revision;
   const result=navigator.share(data);
   Promise.resolve(result).then(()=>{if(s.revision===revision)status.textContent='共有画面を閉じました。投稿後に投稿済みを押してください。';}).catch(e=>{if(s.revision===revision)status.textContent=e.name==='AbortError'?'共有をキャンセルしました。':'共有できませんでした。投稿文のコピーと写真保存を使ってください。';});
  }catch(e){status.textContent=e.message;}
 }
 mount('today');mount('product');
 return {weightedLength,openToday:item=>{if(sessions.today)reset('today',item);},closeToday:()=>{if(sessions.today)reset('today');},closeProduct:()=>reset('product')};
})();

(()=>{
 const panel=document.getElementById('overseasPanel');
 const tab=document.getElementById('homeOverseasTab');
 if(!panel||!tab)return;
 let loaded=false,busy=false;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const endpoint=()=>{
  const input=document.getElementById('cloudApiUrl');
  const base=(input?.value||localStorage.getItem('sanrioCloudApiUrl')||'https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/api2580.php').trim();
  return base.replace(/\/api(?:2530|2540|2550|2560|2580)\.php(?:\?.*)?$/,'/overseas.php');
 };
 const key=()=>document.getElementById('cloudSyncKey')?.value||localStorage.getItem('sanrioCloudSyncKey')||'';
 panel.innerHTML='<div class="today-head"><div><h2 class="section-title">海外</h2><p class="backup-note">海外公式Instagramの新着をネタ発見用に表示します。まずは香港公式 @sanrio.hk を監視中。</p></div><button id="overseasRefresh" class="small-btn" type="button">更新</button></div><div class="overseas-source"><span>🇭🇰 Sanrio Hong Kong</span><a class="small-btn link-btn" href="https://www.instagram.com/sanrio.hk/" target="_blank" rel="noopener noreferrer">Instagramを開く</a></div><p id="overseasStatus" class="backup-note" aria-live="polite"></p><div id="overseasInstagramList"></div>';
 const style=document.createElement('style');style.textContent='#overseasPanel .overseas-source{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:12px 0 16px;padding:12px;border:1px solid #eadde5;border-radius:14px;background:#fff9fc}#overseasPanel .overseas-ig-card{display:grid;grid-template-columns:92px 1fr;gap:12px;padding:14px 0;border-bottom:1px solid #eadde5}#overseasPanel .overseas-ig-card img{width:92px;height:92px;object-fit:cover;border-radius:14px;background:#f7f2f5}#overseasPanel .overseas-ig-card h3{font-size:15px;margin:0 0 6px;line-height:1.45}#overseasPanel .overseas-ig-card p{margin:0 0 8px}#overseasPanel .overseas-actions{display:flex;gap:8px;flex-wrap:wrap}#overseasPanel .overseas-noimage{width:92px;height:92px;border-radius:14px;background:#f3edf1;display:grid;place-items:center;font-size:28px}';document.head.appendChild(style);
 const status=document.getElementById('overseasStatus'),list=document.getElementById('overseasInstagramList');
 function promptFor(item){return `Sanrio fan info向けの海外情報投稿を作成してください。\n\n国・地域：香港\n情報源：Sanrio Hong Kong公式Instagram（@sanrio.hk）\n元投稿：${item.url}\n本文：${item.summary||item.title||''}\n\n画像と元投稿で確認できる事実だけを使い、未確認の発売日・価格・在庫・限定情報は断定しないでください。先頭で「海外グッズ情報」または「海外イベント情報」と分かるようにしてください。X用に3案作成してください。`}
 async function copyPrompt(item,button){
  const text=promptFor(item);try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else if(window.legacyCopyText&&!legacyCopyText(text))throw new Error();button.textContent='コピー済み';setTimeout(()=>button.textContent='投稿文プロンプト',1200);}catch{status.textContent='コピーできませんでした。Instagramを開いて内容を確認してください。';}
 }
 function render(data){
  const items=Array.isArray(data.items)?data.items:[];
  if(!items.length){list.innerHTML='';status.textContent=data.warning||'新着投稿を取得できませんでした。公式Instagramから確認してください。';return;}
  status.textContent=`@sanrio.hk から ${items.length}件取得しました。投稿前に必ずInstagram本体で内容を確認してください。`;
  list.innerHTML=items.map((item,i)=>{const date=item.publishedAt?new Date(item.publishedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';const summary=String(item.summary||item.title||'').slice(0,180);return `<article class="overseas-ig-card">${item.thumbnail?`<img src="${esc(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<div class="overseas-noimage">📷</div>'}<div><h3>${esc(summary||'Sanrio Hong Kong Instagram 投稿')}</h3>${date?`<p class="backup-note">${esc(date)}</p>`:''}<div class="overseas-actions"><a class="small-btn link-btn" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Instagramで確認</a><button class="small-btn overseasPrompt" type="button" data-i="${i}">投稿文プロンプト</button></div></div></article>`}).join('');
  list.querySelectorAll('.overseasPrompt').forEach(button=>button.addEventListener('click',()=>copyPrompt(items[Number(button.dataset.i)],button)));
 }
 async function load(force=false){
  if(busy||(!force&&loaded))return;busy=true;status.textContent='香港公式Instagramを確認中…';
  const refresh=document.getElementById('overseasRefresh');refresh.disabled=true;
  try{
   const token=key();if(!token)throw new Error('管理 → ロリポップ同期で同期キーを設定してください。');
   const r=await fetch(endpoint()+'?action='+(force?'refresh':'list')+'&t='+Date.now(),{headers:{Authorization:'Bearer '+token},cache:'no-store'});const data=await r.json().catch(()=>({}));
   if(!r.ok||data.ok===false)throw new Error(data.error||('HTTP '+r.status));render(data);loaded=true;
  }catch(e){status.textContent='海外Instagramを取得できませんでした：'+e.message;}
  finally{busy=false;refresh.disabled=false;}
 }
 document.getElementById('overseasRefresh').addEventListener('click',()=>load(true));
 tab.addEventListener('click',()=>setTimeout(()=>load(false),0));
 if(tab.getAttribute('aria-selected')==='true')load(false);
})();
