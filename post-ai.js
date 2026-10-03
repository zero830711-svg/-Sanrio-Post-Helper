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
   // A newer screen or request owns its own controls.
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
   // Release fixed-body modal before iPhone suspends this page for native sharing.
   if(kind==='today')closeTodayDetail();
   const revision=s.revision;
   const result=navigator.share(data);
   Promise.resolve(result).then(()=>{if(s.revision===revision)status.textContent='共有画面を閉じました。投稿後に投稿済みを押してください。';}).catch(e=>{if(s.revision===revision)status.textContent=e.name==='AbortError'?'共有をキャンセルしました。':'共有できませんでした。投稿文のコピーと写真保存を使ってください。';});
  }catch(e){status.textContent=e.message;}
 }
 mount('today');mount('product');
 return {weightedLength,openToday:item=>{if(sessions.today)reset('today',item);},closeToday:()=>{if(sessions.today)reset('today');},closeProduct:()=>reset('product')};
})();
