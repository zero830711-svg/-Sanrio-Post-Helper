const $=id=>document.getElementById(id);
const clean=v=>(v||"").trim();
const DB_NAME="sanrioPostHelperDB";
const STORE="popularPosts";
const LEGACY_KEY="sanrioPopularPostsV1";
const LAST_ANALYTICS_IMPORT_KEY="sanrioLastAnalyticsImportAt";
const LAST_BACKUP_EXPORT_KEY="sanrioLastBackupExportAt";
const CLOUD_API_URL_KEY="sanrioCloudApiUrl";
const CLOUD_SYNC_KEY_KEY="sanrioCloudSyncKey";
const LAST_CLOUD_SYNC_KEY="sanrioLastCloudSyncAt";
const DEFAULT_CLOUD_API_URL="https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/api2580.php";
const TODAY_ROLES=["拡散狙い","クリック狙い","鉄板再利用"];
const APP_VERSION="2026.09.22-2590";
let selectedImages=[];
let editingId=null;
let archiveFilter="all";
let archiveSort="newest";
let archiveLimit=50;
let undoState=null;
let searchIndex=null;
let searchIndexSignature="";
const analyticsCharts={};
let cloudSyncTimer=null;
let cloudSyncBusy=false;
let cloudApplyingRemote=false;
const cloudDirtyIds=new Set();
const cloudDeletedIds=new Set();

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"})};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function dbGetAll(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readonly");const req=tx.objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result.sort((a,b)=>(b.savedAt||"").localeCompare(a.savedAt||"")));
    req.onerror=()=>reject(req.error);
  });
}
async function dbPut(item){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(item);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function dbPutMany(items){
  if(!items.length)return;
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    const store=tx.objectStore(STORE);
    items.forEach(item=>store.put(item));
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
}
async function dbDelete(id){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function dbDeleteMany(ids){
  if(!ids.length)return;
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    const store=tx.objectStore(STORE);
    ids.forEach(id=>store.delete(id));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function migrateLegacy(){
  const raw=localStorage.getItem(LEGACY_KEY);if(!raw)return;
  try{
    const old=JSON.parse(raw);
    for(const x of old){
      const exists=(await dbGetAll()).some(v=>v.id===x.id);
      if(!exists)await dbPut({...x,images:x.images||(x.image?[x.image]:[])});
    }
    localStorage.removeItem(LEGACY_KEY);
  }catch(e){}
}
function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

async function compressFile(file){
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
  const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=data});
  const max=1400;let w=img.width,h=img.height;
  if(Math.max(w,h)>max){const s=max/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s)}
  const c=document.createElement("canvas");c.width=w;c.height=h;
  c.getContext("2d").drawImage(img,0,0,w,h);
  return c.toDataURL("image/jpeg",0.78);
}
function renderPreview(){
  $("archivePreviewGrid").innerHTML=selectedImages.map(src=>'<img src="'+src+'" alt="">').join("");
}
function dateInputValue(v){
  const t=new Date(v||"").getTime();
  if(!Number.isFinite(t))return "";
  const d=new Date(t);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
function normalizedUrl(url){
  const v=clean(url);
  if(!v)return "";
  if(/^https?:\/\//i.test(v))return v;
  return "https://"+v;
}

function hasAmazonAffiliate(x){
  if(clean(x.amazon))return true;
  const t=String(x.text||"");
  return /(amazon|アマゾン)/i.test(t) && /(https?:\/\/t\.co\/|amazon\.|amzn\.)/i.test(t);
}
function hasRakutenAffiliate(x){
  if(clean(x.rakuten))return true;
  const t=String(x.text||"");
  return /(楽天|rakuten)/i.test(t) && /(https?:\/\/t\.co\/|rakuten\.)/i.test(t);
}
function hasAffiliate(x){return hasAmazonAffiliate(x)||hasRakutenAffiliate(x)}

function canonicalPostKey(x){
  if(clean(x.postId))return "post:"+clean(x.postId);
  const m=String(x.xUrl||"").match(/status\/(\d+)/);
  if(m)return "post:"+m[1];
  return "id:"+String(x.id||"");
}
function newestIso(...values){
  let best="",bestT=0;
  for(const v of values){
    const t=new Date(v||"").getTime();
    if(Number.isFinite(t)&&t>bestT){bestT=t;best=v}
  }
  return best||undefined;
}
function exclusionSnapshot(x){
  const changed=(x&&x.candidateExcludedChangedAt)||(x&&x.candidateExcludedAt)||"";
  const value=(x&&x.candidateExcludedChangedAt)?x.candidateExcluded===true:!!(x&&x.candidateExcludedAt);
  const t=new Date(changed||"").getTime();
  return {value,changedAt:changed,time:Number.isFinite(t)?t:0};
}
function isCandidateExcluded(x){return exclusionSnapshot(x).value}
function mergedUsageHistory(a,b){
  const ar=new Date(a&&a.recommendedAt||"").getTime();
  const br=new Date(b&&b.recommendedAt||"").getTime();
  const role=Number.isFinite(br)&&(!Number.isFinite(ar)||br>=ar)?(b&&b.recommendedRole):(a&&a.recommendedRole);
  const ae=exclusionSnapshot(a),be=exclusionSnapshot(b);
  const ex=be.time>=ae.time?be:ae;
  return {
    lastRepostedAt:newestIso(a&&a.lastRepostedAt,b&&b.lastRepostedAt),
    recommendedAt:newestIso(a&&a.recommendedAt,b&&b.recommendedAt),
    recommendedRole:role,
    skippedAt:newestIso(a&&a.skippedAt,b&&b.skippedAt),
    revenueRecommendedAt:newestIso(a&&a.revenueRecommendedAt,b&&b.revenueRecommendedAt),
    candidateExcluded:ex.value,
    candidateExcludedChangedAt:ex.changedAt,
    candidateExcludedAt:ex.value?ex.changedAt:"",
    repostCount:Math.max(Number(a&&a.repostCount)||0,Number(b&&b.repostCount)||0)
  };
}
async function propagateUsageHistory(item){
  const all=await dbGetAll();
  const key=canonicalPostKey(item);
  const matches=all.filter(x=>canonicalPostKey(x)===key);
  let history={...item};
  for(const x of matches)history={...history,...mergedUsageHistory(history,x)};
  const updates=[];
  for(const x of matches){
    const merged={...x,...mergedUsageHistory(x,history)};
    updates.push(merged);
    await dbPut(merged);
  }
  if(updates.length)queueCloudSync(updates,[]);
}
async function reconcileUsageHistory(){
  const all=await dbGetAll();
  const groups=new Map();
  for(const x of all){
    const key=canonicalPostKey(x);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(x);
  }
  const updates=[];
  for(const group of groups.values()){
    if(group.length<2)continue;
    let history={};
    for(const x of group)history={...history,...mergedUsageHistory(history,x)};
    for(const x of group)updates.push({...x,...mergedUsageHistory(x,history)});
  }
  await dbPutMany(updates);
  queueCloudSync(updates,[]);
}

function lastUseTime(x){
  const raw=x.lastRepostedAt||x.postedAt||x.savedAt||"";
  const t=new Date(raw).getTime();
  return Number.isFinite(t)?t:0;
}
function isReadyForReuse(x){
  const t=lastUseTime(x);
  if(!t)return true;
  return (Date.now()-t)>=30*24*60*60*1000;
}
function stableDayJitter(x){
  const key=String(x.postId||x.id||"");
  const day=new Date().toISOString().slice(0,10);
  let h=0,s=day+"-"+key;
  for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
  return (h%1000)/1000;
}
function engagementRate(x,key){return metricRate(x[key],x.impressions)}
function spreadScore(x){
  const imp=metricNumber(x.impressions);
  const repostRate=engagementRate(x,"reposts");
  const saveRate=engagementRate(x,"bookmarks");
  const likeRate=engagementRate(x,"likes");
  const ageDays=Math.min(180,Math.max(0,(Date.now()-lastUseTime(x))/(24*60*60*1000)));
  return Math.log10(imp+1)*32 + Math.min(repostRate,0.2)*500 + Math.min(saveRate,0.2)*260 + Math.min(likeRate,0.3)*90 + ageDays*0.08 + stableDayJitter(x)*2;
}
function clickScore(x){
  const imp=metricNumber(x.impressions);
  const clicks=metricNumber(x.urlClicks);
  const ctr=metricRate(x.urlClicks,x.impressions);
  const ageDays=Math.min(180,Math.max(0,(Date.now()-lastUseTime(x))/(24*60*60*1000)));
  const confidence=imp>=10000?1.12:imp>=3000?1.06:1;
  return (Math.log10(clicks+1)*42 + Math.min(ctr,0.5)*210 + Math.log10(imp+1)*8 + ageDays*0.08)*confidence;
}
function evergreenScore(x){
  const imp=metricNumber(x.impressions);
  const clicks=metricNumber(x.urlClicks);
  const saves=metricNumber(x.bookmarks);
  const reposts=metricNumber(x.reposts);
  const ctr=metricRate(x.urlClicks,x.impressions);
  const saveRate=metricRate(x.bookmarks,x.impressions);
  const repostRate=metricRate(x.reposts,x.impressions);
  const ageDays=Math.min(240,Math.max(0,(Date.now()-lastUseTime(x))/(24*60*60*1000)));
  return Math.log10(imp+1)*20 + Math.log10(clicks+1)*20 + Math.log10(saves+1)*16 + Math.log10(reposts+1)*10 + Math.min(ctr,0.5)*120 + Math.min(saveRate,0.3)*120 + Math.min(repostRate,0.2)*140 + ageDays*0.11;
}
function explosionScore(x){
  const imp=metricNumber(x.impressions);
  if(imp<1000)return -Infinity;
  const ctr=metricRate(x.urlClicks,x.impressions);
  const saveRate=metricRate(x.bookmarks,x.impressions);
  const repostRate=metricRate(x.reposts,x.impressions);
  const likeRate=metricRate(x.likes,x.impressions);
  return Math.log10(imp+1)*30 + Math.min(ctr,0.5)*180 + Math.min(saveRate,0.3)*170 + Math.min(repostRate,0.2)*260 + Math.min(likeRate,0.3)*80;
}
function recommendationScore(x){return evergreenScore(x)}

function postedTime(x){
  const raw=x.postedAt||x.savedAt||"";
  const t=new Date(raw).getTime();
  return Number.isFinite(t)?t:0;
}
function formatPostedMeta(x){
  const t=postedTime(x);
  if(!t)return "";
  const d=new Date(t);
  const days=Math.max(0,Math.floor((Date.now()-t)/(24*60*60*1000)));
  return d.toLocaleDateString("ja-JP")+" ・ "+days+"日前";
}
function isLikelyExpiredNews(x){
  const t=String(x.text||"");
  const hot=/(本日|明日|本日発売|本日開始|発売日|予約開始|販売開始|開催決定|開催期間|期間限定|本日より|今日から|\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2})/;
  if(!hot.test(t))return false;
  const age=(Date.now()-postedTime(x))/(24*60*60*1000);
  return age>21;
}
function safeReuseItem(x){return isReadyForReuse(x)&&!isLikelyExpiredNews(x)}
function lowValueReason(x){
  const raw=String(x.text||"").trim();
  if(!raw)return "本文なし";
  if(/^https?:\/\/\S+$/i.test(raw))return "URLだけ";
  const body=raw
    .replace(/https?:\/\/\S+/gi," ")
    .replace(/www\.\S+/gi," ")
    .replace(/[#＃][^\s]+/g," ")
    .replace(/[@＠][^\s]+/g," ");
  const meaningful=(body.match(/[A-Za-z0-9ぁ-んァ-ヶ一-龠]/g)||[]).length;
  if(meaningful<12)return "本文が短すぎる";
  const compact=body.replace(/\s+/g,"").toLowerCase();
  if(/^(詳細はこちら|こちらから|リンクはこちら|続きはこちら|詳細|check|link)$/.test(compact))return "案内文だけ";
  return "";
}
function isLowValueCandidate(x){return !!lowValueReason(x)}
function isRecommendationEligible(x){
  return safeReuseItem(x)&&!isCandidateExcluded(x)&&!isLowValueCandidate(x);
}
function isAnalyticsEligible(x){
  return metricNumber(x.impressions)>=1000&&!isCandidateExcluded(x)&&!isLowValueCandidate(x)&&!isLikelyExpiredNews(x);
}
async function setCandidateExcluded(item,excluded){
  const all=await dbGetAll();
  const key=canonicalPostKey(item);
  const matches=all.filter(x=>canonicalPostKey(x)===key);
  const now=new Date().toISOString();
  const updates=(matches.length?matches:[item]).map(x=>({
    ...x,
    candidateExcluded:!!excluded,
    candidateExcludedChangedAt:now,
    candidateExcludedAt:excluded?now:""
  }));
  await dbPutMany(updates);
}

function todayMetricChips(x,role){
  const chips=[];
  const imp=metricNumber(x.impressions);
  if(role==="拡散狙い"){
    if(imp)chips.push("表示 "+imp.toLocaleString());
    if(metricNumber(x.reposts))chips.push("リポスト "+metricNumber(x.reposts).toLocaleString());
    if(imp&&metricNumber(x.reposts))chips.push("拡散率 "+percentText(metricRate(x.reposts,x.impressions)));
  }else if(role==="クリック狙い"){
    if(metricNumber(x.urlClicks))chips.push("クリック "+metricNumber(x.urlClicks).toLocaleString());
    if(imp)chips.push("クリック率 "+percentText(metricRate(x.urlClicks,x.impressions)));
  }else{
    if(imp)chips.push("表示 "+imp.toLocaleString());
    if(metricNumber(x.bookmarks))chips.push("保存 "+metricNumber(x.bookmarks).toLocaleString());
    if(metricNumber(x.urlClicks))chips.push("クリック "+metricNumber(x.urlClicks).toLocaleString());
  }
  return chips.map(v=>'<span>'+v+'</span>').join("");
}

function localDayKey(date=new Date()){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+d;
}
function recommendedDay(x){
  if(!x.recommendedAt)return "";
  const d=new Date(x.recommendedAt);
  return Number.isFinite(d.getTime())?localDayKey(d):"";
}
function revenueRecommendedDay(x){
  if(!x.revenueRecommendedAt)return "";
  const d=new Date(x.revenueRecommendedAt);
  return Number.isFinite(d.getTime())?localDayKey(d):"";
}
function canRevenueRecommend(x){
  if(!x.revenueRecommendedAt)return true;
  const t=new Date(x.revenueRecommendedAt).getTime();
  if(!Number.isFinite(t))return true;
  if(revenueRecommendedDay(x)===localDayKey())return true;
  return (Date.now()-t)>=7*24*60*60*1000;
}
function canRecommendToday(x){
  if(x.skippedAt){
    const st=new Date(x.skippedAt).getTime();
    if(Number.isFinite(st) && (Date.now()-st)<7*24*60*60*1000)return false;
  }
  return true;
}

function showUndoToast(records){
  if(undoState&&undoState.timer)clearTimeout(undoState.timer);
  undoState={records:records.map(x=>({...x})),timer:null};
  const toast=$("undoToast");
  if(!toast)return;
  toast.classList.remove("hidden");
  undoState.timer=setTimeout(()=>{
    toast.classList.add("hidden");
    undoState=null;
  },5000);
}
async function applyReposted(item){
  const all=await dbGetAll();
  const key=canonicalPostKey(item);
  const matches=all.filter(x=>canonicalPostKey(x)===key);
  const records=matches.length?matches:[item];
  const base=Math.max(...records.map(x=>Number(x.repostCount)||0),0)+1;
  const now=new Date().toISOString();
  const updated=records.map(x=>({...x,lastRepostedAt:now,repostCount:base}));
  await dbPutMany(updated);
  queueCloudSync(updated,[]);
  showUndoToast(records);
}
async function undoLastRepost(){
  if(!undoState)return;
  const records=undoState.records;
  if(undoState.timer)clearTimeout(undoState.timer);
  undoState=null;
  $("undoToast")?.classList.add("hidden");
  await dbPutMany(records);
  queueCloudSync(records,[]);
  await renderToday();
  await renderRevenuePick();
  await renderRecentUsed();
  await renderArchive();
}

function recommendationReasons(x){
  const reasons=[];
  const age=Math.max(0,Math.floor((Date.now()-lastUseTime(x))/(24*60*60*1000)));
  const impressions=metricNumber(x.impressions);
  const clickRate=metricRate(x.urlClicks,x.impressions);
  const saveRate=metricRate(x.bookmarks,x.impressions);
  const repostRate=metricRate(x.reposts,x.impressions);
  if(impressions>=100000)reasons.push("表示10万+");
  else if(impressions>=30000)reasons.push("表示3万+");
  if(repostRate>=0.01)reasons.push("拡散率 "+percentText(repostRate));
  if(clickRate>=0.01)reasons.push("クリック率 "+percentText(clickRate));
  else if(metricNumber(x.urlClicks)>=50)reasons.push("クリック "+metricNumber(x.urlClicks));
  if(saveRate>=0.005)reasons.push("保存率 "+percentText(saveRate));
  if(age>=60)reasons.push(age+"日空き");
  else if(age>=30)reasons.push("30日以上空き");
  return reasons.slice(0,2);
}

function metricNumber(v){
  const s=String(v??"").trim().replace(/,/g,"");
  if(!s)return 0;
  const m=s.match(/^([\d.]+)\s*万$/);
  if(m)return Math.round(Number(m[1])*10000);
  const n=Number(s.replace(/[^\d.-]/g,""));
  return Number.isFinite(n)?n:0;
}

function metricRate(numerator,denominator){
  const d=metricNumber(denominator);
  if(!d)return 0;
  return metricNumber(numerator)/d;
}
function percentText(v){
  return (v*100).toFixed(v>=0.1?1:2)+"%";
}
function freshnessInfo(items){
  const dates=items.map(postedTime).filter(Boolean);
  const latest=dates.length?Math.max(...dates):0;
  if(!latest)return {label:"分析データ日付なし",age:null,latest:0};
  const age=Math.max(0,Math.floor((Date.now()-latest)/(24*60*60*1000)));
  return {label:new Date(latest).toLocaleDateString("ja-JP")+"まで",age,latest};
}
async function renderDataFreshness(){
  const root=$("dataFreshness");
  if(!root)return;
  const items=await dbGetAll();
  const f=freshnessInfo(items);
  const lastImport=localStorage.getItem(LAST_ANALYTICS_IMPORT_KEY);
  let importChip="";
  if(lastImport){
    const d=new Date(lastImport);
    if(Number.isFinite(d.getTime()))importChip='<span>CSV読込：'+esc(d.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))+'</span>';
  }
  let cloudChip="";
  if(cloudConfigured()){
    const pending=cloudPendingCount();
    const last=localStorage.getItem(LAST_CLOUD_SYNC_KEY);
    if(pending)cloudChip='<strong>☁ 未同期 '+pending+'件</strong>';
    else if(last){
      const d=new Date(last);
      cloudChip='<span>☁ 同期済 '+esc(d.toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}))+'</span>';
    }else cloudChip='<span>☁ 同期設定済</span>';
  }
  root.innerHTML='<span>登録 '+items.length.toLocaleString()+'件</span><span>最新投稿：'+esc(f.label)+'</span>'+importChip+cloudChip+
    (f.age!==null&&f.age>=14?'<strong>⚠ 最新投稿 '+f.age+'日前</strong>':'');
}

