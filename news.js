function newsReadMarks(){try{return JSON.parse(localStorage.getItem('sanrioNewsMarks')||'{}')||{};}catch{return {};}}
/* News preparation: fetch files before the user taps native share. */
const newsState={item:null,files:[],selected:[],seq:0,busy:false,limit:5,items:[],warnings:[],marks:newsReadMarks(),drafts:new Map(),browseY:0};
function newsApiUrl(action,url='',index=0){const u=new URL((cloudSettings().url||DEFAULT_CLOUD_API_URL).replace(/\/api[0-9]*\.php(?:\?.*)?$/,'/news.php'));u.searchParams.set('action',action);if(url)u.searchParams.set('url',url);if(action==='image')u.searchParams.set('index',String(index));return u.toString();}
async function newsRequest(action,url='',index=0){const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');const r=await fetch(newsApiUrl(action,url,index),{headers:{Authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(25000)});if(action==='image'&&r.ok){const b=await r.blob();if(!/^image\/(jpeg|png|webp)$/.test(b.type))throw new Error('画像形式を確認できません。');return new File([b],'news-'+(index+1)+'.'+(b.type==='image/png'?'png':b.type==='image/webp'?'webp':'jpg'),{type:b.type});}const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'ニュースを取得できませんでした。');return d;}
function newsHighlight(item){
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
 const normalize=s=>clean(s).replace(/[\s。！？✨🎀「」『』【】]/gu,'');
 const title=normalize(item.title);
 const candidates=[];
 for(const [index,paragraph] of (item.paragraphs||[]).slice(0,40).entries()){
  for(let sentence of clean(paragraph).split(/(?<=[。！？])/u)){
   sentence=sentence.trim();
   const length=Array.from(sentence).length;
   if(length<12||length>105||title.includes(normalize(sentence)))continue;
   if(/価格|[0-9０-９][,，0-9０-９]*円|送料|購入|発売|開催期間|税込|税抜|転載|著作権|ログイン|会員登録|ください|問い合わせ|お問い合わせ|プレスリリース|株式会社|公式サイト|https?:|©/.test(sentence))continue;
   const lineup=/ラインナップ|毛布|ケース|バッグ|マスコット|ぬいぐるみ|ポーチ|キーホルダー|タオル|アクセサリー|スウェット|長袖|マフラー|フィギュア/.test(sentence);
   const charm=/デザイン|柄|カラー|色合い|モチーフ|刺繍|リボン|ふわふわ|もこもこ|かわいい|可愛い|キュート|おしゃれ|便利|コンパクト|機能|素材|収納/.test(sentence);
   if(!lineup&&!charm)continue;
   const score=(lineup?5:0)+(charm?4:0)+(/など|や|揃|そろ|全[0-9０-９]+種/.test(sentence)?2:0)-index/100;
   candidates.push({score,text:sentence.replace(/登場するよ[！。]?$/u,'登場✨').replace(/だよ[！。]?$/u,'です✨').replace(/[。]$/u,'')});
  }
 }
 candidates.sort((a,b)=>b.score-a.score);
 return candidates[0]?.text||'';
}
function newsDraft(item){
 let title=String(item.title||'').replace(/^【[^】]*】\s*/,'').trim();
 const chars=Array.from(title);
 if(chars.length>60)title=chars.slice(0,59).join('')+'…';
 const heading='🎀 '+title+' ✨';
 const footer='\n\n🔎 詳細はこちら\n'+item.url+'\n\n#サンリオ';
 const facts=[];
 // Preserve complete source facts; never cut a price, date or qualification midway.
 for(const kind of ['schedule','price']){
  const f=(item.facts||[]).find(f=>f.kind===kind&&String(f.text||'').trim()&&Array.from(String(f.text)).length<=70);
  if(f)facts.push((kind==='schedule'?'📅 ':'💰 ')+String(f.text).trim());
 }
 let factBlock='';
 for(const fact of facts){
  const next=factBlock+(factBlock?'\n':'\n\n')+fact;
  if(Array.from(heading+next+footer).length<=280)factBlock=next;
 }
 const highlight=newsHighlight(item);
 const intro=highlight&&Array.from(heading+'\n\n'+highlight+factBlock+footer).length<=280?'\n\n'+highlight:'';
 return heading+intro+factBlock+footer;
}
function newsDateLabel(value){const m=String(value||'').match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);return m?Number(m[2])+'/'+Number(m[3]):value;}

