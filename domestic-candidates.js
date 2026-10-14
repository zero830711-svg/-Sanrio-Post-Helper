/* Evidence for domestic products is additive; archive records and links are never rewritten. */
const domesticCandidates=(()=>{
 const KEY='sphDomesticEvidenceV1',DAY=86400000;
 const official=['sanrio.co.jp','hatakeyamashoji.jp','gourmandise.co.jp','skater-onlineshop.com','furyu.jp','takaratomy-arts.co.jp','re-ment.co.jp','eikoh-prize.jp','bandai.co.jp','gashapon.jp','thankyoumart.jp','prtimes.jp'];
 function trusted(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&official.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch(_){return false;}}
 let cachedRaw=null,cachedValue={};
 function read(){try{const raw=localStorage.getItem(KEY)||'{}';if(raw!==cachedRaw){const v=JSON.parse(raw);cachedValue=v&&typeof v==='object'&&!Array.isArray(v)?v:{};cachedRaw=raw;}return cachedValue;}catch(_){return {};}}
 function day(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return '';const t=Date.parse(v+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v?v:'';}
 function today(now=Date.now()){return new Date(now+9*3600000).toISOString().slice(0,10);}
 function dates(text){const out=[];for(const m of String(text).matchAll(/(20\d{2})年\s*(\d{1,2})月\s*(?:(\d{1,2})日|(上旬|中旬|下旬))?/g)){const value=m[1]+'-'+m[2].padStart(2,'0')+(m[3]?'-'+m[3].padStart(2,'0'):'');if(m[3]&&!day(value)||+m[2]<1||+m[2]>12)continue;out.push({value,precision:m[3]?'day':m[4]||'month',text:m[0]});}return out;}
 function ids(item){const out=[...(item.productIds||[])];for(const j of [item.jan,item.productInfo?.jan])if(/^\d{13}$/.test(String(j||'')))out.push('jan:'+j);if(typeof revenueProductIds==='function')out.push(...revenueProductIds(item));return [...new Set(out.filter(v=>/^(jan:\d{13}|asin:[A-Z0-9]{10}|rakuten:[^:\s]+:[^:\s]+)$/.test(v)))];}
 function extract(item,now=Date.now()){
  const url=item.manufacturerInfo?.url||item.url,valid=trusted(url)&&!item.overseas;
  const lines=[item.schedule,...(Array.isArray(item.facts)?item.facts.map(f=>f.text):Object.entries(item.facts||{}).map(([k,v])=>k+'：'+v)),...Object.entries(item.manufacturerInfo?.facts||{}).map(([k,v])=>k+'：'+v),...(valid?[item.title]:[])].filter(Boolean);
  const e={url,title:item.title||'',source:item.source||'',ids:ids(item),image:item.thumbnail||item.image||'',publishedAt:item.date||'',observedAt:new Date(now).toISOString(),verified:valid,identityUncertain:!!item.needsReview||(!(item.jan||item.productInfo?.jan)&&ids(item).filter(id=>!id.startsWith('jan:')).length>1),release:null,reservation:null,event:'new',price:'',evidence:[]};
  if(valid)for(const line of lines){
   const d=dates(line);if(d.length===1&&/発売|販売開始|登場時期|登場予定/.test(line)&&!/延期|変更前/.test(line)){e.release=d[0];e.evidence.push(line);}
   if(d.length===1&&/予約(?:受付)?開始|受注開始/.test(line)&&!/終了/.test(line)){e.reservation=d[0];e.evidence.push(line);}
   if(/再入荷|再販|予約再開|受付再開/.test(line)){e.event='restock';e.evidence.push(line);}
   if(/セール|値下げ/.test(line)){e.event='sale';e.evidence.push(line);}
   if(/価格|税込|税抜/.test(line)&&/[\d,]+円/.test(line)){e.price=line;e.evidence.push(line);}
  }
  return e;
 }
 function ingest(items){const saved={...read()};for(const item of items||[]){if(item.overseas||!item.url)continue;const e=extract(item),old=saved[item.url];if(old?.manual)continue;saved[item.url]=old?{...old,...e,ids:[...new Set([...old.ids,...e.ids])],release:e.release||old.release,reservation:e.reservation||old.reservation,price:e.price||old.price,event:e.event==='new'?old.event:e.event,evidence:[...new Set([...(old.evidence||[]),...e.evidence])]}:e;}
  try{localStorage.setItem(KEY,JSON.stringify(saved));document.dispatchEvent(new Event('sph-domestic-evidence'));}catch(_){document.dispatchEvent(new CustomEvent('sph-domestic-storage-error'));}
 }
 function get(item){return read()[item.url]||extract(item);}
 function classify(e,now=Date.now()){
  const current=today(now),delta=d=>d?.precision==='day'?(Date.parse(d.value)-Date.parse(current))/DAY:null;
  const observed=Date.parse(e.observedAt),fresh=Number.isFinite(observed)&&now>=observed&&now-observed<=7*DAY;
  if(e.verified&&fresh&&delta(e.reservation)!==null&&delta(e.reservation)>=0&&delta(e.reservation)<=7)return {kind:'reservation',priority:1,label:'予約開始（7日以内）'};
  if(e.verified&&fresh&&delta(e.release)!==null&&delta(e.release)>=0&&delta(e.release)<=7)return {kind:'soon',priority:1,label:'発売間近（7日以内）'};
  const announcement=Date.parse(e.publishedAt),recentAnnouncement=Number.isFinite(announcement)&&now>=announcement&&now-announcement<=7*DAY;
  if(e.verified&&fresh&&(e.manual||recentAnnouncement)&&['sale','restock'].includes(e.event))return {kind:'update',priority:4,label:(e.event==='sale'?'セール':'再入荷・再販')+'情報（現在の販売状況は要確認）'};
  if(['sale','restock'].includes(e.event))return {kind:'review',priority:6,label:'更新告知の日付・現在の状況は要確認'};
  if(/くじ|カプセル|ガシャポン|ガチャ/.test(e.title))return {kind:'lottery',priority:3,label:'当りくじ・カプセルトイ'};
  return {kind:e.verified?'new':'review',priority:e.verified?2:6,label:e.verified?'新着発表・掲載':'要確認'};
 }
 function summary(e){const c=classify(e);return [c.label,e.reservation?'予約開始：'+e.reservation.text:'予約開始：未確認',e.release?'発売：'+e.release.text:'発売：未確認',e.price?'資料の'+e.price+'（現在価格は要確認）':'価格：未確認','在庫：未確認','情報元：'+(e.source||'元ページ'),'資料取得：'+new Date(e.observedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),'掲載日：'+(e.publishedAt||'未確認')+'（発売日とは別）'].join(' ／ ');}
 function rank(groups){return groups.map(g=>({...g,domestic:get(g.item)})).sort((a,b)=>classify(a.domestic).priority-classify(b.domestic).priority);}
 function matches(post,e){const keys=ids(post);return (e.postIds||[]).includes(String(post.id))||keys.length&&e.ids.some(k=>keys.includes(k));}
 function reuse(posts,evidence=Object.values(read()),now=Date.now()){
  const index=new Map(),seen=new Set();for(const e of evidence){if(!e.verified||!['reservation','soon','update'].includes(classify(e,now).kind))continue;for(const key of [...(e.identityUncertain?[]:e.ids),...(e.postIds||[]).map(id=>'post:'+id)]){if(!index.has(key))index.set(key,[]);index.get(key).push(e);}}
  return posts.filter(p=>!p.deletedAt&&!p.candidateExcluded&&(!p.skippedAt||now-Date.parse(p.skippedAt)>=7*DAY)).flatMap(p=>{
   const current=[...new Set([...ids(p),'post:'+p.id].flatMap(key=>index.get(key)||[]))];if(!current.length||seen.has(String(p.id)))return [];seen.add(String(p.id));
   const recent=Math.max(Date.parse(p.lastRepostedAt)||0,Date.parse(p.postedAt)||0);if(now-recent<DAY)return [];
   const e=current.sort((a,b)=>classify(a,now).priority-classify(b,now).priority)[0];return [{post:p,evidence:e,reason:classify(e,now).label}];
  }).sort((a,b)=>classify(a.evidence,now).priority-classify(b.evidence,now).priority||(+b.post.impressions||0)-(+a.post.impressions||0));
 }
 function context(post){const entry=reuse([post])[0];return entry?'【商品一致を確認した現在の資料（元投稿とは別・購入リンクに置き換えない）】\n確認先：'+entry.evidence.url+'\n'+summary(entry.evidence)+'\n資料の日付・種類を保ち、現在の価格・在庫は再確認できない限り断定しない。':'';}
 function editor(item,container){const root=document.getElementById(container);if(!root)return;const e=get(item);root.replaceChildren();const info=document.createElement('p');info.className='backup-note';info.textContent=summary(e);root.append(info);const details=document.createElement('details');details.className='evidence-editor';const heading=document.createElement('summary');heading.textContent='公式情報を確認して発売・予約情報を記録';details.append(heading);const fields={};
  for(const [key,label,type,value] of [['url','確認した公式・メーカー・PR TIMESのURL','url',trusted(e.url)?e.url:''],['release','発売日（正確な日付が確認できた場合のみ）','date',e.release?.precision==='day'?e.release.value:''],['reservation','予約開始日（正確な日付が確認できた場合のみ）','date',e.reservation?.precision==='day'?e.reservation.value:''],['jan','JAN（商品・種類・セットが一致する場合のみ）','text',e.ids.find(i=>i.startsWith('jan:'))?.slice(4)||''],['price','確認した価格（円・未確認なら空欄）','number',''],['post','照合する元投稿ID（検索リンクの投稿も指定できます）','text',(e.postIds||[])[0]||'']]){const labelEl=document.createElement('label'),input=document.createElement('input');labelEl.textContent=label;input.type=type;input.value=value;input.maxLength=2048;fields[key]=input;labelEl.append(input);details.append(labelEl);}
  const event=document.createElement('select');for(const [v,t] of [['new','発表・発売予定'],['restock','公式の再入荷・再販告知'],['sale','公式のセール告知']]){const o=document.createElement('option');o.value=v;o.textContent=t;event.append(o);}event.value=e.event;details.append(event);
  const confirmLabel=document.createElement('label'),confirm=document.createElement('input');confirm.type='checkbox';confirmLabel.append(confirm,' 商品・種類・セット内容と現在の告知を公式ページで確認しました');details.append(confirmLabel);const button=document.createElement('button'),status=document.createElement('p');button.type='button';button.className='small-btn';button.textContent='確認情報を保存';status.className='backup-note';status.setAttribute('aria-live','polite');button.onclick=async()=>{try{if(!confirm.checked||!trusted(fields.url.value.trim()))throw new Error('公式の確認先URLと商品一致の確認が必要です。');if(fields.price.value&&(!/^\d+$/.test(fields.price.value)||!Number.isSafeInteger(Number(fields.price.value))))throw new Error('価格は0以上の整数で入力してください。');if(fields.jan.value&&!/^\d{13}$/.test(fields.jan.value))throw new Error('JANは13桁で入力してください。');const post=fields.post.value.trim();if(post&&!(await dbGetAll()).some(p=>String(p.id)===post&&!p.deletedAt))throw new Error('元投稿IDが保存済みアーカイブにありません。');const saved={...read()},record={...e,url:fields.url.value.trim(),verified:true,manual:true,observedAt:new Date().toISOString(),event:event.value,price:fields.price.value?'価格：'+fields.price.value+'円（手動確認時点）':e.price,postIds:post?[post]:[],ids:[...new Set([...e.ids,...(fields.jan.value?['jan:'+fields.jan.value]:[])])]};for(const name of ['release','reservation']){const value=fields[name].value;if(value&&!day(value))throw new Error('日付を確認してください。');record[name]=value?{value,precision:'day',text:value}:e[name];}saved[item.url]=record;localStorage.setItem(KEY,JSON.stringify(saved));status.textContent='確認情報を保存しました。元投稿と紹介リンクは変更していません。';document.dispatchEvent(new Event('sph-domestic-evidence'));}catch(err){status.textContent=err.message;}};details.append(button,status);root.append(details);
 }
 const api={trusted,day,today,dates,ids,extract,ingest,get,classify,summary,rank,matches,reuse,context,editor};
 if(typeof document!=='undefined'){
  async function render(){const root=document.getElementById('domesticReuseList');if(!root||typeof dbGetAll!=='function')return;const candidates=reuse(await dbGetAll());root.replaceChildren();document.getElementById('domesticReusePanel').hidden=!candidates.length;const hint=document.getElementById('domesticReuseStatus');hint.textContent=candidates.length?'確認した国内情報と商品IDが一致する候補です。元リンクを保持します。':'発売・予約・更新情報と一致する候補はありません。新着商品・新作ニュースで情報を取得すると照合します。';
   for(const entry of candidates.slice(0,20)){const row=document.createElement('div');row.className='evidence-row';const text=document.createElement('p');text.textContent=entry.post.title||entry.post.text?.slice(0,100)||'過去投稿';const reason=document.createElement('p');reason.className='backup-note';reason.textContent=summary(entry.evidence);const a=document.createElement('a');a.href=entry.evidence.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='現在の情報を確認';const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent='元投稿から準備';button.onclick=()=>showTodayDetail(entry.post);row.append(text,reason,a,button);root.append(row);}
  }
  document.addEventListener('sph-domestic-evidence',render);document.addEventListener('sph-domestic-storage-error',()=>{const el=document.getElementById('domesticReuseStatus');if(el)el.textContent='確認資料を保存できませんでした。端末の空き容量を確認してください。';});
  document.addEventListener('DOMContentLoaded',render);document.getElementById('homeTodayTab')?.addEventListener('click',render);
 }
 return api;
})();
if(typeof module!=='undefined')module.exports=domesticCandidates;