function buildSearchIndex(items){
  if(typeof FlexSearch==="undefined")return;
  const signature=items.length+"|"+items.map(x=>x.id+":"+(x.updatedAt||x.savedAt||"")).join("|");
  if(searchIndex && signature===searchIndexSignature)return;
  searchIndex=new FlexSearch.Index({tokenize:"full",cache:100});
  items.forEach(x=>{
    const body=[x.title,x.text,x.memo,x.amazon,x.rakuten].filter(Boolean).join(" ");
    searchIndex.add(String(x.id),body);
  });
  searchIndexSignature=signature;
}
function searchIds(items,q){
  if(!q)return null;
  buildSearchIndex(items);
  if(searchIndex){
    try{return new Set(searchIndex.search(q,{limit:items.length}).map(String))}catch(e){}
  }
  return null;
}
function destroyChart(name){
  if(analyticsCharts[name]){
    analyticsCharts[name].destroy();
    analyticsCharts[name]=null;
  }
}
function shortLabel(x){
  return String(x.title||x.text||"投稿").replace(/\s+/g," ").slice(0,18);
}
async function pinCandidateForToday(item){
  if(!isRecommendationEligible(item)){
    alert("この投稿は30日未満・古い可能性あり・自動除外などの理由で、今日の候補には追加できません。");
    return false;
  }
  const all=await dbGetAll();
  const today=localDayKey();
  const usedRoles=new Set(all.filter(x=>recommendedDay(x)===today&&isRecommendationEligible(x)).map(x=>x.recommendedRole).filter(Boolean));
  const role=TODAY_ROLES.find(r=>!usedRoles.has(r));
  if(!role){
    alert("今日の3枠はすでに埋まっています。先に1件を見送るか再投稿済みにしてください。");
    return false;
  }
  const current=all.find(x=>x.id===item.id)||item;
  const updated={...current,recommendedAt:new Date().toISOString(),recommendedRole:role,skippedAt:""};
  await dbPut(updated);
  queueCloudSync([updated],[]);
  return true;
}
function rankingRows(items,metric){
  return items.map((x,i)=>{
    const rate=metric==="click"?metricRate(x.urlClicks,x.impressions):metricRate(x.bookmarks,x.impressions);
    const value=metric==="click"?metricNumber(x.urlClicks):metricNumber(x.bookmarks);
    return '<div class="ranking-row">'+
      '<div class="ranking-rank">'+(i+1)+'</div>'+
      '<div class="ranking-main">'+
        '<strong>'+esc(shortLabel(x))+'</strong>'+
        '<span>表示 '+metricNumber(x.impressions).toLocaleString()+' ・ '+(metric==="click"?"クリック ":"保存 ")+value.toLocaleString()+'</span>'+
        '<div class="ranking-actions">'+
          (x.xUrl?'<a href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">X</a>':'')+
          '<button data-analytics-action="copy" data-id="'+x.id+'">コピー</button>'+
          '<button data-analytics-action="pin" data-id="'+x.id+'">今日の候補にする</button>'+
          '<button data-analytics-action="exclude" data-id="'+x.id+'">候補にしない</button>'+
        '</div>'+
      '</div>'+
      '<div class="ranking-rate">'+percentText(rate)+'</div>'+
    '</div>';
  }).join("");
}