function newsScheduleLabel(item){
 const texts=[...(item.facts||[]).filter(f=>f.kind==='schedule').map(f=>f.text),item.title||''];
 const date='(?:[0-9]{4}年)?[0-9]{1,2}(?:月[0-9]{1,2}日?|/[0-9]{1,2}|月(?:上旬|中旬|下旬)?)';
 const span='('+date+'(?:\\s*(?:[～〜~－-]|から)\\s*'+date+')?)';
 for(const raw of texts){
  const text=String(raw).normalize('NFKC').replace(/[（(][月火水木金土日](?:曜日)?[）)]/g,'').replace(/\s+/g,'');
  let m=text.match(new RegExp(span+'([^0-9。]{0,12})(発売|販売開始|開催|開始)'));
  if(!m){const p=text.match(new RegExp('(発売日|発売|販売開始|開催期間|開催|キャンペーン期間|実施期間)[:：]?'+span+'([^。]{0,8})'));if(p)m=[p[0],p[2],p[3],/発売|販売/.test(p[1])?'発売':'開催'];}
  if(!m)continue;
  const when=m[1].replace(/[0-9]{4}年/g,'').replace(/([0-9]+)月([0-9]+)日?/g,'$1/$2').replace(/[～~－-]|から/g,'〜');
  const context=text.slice(m.index,m.index+m[0].length+4)+m[2],kind=/発売|販売/.test(m[3])?'発売':'開催';
  return when+(context.includes('順次')?'順次':'')+kind+(context.includes('予定')?'予定':'');
 }
 return '';
}
function newsTitleKey(title){return String(title||'').normalize('NFKC').toLowerCase().replace(/【[^】]*】/g,'').replace(/[\s\p{P}\p{S}]/gu,'');}
function newsSameStory(a,b){
 if(a.source===b.source)return false;
 const x=newsTitleKey(a.title),y=newsTitleKey(b.title);
 const published=i=>{const m=String(i.date||'').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null;};
 const pa=published(a),pb=published(b);if(pa!==null&&pb!==null&&Math.abs(pa-pb)>45*86400000)return false;
 // Never combine editions, character variants, or conflicting confirmed schedules.
 const variants=s=>(String(s).normalize('NFKC').match(/第[0-9一二三四五六七八九十]+(?:弾|回)|[0-9]+(?:種|周年)|[0-9]+$|(?:20[0-9]{2})年|(?:ハローキティ|クロミ|マイメロディ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|バッドばつ丸)/g)||[]).sort().join('|');
 if(variants(a.title)!==variants(b.title))return false;
 const da=newsScheduleLabel(a),db=newsScheduleLabel(b);if(da&&db&&da!==db)return false;
 const quoted=s=>Array.from(String(s).matchAll(/[「『]([^」』]+)[」』]/g),m=>newsTitleKey(m[1])).filter(s=>s.length>=6&&!/^(サンリオキャラクターズ|サンリオ|ハローキティ|シナモロール)$/.test(s));
 if(quoted(a.title).some(k=>/カラビナ|くじ|バッグ|ポーチ|マスコット|フィギュア|コラボ|シリーズ|キャンペーン|キーホルダー|グッズ/.test(k)&&quoted(b.title).includes(k)))return true;
 if(Math.min(x.length,y.length)<12||Math.min(x.length,y.length)/Math.max(x.length,y.length)<.75)return false;
 const grams=s=>new Set(Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2)));
 const gx=grams(x),gy=grams(y);const shared=[...gx].filter(g=>gy.has(g)).length;
 return 2*shared/(gx.size+gy.size)>=.86;
}
function newsGroups(){
 const groups=[];
 for(const item of newsState.items){
  const group=groups.find(g=>g.members.every(m=>newsSameStory(m,item)));
  if(group)group.members.push(item);else groups.push({members:[item]});
 }
 return groups.map(g=>{const item=g.members.find(m=>m.source==='サンリオ公式')||g.members[0];return {...item,members:g.members};});
}
function newsGroupMark(item){return item.members.map(m=>newsState.marks[m.url]).find(Boolean);}
function newsSourceLinks(url){
 const box=$('newsRelatedSources');box.replaceChildren();
 const group=newsGroups().find(g=>g.members.some(m=>m.url===url));
 if(!group||group.members.length<2){box.hidden=true;return;}
 box.hidden=false;
 for(const member of group.members){const link=document.createElement('a');link.href=member.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=member.source+'の記事';box.append(link);}
}

