(()=>{
'use strict';
const $=id=>document.getElementById(id),LIST='sphAmazonScoutCandidatesV1',PROVIDER='sphProductSearchProviderV1';
let current=null,busy=false,newsSource='',storageOK=true,autoBusy=false,autoLoaded=false,autoItems=[],autoTag='',autoNextAt=0;
let searchPage=0,searchKeyword='',searchItems=[],searchTag='',searchMore=false,searchReadyAt=0,searchTimer=null;
let autoLimit=20,autoCharacter='',autoCategory='',returnY=0,filterTimer=null,filterVersion=0,filterItems=[];
const text=v=>String(v||'').trim();
function amazonUrl(value){try{const raw=String(value||'').trim(),u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.amazon.co.jp','amazon.co.jp','amzn.to','amzn.asia','a.co','link.amazon'].includes(u.hostname)?raw:'';}catch{return '';}}
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
 const ok=write(list);if(ok){$('amazonFlowEditorStatus').textContent='下書きを保存しました。';renderDrafts();renderAuto();renderSearch();}update();return ok;
}
function button(label,fn){const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=label;b.onclick=fn;return b;}
function open(row){
 returnY=window.scrollY;
 current={...row};current.itemUrl=amazonUrl(row.itemUrl||row.affiliateUrl);
 if(!current.itemUrl){$('amazonFlowStatus').textContent='保存済み商品のAmazonリンクを確認してください。';current=null;return;}
 const chosen=amazonUrl(row.affiliateUrl)||(row.linkMode==='search'?amazonUrl(row.searchUrl):'')||current.itemUrl;
 let body=String(row.draft||row.body||'').trim();
 if(body&&!body.includes(chosen))body+='\n\n🛍️ Amazon：'+chosen;
 if(body&&!/(?:^|\s)#pr\s*$/i.test(body))body+='\n\n#pr';
 const item={url:current.itemUrl,title:row.title,source:'Amazon検索',origin:'amazon-search',ownAmazon:chosen,
  postText:body,postEdited:!!body,previewImage:imageUrl(row.image||''),products:[],
  productInfo:{title:row.title,url:'',itemCode:'',images:[],specs:{},contents:[],checkedAt:new Date().toISOString()}};
 function saveShared(draft,mark){
  const list=rows();if(!storageOK)throw new Error('保存データを確認してください。');
  const index=list.findIndex(x=>x.id===row.id);const entry={...(index>=0?list[index]:row),affiliateUrl:draft.ownAmazon||'',body:draft.postText||'',draft:draft.postText||'',image:row.image||'',status:mark||row.status||'未投稿',sharedEditor:true};
  if(index>=0)list[index]=entry;else list.push(entry);
  if(!write(list))throw new Error('端末に保存できませんでした。');
  renderDrafts();renderAuto();renderSearch();
 }
 $('amazonFlowEditor').hidden=true;
 lovelyWatch.openProduct(item,{host:$('amazonSearchArea'),
  onBack:draft=>saveShared(draft),onMark:(reason,draft)=>saveShared(draft,reason==='used'?'投稿済み':'見送り'),
  onClose:()=>{current=null;window.scrollTo({top:returnY,behavior:'instant'});}
 });
 const search=amazonUrl(row.searchUrl);
 if(search){const button=document.createElement('button');button.type='button';button.className='small-btn';button.id='amazonSharedSearchLink';button.textContent='検索結果リンクを使う';$('lovelyAmazon').after(button);button.onclick=()=>{$('lovelyAmazon').value=search;$('lovelyAmazon').dispatchEvent(new Event('input',{bubbles:true}));};}
 if(row.sourceUrl){const button=document.createElement('button');button.type='button';button.className='small-btn';button.id='amazonSharedToNews';button.textContent='元のニュースにAmazonリンクを追加';$('lovelyPostText').after(button);button.onclick=()=>{const link=$('lovelyAmazon').value.trim();if(link)document.dispatchEvent(new CustomEvent('sph-amazon-news-link',{detail:{sourceUrl:row.sourceUrl,link}}));};}
}

function prepare(item,tag,manual=false){
 const itemUrl=amazonUrl(item.url);if(!itemUrl||!text(item.title))return;
 const asin=productAsin(itemUrl);
 const list=rows();if(!storageOK)return;
 const existing=list.find(row=>row.itemUrl===itemUrl||row.affiliateUrl===itemUrl||(asin&&productAsin(row.itemUrl||row.affiliateUrl)===asin));
 const pastedSearch=manual&&['www.amazon.co.jp','amazon.co.jp'].includes(new URL(itemUrl).hostname)&&/^\/s\/?$/.test(new URL(itemUrl).pathname);
 if(existing&&!existing.image&&imageUrl(item.image||''))existing.image=imageUrl(item.image);
 const entry=existing||{id:crypto.randomUUID(),title:text(item.title),itemUrl,affiliateUrl:itemUrl,searchUrl:manual?(pastedSearch?itemUrl:''):searchLink(item.title,tag),partnerTag:tag,sourceUrl:newsSource,manual,image:imageUrl(item.image||''),createdAt:new Date().toISOString(),status:'未投稿',body:'',linkMode:pastedSearch?'search':'item'};
 if(!existing){list.push(entry);if(!write(list))return false;}
 open(entry);return true;
}
function renderDrafts(){
 const host=$('amazonFlowDrafts');host.replaceChildren();const filter=$('amazonFlowFilter').value;
 const list=rows().filter(row=>(row.status||'未投稿')===filter).slice().reverse();
 for(const row of list){const card=document.createElement('article');card.className='flow-card';const title=document.createElement('h3');title.textContent=row.title;card.append(title,button('確認・共有',()=>open(row)));host.append(card);}
 if(!list.length){const p=document.createElement('p');p.className='backup-note';p.textContent='該当するAmazon下書きはありません。';host.append(p);}
}
function productAsin(value){const u=amazonUrl(value);return u?new URL(u).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase()||'':'';}
const characters=[['すべて',''],['キティ','ハローキティ|hello kitty'],['マイメロディ','マイメロディ|my melody'],['クロミ','クロミ|kuromi'],['シナモロール','シナモロール|シナモン|cinnamoroll'],['ポムポムプリン','ポムポムプリン|pompompurin'],['ポチャッコ','ポチャッコ|pochacco'],['その他','other']];
const categories=[['すべて',''],['ぬいぐるみ','ぬいぐるみ|マスコット|抱き枕'],['バッグ・ポーチ','バッグ|ポーチ|ケース'],['おもちゃ','フィギュア|おもちゃ|玩具|ブロック'],['文具','文具|ペン|ノート|バインダー|シール'],['生活雑貨','ボトル|タオル|食器|コップ|クッション|収納'],['その他','other']];
function matches(value,pattern,options){return !pattern||(pattern==='other'?!options.some(([,p])=>p&&p!=='other'&&new RegExp(p,'i').test(value)):new RegExp(pattern,'i').test(value));}
function savedProduct(item){const asin=productAsin(item.url);return rows().find(r=>(asin&&productAsin(r.itemUrl||r.affiliateUrl)===asin)||r.itemUrl===item.url||r.affiliateUrl===item.url);}
function renderAuto(){
 const host=$('amazonAutoResults');host.replaceChildren();const saved=rows();const used=new Set(saved.filter(r=>['投稿済み','見送り'].includes(r.status)).map(r=>productAsin(r.itemUrl||r.affiliateUrl)).filter(Boolean));
 const unique=new Map();for(const item of [...autoItems,...filterItems]){const id=productAsin(item.url);if(id&&Number(item.fetchedAt||0)*1000>Date.now()-86400000&&amazonUrl(item.url)&&text(item.title))unique.set(id,item);}
 const available=[...unique.values()].filter(i=>!used.has(productAsin(i.url))),query=$('amazonAutoQuery').value.trim().toLowerCase();
 const filtered=available.filter(i=>i.title.toLowerCase().includes(query)&&matches(i.title,autoCharacter,characters)&&matches(i.title,autoCategory,categories));
 for(const item of filtered.slice(0,autoLimit))renderProduct(item,autoTag,host);
 $('amazonAutoCount').textContent='表示 '+Math.min(filtered.length,autoLimit)+'件 ／ 絞込 '+filtered.length+'件 ／ 未投稿 '+available.length+'件 ／ 有効な取得 '+unique.size+'件（投稿済み・見送り '+(unique.size-available.length)+'件を除外）';
 $('amazonAutoMore').hidden=filtered.length<=autoLimit;
 if(!filtered.length){const p=document.createElement('p');p.className='backup-note';p.textContent=available.length?'この条件に合う候補はありません。絞り込みを変更してください。':'現在の未投稿候補はありません。自動検索が進むとここに表示されます。';host.append(p);}
}
const sanrioSearchNames=/サンリオ|sanrio|ハローキティ|hello\s*kitty|キティ|マイメロディ|マイメロ|my\s*melody|クロミ|kuromi|シナモロール|シナモン|cinnamoroll|ポムポムプリン|pompompurin|ポチャッコ|pochacco|リトルツインスターズ|キキララ|ハンギョドン|タキシードサム|けろけろけろっぴ|バッドばつ丸|あひるのペックル|ぐでたま|マイスウィートピアノ|ウィッシュミーメル|こぎみゅん|はなまるおばけ|がおぱわるぅ|ぼんぼんりぼん|ディアダニエル|チャーミーキティ|まるもふびより|コロコロクリリン|マロンクリーム|シュガーバニーズ|ウサハナ|マシュマロみたいなふわふわにゃんこ|チョコキャット|KIRIMI|おさるのもんきち|ゴロピカドン|ジュエルペット|みんなのたあ坊|リトルフォレストフェロォ|ルロロマニック|JOCHUM/i;
function prioritizedBrandItems(items,keyword){if(!/^(?:TOPTOY|POP MART|バンダイ|タカラトミー|リーメント|エンスカイ) サンリオ$/i.test(keyword))return items.slice();return items.slice().sort((a,b)=>Number(sanrioSearchNames.test(b.title))-Number(sanrioSearchNames.test(a.title)));}
function renderSearch(){const host=$('amazonFlowResults');host.replaceChildren();for(const item of prioritizedBrandItems(searchItems,searchKeyword))renderProduct(item,searchTag,host);}
function filterButtons(id,options,choose){for(const [label,value] of options){const b=button(label,()=>{choose(value);autoLimit=20;for(const child of $(id).children)child.setAttribute('aria-pressed',String(child===b));renderAuto();scheduleFilterSearch();});b.setAttribute('aria-pressed',String(!value));$(id).append(b);}}
function scheduleFilterSearch(){
 const version=++filterVersion;clearTimeout(filterTimer);
 const character=characters.find(([,v])=>v===autoCharacter),category=categories.find(([,v])=>v===autoCategory);
 const matched=$('amazonAutoResults').querySelector('.flow-card');
 if(matched||(!autoCharacter&&!autoCategory)){ $('amazonFilterStatus').textContent='';return; }
 if(autoCharacter==='other'||autoCategory==='other'){ $('amazonFilterStatus').textContent='「その他」は取得済み候補から絞り込みます。';return; }
 const keywords=[character&&character[1]?character[0]:'サンリオ',category&&category[1]?category[0]:''].filter(Boolean).join(' ');
 const run=async()=>{
  if(version!==filterVersion)return;
  const wait=Math.max(0,searchReadyAt-Date.now());
  if(busy||autoBusy||wait){$('amazonFilterStatus').textContent='「'+keywords+'」の検索を準備中です…';filterTimer=setTimeout(run,Math.max(500,wait));return;}
  busy=true;searchReadyAt=Date.now()+5000;searchControls();$('amazonFilterStatus').textContent='「'+keywords+'」をAmazonで検索中です…';
  try{
   const d=await amazonRequest('search',{keywords,page:1});const now=Math.floor(Date.now()/1000);
   const found=(d.items||[]).filter(item=>productAsin(item.url)&&text(item.title)).map(item=>({...item,fetchedAt:now}));
   const unique=new Map(filterItems.map(item=>[productAsin(item.url),item]));for(const item of found)unique.set(productAsin(item.url),item);
   filterItems=[...unique.values()];if(d.partnerTag)autoTag=d.partnerTag;renderAuto();
   if(version===filterVersion)$('amazonFilterStatus').textContent=found.length?'「'+keywords+'」を検索しました。商品名に条件が一致する候補を表示しています。':'「'+keywords+'」の検索結果はありませんでした。';
  }catch(e){if(version===filterVersion)$('amazonFilterStatus').textContent='「'+keywords+'」を検索できませんでした：'+e.message;}
  finally{busy=false;searchControls();}
 };
 $('amazonFilterStatus').textContent='「'+keywords+'」の検索を準備中です…';filterTimer=setTimeout(run,600);
}
function backToList(){if(current&&!save())return;$('amazonFlowEditor').hidden=true;current=null;window.scrollTo({top:returnY,behavior:'instant'});}
function renderProduct(item,tag,host){
 const card=document.createElement('article');card.className='flow-card flow-source-card';const photo=imageUrl(item.image);if(photo){const img=document.createElement('img');img.src=photo;img.alt='商品照合用写真';img.loading='lazy';img.referrerPolicy='no-referrer';card.classList.add('has-image');card.append(img);}
 const title=document.createElement('h3');title.textContent=item.title;const a=document.createElement('a');amazonAppAnchor(a,item.url);a.textContent='アプリで開く';a.className='small-btn link-btn';a.rel='sponsored nofollow noopener noreferrer';const actions=document.createElement('div');actions.className='flow-source-actions';const web=document.createElement('a');web.href=item.url;web.target='_blank';web.rel='noopener noreferrer';web.className='small-btn link-btn';web.textContent='ブラウザで開く';actions.append(a,web,button('投稿準備',()=>prepare(item,tag)));const state=document.createElement('p');state.className='backup-note';const saved=savedProduct(item);state.textContent=saved?(!saved.status||saved.status==='未投稿'?'下書きあり':saved.status):'未保存';card.append(title,state,actions);host.append(card);
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
 $('amazonAutoStatus').textContent=autoItems.length+'件を取得済み ・ 最終成功：'+time+(autoNextAt>Date.now()?' ・ 次の自動検索：'+new Date(autoNextAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'')+(d.autoError?' ・ '+d.autoError:'');
 $('amazonAutoProgress').textContent=(d.lastQuery?'前回の検索：'+d.lastQuery+' ・ ':'')+(d.nextQuery?'次の検索：'+d.nextQuery:'')+'（30分ごとに検索語を切替）';
}
async function loadAuto(){
 if(autoBusy||busy||$('flowProvider').value!=='amazon')return;
 autoBusy=true;$('amazonAutoRefresh').disabled=true;$('amazonFlowSearch').disabled=true;
 try{
  const d=await amazonRequest('candidates');
  if(d.configured===false)throw new Error('サーバーに保存したAmazon接続設定を読み出せません。保存領域の確認が必要です。');
  applyAuto(d);autoLoaded=true;
  if(autoNextAt<=Date.now()){
   $('amazonAutoStatus').textContent+=' ・ 新しい候補を検索中…';
   const next=await amazonRequest('discover',{});applyAuto(next);
  }
 }catch(e){$('amazonAutoStatus').textContent='自動検索を完了できませんでした：'+e.message+(autoItems.length?' 現在読み込んでいる候補は表示したままです。':' この画面では取得済み候補を読み込めていません。保存した下書きは別管理です。');}
 finally{autoBusy=false;$('amazonAutoRefresh').disabled=false;searchControls();}
}
function searchControls(){
 $('amazonFlowSearch').disabled=busy||autoBusy;
 for(const b of $('amazonBrandButtons').querySelectorAll('button'))b.disabled=busy||autoBusy;
 $('amazonFlowMore').hidden=!searchMore;$('amazonFlowMore').disabled=busy||autoBusy||Date.now()<searchReadyAt||$('amazonFlowQuery').value.trim()!==searchKeyword;
 clearTimeout(searchTimer);if(Date.now()<searchReadyAt)searchTimer=setTimeout(searchControls,searchReadyAt-Date.now()+20);
 const u=new URL('https://www.amazon.co.jp/s');u.searchParams.set('k',$('amazonFlowQuery').value.trim()||'サンリオ');amazonAppAnchor($('amazonSearchExternal'),u.href,'Amazonアプリで検索');$('amazonSearchWeb').href=u.href;
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
  renderSearch();
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
filterButtons('amazonCharacterButtons',characters,value=>autoCharacter=value);
filterButtons('amazonCategoryButtons',categories,value=>autoCategory=value);
$('amazonAutoQuery').oninput=()=>{autoLimit=20;renderAuto();++filterVersion;clearTimeout(filterTimer);$('amazonFilterStatus').textContent='';};
$('amazonAutoMore').onclick=()=>{autoLimit+=20;renderAuto();};
$('amazonDraftsJump').onclick=()=>{$('amazonDraftsHeading').scrollIntoView({block:'start',behavior:'instant'});$('amazonDraftsHeading').focus({preventScroll:true});};
$('amazonFlowBack').onclick=backToList;
document.addEventListener('sph-candidates-restored',()=>{current=null;$('amazonFlowEditor').hidden=true;renderDrafts();renderAuto();renderSearch();});
document.addEventListener('sph-product-flow-tab',()=>{if($('flowProvider').value==='amazon')loadAuto();});
setInterval(()=>{if(!document.hidden&&!$('productFlowPanel').hidden&&$('flowProvider').value==='amazon'&&autoNextAt<=Date.now())loadAuto();},60000);
for(const b of $('amazonBrandButtons').querySelectorAll('button'))b.onclick=()=>{for(const other of $('amazonBrandButtons').querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===b));$('amazonFlowQuery').value=b.dataset.amazonBrand+' サンリオ';searchControls();search();};
$('amazonFlowSearch').onclick=()=>search();$('amazonFlowMore').onclick=()=>search(true);$('amazonFlowQuery').oninput=()=>{for(const b of $('amazonBrandButtons').querySelectorAll('button'))b.setAttribute('aria-pressed','false');searchControls();};$('amazonFlowQuery').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search();}};
$('amazonManualAdd').onclick=manualAdd;for(const id of ['amazonManualTitle','amazonManualUrl'])$(id).oninput=()=>{$('amazonManualConfirmed').checked=false;};
$('amazonFlowFilter').onchange=renderDrafts;
$('amazonFlowBody').oninput=()=>{update();save();};$('amazonFlowMode').onchange=()=>{update();save();};$('amazonFlowSave').onclick=()=>save();
$('amazonFlowCopy').onclick=()=>{if(save())copyTextFromClick(finalText(),$('amazonFlowCopy'),'本文をコピーしました');};
$('amazonFlowCopyLink').onclick=()=>copyTextFromClick(link(),$('amazonFlowCopyLink'),'Amazonリンクをコピーしました');
$('amazonFlowShare').onclick=async()=>{if(!save())return;try{if(navigator.share)await navigator.share({text:finalText()});else copyTextFromClick(finalText(),$('amazonFlowShare'),'本文をコピーしました');}catch(e){if(e.name!=='AbortError')$('amazonFlowEditorStatus').textContent='共有できませんでした。本文コピーをご利用ください。';}};
$('amazonFlowDone').onclick=()=>{if(save('投稿済み'))backToList();};$('amazonFlowSkip').onclick=()=>{if(save('見送り'))backToList();};
$('amazonFlowToNews').onclick=()=>{if(save()&&link())document.dispatchEvent(new CustomEvent('sph-amazon-news-link',{detail:{sourceUrl:newsSource,link:link()}}));};
document.addEventListener('sph-amazon-product-search',event=>{newsSource=text(event.detail?.sourceUrl);$('amazonFlowQuery').value=text(event.detail?.title).slice(0,120)||'サンリオ';$('flowProvider').value='amazon';provider();setHomeView('flow');searchControls();update();$('amazonFlowQuery').scrollIntoView({block:'center',behavior:'instant'});});
try{if(localStorage.getItem(PROVIDER)==='amazon'){$('flowProvider').value='amazon';provider();}}catch{}
$('amazonFlowQuery').addEventListener('input',searchControls);
for(const id of ['amazonFlowSource','amazonFlowSourceWeb'])$(id).addEventListener('click',()=>{if(current)save();});
searchControls();
})();