function loadCloudSettings(){
  const saved=localStorage.getItem(CLOUD_API_URL_KEY)||"";
  const oldApi=/\/api(?:2530|2540|2550|2560)?\.php(?:$|\?)/.test(saved);
  const url=oldApi?DEFAULT_CLOUD_API_URL:(saved||DEFAULT_CLOUD_API_URL);
  if(oldApi)localStorage.setItem(CLOUD_API_URL_KEY,DEFAULT_CLOUD_API_URL);
  const key=localStorage.getItem(CLOUD_SYNC_KEY_KEY)||"";
  const urlEl=$("cloudApiUrl"),keyEl=$("cloudSyncKey");
  if(urlEl&&!urlEl.value)urlEl.value=url;
  if(keyEl&&!keyEl.value)keyEl.value=key;
}
function saveCloudSettings(){
  const url=clean($("cloudApiUrl")?.value);
  const key=clean($("cloudSyncKey")?.value);
  if(url)localStorage.setItem(CLOUD_API_URL_KEY,url); else localStorage.removeItem(CLOUD_API_URL_KEY);
  if(key)localStorage.setItem(CLOUD_SYNC_KEY_KEY,key); else localStorage.removeItem(CLOUD_SYNC_KEY_KEY);
  renderCloudStatus("設定をこの端末に保存しました");
}
function renderCloudStatus(message,isError=false){
  const root=$("cloudSyncStatus");
  if(!root)return;
  if(message){
    root.textContent=message;
    root.classList.toggle("error",!!isError);
    return;
  }
  const last=localStorage.getItem(LAST_CLOUD_SYNC_KEY);
  root.classList.remove("error");
  root.textContent=last?"最終同期："+new Date(last).toLocaleString("ja-JP"):"まだ同期していません";
}
function cloudSettings(){
  return {
    url:(()=>{
      const typed=clean($("cloudApiUrl")?.value);
      const saved=localStorage.getItem(CLOUD_API_URL_KEY)||"";
      const v=typed||saved||DEFAULT_CLOUD_API_URL;
      return /\/api(?:2530|2540|2550|2560)?\.php(?:$|\?)/.test(v)?DEFAULT_CLOUD_API_URL:v;
    })(),
    key:clean($("cloudSyncKey")?.value)||localStorage.getItem(CLOUD_SYNC_KEY_KEY)||""
  };
}
async function cloudRequest(action,options={}){
  const {url,key}=cloudSettings();
  if(!url||!key)throw new Error("API URLと同期キーを入力してください");
  const target=new URL(url);
  target.searchParams.set("action",action);
  const headers={...(options.headers||{}),"Authorization":"Bearer "+key};
  const res=await fetch(target.toString(),{...options,headers,cache:"no-store"});
  const text=await res.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch(e){throw new Error("サーバー応答をJSONとして読めません")}
  if(!res.ok||data.ok===false){
    const diag=[
      data.error||("HTTP "+res.status),
      data.apiVersion?("API "+data.apiVersion):"",
      data.contentType?("type "+data.contentType):"",
      data.rawLength!==undefined?("raw "+data.rawLength):"",
      data.hasFormPayload!==undefined?("form "+String(data.hasFormPayload)):"",
      data.hasUpload!==undefined?("file "+String(data.hasUpload)):"",
      data.postPayloadLength!==undefined?("postLen "+data.postPayloadLength):"",
      data.b64Length!==undefined?("b64Len "+data.b64Length):"",
      data.jsonError?("json "+data.jsonError):""
    ].filter(Boolean).join(" / ");
    throw new Error(diag);
  }
  return data;
}
function sanitizeUnicodeString(str){
  return String(str).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,"�");
}
function sanitizeForCloud(value){
  if(typeof value==="string")return sanitizeUnicodeString(value);
  if(Array.isArray(value))return value.map(sanitizeForCloud);
  if(value&&typeof value==="object"){
    const out={};
    for(const [k,v] of Object.entries(value))out[k]=sanitizeForCloud(v);
    return out;
  }
  return value;
}
function cloudSafeItem(x){
  const copy=sanitizeForCloud({...x});
  delete copy.images;
  delete copy.image;
  return copy;
}
function itemFreshnessTime(x){
  const fields=["updatedAt","lastRepostedAt","candidateExcludedChangedAt","skippedAt","revenueRecommendedAt","recommendedAt","savedAt","postedAt","deletedAt"];
  let best=0;
  for(const key of fields){
    const t=new Date(x&&x[key]||"").getTime();
    if(Number.isFinite(t)&&t>best)best=t;
  }
  return best;
}
function cloudConfigured(){
  return !!clean(localStorage.getItem(CLOUD_SYNC_KEY_KEY)||"");
}
function cloudPendingCount(){
  return cloudDirtyIds.size+cloudDeletedIds.size;
}
function markCloudStatusChip(){
  renderDataFreshness().catch(()=>{});
}
function queueCloudSync(items=[],deletedIds=[]){
  if(cloudApplyingRemote||!cloudConfigured())return;
  for(const item of items){
    if(item&&item.id){
      cloudDeletedIds.delete(String(item.id));
      cloudDirtyIds.add(String(item.id));
    }
  }
  for(const id of deletedIds){
    if(id){
      cloudDirtyIds.delete(String(id));
      cloudDeletedIds.add(String(id));
    }
  }
  if(!cloudPendingCount())return;
  renderCloudStatus("未同期 "+cloudPendingCount()+"件（まもなく自動保存）");
  markCloudStatusChip();
  if(cloudSyncTimer)clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>flushCloudChanges(),2500);
}
async function sendCloudItems(items,{progress=false}={}){
  const safe=items.map(cloudSafeItem);
  const chunkSize=10;
  for(let i=0;i<safe.length;i+=chunkSize){
    const chunk=safe.slice(i,i+chunkSize);
    const form=new FormData();
    const payload=JSON.stringify({items:chunk});
    form.append("payload_b64",utf8ToBase64(payload));
    await cloudRequest("push",{method:"POST",body:form});
    if(progress)renderCloudStatus("保存中… "+Math.min(i+chunk.length,safe.length)+" / "+safe.length+"件");
  }
}
async function sendCloudDeletes(ids){
  if(!ids.length)return;
  const chunkSize=50;
  for(let i=0;i<ids.length;i+=chunkSize){
    const chunk=ids.slice(i,i+chunkSize);
    const form=new FormData();
    const payload=JSON.stringify({ids:chunk,deletedAt:new Date().toISOString()});
    form.append("payload_b64",utf8ToBase64(payload));
    await cloudRequest("delete",{method:"POST",body:form});
  }
}
async function flushCloudChanges(){
  if(!cloudConfigured()||cloudApplyingRemote)return;
  if(cloudSyncBusy){
    if(cloudSyncTimer)clearTimeout(cloudSyncTimer);
    cloudSyncTimer=setTimeout(()=>flushCloudChanges(),1800);
    return;
  }
  const dirty=[...cloudDirtyIds];
  const deleted=[...cloudDeletedIds];
  if(!dirty.length&&!deleted.length)return;
  dirty.forEach(id=>cloudDirtyIds.delete(id));
  deleted.forEach(id=>cloudDeletedIds.delete(id));
  cloudSyncBusy=true;
  renderCloudStatus("自動同期中…");
  try{
    if(deleted.length)await sendCloudDeletes(deleted);
    if(dirty.length){
      const all=await dbGetAll();
      const wanted=new Set(dirty);
      const items=all.filter(x=>wanted.has(String(x.id)));
      if(items.length)await sendCloudItems(items);
    }
    const now=new Date().toISOString();
    localStorage.setItem(LAST_CLOUD_SYNC_KEY,now);
    renderCloudStatus("自動同期済み："+new Date(now).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}));
  }catch(e){
    dirty.forEach(id=>cloudDirtyIds.add(id));
    deleted.forEach(id=>cloudDeletedIds.add(id));
    renderCloudStatus("自動同期失敗："+e.message,true);
  }finally{
    cloudSyncBusy=false;
    markCloudStatusChip();
    if(cloudPendingCount()){
      if(cloudSyncTimer)clearTimeout(cloudSyncTimer);
      cloudSyncTimer=setTimeout(()=>flushCloudChanges(),5000);
    }
  }
}
async function cloudPing(){
  renderCloudStatus("接続確認中…");
  try{
    const data=await cloudRequest("ping");
    saveCloudSettings();
    renderCloudStatus("接続OK"+(data.apiVersion?" ・ API "+data.apiVersion:"")+(data.serverTime?" ・ "+data.serverTime:""));
  }catch(e){renderCloudStatus("接続失敗："+e.message,true)}
}
function utf8ToBase64(str){
  const bytes=new TextEncoder().encode(str);
  let binary="";
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step){
    binary+=String.fromCharCode(...bytes.subarray(i,i+step));
  }
  return btoa(binary);
}
async function cloudPushAll(){
  renderCloudStatus("クラウドへ保存中…");
  try{
    const items=await dbGetAll();
    await sendCloudItems(items,{progress:true});
    cloudDirtyIds.clear();
    cloudDeletedIds.clear();
    const now=new Date().toISOString();
    localStorage.setItem(LAST_CLOUD_SYNC_KEY,now);
    renderCloudStatus("クラウド保存完了："+items.length+"件");
    markCloudStatusChip();
  }catch(e){renderCloudStatus("保存失敗："+e.message,true)}
}
async function cloudPullMerge(options={}){
  const silent=!!options.silent;
  const refresh=options.refresh!==false;
  if(!cloudConfigured())return {ok:false,count:0};
  if(!silent)renderCloudStatus("クラウドから読込中…");
  cloudApplyingRemote=true;
  const pushBack=[];
  try{
    const data=await cloudRequest("pull");
    const remote=Array.isArray(data.items)?data.items:[];
    const local=await dbGetAll();
    const byId=new Map(local.map(x=>[String(x.id),x]));
    const byKey=new Map(local.map(x=>[canonicalPostKey(x),x]));
    const pending=[];
    const deletes=[];
    for(const incomingRaw of remote){
      const incoming={...incomingRaw};
      const current=byId.get(String(incoming.id))||byKey.get(canonicalPostKey(incoming));
      if(incoming._deleted){
        const deletedT=itemFreshnessTime(incoming);
        const localT=itemFreshnessTime(current);
        if(!current||deletedT>=localT){
          if(incoming.id)deletes.push(String(incoming.id));
        }else if(current){
          pushBack.push(current);
        }
        continue;
      }
      let merged;
      if(current){
        const newer=itemFreshnessTime(incoming)>itemFreshnessTime(current)?incoming:current;
        const older=newer===incoming?current:incoming;
        merged={...older,...newer,...mergedUsageHistory(current,incoming)};
        merged.images=current.images||(current.image?[current.image]:[]);
      }else{
        merged={...incoming,images:[]};
      }
      pending.push(merged);
      byId.set(String(merged.id),merged);
      byKey.set(canonicalPostKey(merged),merged);
    }
    await dbPutMany(pending);
    await dbDeleteMany(deletes);
    await reconcileUsageHistory();
    searchIndex=null;searchIndexSignature="";
    const now=new Date().toISOString();
    localStorage.setItem(LAST_CLOUD_SYNC_KEY,now);
    if(refresh){
      await renderToday();
      await renderRevenuePick();
      await renderRecentUsed();
      await renderTodayProgress();
      await renderDataFreshness();
      await renderDataHealth();
      await renderAnalytics();
      await renderArchive();
    }
    if(!silent)renderCloudStatus("統合完了："+remote.filter(x=>!x._deleted).length+"件"+(deletes.length?" / 削除反映 "+deletes.length+"件":""));
    return {ok:true,count:remote.length,deletes};
  }catch(e){
    if(!silent)renderCloudStatus("読込失敗："+e.message,true);
    else console.error("auto cloud pull",e);
    return {ok:false,count:0,error:e};
  }finally{
    cloudApplyingRemote=false;
    if(pushBack.length)queueCloudSync(pushBack,[]);
    markCloudStatusChip();
  }
}

