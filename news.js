function newsArticleKey(url){
 try{const p=new URL(url);let key=p.origin+p.pathname.replace(/\/$/,'');
 const field=p.hostname==='gashapon.jp'?'jan_code':p.hostname==='www.takaratomy-arts.co.jp'?'n':null;
 if(field)key+='?'+field+'='+p.searchParams.get(field);return key;}catch{return '';}
}
function newsProductId(url){
 try{const p=new URL(url);if(p.hostname==='gashapon.jp'&&p.pathname==='/products/detail.php')return 'gashapon:'+p.searchParams.get('jan_code');
 if(p.hostname==='www.takaratomy-arts.co.jp'&&p.pathname==='/items/item.html')return 'arts:'+p.searchParams.get('n');}catch{}return '';
}
function newsStorageKey(name){return 'sanrioNews'+name+':'+(cloudSettings().url||DEFAULT_CLOUD_API_URL);}
function newsReadDrafts(){
 try{const data=JSON.parse(localStorage.getItem(newsStorageKey('Drafts'))||'null');if(data?.version!==1||!Array.isArray(data.entries))return new Map();
 return new Map(data.entries.slice(0,40).filter(e=>e&&typeof e.item?.url==='string'&&/^https:\/\//.test(e.item.url)&&typeof e.text==='string'&&e.text.length<=20000&&Array.isArray(e.item.images)).map(e=>{
 const item={...e.item,images:e.item.images.filter(u=>typeof u==='string'&&/^https:\/\//.test(u)).slice(0,8)};
 const selected=Array.isArray(e.selected)?[...new Set(e.selected)].filter(i=>Number.isInteger(i)&&i>=0&&i<item.images.length).slice(0,e.collageMode?7:4):[];
 const collageIndices=(Array.isArray(e.collageIndices)?e.collageIndices:selected.slice(0,4)).filter(i=>selected.includes(i)).slice(0,4);
 return [item.url,{...e,item,selected,collageIndices,files:item.images.map(()=>null),loading:[],errors:[],aiPending:false,restored:true}];}));}catch{return new Map();}
}
function newsSaveDrafts(){
 const unique=[...new Set(newsState.drafts.values())].filter(e=>!newsState.marks[e.item.url]).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0)).slice(0,40);
 const entries=unique.map(e=>({item:e.item,text:e.text,replyText:e.replyText,includeLink:e.includeLink,selected:e.selected,collageMode:!!e.collageMode,collageIndices:e.collageIndices,aiDrafts:e.aiDrafts,aiChoice:e.aiChoice,aiAttempted:e.aiAttempted,aiStatus:e.aiStatus,savedAt:e.savedAt||Date.now()}));
 try{localStorage.setItem(newsStorageKey('Drafts'),JSON.stringify({version:1,entries}));if($('newsDraftStatus'))$('newsDraftStatus').textContent='準備を自動保存しました';return true;}catch{if($('newsDraftStatus'))$('newsDraftStatus').textContent='自動保存できませんでした。本文をコピーして残してください。';return false;}
}
function newsSplitReply(text,item){
 const lines=String(text||'').split('\n');
 const index=lines.findIndex(line=>line.trim()===item.url);
 if(index<0)return {text,reply:''};
 lines.splice(index,1);
 if(index>0&&/^(?:🔎\s*)?(?:詳細|詳しく)(?:はこちら)?[：:]?\s*$/.test(lines[index-1].trim()))lines.splice(index-1,1);
 return {text:lines.join('\n').replace(/\n{3,}/g,'\n\n').trim(),reply:'🔎 詳細はこちら\n'+item.url};
}
function newsSetupReply(entry){
 if(typeof entry.includeLink==='boolean')return;
 const split=newsSplitReply(entry.text,entry.item);
 entry.text=split.text;entry.replyText=split.reply;entry.includeLink=false;
}
function newsReplyRender(entry){
 $('newsIncludeLink').checked=!!entry.includeLink;
 $('newsReplyText').value=entry.replyText||'';
 $('newsReplyBox').hidden=!!entry.includeLink||!entry.replyText;
 $('newsIncludeLinkLabel').hidden=!entry.replyText;
}
function newsApplyGenerated(entry,text){
 const split=newsSplitReply(text,entry.item);
 if(split.reply&&!entry.replyText)entry.replyText=split.reply;
 entry.text=split.text+(entry.includeLink&&entry.replyText?'\n\n'+entry.replyText:'');
}
function newsReadSeen(){try{const d=JSON.parse(localStorage.getItem(newsStorageKey('Seen'))||'null');return d?.version===1&&d.known&&typeof d.known==='object'?d.known:null;}catch{return null;}}
function newsTrackItems(items){
 const previous=newsState.seen,known={...(previous||{})},added=new Set(),now=Date.now();
 for(const item of items){const key=newsArticleKey(item.url);if(!key)continue;if(!Object.prototype.hasOwnProperty.call(known,key)){known[key]=previous?now:0;if(previous)added.add(key);}}
 newsState.seen=known;newsState.added=added;
 try{localStorage.setItem(newsStorageKey('Seen'),JSON.stringify({version:1,known:Object.fromEntries(Object.entries(known).slice(-2000))}));}catch{}
}
function newsGroupNew(item){return item.members.some(m=>newsState.added.has(newsArticleKey(m.url)));}
function newsGroupDraft(item){return item.members.some(m=>newsState.drafts.has(m.url));}
function newsGroupTime(item){return Math.max(0,...item.members.map(m=>Math.max(Date.parse(m.date||'')||0,newsState.seen?.[newsArticleKey(m.url)]||0)));}
function newsReadMarks(){try{return JSON.parse(localStorage.getItem('sanrioNewsMarks')||'{}')||{};}catch{return {};}}
/* News preparation: fetch files before the user taps native share. */
const newsState={item:null,files:[],selected:[],seq:0,busy:false,limit:5,items:[],warnings:[],sourceStatuses:{},marks:newsReadMarks(),drafts:newsReadDrafts(),seen:newsReadSeen(),added:new Set(),browseY:0};
function newsApiUrl(action,url='',index=0){const u=new URL((cloudSettings().url||DEFAULT_CLOUD_API_URL).replace(/\/api[0-9]*\.php(?:\?.*)?$/,'/news.php'));u.searchParams.set('action',action);if(url)u.searchParams.set('url',url);if(action==='image')u.searchParams.set('index',String(index));return u.toString();}
async function newsRequest(action,url='',index=0){const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');const r=await fetch(newsApiUrl(action,url,index),{headers:{Authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(25000)});if(action==='image'&&r.ok){const b=await r.blob();if(!/^image\/(jpeg|png|webp)$/.test(b.type))throw new Error('画像形式を確認できません。');const png=await sharePhotoPng(b);return new File([png],'news-'+(index+1)+'.png',{type:'image/png'});}const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'ニュースを取得できませんでした。');return d;}
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
 if(item.instagram)return '🎀 '+item.title+' ✨\n\n'+newsHighlight(item)+'\n\n🔎 元の投稿はこちら\n'+item.url+'\n\n#サンリオ';
 let title=String(item.title||'').replace(/^【[^】]*】\s*/,'').trim();
 const chars=Array.from(title);
 if(chars.length>60)title=chars.slice(0,59).join('')+'…';
 const heading='🎀 '+(item.resale&&!/再販|再発売/.test(title)?'【再販】 ':'')+title+' ✨';
 const footer=item.tipsOnly?'\n\n#サンリオ':item.prize?'\n\n#サンリオ #フリュープライズ':'\n\n🔎 詳細はこちら\n'+item.url+'\n\n#サンリオ';
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
 const rawHighlight=newsHighlight(item);
 const highlight=item.resale?rawHighlight.replace(/新登場/g,'登場').replace(/新作/g,'商品'):rawHighlight;
 const intro=highlight&&Array.from(heading+'\n\n'+highlight+factBlock+footer).length<=280?'\n\n'+highlight:'';
 return heading+intro+factBlock+footer;
}
function newsDateLabel(value){const m=String(value||'').match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);return m?Number(m[2])+'/'+Number(m[3]):value;}

