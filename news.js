function newsReadMarks(){try{return JSON.parse(localStorage.getItem('sanrioNewsMarks')||'{}')||{};}catch{return {};}}
/* News preparation: fetch files before the user taps native share. */
const newsState={item:null,files:[],seq:0,busy:false,items:[],warnings:[],marks:newsReadMarks()};
function newsApiUrl(action,url='',index=0){const u=new URL((cloudSettings().url||DEFAULT_CLOUD_API_URL).replace(/\/api[0-9]*\.php(?:\?.*)?$/,'/news.php'));u.searchParams.set('action',action);if(url)u.searchParams.set('url',url);if(action==='image')u.searchParams.set('index',String(index));return u.toString();}
async function newsRequest(action,url='',index=0){const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');const r=await fetch(newsApiUrl(action,url,index),{headers:{Authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(25000)});if(action==='image'&&r.ok){const b=await r.blob();if(!/^image\/(jpeg|png|webp)$/.test(b.type))throw new Error('画像形式を確認できません。');return new File([b],'news-'+(index+1)+'.'+(b.type==='image/png'?'png':b.type==='image/webp'?'webp':'jpg'),{type:b.type});}const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'ニュースを取得できませんでした。');return d;}
function newsDraft(item){
 let title=String(item.title||'').replace(/^【[^】]*】\s*/,'');
 title=Array.from(title).slice(0,85).join('');
 const facts=(item.facts||[]).slice(0,2).map(f=>(f.kind==='schedule'?'📅 ':'💰 ')+f.text);
 return title+(facts.length?'\n\n記事の案内\n'+facts.join('\n'):'')+'\n\n詳細：'+item.url;
}
function newsRender(){
 const filter=$('newsFilter').value;const rows=newsState.items.filter(i=>filter==='all'||(filter==='hidden'?!!newsState.marks[i.url]:!newsState.marks[i.url]));
 $('newsList').replaceChildren();
 for(const item of rows){
 const row=document.createElement('article');row.className='news-row';
 const info=document.createElement('div');info.className='news-row-info';
 const title=document.createElement('strong');title.textContent=item.title;
 const source=document.createElement('span');source.className='backup-note';
 source.textContent=item.source+' ・ '+(item.date?'発表 '+item.date:'発表日未確認')+(newsState.marks[item.url]?' ・ '+(newsState.marks[item.url].kind==='done'?'投稿済み':'見送り'):'');
 info.append(source,title);
 const img=document.createElement('img');img.className='news-thumb';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
 if(item.image){img.src=item.image;img.onerror=()=>{img.hidden=true;};}else img.hidden=true;
 const btn=document.createElement('button');btn.type='button';btn.className='small-btn';btn.textContent='投稿準備';btn.addEventListener('click',()=>newsPrepare(item.url));
 row.append(img,info,btn);
 if(newsState.marks[item.url]){const restore=document.createElement('button');restore.type='button';restore.className='small-btn news-restore';restore.textContent='戻す';restore.addEventListener('click',()=>newsMark(item.url,null));row.append(restore);}
 $('newsList').append(row);
 }
 $('newsStatus').textContent=rows.length+'件'+(newsState.warnings.length?' ・ 一部の取得に失敗しました':'')+(rows.length?'':' ・ 表示するニュースはありません');
}
function newsMark(url,kind){
 const prev=newsState.marks[url];if(kind)newsState.marks[url]={kind,at:new Date().toISOString()};else delete newsState.marks[url];
 try{localStorage.setItem('sanrioNewsMarks',JSON.stringify(newsState.marks));}catch(e){if(prev)newsState.marks[url]=prev;else delete newsState.marks[url];$('newsEditorStatus').textContent='保存できませんでした。端末の空き容量を確認してください。';return;}
 if(newsState.item?.url===url){++newsState.seq;$('newsEditor').hidden=true;newsState.item=null;}
 newsRender();$('newsList').scrollIntoView({block:'start',behavior:'instant'});
}
async function newsLoad(){if(newsState.busy)return;newsState.busy=true;$('newsStatus').textContent='ニュースを確認中…';try{const d=await newsRequest('list');newsState.items=d.items;newsState.warnings=d.warnings||[];newsRender();}catch(e){$('newsStatus').textContent=e.message;}finally{newsState.busy=false;}}
async function newsPrepare(url){const seq=++newsState.seq;newsState.item=null;newsState.files=[];const editor=$('newsEditor');$('newsList').before(editor);editor.hidden=false;$('newsTitle').textContent='投稿を準備中…';$('newsSource').textContent='';$('newsSource').removeAttribute('href');$('newsDate').textContent='';$('newsFacts').textContent='';editor.prepend($('newsEditorStatus'));editor.scrollIntoView({block:'start',behavior:'instant'});$('newsShare').disabled=true;$('newsDone').disabled=true;$('newsSkip').disabled=true;$('newsEditorStatus').textContent='本文・写真を準備中…';$('newsImages').replaceChildren();$('newsText').value='';try{const d=await newsRequest('detail',url);if(seq!==newsState.seq)return;newsState.item=d.item;$('newsDone').disabled=false;$('newsSkip').disabled=false;$('newsTitle').textContent=d.item.title;$('newsSource').href=d.item.url;$('newsSource').textContent=d.item.source+'の記事を確認';$('newsDate').textContent=d.item.date?'発表日：'+d.item.date+'（発売日とは別）':'発表日を元記事で確認';$('newsText').value=newsDraft(d.item);$('newsFacts').textContent=(d.item.paragraphs||[]).slice(0,6).join('\n\n');let failed=0;const results=await Promise.allSettled(d.item.images.map((_,i)=>newsRequest('image',url,i)));if(seq!==newsState.seq)return;for(const r of results){if(r.status==='fulfilled'){newsState.files.push(r.value);const img=document.createElement('img');img.src=URL.createObjectURL(r.value);img.alt='記事の画像 '+newsState.files.length;img.onload=()=>URL.revokeObjectURL(img.src);$('newsImages').append(img);}else failed++;}$('newsEditorStatus').textContent='写真 '+newsState.files.length+'枚を準備'+(failed?' ・ '+failed+'枚は取得できませんでした':'')+'。本文と画像を確認して共有してください。';$('newsShare').disabled=false;}catch(e){if(seq===newsState.seq)$('newsEditorStatus').textContent=e.message;}}
$('newsRefresh').addEventListener('click',newsLoad);
$('newsOpen').addEventListener('click',()=>newsPrepare($('newsUrl').value.trim()));
$('newsExample').addEventListener('click',()=>{const url='https://prtimes.jp/main/html/rd/p/000000122.000013308.html';$('newsUrl').value=url;newsPrepare(url);});
$('newsCopy').addEventListener('click',()=>copyTextFromClick($('newsText').value,$('newsCopy'),'投稿文をコピーしました'));
$('newsShare').addEventListener('click',async()=>{const text=$('newsText').value.trim();if(!text)return;const data={text,files:newsState.files};try{if(newsState.files.length&&navigator.canShare?.(data)){await navigator.share(data);$('newsEditorStatus').textContent='共有先でXを選び、本文・写真を確認して投稿してください。';}else if(navigator.share){await navigator.share({text});$('newsEditorStatus').textContent='本文を共有しました。写真は「写真を保存」から添付できます。';}else{copyTextFromClick(text,$('newsCopy'),'本文をコピーしました');window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text),'_blank','noopener');}}catch(e){if(e.name!=='AbortError')$('newsEditorStatus').textContent='共有できませんでした。投稿文をコピーし、写真を保存してXに添付してください。';}});
$('newsSavePhotos').addEventListener('click',()=>{for(const f of newsState.files){const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}});

$('newsBack').addEventListener('click',()=>{$('newsEditor').hidden=true;$('newsList').scrollIntoView({block:'start',behavior:'instant'});});

$('newsFilter').addEventListener('change',newsRender);
$('newsDone').addEventListener('click',()=>{if(newsState.item)newsMark(newsState.item.url,'done');});
$('newsSkip').addEventListener('click',()=>{if(newsState.item)newsMark(newsState.item.url,'skip');});