function backupAgeDays(){
  const raw=localStorage.getItem(LAST_BACKUP_EXPORT_KEY);
  const t=new Date(raw||"").getTime();
  return Number.isFinite(t)?Math.floor((Date.now()-t)/(24*60*60*1000)):null;
}
function renderBackupStatus(){
  const root=$("backupStatus");
  if(!root)return;
  const raw=localStorage.getItem(LAST_BACKUP_EXPORT_KEY);
  const age=backupAgeDays();
  if(!raw||age===null){
    root.innerHTML='<strong>まだバックアップ記録がありません</strong>';
    return;
  }
  const d=new Date(raw);
  root.innerHTML='最終バックアップ：'+esc(d.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))+
    (age>=10?' <strong>⚠ '+age+'日経過</strong>':'');
}
function newestItemValue(group,key){
  return [...group]
    .sort((a,b)=>new Date(b.updatedAt||b.savedAt||b.postedAt||0)-new Date(a.updatedAt||a.savedAt||a.postedAt||0))
    .map(x=>x[key]).find(v=>v!==undefined&&v!==null&&String(v)!=="");
}
function mergeDuplicateGroup(group){
  const preferred=[...group].sort((a,b)=>{
    const aScore=(a.images?.length||0)*10+(a.updatedAt?5:0)+(clean(a.amazon)?3:0)+(clean(a.rakuten)?3:0)+(clean(a.xUrl)?2:0);
    const bScore=(b.images?.length||0)*10+(b.updatedAt?5:0)+(clean(b.amazon)?3:0)+(clean(b.rakuten)?3:0)+(clean(b.xUrl)?2:0);
    return bScore-aScore;
  })[0];
  let history={};
  for(const x of group)history={...history,...mergedUsageHistory(history,x)};
  const metricMax=key=>String(Math.max(...group.map(x=>metricNumber(x[key]))));
  return {
    ...preferred,
    ...history,
    title:newestItemValue(group,"title")||preferred.title||"",
    text:newestItemValue(group,"text")||preferred.text||"",
    xUrl:newestItemValue(group,"xUrl")||preferred.xUrl||"",
    amazon:newestItemValue(group,"amazon")||preferred.amazon||"",
    rakuten:newestItemValue(group,"rakuten")||preferred.rakuten||"",
    memo:newestItemValue(group,"memo")||preferred.memo||"",
    images:group.reduce((best,x)=>{
      const imgs=x.images||(x.image?[x.image]:[]);
      return imgs.length>best.length?imgs:best;
    },[]),
    impressions:metricMax("impressions"),
    likes:metricMax("likes"),
    bookmarks:metricMax("bookmarks"),
    urlClicks:metricMax("urlClicks"),
    reposts:metricMax("reposts"),
    replies:metricMax("replies"),
    follows:metricMax("follows"),
    postedAt:newestIso(...group.map(x=>x.postedAt))||preferred.postedAt,
    savedAt:newestIso(...group.map(x=>x.savedAt))||preferred.savedAt
  };
}
async function mergeAllDuplicates(){
  const all=await dbGetAll();
  const groups=new Map();
  for(const x of all){
    const key=canonicalPostKey(x);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(x);
  }
  const dupGroups=[...groups.values()].filter(g=>g.length>1);
  if(!dupGroups.length){alert("重複データはありません。");return}
  if(!confirm(dupGroups.length+"組の重複投稿を1件ずつに統合します。再投稿履歴・除外状態・画像・指標はできるだけ保持します。よろしいですか？"))return;
  const puts=[],deletes=[];
  for(const group of dupGroups){
    const merged=mergeDuplicateGroup(group);
    puts.push(merged);
    group.filter(x=>x.id!==merged.id).forEach(x=>deletes.push(x.id));
  }
  await dbPutMany(puts);
  await dbDeleteMany(deletes);
  queueCloudSync(puts,deletes);
  searchIndex=null;searchIndexSignature="";
  await renderArchive();
  await renderToday();
  await renderRevenuePick();
  await renderRecentUsed();
  await renderAnalytics();
  await renderDataHealth();
  alert(dupGroups.length+"組の重複投稿を統合しました。");
}
async function renderDataHealth(){
  const root=$("dataHealth");
  if(!root)return;
  const items=await dbGetAll();
  const counts=new Map();
  items.forEach(x=>counts.set(canonicalPostKey(x),(counts.get(canonicalPostKey(x))||0)+1));
  const duplicateItems=items.filter(x=>(counts.get(canonicalPostKey(x))||0)>1).length;
  const mergeBtn=$("mergeDuplicates");
  if(mergeBtn)mergeBtn.classList.toggle("hidden",duplicateItems===0);
  const values=[
    ["duplicate","重複",duplicateItems],
    ["missingx","Xリンクなし",items.filter(x=>!clean(x.xUrl)).length],
    ["autoexcluded","自動除外",items.filter(isLowValueCandidate).length],
    ["stale","古い可能性",items.filter(isLikelyExpiredNews).length],
    ["excluded","候補から除外",items.filter(isCandidateExcluded).length]
  ];
  root.innerHTML=values.map(([filter,label,count])=>
    '<button type="button" class="health-item" data-health-filter="'+filter+'"><span>'+label+'</span><strong>'+count.toLocaleString()+'</strong></button>'
  ).join("");
}
const POST_PATTERNS=[
  ["新作",/新作|NEW|new item/i],
  ["再販・再入荷",/再販|再入荷|再登場|restock/i],
  ["限定",/限定|数量限定|期間限定/],
  ["予約",/予約|受注|予約受付/],
  ["発売・販売開始",/発売|販売開始|登場|本日より/],
  ["価格訴求",/[¥￥]\s?[\d,]+|\d[\d,]*円/],
  ["Amazon",/Amazon|アマゾン/i],
  ["楽天",/楽天|Rakuten/i],
  ["まとめ・一覧",/まとめ|一覧|全種|ラインナップ|種類/],
  ["かわいい訴求",/かわいい|可愛い|かわいすぎ|大人かわいい/]
];
function patternStats(items){
  return POST_PATTERNS.map(([label,re])=>{
    const rows=items.filter(x=>re.test(String(x.title||"")+" "+String(x.text||""))&&metricNumber(x.impressions)>=1000);
    if(rows.length<2)return null;
    const totalImp=rows.reduce((s,x)=>s+metricNumber(x.impressions),0);
    const totalClicks=rows.reduce((s,x)=>s+metricNumber(x.urlClicks),0);
    const totalSaves=rows.reduce((s,x)=>s+metricNumber(x.bookmarks),0);
    const totalReposts=rows.reduce((s,x)=>s+metricNumber(x.reposts),0);
    const avgImp=totalImp/rows.length;
    const ctr=totalImp?totalClicks/totalImp:0;
    const saveRate=totalImp?totalSaves/totalImp:0;
    const repostRate=totalImp?totalReposts/totalImp:0;
    const score=Math.log10(avgImp+1)*22+Math.min(ctr,.5)*160+Math.min(saveRate,.3)*100+Math.min(repostRate,.2)*220;
    return {label,count:rows.length,avgImp,ctr,saveRate,repostRate,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
}
function renderPatternAnalysis(items){
  const root=$("patternAnalysis");
  if(!root)return;
  const rows=patternStats(items).slice(0,8);
  if(!rows.length){
    root.innerHTML='<div class="empty compact-empty">比較できる投稿がまだ足りません。</div>';
    return;
  }
  root.innerHTML=rows.map((x,i)=>
    '<div class="pattern-row">'+
      '<div class="pattern-rank">'+(i+1)+'</div>'+
      '<div class="pattern-main"><strong>'+esc(x.label)+'</strong><span>'+x.count+'投稿 ・ 平均表示 '+Math.round(x.avgImp).toLocaleString()+'</span></div>'+
      '<div class="pattern-metrics"><b>CTR '+percentText(x.ctr)+'</b><span>拡散 '+percentText(x.repostRate)+' / 保存 '+percentText(x.saveRate)+'</span></div>'+
    '</div>'
  ).join("");
}

async function renderAnalytics(){
  const summary=$("analyticsSummary");
  if(!summary)return;
  const items=await dbGetAll();
  const total=items.length;
  const totalImp=items.reduce((s,x)=>s+metricNumber(x.impressions),0);
  const totalSaves=items.reduce((s,x)=>s+metricNumber(x.bookmarks),0);
  const totalClicks=items.reduce((s,x)=>s+metricNumber(x.urlClicks),0);
  const overallSaveRate=totalImp?totalSaves/totalImp:0;
  const overallClickRate=totalImp?totalClicks/totalImp:0;
  summary.innerHTML=[
    ["投稿",total.toLocaleString()],
    ["表示",totalImp.toLocaleString()],
    ["保存率",percentText(overallSaveRate)],
    ["クリック率",percentText(overallClickRate)],
    ["クリック",totalClicks.toLocaleString()]
  ].map(([k,v])=>'<div class="analytics-stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join("");

  const panel=document.querySelector(".analytics-dashboard");
  if(!panel||!panel.open)return;

  const eligible=items.filter(isAnalyticsEligible);
  const topClick=[...eligible]
    .sort((a,b)=>metricRate(b.urlClicks,b.impressions)-metricRate(a.urlClicks,a.impressions))
    .slice(0,5);
  const topSave=[...eligible]
    .sort((a,b)=>metricRate(b.bookmarks,b.impressions)-metricRate(a.bookmarks,a.impressions))
    .slice(0,5);

  const clickRoot=$("clickRateRanking");
  const saveRoot=$("saveRateRanking");
  if(clickRoot)clickRoot.innerHTML=topClick.length?rankingRows(topClick,"click"):'<div class="empty compact-empty">対象データがありません。</div>';
  if(saveRoot)saveRoot.innerHTML=topSave.length?rankingRows(topSave,"save"):'<div class="empty compact-empty">対象データがありません。</div>';
  renderPatternAnalysis(items);

  if(typeof Chart==="undefined")return;
  destroyChart("character");

  const chars=[
    ["キティ",/ハローキティ|キティ/],
    ["クロミ",/クロミ/],
    ["マイメロ",/マイメロ/],
    ["シナモン",/シナモン|シナモロール/],
    ["プリン",/ポムポムプリン/],
    ["ポチャッコ",/ポチャッコ/]
  ];
  const charData=chars.map(([name,re])=>{
    const rows=items.filter(x=>re.test(String(x.title||"")+" "+String(x.text||""))&&isAnalyticsEligible(x));
    const avg=rows.length?rows.reduce((s,x)=>s+metricRate(x.urlClicks,x.impressions),0)/rows.length:0;
    return {name,avg,count:rows.length};
  });
  const charEl=$("characterChart");
  if(charEl)analyticsCharts.character=new Chart(charEl,{
    type:"bar",
    data:{labels:charData.map(x=>x.name+" ("+x.count+")"),datasets:[{label:"平均クリック率 %",data:charData.map(x=>Number((x.avg*100).toFixed(2)))}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}
  });
}

function csvTitle(text){
  const first=String(text||"").replace(/\s+/g," ").trim();
  return first ? first.slice(0,42) : "X投稿";
}

function parseCSV(text){
  text=String(text||"").replace(/^\uFEFF/,"");
  const rows=[]; let row=[], field="", quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){field+='"';i++}
      else if(ch==='"'){quoted=false}
      else field+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===','){row.push(field);field=""}
      else if(ch==='\n'){row.push(field);rows.push(row);row=[];field=""}
      else if(ch!=='\r')field+=ch;
    }
  }
  if(field.length||row.length){row.push(field);rows.push(row)}
  if(!rows.length)return [];
  const headers=rows.shift().map(x=>x.trim());
  return rows.filter(r=>r.some(v=>String(v||"").trim())).map(r=>{
    const obj={}; headers.forEach((h,i)=>obj[h]=r[i]??""); return obj;
  });
}

function parseXAnalyticsDate(v){
  const t=Date.parse(String(v||""));
  return Number.isFinite(t)?new Date(t).toISOString():new Date().toISOString();
}

async function importAnalyticsCSV(file){
  const raw=await file.text();
  const rows=parseCSV(raw);
  const required=["ポストID","日付","ポスト本文","ポストのリンク","インプレッション数","いいね","ブックマーク"];
  if(!rows.length || !required.every(k=>Object.prototype.hasOwnProperty.call(rows[0],k))){
    throw new Error("このCSVはXのポスト別アナリティクス形式ではありません");
  }
  let added=0,updated=0;
  const existing=await dbGetAll();
  const byId=new Map(existing.map(x=>[x.id,x]));
  const byPostKey=new Map(existing.map(x=>[canonicalPostKey(x),x]));
  const pending=[];
  for(const r of rows){
    const postId=clean(r["ポストID"]);
    if(!postId)continue;
    const id="xanalytics-"+postId;
    const prev=byId.get(id)||byPostKey.get("post:"+postId);
    const item={
      ...(prev||{}),
      id,
      source:"x-analytics",
      postId,
      title:(prev&&prev.title)||csvTitle(r["ポスト本文"]),
      text:r["ポスト本文"]||"",
      xUrl:r["ポストのリンク"]||"",
      images:(prev&&prev.images)||[],
      amazon:(prev&&prev.amazon)||"",
      rakuten:(prev&&prev.rakuten)||"",
      impressions:String(r["インプレッション数"]||""),
      likes:String(r["いいね"]||""),
      bookmarks:String(r["ブックマーク"]||""),
      reposts:String(r["リポスト"]||""),
      replies:String(r["返信"]||""),
      urlClicks:String(r["URLのクリック数"]||""),
      follows:String(r["新しいフォロー"]||""),
      memo:(prev&&prev.memo)||"",
      postedAt:parseXAnalyticsDate(r["日付"]),
      savedAt:(prev&&prev.savedAt)||parseXAnalyticsDate(r["日付"]),
      repostCount:(prev&&prev.repostCount)||0,
      lastRepostedAt:prev&&prev.lastRepostedAt,
      recommendedAt:prev&&prev.recommendedAt,
      skippedAt:prev&&prev.skippedAt,
      revenueRecommendedAt:prev&&prev.revenueRecommendedAt
    };
    pending.push(item);
    if(prev)updated++; else added++;
    byId.set(id,item);
    byPostKey.set("post:"+postId,item);
  }
  await dbPutMany(pending);
  return {added,updated,total:added+updated,items:pending};
}

async function getReadyItems(){
  const all=await dbGetAll();
  return all
    .filter(x=>isRecommendationEligible(x)&&canRecommendToday(x))
    .sort((a,b)=>{
      const at=recommendedDay(a)===localDayKey()?1:0;
      const bt=recommendedDay(b)===localDayKey()?1:0;
      if(at!==bt)return bt-at;
      return recommendationScore(b)-recommendationScore(a);
    });
}
async function getRoleBasedPicks(){
  const pool=await getReadyItems();
  if(!pool.length)return [];
  const today=localDayKey();
  const picked=[];
  const used=new Set();

  const keep=(x,role)=>{
    if(!x||used.has(x.id))return;
    picked.push({...x,_role:role});
    used.add(x.id);
  };

  const sameDay=pool.filter(x=>recommendedDay(x)===today);
  for(const role of TODAY_ROLES){
    const existing=sameDay.find(x=>x.recommendedRole===role&&!used.has(x.id));
    keep(existing,role);
  }

  const remaining=()=>pool.filter(x=>!used.has(x.id));
  for(const role of TODAY_ROLES){
    if(picked.some(x=>x._role===role))continue;
    const candidates=remaining();
    let choice=null;
    if(role==="拡散狙い"){
      choice=[...candidates].filter(x=>metricNumber(x.impressions)>=1000).sort((a,b)=>spreadScore(b)-spreadScore(a))[0]||null;
    }else if(role==="クリック狙い"){
      choice=[...candidates].filter(x=>metricNumber(x.impressions)>=1000&&metricNumber(x.urlClicks)>0).sort((a,b)=>clickScore(b)-clickScore(a))[0]||null;
    }else{
      choice=[...candidates].filter(x=>metricNumber(x.impressions)>=1000).sort((a,b)=>evergreenScore(b)-evergreenScore(a))[0]||null;
    }
    if(!choice)choice=[...candidates].sort((a,b)=>evergreenScore(b)-evergreenScore(a))[0]||null;
    keep(choice,role);
  }
  return TODAY_ROLES.map(role=>picked.find(x=>x._role===role)).filter(Boolean);
}

async function stampRecommendations(items){
  const today=localDayKey();
  const updates=[];
  for(const item of items){
    if(recommendedDay(item)===today&&item.recommendedRole===item._role)continue;
    updates.push({...item,recommendedAt:new Date().toISOString(),recommendedRole:item._role||item.recommendedRole||"鉄板再利用"});
  }
  await dbPutMany(updates);
  if(updates.length)queueCloudSync(updates,[]);
}

function revenueScore(x){return explosionScore(x)}
async function getRevenuePick(){
  const all=await dbGetAll();
  const today=localDayKey();
  const todayKeys=new Set(all.filter(x=>recommendedDay(x)===today).map(canonicalPostKey));
  return all
    .filter(x=>isRecommendationEligible(x)&&metricNumber(x.impressions)>=1000&&!todayKeys.has(canonicalPostKey(x))&&canRevenueRecommend(x))
    .sort((a,b)=>{
      const at=revenueRecommendedDay(a)===today?1:0;
      const bt=revenueRecommendedDay(b)===today?1:0;
      if(at!==bt)return bt-at;
      return explosionScore(b)-explosionScore(a);
    })[0]||null;
}

function itemLinkButtons(x){
  const amazon=normalizedUrl(x.amazon);
  const rakuten=normalizedUrl(x.rakuten);
  return [
    amazon?'<a class="small-btn link-btn" href="'+esc(amazon)+'" target="_blank" rel="noopener">Amazon</a>':"",
    rakuten?'<a class="small-btn link-btn" href="'+esc(rakuten)+'" target="_blank" rel="noopener">楽天</a>':""
  ].join("");
}

async function renderTodayProgress(){
  const root=$("todayProgress");
  if(!root)return;
  const items=await dbGetAll();
  const today=localDayKey();
  const reposted=new Set(items.filter(x=>x.lastRepostedAt&&localDayKey(new Date(x.lastRepostedAt))===today).map(canonicalPostKey)).size;
  const skipped=new Set(items.filter(x=>x.skippedAt&&localDayKey(new Date(x.skippedAt))===today).map(canonicalPostKey)).size;
  root.innerHTML='<span>今日：再投稿 <strong>'+reposted+'</strong>件</span><span>見送り <strong>'+skipped+'</strong>件</span>';
}
async function renderToday(){
  const root=$("todayList");
  const items=await getRoleBasedPicks();
  if(!items.length){
    root.innerHTML='<div class="empty">今すぐ出せる候補はありません。</div>';
    return;
  }
  await stampRecommendations(items);
  root.innerHTML=items.map((x,i)=>{
    const imgs=x.images||(x.image?[x.image]:[]);
    return '<article class="today-item featured">'+
      (imgs[0]?'<img src="'+imgs[0]+'" alt="">':'<div class="today-rank">'+(i+1)+'</div>')+
      '<div class="today-main"><div class="today-rank-label">'+esc(x._role||("おすすめ "+(i+1)))+'</div><h3>'+esc(x.title)+'</h3>'+
      '<div class="today-meta">'+esc(formatPostedMeta(x))+'</div>'+
      '<div class="recommend-reason">選定理由：'+esc(recommendationReasons(x).join("・"))+'</div>'+
      '<p class="today-preview">'+esc(x.text)+'</p>'+
      '<div class="metric-chips">'+todayMetricChips(x,x._role)+'</div>'+
      '<div class="today-actions">'+
        (x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'')+
        '<button class="small-btn" data-today-action="copy" data-id="'+x.id+'">投稿文コピー</button>'+
        '<button class="small-btn" data-today-action="reposted" data-id="'+x.id+'">再投稿済みにする</button>'+
        '<button class="small-btn skip-btn" data-today-action="skip" data-id="'+x.id+'">見送る</button>'+
        '<button class="small-btn exclude-btn" data-today-action="exclude" data-id="'+x.id+'">候補にしない</button>'+
      '</div></div></article>';
  }).join("");
}

async function renderRecentUsed(){
  const root=$("recentUsedList");
  const card=$("recentUsedCard");
  if(!root)return;
  const cutoff=Date.now()-7*24*60*60*1000;
  const items=(await dbGetAll())
    .filter(x=>{
      const t=new Date(x.lastRepostedAt||"").getTime();
      return Number.isFinite(t)&&t>=cutoff;
    })
    .sort((a,b)=>new Date(b.lastRepostedAt)-new Date(a.lastRepostedAt))
    .slice(0,3);
  if(!items.length){
    root.innerHTML="";
    card?.classList.add("hidden");
    return;
  }
  card?.classList.remove("hidden");
  root.innerHTML=items.map(x=>
    '<article class="recent-used-item">'+
      '<div><strong>'+esc(x.title)+'</strong>'+
      '<div class="today-meta">'+esc(new Date(x.lastRepostedAt).toLocaleDateString("ja-JP"))+' に再投稿</div></div>'+
      (x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'')+
    '</article>'
  ).join("");
}

async function renderRevenuePick(){
  const root=$("revenueToday");
  const x=await getRevenuePick();
  if(!x){root.innerHTML='<div class="empty">今すぐ出せる爆発候補はありません。</div>';return}
  if(revenueRecommendedDay(x)!==localDayKey()){
    x.revenueRecommendedAt=new Date().toISOString();
    await dbPut(x);
    await propagateUsageHistory(x);
  }
  root.innerHTML='<article class="revenue-pick">'+
    '<div class="revenue-label">爆発候補</div>'+
    '<h3>'+esc(x.title)+'</h3>'+
    '<div class="today-meta">'+esc(formatPostedMeta(x))+'</div>'+
    '<div class="recommend-reason">選定理由：'+esc(recommendationReasons(x).join("・"))+'</div>'+
    '<p class="today-preview">'+esc(x.text)+'</p>'+
    '<div class="metric-chips">'+
      (metricNumber(x.impressions)?'<span>表示 '+metricNumber(x.impressions).toLocaleString()+'</span>':'')+
      (metricNumber(x.reposts)?'<span>リポスト '+metricNumber(x.reposts).toLocaleString()+'</span>':'')+
      (metricNumber(x.urlClicks)?'<span>クリック '+metricNumber(x.urlClicks).toLocaleString()+'</span>':'')+
      (metricNumber(x.impressions)?'<span>クリック率 '+percentText(metricRate(x.urlClicks,x.impressions))+'</span>':'')+
    '</div>'+
    '<div class="today-actions">'+
      (x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'')+
      '<button class="small-btn" data-revenue-action="copy" data-id="'+x.id+'">投稿文コピー</button>'+
      '<button class="small-btn" data-revenue-action="reposted" data-id="'+x.id+'">再投稿済みにする</button>'+
      '<button class="small-btn exclude-btn" data-revenue-action="exclude" data-id="'+x.id+'">候補にしない</button>'+
    '</div></article>';
}

async function renderArchive(){
  const q=clean($("archiveSearch").value).toLowerCase();
  const all=await dbGetAll();
  const flexIds=searchIds(all,q);
  const keyCounts=new Map();
  all.forEach(x=>keyCounts.set(canonicalPostKey(x),(keyCounts.get(canonicalPostKey(x))||0)+1));
  const now=Date.now();
  const readyCutoff=30*24*60*60*1000;
  let items=all.filter(x=>{
    let hay=((x.title+" "+x.text+" "+x.memo+" "+(x.impressions||"")+" "+(x.likes||"")+" "+(x.bookmarks||"")).toLowerCase());
    if(/シナモン|シナモロール/.test(hay))hay+=" シナモン シナモロール";
    const matches=!q || hay.includes(q) || (flexIds&&flexIds.has(String(x.id)));
    if(!matches)return false;
    if(archiveFilter==="ready")return safeReuseItem(x);
    if(archiveFilter==="affiliate")return hasAffiliate(x);
    if(archiveFilter==="amazon")return hasAmazonAffiliate(x);
    if(archiveFilter==="rakuten")return hasRakutenAffiliate(x);
    if(archiveFilter==="both")return hasAmazonAffiliate(x)&&hasRakutenAffiliate(x);
    if(archiveFilter==="stale")return isLikelyExpiredNews(x);
    if(archiveFilter==="excluded")return isCandidateExcluded(x);
    if(archiveFilter==="autoexcluded")return isLowValueCandidate(x);
    if(archiveFilter==="duplicate")return (keyCounts.get(canonicalPostKey(x))||0)>1;
    if(archiveFilter==="missingx")return !clean(x.xUrl);
    return true;
  });
  if(archiveSort==="impressions")items.sort((a,b)=>metricNumber(b.impressions)-metricNumber(a.impressions));
  else if(archiveSort==="likes")items.sort((a,b)=>metricNumber(b.likes)-metricNumber(a.likes));
  else if(archiveSort==="bookmarks")items.sort((a,b)=>metricNumber(b.bookmarks)-metricNumber(a.bookmarks));
  else if(archiveSort==="clicks")items.sort((a,b)=>metricNumber(b.urlClicks)-metricNumber(a.urlClicks));
  else items.sort((a,b)=>String(b.postedAt||b.savedAt||"").localeCompare(String(a.postedAt||a.savedAt||"")));
  const root=$("archiveList");
  if(!items.length){root.innerHTML='<div class="empty">保存した人気投稿はまだありません。</div>';return}
  const total=items.length;
  const visible=items.slice(0,archiveLimit);
  root.innerHTML='<div class="archive-count">'+visible.length+' / '+total+'件を表示</div>'+visible.map(x=>{
    const imgs=x.images||(x.image?[x.image]:[]);
    return `<article class="archive-item">
      <div class="thumb-wrap">
        ${imgs[0]?'<img class="archive-thumb" src="'+imgs[0]+'" alt="">':'<div class="archive-thumb"></div>'}
        ${imgs.length>1?'<span class="image-count">'+imgs.length+'枚</span>':''}
      </div>
      <div class="archive-body">
        <h3>${esc(x.title)}${x.source==="x-analytics"?'<span class="edited-badge">X分析</span>':''}${x.updatedAt?'<span class="edited-badge">修正済</span>':''}</h3>
        <p class="status-line">${x.lastRepostedAt?'最終再投稿：'+new Date(x.lastRepostedAt).toLocaleDateString('ja-JP'):'まだ再投稿していません'}${x.repostCount?' ・ '+x.repostCount+'回':''}${isCandidateExcluded(x)?' ・ 候補から除外中':''}${isLowValueCandidate(x)?' ・ 自動除外：'+lowValueReason(x):''}</p>
        ${(x.impressions||x.likes||x.bookmarks)?'<div class="metric-chips">'+
          (x.impressions?'<span>表示 '+esc(x.impressions)+'</span>':'')+
          (x.likes?'<span>♥ '+esc(x.likes)+'</span>':'')+
          (x.bookmarks?'<span>保存 '+esc(x.bookmarks)+'</span>':'')+
        '</div>':''}
        <p>${esc(x.text)}</p>
        <div class="archive-actions primary-actions">
          ${x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':''}
          <button class="small-btn" data-action="copy" data-id="${x.id}">投稿文コピー</button>
          <button class="small-btn" data-action="reposted" data-id="${x.id}">再投稿済みにする</button>
        </div>
        <details class="card-more">
          <summary>その他</summary>
          <div class="archive-actions more-actions">
            <button class="small-btn" data-action="sharex" data-id="${x.id}">Xへ共有</button>
            <button class="small-btn" data-action="edit" data-id="${x.id}">修正</button>
            ${x.amazon?'<a class="small-btn link-btn" href="'+esc(normalizedUrl(x.amazon))+'" target="_blank" rel="noopener">Amazon</a>':''}
            ${x.rakuten?'<a class="small-btn link-btn" href="'+esc(normalizedUrl(x.rakuten))+'" target="_blank" rel="noopener">楽天</a>':''}
            ${imgs.length?'<button class="small-btn" data-action="images" data-id="'+x.id+'">画像を見る</button>':''}
            <button class="small-btn" data-action="${isCandidateExcluded(x)?'restore':'exclude'}" data-id="${x.id}">${isCandidateExcluded(x)?'候補に戻す':'候補にしない'}</button>
            <button class="small-btn danger" data-action="delete" data-id="${x.id}">削除</button>
          </div>
        </details>
      </div>
    </article>`}).join("")+
    (visible.length<total?'<button class="load-more" data-action="more">さらに50件表示</button>':'');
}
function resetArchiveForm(){
  ["archiveTitle","archiveText","archiveXUrl","archivePostedAt","archiveAmazon","archiveRakuten","archiveImpressions","archiveLikes","archiveBookmarks","archiveUrlClicks","archiveMemo"].forEach(id=>$(id).value="");
  $("archiveImage").value="";
  selectedImages=[];
  editingId=null;
  renderPreview();
  $("archiveFormTitle").textContent="人気投稿を保存";
  $("saveArchive").textContent="人気投稿に保存";
  $("cancelEdit").classList.add("hidden");
}

function startEdit(item){
  editingId=item.id;
  $("archiveTitle").value=item.title||"";
  $("archiveText").value=item.text||"";
  $("archiveXUrl").value=item.xUrl||"";
  $("archivePostedAt").value=dateInputValue(item.postedAt);
  $("archiveAmazon").value=item.amazon||"";
  $("archiveRakuten").value=item.rakuten||"";
  $("archiveImpressions").value=item.impressions||"";
  $("archiveLikes").value=item.likes||"";
  $("archiveBookmarks").value=item.bookmarks||"";
  $("archiveUrlClicks").value=item.urlClicks||"";
  $("archiveMemo").value=item.memo||"";
  selectedImages=[...(item.images||(item.image?[item.image]:[]))];
  renderPreview();
  $("archiveFormTitle").textContent="人気投稿を修正";
  $("saveArchive").textContent="修正を保存";
  $("cancelEdit").classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}
function showImages(images){
  $("modalImages").innerHTML=images.map(src=>'<img src="'+src+'" alt="保存画像">').join("");
  $("modalCount").textContent=images.length+"枚";
  $("imageModal").classList.remove("hidden");
  document.body.style.overflow="hidden";
}
function closeImages(){
  $("imageModal").classList.add("hidden");
  $("modalImages").innerHTML="";
  document.body.style.overflow="";
}

async function dataUrlToFile(dataUrl,name){
  const res=await fetch(dataUrl);
  const blob=await res.blob();
  const type=blob.type||"image/jpeg";
  const ext=type.includes("png")?"png":"jpg";
  return new File([blob],name+"."+ext,{type});
}

async function shareToX(item,button){
  const imgs=item.images||(item.image?[item.image]:[]);
  const files=[];
  for(let i=0;i<imgs.length;i++){
    try{files.push(await dataUrlToFile(imgs[i],"sanrio-"+(i+1)))}catch(e){}
  }

  const shareData={text:item.text||"",title:item.title||"Sanrio post"};
  if(files.length)shareData.files=files;

  try{
    if(navigator.share && (!files.length || !navigator.canShare || navigator.canShare({files}))){
      await navigator.share(shareData);
      return;
    }
  }catch(e){
    if(e && e.name==="AbortError")return;
  }

  try{await navigator.clipboard.writeText(item.text||"")}catch(e){}
  if(files.length)showImages(imgs);
  alert("投稿文をコピーしました。画像は長押しで保存してXに貼り付けてください。");
}


$("importAnalyticsCsv").addEventListener("change",async e=>{
  const file=e.target.files[0]; if(!file)return;
  const status=$("analyticsImportStatus");
  status.textContent="読み込み中…";
  try{
    const result=await importAnalyticsCSV(file);
    localStorage.setItem(LAST_ANALYTICS_IMPORT_KEY,new Date().toISOString());
    status.textContent=result.total+"件を処理しました（新規 "+result.added+"件 / 更新 "+result.updated+"件）";
    queueCloudSync(result.items||[],[]);
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderAnalytics();
    await renderDataFreshness();
    await renderDataHealth();
  }catch(err){
    status.textContent="";
    alert(err.message||"CSVを読み込めませんでした");
  }
  e.target.value="";
});

$("archiveImage").addEventListener("change",async e=>{
  const files=[...e.target.files].slice(0,4);
  if(e.target.files.length>4)alert("写真は最大4枚までです");
  selectedImages=[];
  for(const f of files){
    try{selectedImages.push(await compressFile(f))}catch(err){alert("画像の読み込みに失敗しました")}
  }
  renderPreview();
});

$("saveArchive").addEventListener("click",async()=>{
  const title=clean($("archiveTitle").value);
  const text=clean($("archiveText").value);
  if(!title&&!text){alert("商品名か投稿文を入れてください");return}

  const now=new Date().toISOString();
  let item;
  if(editingId){
    const current=(await dbGetAll()).find(x=>x.id===editingId);
    if(!current){alert("修正対象が見つかりません");return}
    item={
      ...current,
      title,text,images:[...selectedImages],
      xUrl:clean($("archiveXUrl").value),
      postedAt:clean($("archivePostedAt").value)?new Date($("archivePostedAt").value+"T12:00:00").toISOString():current.postedAt,
      amazon:clean($("archiveAmazon").value),
      rakuten:clean($("archiveRakuten").value),
      impressions:clean($("archiveImpressions").value),
      likes:clean($("archiveLikes").value),
      bookmarks:clean($("archiveBookmarks").value),
      urlClicks:clean($("archiveUrlClicks").value),
      memo:clean($("archiveMemo").value),
      updatedAt:now
    };
  }else{
    item={
      id:Date.now().toString(),
      title,text,images:[...selectedImages],
      xUrl:clean($("archiveXUrl").value),
      postedAt:clean($("archivePostedAt").value)?new Date($("archivePostedAt").value+"T12:00:00").toISOString():now,
      amazon:clean($("archiveAmazon").value),
      rakuten:clean($("archiveRakuten").value),
      impressions:clean($("archiveImpressions").value),
      likes:clean($("archiveLikes").value),
      bookmarks:clean($("archiveBookmarks").value),
      urlClicks:clean($("archiveUrlClicks").value),
      memo:clean($("archiveMemo").value),
      savedAt:now,
      repostCount:0
    };
  }

  await dbPut(item);
  queueCloudSync([item],[]);
  const wasEdit=!!editingId;
  resetArchiveForm();
  await renderArchive();
  await renderAnalytics();
  await renderDataFreshness();
  await renderDataHealth();
  await renderTodayProgress();
  alert(wasEdit?"修正を保存しました":"保存しました");
});

$("cancelEdit").addEventListener("click",resetArchiveForm);

$("archiveSearch").addEventListener("input",()=>{archiveLimit=50;renderArchive()});

$("mergeDuplicates")?.addEventListener("click",mergeAllDuplicates);
$("cloudSaveSettings")?.addEventListener("click",saveCloudSettings);
$("cloudTest")?.addEventListener("click",cloudPing);
$("cloudPush")?.addEventListener("click",cloudPushAll);
$("cloudPull")?.addEventListener("click",async()=>{
  if(!confirm("ロリポップ上の投稿データをこの端末へ統合します。端末の写真は保持します。よろしいですか？"))return;
  await cloudPullMerge();
});

$("dataHealth")?.addEventListener("click",e=>{
  const btn=e.target.closest("[data-health-filter]");
  if(!btn)return;
  archiveFilter=btn.dataset.healthFilter;
  archiveLimit=50;
  document.querySelectorAll(".filter-btn").forEach(x=>x.classList.toggle("active",x.dataset.filter===archiveFilter));
  const details=document.querySelector(".archive-browse");
  if(details)details.open=true;
  renderArchive();
  details?.scrollIntoView({behavior:"smooth",block:"start"});
});

async function checkLatestVersion(){
  const status=$("appVersionStatus");
  const btn=$("forceLatest");
  try{
    const res=await fetch("./version.json?ts="+Date.now(),{cache:"no-store"});
    if(!res.ok)return;
    const data=await res.json();
    const latest=String(data.version||"");
    if(latest&&latest!==APP_VERSION){
      if(status)status.textContent="新しい版 "+latest+" があります";
      btn?.classList.add("update-available");
    }else if(status){
      status.textContent="アプリ版 "+APP_VERSION+"（最新）";
    }
  }catch(e){}
}
$("forceLatest")?.addEventListener("click",()=>{
  const url=new URL(location.href);
  url.searchParams.set("v","20260922-2590");
  url.searchParams.set("refresh",Date.now().toString());
  location.replace(url.toString());
});

document.querySelector(".analytics-dashboard")?.addEventListener("toggle",e=>{
  if(e.currentTarget.open)requestAnimationFrame(()=>renderAnalytics());
});

document.querySelector(".analytics-dashboard")?.addEventListener("click",async e=>{
  const btn=e.target.closest("[data-analytics-action]");
  if(!btn)return;
  const items=await dbGetAll();
  const item=items.find(x=>x.id===btn.dataset.id);
  if(!item)return;
  if(btn.dataset.analyticsAction==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";
    setTimeout(()=>btn.textContent="コピー",1200);
  }
  if(btn.dataset.analyticsAction==="pin"){
    if(await pinCandidateForToday(item)){
      await renderToday();
      await renderTodayProgress();
      document.querySelector(".today-card")?.scrollIntoView({behavior:"smooth",block:"start"});
    }
  }
  if(btn.dataset.analyticsAction==="exclude"){
    await setCandidateExcluded(item,true);
    await renderAnalytics();
    await renderToday();
    await renderRevenuePick();
    await renderArchive();
    await renderDataHealth();
  }
});


$("revenueToday").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-revenue-action]");
  if(!btn)return;
  const items=await dbGetAll();
  const item=items.find(x=>x.id===btn.dataset.id);
  if(!item)return;
  if(btn.dataset.revenueAction==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿文コピー",1200);
  }
  if(btn.dataset.revenueAction==="reposted"){
    await applyReposted(item);
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderArchive();
    await renderTodayProgress();
  }
  if(btn.dataset.revenueAction==="exclude"){
    await setCandidateExcluded(item,true);
    await renderToday();
    await renderRevenuePick();
    await renderArchive();
  }
});