function newsChosenFiles(){return newsState.selected.map(i=>newsState.files[i]).filter(Boolean);}
function newsPhotoReady(){return newsState.selected.every(i=>!!newsState.files[i]);}
function newsPhotoStatus(){
 if(!newsState.item)return;
 const ready=newsPhotoReady(),entry=newsState.drafts.get(newsState.item.url);
 $('newsShare').disabled=!ready;$('newsSavePhotos').disabled=!ready||!newsState.selected.length;
 const loaded=newsState.files.filter(Boolean).length,total=newsState.files.length;
 const failed=entry?.errors?.filter(Boolean).length||0;
 $('newsEditorStatus').textContent=failed?'一部の写真を取得できませんでした。使わない写真は選択を外してください。':loaded<total?'本文は編集できます。写真を準備中（'+loaded+' / '+total+'枚）':'写真 '+loaded+'枚を準備。本文と画像を確認して共有してください。';
}
function newsPhotoArrived(entry,index){
 if(!newsState.item||newsState.drafts.get(newsState.item.url)!==entry)return;
 const img=$('newsImages').querySelector('[data-news-photo="'+index+'"]');
 if(img&&entry.files[index]){const u=URL.createObjectURL(entry.files[index]);img.onload=()=>URL.revokeObjectURL(u);img.onerror=()=>URL.revokeObjectURL(u);img.src=u;}
 newsPhotoStatus();
}
function newsLoadPhotos(entry){
 entry.loading=entry.loading||[];entry.errors=entry.errors||[];
 entry.item.images.forEach((_,i)=>{
  if(entry.files[i]||entry.loading[i])return;
  entry.loading[i]=true;entry.errors[i]=null;
  newsRequest('image',entry.item.url,i).then(file=>{entry.files[i]=file;}).catch(error=>{entry.errors[i]=error.message;}).finally(()=>{entry.loading[i]=false;newsPhotoArrived(entry,i);});
 });
}
function newsPhotosRender(){
 const box=$('newsImages');box.replaceChildren();
 [...newsState.selected,...newsState.files.map((_,i)=>i).filter(i=>!newsState.selected.includes(i))].forEach(i=>{const file=newsState.files[i];
 const card=document.createElement('div');card.className='news-photo';
 const img=document.createElement('img');img.alt='記事の写真 '+(i+1);img.dataset.newsPhoto=String(i);img.referrerPolicy='no-referrer';
 if(file){const u=URL.createObjectURL(file);img.src=u;img.onload=()=>URL.revokeObjectURL(u);img.onerror=()=>URL.revokeObjectURL(u);}else img.src=newsState.item.images[i];
 const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=newsState.selected.includes(i);
 const pos=newsState.selected.indexOf(i);
 label.append(check,document.createTextNode(pos>=0?(pos+1)+'枚目':'使わない'));
 check.addEventListener('change',()=>{if(check.checked){if(newsState.selected.length>=4){check.checked=false;$('newsEditorStatus').textContent='写真は4枚まで選べます。';return;}newsState.selected.push(i);}else newsState.selected=newsState.selected.filter(n=>n!==i);newsKeepDraft();newsPhotosRender();newsPhotoStatus();});
 const controls=document.createElement('div');controls.className='news-photo-controls';
 ['前へ','後へ'].forEach((text,n)=>{const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=text;b.setAttribute('aria-label','写真'+(i+1)+'を'+text);b.disabled=pos<0||(n===0?pos===0:pos===newsState.selected.length-1);b.onclick=()=>{const target=pos+(n===0?-1:1);[newsState.selected[pos],newsState.selected[target]]=[newsState.selected[target],newsState.selected[pos]];newsKeepDraft();newsPhotosRender();newsPhotoStatus();};controls.append(b);});
 card.append(img,label,controls);box.append(card);
 });
}
function newsRender(){
 const filter=$('newsFilter').value;const rows=newsGroups().filter(i=>filter==='all'||(filter==='hidden'?!!newsGroupMark(i):!newsGroupMark(i)));
 $('newsList').replaceChildren();
 for(const item of rows.slice(0,newsState.limit)){
 const row=document.createElement('article');row.className='news-row';
 const info=document.createElement('div');info.className='news-row-info';
 const title=document.createElement('strong');title.textContent=item.title;
 const source=document.createElement('span');source.className='backup-note';
 const mark=newsGroupMark(item);
 source.textContent=item.members.map(m=>m.source).join('・')+' ・ '+(item.date?'発表 '+newsDateLabel(item.date):'発表日未確認')+(mark?' ・ '+(mark.kind==='done'?'投稿済み':'見送り'):'');
 info.append(source,title);
 const schedule=item.members.map(newsScheduleLabel).find(Boolean);if(schedule){const note=document.createElement('span');note.className='news-schedule';note.textContent=schedule;info.append(note);}
 const img=document.createElement('img');img.className='news-thumb';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
 if(item.image){img.src=item.image;img.onerror=()=>{img.hidden=true;};}else img.hidden=true;
 const btn=document.createElement('button');btn.type='button';btn.className='small-btn';btn.textContent='投稿準備';btn.addEventListener('click',()=>newsPrepare(item.url));
 row.append(img,info,btn);
 if(mark){const restore=document.createElement('button');restore.type='button';restore.className='small-btn news-restore';restore.textContent='戻す';restore.addEventListener('click',()=>newsMark(item.url,null));row.append(restore);}
 $('newsList').append(row);
 }
 const more=$('newsMore');more.hidden=rows.length<=newsState.limit;more.textContent='もっと見る（あと'+Math.max(0,rows.length-newsState.limit)+'件）';
 $('newsStatus').textContent=Math.min(newsState.limit,rows.length)+' / '+rows.length+'件'+(newsState.warnings.length?' ・ 一部の取得に失敗しました':'')+(rows.length?'':' ・ 表示するニュースはありません');
}
function newsKeepDraft(){
 if(!newsState.item)return;
 const entry=newsState.drafts.get(newsState.item.url);
 if(entry){entry.text=$('newsText').value;entry.selected=newsState.selected.slice();}
}
function newsReturn(){newsKeepDraft();++newsState.seq;$('newsEditor').hidden=true;$('newsBrowse').hidden=false;newsState.item=null;newsRender();window.scrollTo({top:newsState.browseY,behavior:'instant'});}
function newsMark(url,kind){
 const group=newsGroups().find(g=>g.members.some(m=>m.url===url)),urls=group?group.members.map(m=>m.url):[url];
 const prev={...newsState.marks};for(const u of urls){if(kind)newsState.marks[u]={kind,at:new Date().toISOString()};else delete newsState.marks[u];}
 try{localStorage.setItem('sanrioNewsMarks',JSON.stringify(newsState.marks));}catch(e){newsState.marks=prev;$('newsEditorStatus').textContent='保存できませんでした。端末の空き容量を確認してください。';return;}
 const editing=newsState.item?.url===url;if(editing)newsReturn();
 newsRender();if(editing)window.scrollTo({top:newsState.browseY,behavior:'instant'});
}
async function newsLoad(){if(newsState.busy)return;newsState.busy=true;$('newsStatus').textContent='ニュースを確認中…';try{const d=await newsRequest('list');newsState.items=d.items;newsState.limit=5;newsState.warnings=d.warnings||[];newsRender();}catch(e){$('newsStatus').textContent=e.message;}finally{newsState.busy=false;}}
async function newsPrepare(url){
 newsKeepDraft();if(!$('newsBrowse').hidden)newsState.browseY=window.scrollY;
 const seq=++newsState.seq;$('newsAiStatus').textContent='';$('newsAiRetry').disabled=true;newsState.item=null;newsState.files=[];newsState.selected=[];
 const editor=$('newsEditor');$('newsBrowse').after(editor);$('newsBrowse').hidden=true;editor.hidden=false;
 const listed=newsState.items.find(item=>item.url===url);
 $('newsTitle').textContent=listed?.title||'投稿を準備中…';
 $('newsSource').textContent='';$('newsSource').removeAttribute('href');$('newsDate').textContent='';$('newsFacts').textContent='';
 editor.prepend($('newsEditorStatus'));editor.scrollIntoView({block:'start',behavior:'instant'});
 $('newsShare').disabled=true;$('newsSavePhotos').disabled=true;$('newsDone').disabled=true;$('newsSkip').disabled=true;
 $('newsRelatedSources').hidden=true;$('newsRelatedSources').replaceChildren();
 $('newsEditorStatus').textContent='記事を確認中…';$('newsImages').replaceChildren();$('newsText').value='';
 try{
  let entry=newsState.drafts.get(url);
  if(!entry){
   const d=await newsRequest('detail',url);if(seq!==newsState.seq)return;
   const item={...d.item,images:d.item.images||[]};
   entry={item,text:newsDraft(item),files:item.images.map(()=>null),selected:item.images.map((_,i)=>i).slice(0,4),errors:[],loading:[]};
   newsState.drafts.set(url,entry);newsState.drafts.set(item.url,entry);
  }
  if(seq!==newsState.seq)return;
  newsState.item=entry.item;newsState.files=entry.files;newsState.selected=entry.selected.slice();
  const listedItem=newsState.items.find(i=>i.url===url||i.url===entry.item.url);if(listedItem)listedItem.facts=entry.item.facts||[];
  newsSourceLinks(url);
  $('newsDone').disabled=false;$('newsSkip').disabled=false;
  $('newsTitle').textContent=entry.item.title;$('newsSource').href=entry.item.url;$('newsSource').textContent=entry.item.source+'の記事を確認';
  $('newsDate').textContent=entry.item.date?'発表日：'+entry.item.date+'（発売日とは別）':'発表日を元記事で確認';
  $('newsText').value=entry.text;$('newsFacts').textContent=(entry.item.paragraphs||[]).slice(0,6).join('\n\n');
  // Show every preview before waiting for downloadable photo files.
  newsPhotosRender();newsLoadPhotos(entry);newsPhotoStatus();$('newsAiRetry').disabled=false;newsAiAdjust(entry,seq);
 }catch(e){if(seq===newsState.seq)$('newsEditorStatus').textContent=e.message;}
}
$('newsText').addEventListener('input',newsKeepDraft);
$('newsRefresh').addEventListener('click',newsLoad);
$('newsOpen').addEventListener('click',()=>newsPrepare($('newsUrl').value.trim()));
$('newsExample').addEventListener('click',()=>{const url='https://prtimes.jp/main/html/rd/p/000000122.000013308.html';$('newsUrl').value=url;newsPrepare(url);});
$('newsCopy').addEventListener('click',()=>copyTextFromClick($('newsText').value,$('newsCopy'),'投稿文をコピーしました'));
$('newsShare').addEventListener('click',async()=>{const text=$('newsText').value.trim();if(!text||!newsPhotoReady())return;newsKeepDraft();const data={text,files:newsChosenFiles()};try{if(data.files.length&&navigator.canShare?.(data)){await navigator.share(data);$('newsEditorStatus').textContent='共有先でXを選び、本文・写真を確認して投稿してください。';}else if(navigator.share){await navigator.share({text});$('newsEditorStatus').textContent='本文を共有しました。写真は「写真を保存」から添付できます。';}else{copyTextFromClick(text,$('newsCopy'),'本文をコピーしました');window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text),'_blank','noopener');}}catch(e){if(e.name!=='AbortError')$('newsEditorStatus').textContent='共有できませんでした。投稿文をコピーし、写真を保存してXに添付してください。';}});
$('newsSavePhotos').addEventListener('click',()=>{for(const f of newsChosenFiles()){const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}});