function newsScheduleLabel(item){
 if(item.tipsOnly)return item.schedule||'';
 if(item.prize)return item.schedule?item.schedule+'登場予定':'';
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
function newsCharacters(title){
 return [...new Set(String(title||'').normalize('NFKC').match(/ハローキティ|クロミ|マイメロディ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|バッドばつ丸|ウサハナ|リトルツインスターズ|タキシードサム|あひるのペックル|こぎみゅん|けろけろけろっぴ|ぐでたま/g)||[])].sort();
}
function newsSameStory(a,b){
 if(!!a.tipsOnly!==!!b.tipsOnly)return false;
 if(!!a.prize!==!!b.prize)return false;
 const ua=newsArticleKey(a.url),ub=newsArticleKey(b.url);if(ua&&ua===ub)return true;
 const ida=newsProductId(a.url),idb=newsProductId(b.url);if(ida&&idb&&ida!==idb)return false;
 const x=newsTitleKey(a.title),y=newsTitleKey(b.title);
 const published=i=>{const m=String(i.date||'').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null;};
 const pa=published(a),pb=published(b);if(pa!==null&&pb!==null&&Math.abs(pa-pb)>45*86400000)return false;
 // Never combine editions, character variants, or conflicting confirmed schedules.
 const variants=s=>(String(s).normalize('NFKC').match(/第[0-9一二三四五六七八九十]+(?:弾|回)|[0-9]+(?:種|周年)|[0-9]+$|(?:20[0-9]{2})年|(?:ハローキティ|クロミ|マイメロディ|シナモロール|ポムポムプリン|ポチャッコ|ハンギョドン|バッドばつ丸|ウサハナ|リトルツインスターズ|タキシードサム|あひるのペックル|こぎみゅん|けろけろけろっぴ|ぐでたま)/g)||[]).sort().join('|');
 if(variants(a.title)!==variants(b.title))return false;
 const da=newsScheduleLabel(a),db=newsScheduleLabel(b);if(da&&db&&da!==db)return false;
 if(x.length>=6&&x===y)return true;
 const quoted=s=>Array.from(String(s).matchAll(/[「『]([^」』]+)[」』]/g),m=>newsTitleKey(m[1])).filter(s=>s.length>=6&&!/^(サンリオキャラクターズ|サンリオ|ハローキティ|シナモロール)$/.test(s));
 if(quoted(a.title).some(k=>/カラビナ|くじ|バッグ|ポーチ|マスコット|フィギュア|コラボ|シリーズ|キャンペーン|キーホルダー|グッズ/.test(k)&&quoted(b.title).includes(k)))return true;
 // Product names may use 「product」 in one headline and 〈product×character〉 in another.
 // Require a known character and close publication dates, while keeping the safeguards above.
 const chars=newsCharacters(a.title),otherChars=newsCharacters(b.title);
 if(chars.length&&chars.join('|')===otherChars.join('|')&&pa!==null&&pb!==null&&Math.abs(pa-pb)<=14*86400000){
  const productNames=title=>Array.from(String(title||'').normalize('NFKC').matchAll(/[「『〈《<“]([^」』〉》>”]+)[」』〉》>”]/g),m=>{
   let name=m[1];for(const char of chars)name=name.replaceAll(char,'');
   return newsTitleKey(name);
  }).filter(name=>name.length>=6&&!/サンリオ|キャラクター|コラボレーション|キャンペーン|新商品|限定デザイン/.test(name));
  if(productNames(a.title).some(name=>productNames(b.title).includes(name)))return true;
 }
 if(Math.min(x.length,y.length)<12||Math.min(x.length,y.length)/Math.max(x.length,y.length)<.75)return false;
 const grams=s=>new Set(Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2)));
 const gx=grams(x),gy=grams(y);const shared=[...gx].filter(g=>gy.has(g)).length;
 return 2*shared/(gx.size+gy.size)>=.86;
}
let newsHomeView='news';
function newsSetHomeView(view){
 if(newsHomeView!==view){newsKeepDraft();++newsState.seq;$('newsEditor').hidden=true;$('newsBrowse').hidden=false;newsState.item=null;newsState.limit=5;}
 newsHomeView=view;
 const instagram=view==='instagram';
 $('newsBrowseTitle').textContent=instagram?'Instagram':'新作ニュース';
 $('newsBrowseDescription').textContent=instagram?'23アカウント・サンリオ関連のみ表示・2時間ごとに5アカウントずつ確認':'公式ニュース・メーカー新作から投稿を準備';
 $('newsSourceFilter').closest('label').hidden=instagram;
 $('instagramAccountFilter').closest('label').hidden=!instagram;
 if(instagram)$('newsSourceFilter').value='all';
 newsRender();
}
function newsGroups(){
 const groups=[],seen=new Set();
 for(const item of newsState.items){
  if(Boolean(item.instagram)!==(newsHomeView==='instagram'))continue;
  const account=$('instagramAccountFilter').value;if(newsHomeView==='instagram'&&account!=='all'&&item.instagramAccount!==account)continue;
  if(seen.has(item.url))continue;seen.add(item.url);
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

function newsCollageEntry(){return newsState.item&&newsState.drafts.get(newsState.item.url);}
function newsCollageIndices(){const e=newsCollageEntry();return newsState.selected.filter(i=>e?.collageIndices?.includes(i));}
function newsCollageKey(){return newsCollageIndices().join(',');}
function newsChosenFiles(){const e=newsCollageEntry();if(!e?.collageMode)return newsState.selected.map(i=>newsState.files[i]).filter(Boolean);if(e.collageKey!==newsCollageKey())return [];return [...(e.collageFiles||[]),...newsState.selected.filter(i=>!e.collageIndices.includes(i)).map(i=>newsState.files[i]).filter(Boolean)];}
function newsPhotoReady(){const e=newsCollageEntry();return newsState.selected.every(i=>!!newsState.files[i])&&(!e?.collageMode||newsCollageIndices().length===4&&e.collageKey===newsCollageKey()&&!!e.collageFiles);}
function newsClearCollagePreview(){const box=$('newsCollagePreview');for(const img of box.querySelectorAll('img'))URL.revokeObjectURL(img.src);box.replaceChildren();box.hidden=true;box.dataset.key='';}
function newsComposePhotos(entry){
 const key=newsCollageKey();if(entry.collageKey===key&&entry.collageFiles||entry.collagePending===key||entry.collageFailed===key)return;
 entry.collagePending=key;const files=newsCollageIndices().map(i=>entry.files[i]);
 newsCollageFiles(files).then(result=>{if(entry.collagePending===key){entry.collageKey=key;entry.collageFiles=result;}}).catch(()=>{if(entry.collagePending===key)entry.collageFailed=key;}).finally(()=>{
  if(entry.collagePending===key)entry.collagePending=null;
  if(newsCollageEntry()===entry)newsPhotoStatus();
 });
}
function newsPhotoStatus(){
 if(!newsState.item)return;
 const entry=newsCollageEntry(),total=newsState.selected.length;
 const mode=!!entry?.collageMode;
 if(mode&&newsCollageIndices().length===4&&newsCollageIndices().every(i=>!!newsState.files[i]))newsComposePhotos(entry);
 const ready=newsPhotoReady();
 $('newsShare').disabled=!ready;$('newsSavePhotos').disabled=!ready||!newsState.selected.length;
 const loaded=newsState.selected.filter(i=>!!newsState.files[i]).length;
 const failed=newsState.selected.filter(i=>entry?.errors?.[i]).length;
 $('newsEditorStatus').textContent=failed?'選んだ写真を取得できませんでした。写真の「再試行」を押すか、選択を外してください。':loaded<total?'本文は編集できます。選んだ写真を準備中（'+loaded+' / '+total+'枚）':total?'選んだ写真 '+loaded+'枚を準備。本文と画像を確認して共有してください。':'本文を編集できます。使う写真を選んでください。';
 if(mode&&newsCollageIndices().length!==4)$('newsEditorStatus').textContent='まとめる写真を4枚選んでください（'+newsCollageIndices().length+' / 4枚）。';
 else if(mode&&loaded===total&&!failed)$('newsEditorStatus').textContent=entry.collageFailed===newsCollageKey()?'まとめ画像を作れませんでした。再作成するか、まとめる設定を外してください。':ready?'まとめ画像1枚＋個別写真'+(total-4)+'枚を準備しました。完成画像を確認してください。':'写真をまとめています…';
 $('newsCollageRetry').hidden=!(mode&&entry.collageFailed===newsCollageKey());
 const preview=$('newsCollagePreview'),previewKey=mode&&ready?newsCollageKey()+'|'+newsState.selected.join(','):'';
 if(preview.dataset.key!==previewKey){newsClearCollagePreview();if(previewKey){preview.hidden=false;preview.dataset.key=previewKey;for(const [i,file] of newsChosenFiles().entries()){const img=document.createElement('img');img.src=URL.createObjectURL(file);img.alt=i===0?'共有するまとめ画像 1':'共有する個別写真 '+i;preview.append(img);}}}
 entry?.item.images.forEach((_,i)=>{const status=$('newsPhotoStatus'+i),retry=$('newsPhotoRetry'+i);if(status)status.textContent=entry.loading?.[i]?'写真を準備中…':entry.errors?.[i]?'取得失敗。再試行できます。':entry.files[i]?'写真を準備しました':'';if(retry){retry.hidden=!entry.errors?.[i];retry.disabled=!!entry.loading?.[i]||!newsState.selected.includes(i);}});
}
function newsPhotoArrived(entry,index){
 if(!newsState.item||newsState.drafts.get(newsState.item.url)!==entry)return;
 const img=$('newsImages').querySelector('[data-news-photo="'+index+'"]');
 if(img&&entry.files[index]){const u=URL.createObjectURL(entry.files[index]);img.onload=()=>URL.revokeObjectURL(u);img.onerror=()=>URL.revokeObjectURL(u);img.src=u;}
 newsPhotoStatus();
}
function newsLoadPhotos(entry){
 entry.loading=entry.loading||[];entry.errors=entry.errors||[];
 entry.selected.forEach(i=>{
  if(entry.files[i]||entry.loading[i]||entry.errors[i])return;
  entry.loading[i]=true;entry.errors[i]=null;
  newsRequest('image',entry.item.url,i).then(file=>{entry.files[i]=file;}).catch(error=>{entry.errors[i]=error.message;}).finally(()=>{entry.loading[i]=false;newsPhotoArrived(entry,i);});
 });
}
function newsPhotosRender(){
 const box=$('newsImages');box.replaceChildren();const entry=newsState.drafts.get(newsState.item.url);
 [...newsState.selected,...newsState.files.map((_,i)=>i).filter(i=>!newsState.selected.includes(i))].forEach(i=>{const file=newsState.files[i];
 const card=document.createElement('div');card.className='news-photo';
 const img=document.createElement('img');img.alt='記事の写真 '+(i+1);img.dataset.newsPhoto=String(i);img.referrerPolicy='no-referrer';img.loading='lazy';
 if(file){const u=URL.createObjectURL(file);img.src=u;img.onload=()=>URL.revokeObjectURL(u);img.onerror=()=>URL.revokeObjectURL(u);}else img.src=newsState.item.images[i];
 const label=document.createElement('label');
 const pos=newsState.selected.indexOf(i);
 if(entry.collageMode){
  const select=document.createElement('select');select.setAttribute('aria-label','写真'+(i+1)+'の使い方');
  for(const [value,text] of [['none','使わない'],['collage','まとめる（4枚で1枚）'],['single','個別写真で使う']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  select.value=pos<0?'none':entry.collageIndices.includes(i)?'collage':'single';
  select.addEventListener('change',()=>{
   const grouped=newsCollageIndices().filter(n=>n!==i),singles=newsState.selected.filter(n=>n!==i&&!entry.collageIndices.includes(n));
   if(select.value==='collage'&&grouped.length>=4||select.value==='single'&&singles.length>=3){select.value=pos<0?'none':entry.collageIndices.includes(i)?'collage':'single';$('newsEditorStatus').textContent='まとめる写真は4枚、個別写真は3枚まで選べます。';return;}
   entry.collageIndices=select.value==='collage'?[...grouped,i]:grouped;
   if(select.value==='none')newsState.selected=newsState.selected.filter(n=>n!==i);else if(pos<0)newsState.selected.push(i);
   newsKeepDraft();newsLoadPhotos(entry);newsPhotosRender();newsPhotoStatus();
  });label.append(select);
 }else{
  const check=document.createElement('input');check.type='checkbox';check.checked=pos>=0;label.append(check,document.createTextNode(pos>=0?(pos+1)+'枚目':'使わない'));
  check.addEventListener('change',()=>{if(check.checked){if(newsState.selected.length>=4){check.checked=false;$('newsEditorStatus').textContent='写真は4枚まで選べます。';return;}newsState.selected.push(i);}else newsState.selected=newsState.selected.filter(n=>n!==i);newsKeepDraft();newsLoadPhotos(entry);newsPhotosRender();newsPhotoStatus();});
 }
 const controls=document.createElement('div');controls.className='news-photo-controls';
 ['前へ','後へ'].forEach((text,n)=>{const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=text;b.setAttribute('aria-label','写真'+(i+1)+'を'+text);b.disabled=pos<0||(n===0?pos===0:pos===newsState.selected.length-1);b.onclick=()=>{const target=pos+(n===0?-1:1);[newsState.selected[pos],newsState.selected[target]]=[newsState.selected[target],newsState.selected[pos]];newsKeepDraft();newsPhotosRender();newsPhotoStatus();};controls.append(b);});
 const status=document.createElement('p');status.id='newsPhotoStatus'+i;status.className='backup-note';status.setAttribute('aria-live','polite');
 const retry=document.createElement('button');retry.id='newsPhotoRetry'+i;retry.type='button';retry.className='small-btn';retry.textContent='再試行';retry.setAttribute('aria-label','写真'+(i+1)+'を再試行');retry.hidden=!entry?.errors?.[i];retry.addEventListener('click',()=>{if(!entry||entry.loading?.[i]||!newsState.selected.includes(i))return;entry.errors[i]=null;newsLoadPhotos(entry);newsPhotoStatus();});
 card.append(img,label,controls,status,retry);box.append(card);
 });
}
function newsSourceStatusLabel(){
 const source=$('newsSourceFilter')?.value||'all';
 const labels=Object.entries(newsState.sourceStatuses||{}).filter(([name,value])=>(source==='all'||name===source)&&['partial','failed'].includes(value?.state)).map(([name,value])=>name+'：'+(value.state==='partial'?'一部更新待ち':'更新待ち'));
 return labels.length?' ・ '+labels.join(' ／ '):Object.keys(newsState.sourceStatuses||{}).length?'':newsState.warnings.length?' ・ 一部の取得に失敗しました':'';
}
function newsRender(){
 const filter=$('newsFilter').value;const sourceFilter=$('newsSourceFilter')?.value||'all';const rows=newsGroups().filter(i=>(sourceFilter==='all'||i.members.some(m=>m.source===sourceFilter))).filter(i=>filter==='draft'?newsGroupDraft(i)&&!newsGroupMark(i):filter==='all'||(filter==='hidden'?!!newsGroupMark(i):!newsGroupMark(i)));
 rows.sort((a,b)=>Number(newsGroupNew(b))-Number(newsGroupNew(a))||newsGroupTime(b)-newsGroupTime(a));
 $('newsList').replaceChildren();
 for(const item of rows.slice(0,newsState.limit)){
 const row=document.createElement('article');row.className='news-row';
 const info=document.createElement('div');info.className='news-row-info';
 const title=document.createElement('strong');title.textContent=item.title;
 const source=document.createElement('span');source.className='backup-note';
 const mark=newsGroupMark(item);
 source.textContent=(newsGroupNew(item)?'NEW ・ ':'')+(newsGroupDraft(item)&&!mark?'準備中 ・ ':'')+[...new Set(item.members.map(m=>m.source))].join('・')+' ・ '+(item.gashapon?(item.resale?'再販':'ガシャポン情報'):item.tipsOnly?'公式新作情報'+(item.date?' ・ 発表 '+newsDateLabel(item.date):''):item.prize?'プライズ情報':item.date?'発表 '+newsDateLabel(item.date):'発表日未確認')+(mark?' ・ '+(mark.kind==='done'?'投稿済み':'見送り'):'');
 info.append(source,title);
 const schedule=item.members.map(newsScheduleLabel).find(Boolean);if(schedule){const note=document.createElement('span');note.className='news-schedule';note.textContent=schedule;info.append(note);}
 const img=document.createElement('img');img.className='news-thumb';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
 if(item.image){img.src=item.image;img.onerror=()=>{img.hidden=true;};}else img.hidden=true;
 const btn=document.createElement('button');btn.type='button';btn.className='small-btn';btn.textContent='投稿準備';btn.addEventListener('click',()=>newsPrepare(item.url));
 const actions=document.createElement('div');actions.className='news-row-actions';actions.append(btn);
 if(!mark){const skip=document.createElement('button');skip.type='button';skip.className='small-btn news-row-skip';skip.textContent='見送り';skip.addEventListener('click',()=>{const y=window.scrollY;newsMark(item.url,'skip');window.scrollTo({top:y,behavior:'instant'});});actions.append(skip);}
 row.append(img,info,actions);
 if(mark){const restore=document.createElement('button');restore.type='button';restore.className='small-btn news-restore';restore.textContent='戻す';restore.addEventListener('click',()=>newsMark(item.url,null));actions.append(restore);}
 $('newsList').append(row);
 }
 const more=$('newsMore');more.hidden=rows.length<=newsState.limit;more.textContent='もっと見る（あと'+Math.max(0,rows.length-newsState.limit)+'件）';
 $('newsStatus').textContent=Math.min(newsState.limit,rows.length)+' / '+rows.length+'件'+newsSourceStatusLabel()+(rows.length?'':' ・ 表示するニュースはありません');
}
function newsKeepDraft(){
 if(!newsState.item)return;
 const entry=newsState.drafts.get(newsState.item.url);
 if(entry){entry.text=$('newsText').value;entry.replyText=$('newsReplyText').value;if(entry.aiDrafts?.length)entry.aiDrafts[entry.aiChoice||0].text=entry.text;entry.selected=newsState.selected.slice();entry.savedAt=Date.now();newsSaveDrafts();}
}
function newsReturn(){newsKeepDraft();++newsState.seq;$('newsEditor').hidden=true;$('newsBrowse').hidden=false;newsState.item=null;newsRender();window.scrollTo({top:newsState.browseY,behavior:'instant'});}
function newsMark(url,kind){
 const group=newsGroups().find(g=>g.members.some(m=>m.url===url)),urls=group?group.members.map(m=>m.url):[url];
 const prev={...newsState.marks};for(const u of urls){if(kind)newsState.marks[u]={kind,at:new Date().toISOString()};else delete newsState.marks[u];}
 try{localStorage.setItem('sanrioNewsMarks',JSON.stringify(newsState.marks));}catch(e){newsState.marks=prev;$('newsEditorStatus').textContent='保存できませんでした。端末の空き容量を確認してください。';return;}
 const editing=newsState.item?.url===url;if(editing)newsReturn();
 if(kind){for(const u of urls)newsState.drafts.delete(u);newsSaveDrafts();}
 newsRender();if(editing)window.scrollTo({top:newsState.browseY,behavior:'instant'});
}
async function newsLoad(){if(newsState.busy)return;newsState.busy=true;$('newsStatus').textContent='ニュースを確認中…';try{const d=await newsRequest('list');newsTrackItems(d.items);newsState.items=d.items;newsState.limit=5;newsState.warnings=d.warnings||[];newsState.sourceStatuses=d.sourceStatuses||{};newsRender();}catch(e){$('newsStatus').textContent=e.message;}finally{newsState.busy=false;}}
async function newsPrepare(url){
 newsKeepDraft();if(!$('newsBrowse').hidden)newsState.browseY=window.scrollY;
 const seq=++newsState.seq;$('newsAiStatus').textContent='';$('newsAiRetry').disabled=true;$('newsAiChoiceLabel').hidden=true;newsState.item=null;newsState.files=[];newsState.selected=[];
 const editor=$('newsEditor');$('newsBrowse').after(editor);$('newsBrowse').hidden=true;editor.hidden=false;
 const listed=newsState.items.find(item=>item.url===url);
 $('newsTitle').textContent=listed?.title||'投稿を準備中…';
 $('newsSource').textContent='';$('newsSource').removeAttribute('href');$('newsDate').textContent='';$('newsFacts').textContent='';
 editor.prepend($('newsEditorStatus'));editor.scrollIntoView({block:'start',behavior:'instant'});
 $('newsShare').disabled=true;$('newsSavePhotos').disabled=true;$('newsDone').disabled=true;$('newsSkip').disabled=true;
 $('newsRelatedSources').hidden=true;$('newsRelatedSources').replaceChildren();
 newsClearCollagePreview();$('newsCollageRetry').hidden=true;$('newsCollageControls').hidden=true;
 $('newsDraftStatus').textContent='';$('newsEditorStatus').textContent='記事を確認中…';$('newsImages').replaceChildren();$('newsText').value='';
 try{
  let entry=newsState.drafts.get(url);
  if(!entry){
   const d=await newsRequest('detail',url);if(seq!==newsState.seq)return;
   const item={...d.item,images:d.item.images||[]};
   entry={item,text:newsDraft(item),files:item.images.map(()=>null),selected:item.images.map((_,i)=>i).slice(0,4),errors:[],loading:[],savedAt:Date.now()};
   newsState.drafts.set(url,entry);newsState.drafts.set(item.url,entry);
  }
  if(seq!==newsState.seq)return;
  newsState.item=entry.item;newsState.files=entry.files;newsState.selected=entry.selected.slice();
  $('newsCollageMode').checked=!!entry.collageMode;$('newsCollageControls').hidden=entry.item.images.length<4;
  $('newsPhotoHint').textContent=entry.collageMode?'まとめる写真を4枚選択。さらに個別写真を3枚まで追加できます。':'4枚まで選択・「前へ／後へ」で並べ替え';
  const listedItem=newsState.items.find(i=>i.url===url||i.url===entry.item.url);if(listedItem)listedItem.facts=entry.item.facts||[];
  newsSourceLinks(url);
  $('newsDone').disabled=false;$('newsSkip').disabled=false;
  $('newsTitle').textContent=entry.item.title;$('newsSource').href=entry.item.url;$('newsSource').textContent=entry.item.source+'の記事を確認';
  $('newsDate').textContent=entry.item.tipsOnly?(entry.item.schedule||'発売時期は公式ページで確認'):entry.item.prize?(entry.item.schedule?entry.item.schedule+'登場予定（店舗により時期が前後します）':'登場時期は公式ページで確認'):entry.item.date?'発表日：'+entry.item.date+'（発売日とは別）':'発表日を元記事で確認';
  newsSetupReply(entry);newsReplyRender(entry);$('newsText').value=entry.text;$('newsAiChoiceLabel').hidden=!entry.aiDrafts?.length;$('newsAiChoice').value=String(entry.aiChoice||0);$('newsFacts').textContent=(entry.item.paragraphs||[]).slice(0,6).join('\n\n');
  newsSaveDrafts();if(entry.restored&&$('newsDraftStatus'))$('newsDraftStatus').textContent='保存した準備を復元しました。日程は元記事で確認してください。';
  // Show every preview before waiting for downloadable photo files.
  newsPhotosRender();newsLoadPhotos(entry);newsPhotoStatus();
  $('newsAiRetry').disabled=!!entry.aiPending;$('newsAiStatus').textContent=entry.aiStatus||'文字数制限なしで、華やかで可愛いニュース投稿文を1案作れます。';editor.scrollIntoView({block:'start',behavior:'instant'});
 }catch(e){if(seq===newsState.seq)$('newsEditorStatus').textContent=e.message;}
}
$('newsText').addEventListener('input',newsKeepDraft);
$('newsReplyText').addEventListener('input',newsKeepDraft);
$('newsReplyCopy').addEventListener('click',()=>copyTextFromClick($('newsReplyText').value,$('newsReplyCopy'),'返信用コメントをコピーしました'));
$('newsIncludeLink').addEventListener('change',()=>{
 const entry=newsState.item&&newsState.drafts.get(newsState.item.url);if(!entry)return;
 newsKeepDraft();const include=$('newsIncludeLink').checked;
 if(include&&!entry.includeLink&&entry.replyText)entry.text=entry.text.trimEnd()+'\n\n'+entry.replyText;
 else if(!include&&entry.includeLink&&entry.replyText){const index=entry.text.lastIndexOf(entry.replyText);if(index>=0)entry.text=(entry.text.slice(0,index)+entry.text.slice(index+entry.replyText.length)).trim();}
 entry.includeLink=include;$('newsText').value=entry.text;newsReplyRender(entry);newsKeepDraft();
});

$('newsAiChoice').addEventListener('change',()=>{
 const entry=newsState.item&&newsState.drafts.get(newsState.item.url);if(!entry?.aiDrafts?.length)return;
 newsKeepDraft();entry.aiChoice=Number($('newsAiChoice').value);newsApplyGenerated(entry,entry.aiDrafts[entry.aiChoice].text);newsReplyRender(entry);$('newsText').value=entry.text;entry.savedAt=Date.now();newsSaveDrafts();
});
$('newsRefresh').addEventListener('click',newsLoad);
$('newsOpen').addEventListener('click',()=>newsPrepare($('newsUrl').value.trim()));
$('newsCopy').addEventListener('click',()=>copyTextFromClick($('newsText').value,$('newsCopy'),'投稿文をコピーしました'));
$('newsShare').addEventListener('click',async()=>{const text=$('newsText').value.trim();if(!text||!newsPhotoReady())return;newsKeepDraft();const data={text,files:newsChosenFiles()};try{if(data.files.length&&navigator.canShare?.(data)){await navigator.share(data);$('newsEditorStatus').textContent='共有先でXを選び、本文・写真を確認して投稿してください。';}else if(navigator.share){await navigator.share({text});$('newsEditorStatus').textContent='本文を共有しました。写真は「写真を保存」から添付できます。';}else{copyTextFromClick(text,$('newsCopy'),'本文をコピーしました');window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text),'_blank','noopener');}}catch(e){if(e.name!=='AbortError')$('newsEditorStatus').textContent='共有できませんでした。投稿文をコピーし、写真を保存してXに添付してください。';}});
$('newsSavePhotos').addEventListener('click',()=>{for(const f of newsChosenFiles()){const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}});

$('newsBack').addEventListener('click',newsReturn);
$('newsBackBottom').addEventListener('click',newsReturn);

$('newsMore').addEventListener('click',()=>{const y=window.scrollY;newsState.limit+=5;newsRender();window.scrollTo({top:y,behavior:'instant'});});
$('newsSourceFilter').addEventListener('change',()=>{newsState.limit=5;newsRender();});
$('newsFilter').addEventListener('change',()=>{newsState.limit=5;newsRender();});
$('newsDone').addEventListener('click',()=>{if(newsState.item)newsMark(newsState.item.url,'done');});
$('newsSkip').addEventListener('click',()=>{if(newsState.item)newsMark(newsState.item.url,'skip');});

async function newsAiPost(action,data){
 const {key}=cloudSettings();if(!key)throw new Error('同期キーを設定してください。');
 const drafting=action==='ai-draft'||action==='post-ai-draft'||action==='product-groq-draft';
 const r=await fetch(newsApiUrl(action),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(drafting?85000:25000)});
 const d=await r.json();if(!r.ok||d.ok===false){const e=new Error(d.error||'AIを利用できません。');e.retryable=drafting&&d.retryable===true;throw e;}return d;
}
async function newsAiDraftWithRetry(entry,seq){
 for(let attempt=0;attempt<3;attempt++){
  try{return await newsAiPost('ai-draft',{url:entry.item.url});}
  catch(e){
   if(!e.retryable||attempt===2||seq!==newsState.seq)throw e;
   const delay=attempt===0?3000:6000;
   $('newsAiStatus').textContent='AIが混雑しています。'+delay/1000+'秒後に再試行します（'+(attempt+1)+'/2）…';
   await new Promise(resolve=>setTimeout(resolve,delay));
   if(seq!==newsState.seq)throw new Error('画面を切り替えたため、自動再試行を停止しました。');
   $('newsAiStatus').textContent='AIで文章を調整中…（再試行'+(attempt+1)+'/2・編集すると自動反映しません）';
  }
 }
}
async function newsAiAdjust(entry,seq,force=false){
 if(entry.aiPending){$('newsAiStatus').textContent='AIで文章を調整中…';$('newsAiRetry').disabled=true;return;}
 if(entry.aiAttempted&&!force){$('newsAiStatus').textContent=entry.aiStatus||'';return;}
 entry.aiAttempted=true;entry.aiPending=true;
 const before=entry.text;
 if(seq===newsState.seq){$('newsAiStatus').textContent='AIで文章を調整中…（編集すると自動反映しません）';$('newsAiRetry').disabled=true;}
 try{
  const d=await newsAiDraftWithRetry(entry,seq);
  if(!d.configured){entry.aiStatus='GroqのAPIキーを「AI設定」に保存してください。';}
  else if(typeof d.text!=='string'||!d.text.trim()){throw new Error('AI文を取得できません。');}
  else if(entry.text!==before||(seq===newsState.seq&&$('newsText').value!==before)){entry.aiStatus='手動編集を優先しました。AI文は反映していません。';}
  else{entry.aiDrafts=Array.isArray(d.drafts)&&d.drafts.length===3&&d.drafts.every(v=>typeof v.text==='string'&&v.text.trim())?d.drafts.map(v=>({...v})):[];entry.aiChoice=0;newsApplyGenerated(entry,entry.aiDrafts[0]?.text||d.text);entry.aiStatus=(entry.aiDrafts.length?'可愛い投稿案を3つ作成しました。':'AI生成済み（文字数制限なし）：')+'価格・日程・条件を元記事で確認してください。';if(newsState.item===entry.item){newsReplyRender(entry);$('newsText').value=entry.text;$('newsAiChoice').value='0';$('newsAiChoiceLabel').hidden=!entry.aiDrafts.length;}}
 }catch(e){entry.aiStatus='AI未調整：'+e.message;}
 finally{entry.aiPending=false;entry.savedAt=Date.now();newsSaveDrafts();if(newsState.item===entry.item){$('newsAiStatus').textContent=entry.aiStatus;$('newsAiRetry').disabled=false;}}
}
$('newsAiRetry').addEventListener('click',()=>{
 const entry=newsState.item&&newsState.drafts.get(newsState.item.url);if(!entry)return;newsKeepDraft();newsAiAdjust(entry,newsState.seq,true);
});

$('newsGroqSave').addEventListener('click',async()=>{const input=$('newsGroqKey'),button=$('newsGroqSave');button.disabled=true;try{const d=await newsAiPost('groq-settings',{apiKey:input.value.trim()});input.value='';$('newsGroqStatus').textContent=d.configured?'保存しました。AI生成ボタンを使えます。':'設定できませんでした。';}catch(e){input.value='';$('newsGroqStatus').textContent=e.message;}finally{button.disabled=false;}});

window.addEventListener('pagehide',newsKeepDraft);

$('newsCollageMode').addEventListener('change',()=>{
 const entry=newsCollageEntry();if(!entry)return;entry.collageMode=$('newsCollageMode').checked;
 newsState.selected=newsState.selected.slice(0,4);entry.collageIndices=newsState.selected.slice();
 entry.collageFailed=null;$('newsPhotoHint').textContent=entry.collageMode?'まとめる写真を4枚選択。さらに個別写真を3枚まで追加できます。':'4枚まで選択・「前へ／後へ」で並べ替え';
 newsKeepDraft();newsPhotosRender();newsLoadPhotos(entry);newsPhotoStatus();
});
$('newsCollageRetry').addEventListener('click',()=>{const entry=newsCollageEntry();if(entry){entry.collageFailed=null;newsPhotoStatus();}});

$('instagramAccountFilter').addEventListener('change',()=>{newsState.limit=5;newsRender();});