$("todayList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-today-action]");
  if(!btn)return;
  const items=await dbGetAll();
  const item=items.find(x=>x.id===btn.dataset.id);
  if(!item)return;
  if(btn.dataset.todayAction==="sharex")await shareToX(item,btn);
  if(btn.dataset.todayAction==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿文コピー",1200);
  }
  if(btn.dataset.todayAction==="reposted"){
    await applyReposted(item);
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderArchive();
    await renderTodayProgress();
  }
  if(btn.dataset.todayAction==="skip"){
    item.skippedAt=new Date().toISOString();
    await dbPut(item);
    queueCloudSync([item],[]);
    await propagateUsageHistory(item);
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderArchive();
    await renderTodayProgress();
  }
  if(btn.dataset.todayAction==="exclude"){
    await setCandidateExcluded(item,true);
    await renderToday();
    await renderRevenuePick();
    await renderArchive();
  }
});

document.querySelectorAll(".filter-btn").forEach(btn=>btn.addEventListener("click",()=>{
  archiveFilter=btn.dataset.filter;
  archiveLimit=50;
  document.querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  renderArchive();
}));

document.querySelectorAll(".character-btn").forEach(btn=>btn.addEventListener("click",()=>{
  archiveLimit=50;
  const input=$("archiveSearch");
  const same=input.value===btn.dataset.character;
  input.value=same?"":(btn.dataset.character==="シナモ"?"シナモン":btn.dataset.character);
  document.querySelectorAll(".character-btn").forEach(x=>x.classList.remove("active"));
  if(!same)btn.classList.add("active");
  renderArchive();
}));