$('newsBack').addEventListener('click',newsReturn);

$('newsMore').addEventListener('click',()=>{const y=window.scrollY;newsState.limit+=5;newsRender();window.scrollTo({top:y,behavior:'instant'});});
$('newsFilter').addEventListener('change',()=>{newsState.limit=5;newsRender();});
$('newsDone').addEventListener('click',()=>{if(newsState.item)newsMark(newsState.item.url,'done');});
$('newsSkip').addEventListener('click',()=>{if(newsState.item)newsMark(newsState.item.url,'skip');});

async function newsAiPost(action,data){
 const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');
 const r=await fetch(newsApiUrl(action),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(25000)});
 const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'AIを利用できません。');return d;
}
async function newsAiSettingsLoad(){
 try{const d=await newsRequest('ai-settings');$('newsAiSettingsStatus').textContent=d.configured?'設定済み：投稿準備時にAIで文章を調整します。':'未設定：通常の下書きを使います。';}catch(e){$('newsAiSettingsStatus').textContent=e.message;}
}
async function newsAiAdjust(entry,seq,force=false){
 if(entry.aiPending){$('newsAiStatus').textContent='AIで文章を調整中…';$('newsAiRetry').disabled=true;return;}
 if(entry.aiAttempted&&!force){$('newsAiStatus').textContent=entry.aiStatus||'';return;}
 entry.aiAttempted=true;entry.aiPending=true;
 const before=entry.text;
 if(seq===newsState.seq){$('newsAiStatus').textContent='AIで文章を調整中…（編集すると自動反映しません）';$('newsAiRetry').disabled=true;}
 try{
  const d=await newsAiPost('ai-draft',{url:entry.item.url});
  if(!d.configured){entry.aiStatus='AI未設定：通常の下書きです。';}
  else if(typeof d.text!=='string'||!d.text.trim()){throw new Error('AI文を取得できません。');}
  else if(entry.text!==before||(seq===newsState.seq&&$('newsText').value!==before)){entry.aiStatus='手動編集を優先しました。AI文は反映していません。';}
  else{entry.text=d.text;entry.aiStatus='AI調整済み：価格・日程・条件を元記事で確認してください。';if(newsState.item===entry.item)$('newsText').value=d.text;}
 }catch(e){entry.aiStatus='AI未調整：'+e.message;}
 finally{entry.aiPending=false;if(newsState.item===entry.item){$('newsAiStatus').textContent=entry.aiStatus;$('newsAiRetry').disabled=false;}}
}
$('newsAiSettings').addEventListener('toggle',()=>{if($('newsAiSettings').open)newsAiSettingsLoad();});
$('newsAiSave').addEventListener('click',async()=>{
 const b=$('newsAiSave');b.disabled=true;
 try{await newsAiPost('ai-settings',{apiKey:$('newsAiKey').value.trim()});$('newsAiKey').value='';newsState.drafts.forEach(e=>{e.aiAttempted=false;});await newsAiSettingsLoad();}
 catch(e){$('newsAiSettingsStatus').textContent=e.message;}finally{b.disabled=false;}
});
$('newsAiRemove').addEventListener('click',async()=>{
 if(!confirm('AI設定を解除しますか？'))return;
 try{await newsAiPost('ai-settings',{remove:true});$('newsAiKey').value='';await newsAiSettingsLoad();}catch(e){$('newsAiSettingsStatus').textContent=e.message;}
});
$('newsAiRetry').addEventListener('click',()=>{
 const entry=newsState.item&&newsState.drafts.get(newsState.item.url);if(!entry||!confirm('現在の本文をAI文に置き換えますか？'))return;newsKeepDraft();newsAiAdjust(entry,newsState.seq,true);
});