document.querySelectorAll(".sort-btn").forEach(btn=>btn.addEventListener("click",()=>{
  archiveSort=btn.dataset.sort;
  archiveLimit=50;
  document.querySelectorAll(".sort-btn").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  renderArchive();
}));

$("exportBackup").addEventListener("click",async()=>{
  const items=await dbGetAll();
  const exportedAt=new Date().toISOString();
  const payload={version:1,exportedAt,items};
  const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
  const file=new File([blob],"sanrio-post-helper-backup.json",{type:"application/json"});
  try{
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      await navigator.share({files:[file],title:"Sanrio Post Helper バックアップ"});
      localStorage.setItem(LAST_BACKUP_EXPORT_KEY,exportedAt);
      renderBackupStatus();
      return;
    }
  }catch(e){
    if(e && e.name==="AbortError")return;
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="sanrio-post-helper-backup.json";
  document.body.appendChild(a);a.click();a.remove();
  localStorage.setItem(LAST_BACKUP_EXPORT_KEY,exportedAt);
  renderBackupStatus();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

$("importBackup").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const text=await file.text();
    const payload=JSON.parse(text);
    const items=Array.isArray(payload)?payload:payload.items;
    if(!Array.isArray(items))throw new Error("invalid");
    if(!confirm(items.length+"件のバックアップを読み込みます。既存データは残したまま追加・更新しますか？")){e.target.value="";return}
    const existing=await dbGetAll();
    const byId=new Map(existing.map(x=>[x.id,x]));
    const byKey=new Map(existing.map(x=>[canonicalPostKey(x),x]));
    const pending=[];
    for(const incoming of items){
      const item={...incoming};
      if(!item.id)item.id=Date.now().toString()+Math.random().toString(16).slice(2);
      const current=byId.get(item.id)||byKey.get(canonicalPostKey(item));
      const merged=current?{...current,...item,...mergedUsageHistory(current,item)}:item;
      pending.push(merged);
      byId.set(merged.id,merged);
      byKey.set(canonicalPostKey(merged),merged);
    }
    await dbPutMany(pending);
    queueCloudSync(pending,[]);
    await reconcileUsageHistory();
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderAnalytics();
    await renderDataFreshness();
    await renderDataHealth();
    alert("バックアップを読み込みました");
  }catch(err){
    alert("バックアップファイルを読み込めませんでした");
  }
  e.target.value="";
});

$("archiveList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-action]");if(!btn)return;
  if(btn.dataset.action==="more"){
    archiveLimit+=50;
    await renderArchive();
    return;
  }
  const items=await dbGetAll();const item=items.find(x=>x.id===btn.dataset.id);if(!item)return;
  if(btn.dataset.action==="sharex"){
    await shareToX(item,btn);
  }
  if(btn.dataset.action==="reposted"){
    await applyReposted(item);
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderTodayProgress();
  }
  if(btn.dataset.action==="edit"){
    startEdit(item);
  }
  if(btn.dataset.action==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿文コピー",1200);
  }
  if(btn.dataset.action==="images"){
    const imgs=item.images||(item.image?[item.image]:[]);showImages(imgs);
  }
  if(btn.dataset.action==="exclude"){
    await setCandidateExcluded(item,true);
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
  }
  if(btn.dataset.action==="restore"){
    await setCandidateExcluded(item,false);
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
  }
  if(btn.dataset.action==="delete"){
    if(!confirm("この保存データを削除しますか？"))return;
    await dbDelete(item.id);
    queueCloudSync([],[item.id]);
    await renderArchive();await renderDataHealth();
  }
});

$("undoRepost").addEventListener("click",undoLastRepost);
$("closeModal").addEventListener("click",closeImages);
$("imageModal").addEventListener("click",e=>{if(e.target===$("imageModal"))closeImages()});

(async()=>{
  checkLatestVersion();
  loadCloudSettings();
  renderCloudStatus();
  try{await migrateLegacy()}catch(e){console.error("migrateLegacy",e)}
  if(cloudConfigured()){
    renderCloudStatus("起動時にクラウド確認中…");
    try{await cloudPullMerge({silent:true,refresh:false})}catch(e){console.error("startup cloud pull",e)}
  }
  try{await reconcileUsageHistory()}catch(e){console.error("reconcileUsageHistory",e)}
  try{await renderToday()}catch(e){
    console.error("renderToday",e);
    const root=$("todayList"); if(root)root.innerHTML='<div class="empty">候補の読み込みに失敗しました。最新版を読み込んでも直らない場合は管理画面を確認してください。</div>';
  }
  try{await renderRevenuePick()}catch(e){
    console.error("renderRevenuePick",e);
    const root=$("revenueToday"); if(root)root.innerHTML='<div class="empty">収益候補の読み込みに失敗しました。</div>';
  }
  try{await renderRecentUsed()}catch(e){console.error("renderRecentUsed",e)}
  try{await renderTodayProgress()}catch(e){console.error("renderTodayProgress",e)}
  try{await renderDataFreshness()}catch(e){console.error("renderDataFreshness",e)}
  try{renderBackupStatus()}catch(e){console.error("renderBackupStatus",e)}
  try{await renderDataHealth()}catch(e){console.error("renderDataHealth",e)}
  try{await renderAnalytics()}catch(e){console.error("renderAnalytics",e)}
  try{await renderArchive()}catch(e){console.error("renderArchive",e)}
  if(cloudConfigured()){
    const last=localStorage.getItem(LAST_CLOUD_SYNC_KEY);
    if(last)renderCloudStatus("自動同期済み："+new Date(last).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}));
  }
})();