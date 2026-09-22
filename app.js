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
const TREND_CACHE_KEY="sanrioTrendRadarCacheV4";
const DEFAULT_CLOUD_API_URL="https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/api2580.php";
const TODAY_ROLES=["拡散狙い","クリック狙い","鉄板再利用"];
let trendRangeHours=24;
const APP_VERSION="2026.09.23-3010";
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

function normalizedUrl(url){
  const v=clean(url);
  if(!v)return "";
  if(/^https?:\/\//i.test(v))return v;
  return "https://"+v;
}
function mediaArray(v){
  return Array.isArray(v)?v.filter(x=>typeof x==="string"&&x):[];
}
function cloudMediaFirst(remote,local){
  const all=[...mediaArray(remote),...mediaArray(local)];
  return [...new Set(all)].sort((a,b)=>{
    const ah=/^https?:\/\//i.test(a)?0:1,bh=/^https?:\/\//i.test(b)?0:1;
    return ah-bh;
  });
}
function archiveMediaApiUrl(){
  const base=cloudSettings().url||DEFAULT_CLOUD_API_URL;
  return base.replace(/\/api(?:2530|2540|2550|2560|2580)\.php(?:\?.*)?$/,"/archive-media-batch.php");
}
async function archiveMediaRequest(action="stats"){
  const {key}=cloudSettings();
  if(!key)throw new Error("同期キーを設定してください");
  const u=new URL(archiveMediaApiUrl());u.searchParams.set("action",action);
  const r=await fetch(u.toString(),{headers:{Authorization:"Bearer "+key},cache:"no-store"});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(e){throw new Error("アーカイブAPIの応答を読めません")}
  if(!r.ok||d.ok===false)throw new Error(d.error||("HTTP "+r.status));
  return d;
}
function byteText(n){
  const v=Number(n)||0;if(v>=1024**3)return (v/1024**3).toFixed(1)+" GB";if(v>=1024**2)return (v/1024**2).toFixed(1)+" MB";if(v>=1024)return (v/1024).toFixed(1)+" KB";return v.toLocaleString()+" B";
}
async function renderArchiveCloudStatus(){
  const root=$("archiveCloudStatus");if(!root)return;
  const local=await dbGetAll();const localMedia=local.filter(x=>mediaArray(x.images).length||mediaArray(x.videos).length).length;
  if(!cloudConfigured()){root.innerHTML='<span>端末 '+local.length.toLocaleString()+'投稿</span><strong>同期キー未設定</strong>';return}
  root.textContent="ロリポップを確認中…";
  try{
    const d=await archiveMediaRequest("stats");
    root.innerHTML=['<span>投稿DB '+Number(d.posts||0).toLocaleString()+'件</span>','<span>メディア付き '+Number(d.mediaPosts||0).toLocaleString()+'投稿</span>','<span>写真 '+Number(d.images||0).toLocaleString()+'枚</span>','<span>動画 '+Number(d.videos||0).toLocaleString()+'本</span>','<span>容量 '+byteText(d.bytes||0)+'</span>','<span>端末で表示可能 '+localMedia.toLocaleString()+'投稿</span>'].join("");
  }catch(e){root.innerHTML='<strong>状態取得失敗：'+esc(e.message)+'</strong>'}
}
async function syncArchiveMediaLinks(options={}){
  if(!cloudConfigured())return {ok:false,count:0};
  const root=$("archiveCloudStatus");if(root&&!options.silent)root.textContent="画像リンクを照合中…";
  try{
    const d=await archiveMediaRequest("manifest"),rows=Array.isArray(d.items)?d.items:[],local=await dbGetAll();
    const byPost=new Map(local.map(x=>[String(x.postId||""),x]).filter(([k])=>k)),grouped=new Map();
    for(const r of rows){const id=String(r.postId||"");if(!id||!r.publicUrl)continue;if(!grouped.has(id))grouped.set(id,{images:[],videos:[]});const g=grouped.get(id);if(r.mediaType==="video")g.videos.push(r.publicUrl);else g.images.push(r.publicUrl)}
    const updates=[];
    for(const [postId,g] of grouped){const x=byPost.get(postId);if(!x)continue;const next={...x,images:cloudMediaFirst(g.images,x.images),videos:cloudMediaFirst(g.videos,x.videos)};if(JSON.stringify(next.images)!==JSON.stringify(mediaArray(x.images))||JSON.stringify(next.videos)!==JSON.stringify(mediaArray(x.videos)))updates.push(next)}
    if(updates.length){await dbPutMany(updates);queueCloudSync(updates,[]);searchIndex=null;searchIndexSignature="";await renderArchive()}
    localStorage.setItem("sanrioArchiveMediaManifestAt",new Date().toISOString());
    if(root&&!options.silent)root.textContent="画像リンク修復完了："+updates.length+"投稿更新";
    return {ok:true,count:updates.length,total:rows.length};
  }catch(e){if(root&&!options.silent)root.innerHTML='<strong>修復失敗：'+esc(e.message)+'</strong>';return {ok:false,count:0,error:e}}
}
async function maybeSyncArchiveMediaLinks(){
  if(!cloudConfigured())return;const t=new Date(localStorage.getItem("sanrioArchiveMediaManifestAt")||0).getTime();if(Number.isFinite(t)&&Date.now()-t<12*60*60*1000)return;await syncArchiveMediaLinks({silent:true});
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
        merged.images=cloudMediaFirst(incoming.images,current.images||(current.image?[current.image]:[]));
        merged.videos=cloudMediaFirst(incoming.videos,current.videos);
      }else{
        merged={...incoming,images:mediaArray(incoming.images),videos:mediaArray(incoming.videos)};
      }
      pending.push(merged);
      byId.set(String(merged.id),merged);
      byKey.set(canonicalPostKey(merged),merged);
    }
    await dbPutMany(pending);
    await dbDeleteMany(deletes);
    await reconcileUsageHistory();
    try{
      await syncArchiveMediaLinks({silent:true});
    }catch(e){
      console.error("archive media repair after cloud pull",e);
    }
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
      await renderArchiveCloudStatus();
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

function trendApiUrl(){
  const base=cloudSettings().url||DEFAULT_CLOUD_API_URL;
  return base.replace(/\/api(?:2530|2540|2550|2560|2580)\.php(?:\?.*)?$/,"/trend.php");
}
async function trendRequest(force=false){
  const {key}=cloudSettings();
  if(!key)throw new Error("同期キーを設定してください");
  const target=new URL(trendApiUrl());
  if(force)target.searchParams.set("refresh","1");
  const res=await fetch(target.toString(),{
    method:"GET",headers:{"Authorization":"Bearer "+key},cache:"no-store"
  });
  const text=await res.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch(e){throw new Error("Trend APIの応答を読めません")}
  if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
  return data;
}
async function trendStateRequest(topicKey,state){
  const {key}=cloudSettings();
  if(!key)throw new Error("同期キーを設定してください");
  const form=new FormData();
  form.append("topic_key",String(topicKey||""));
  form.append("state",String(state||""));
  const res=await fetch(trendApiUrl()+"?action=state",{
    method:"POST",headers:{"Authorization":"Bearer "+key},body:form,cache:"no-store"
  });
  const text=await res.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch(e){}
  if(!res.ok||data.ok===false)throw new Error(data.error||("HTTP "+res.status));
  return data;
}

function trendCharacter(text){
  const t=String(text||"");
  const pairs=[
    ["クロミ",/クロミ|KUROMI/i],
    ["キティ",/ハローキティ|Hello Kitty|キティ/i],
    ["マイメロ",/マイメロ|My Melody/i],
    ["シナモン",/シナモン|Cinnamoroll/i],
    ["プリン",/ポムポムプリン|Pompompurin/i],
    ["ポチャッコ",/ポチャッコ|Pochacco/i]
  ];
  return (pairs.find(([,re])=>re.test(t))||[])[0]||"";
}
function characterAffinity(items,character){
  if(!character)return 0;
  const map={
    "クロミ":/クロミ|KUROMI/i,
    "キティ":/ハローキティ|Hello Kitty|キティ/i,
    "マイメロ":/マイメロ|My Melody/i,
    "シナモン":/シナモン|Cinnamoroll/i,
    "プリン":/ポムポムプリン|Pompompurin/i,
    "ポチャッコ":/ポチャッコ|Pochacco/i
  };
  const re=map[character];
  if(!re)return 0;
  const rows=items.filter(x=>metricNumber(x.impressions)>=1000&&re.test(String(x.title||"")+" "+String(x.text||"")));
  if(!rows.length)return 0;
  const imp=rows.reduce((s,x)=>s+metricNumber(x.impressions),0);
  const clicks=rows.reduce((s,x)=>s+metricNumber(x.urlClicks),0);
  return imp?clicks/imp:0;
}
function trendAgeHours(date){
  const t=new Date(date||"").getTime();
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/(60*60*1000)):9999;
}
function trendUsefulnessBonus(item){
  const t=((item.title||"")+" "+(item.summary||"")).toLowerCase();
  let bonus=0;
  if(/collab|collaboration|コラボ|新作|new collection|plush|ぬい|goods|グッズ|限定|limited|pop.?up|ポップアップ|発売|release|再販|restock|キャンペーン|campaign/.test(t))bonus+=24;
  if(/game|rhythm|mobile game|ゲーム|決算|earnings|financial|corporate|人事|株主/.test(t))bonus-=16;
  return bonus;
}
function trendLocalScore(item,history){
  const age=trendAgeHours(item.publishedAt||item.firstSeenAt);
  const freshness=Math.max(0,72-Math.min(age,144)*0.75);
  const social=Math.min(35,Math.log10((Number(item.votes)||0)+(Number(item.comments)||0)*3+1)*11);
  const sourceBonus=item.sourceType==="official"?28:item.region==="JP"?18:item.sourceType==="reddit"?10:12;
  const char=trendCharacter((item.title||"")+" "+(item.summary||""));
  const affinity=characterAffinity(history,char);
  const affinityBonus=Math.min(32,affinity*650);
  const corroboration=Math.min(20,Math.max(0,(Number(item.relatedCount)||1)-1)*6);
  const newBonus=item.isNew?14:0;
  return freshness+social+sourceBonus+affinityBonus+corroboration+newBonus+trendUsefulnessBonus(item);
}

function trendOpportunity(item,history){
  const score=trendLocalScore(item,history);
  const age=trendAgeHours(item.publishedAt||item.firstSeenAt);
  const jp=Number(item.jpCount)||0;
  const foreign=Number(item.foreignCount)||0;
  const related=Math.max(1,Number(item.relatedCount)||1);
  const ahead=jp===0&&foreign>=1&&related>=2&&age<=72;
  if(ahead)return {label:"先取り候補",className:"ahead",score};
  if(age<=36&&score>=115)return {label:"今すぐ投稿",className:"now",score};
  if(age<=72&&score>=88)return {label:"投稿候補",className:"good",score};
  return {label:"様子見",className:"watch",score};
}
function trendKeywordTokens(item){
  const raw=((item.title||"")+" "+(item.summary||"")).toLowerCase()
    .replace(/https?:\/\/\S+/g," ")
    .replace(/[^\p{L}\p{N}]+/gu," ");
  const stop=new Set(["sanrio","サンリオ","hello","kitty","ハローキティ","news","new","the","and","with","for","from","official","characters"]);
  return [...new Set(raw.split(/\s+/).filter(x=>x.length>=3&&!stop.has(x)))].slice(0,14);
}
function trendSimilarPosts(history,item){
  const char=trendCharacter((item.title||"")+" "+(item.summary||""));
  const charRes={
    "クロミ":/クロミ|KUROMI/i,
    "キティ":/ハローキティ|Hello Kitty|キティ/i,
    "マイメロ":/マイメロ|My Melody/i,
    "シナモン":/シナモン|Cinnamoroll/i,
    "プリン":/ポムポムプリン|Pompompurin/i,
    "ポチャッコ":/ポチャッコ|Pochacco/i
  };
  const re=charRes[char];
  const tokens=trendKeywordTokens(item);
  return history
    .filter(x=>metricNumber(x.impressions)>=1000)
    .map(x=>{
      const body=((x.title||"")+" "+(x.text||"")).toLowerCase();
      let relevance=0;
      if(re&&re.test(body))relevance+=5;
      for(const token of tokens)if(body.includes(token))relevance+=1;
      const ctr=metricRate(x.urlClicks,x.impressions);
      const spread=metricRate(x.reposts,x.impressions);
      const perf=Math.log10(metricNumber(x.impressions)+1)+ctr*120+spread*80;
      return {...x,_trendRelevance:relevance,_trendPerf:perf};
    })
    .filter(x=>x._trendRelevance>0)
    .sort((a,b)=>(b._trendRelevance-a._trendRelevance)||(b._trendPerf-a._trendPerf))
    .slice(0,2);
}
function trendSimilarHtml(history,item){
  const rows=trendSimilarPosts(history,item);
  if(!rows.length)return "";
  return '<details class="trend-similar"><summary>過去の強い類似投稿 '+rows.length+'件</summary>'+
    '<div class="trend-similar-list">'+rows.map(x=>
      '<div class="trend-similar-row"><div><strong>'+esc(shortLabel(x))+'</strong>'+
      '<span>表示 '+metricNumber(x.impressions).toLocaleString()+
      (metricNumber(x.urlClicks)?' ・ CTR '+percentText(metricRate(x.urlClicks,x.impressions)):'')+
      '</span></div>'+
      (x.xUrl?'<a href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">X</a>':'')+
      '</div>'
    ).join("")+'</div></details>';
}

function trendCategory(item){
  const t=((item.title||"")+" "+(item.summary||"")).toLowerCase();
  if(/collab|collaboration|コラボ/.test(t))return "コラボ";
  if(/restock|再販|再入荷/.test(t))return "再販";
  if(/limited|限定/.test(t))return "限定";
  if(/pop.?up|ポップアップ|event|イベント/.test(t))return "イベント";
  if(/new collection|新作|発売|release|goods|グッズ|plush|ぬい/.test(t))return "新商品";
  if((Number(item.jpCount)||0)===0&&(Number(item.foreignCount)||0)>0)return "海外先行";
  return "話題";
}
function trendTrust(item){
  if(item.sourceType==="official")return {label:"公式確認",className:"official"};
  if((Number(item.relatedCount)||0)>=2)return {label:"複数媒体確認",className:"multi"};
  if(item.sourceType==="reddit")return {label:"SNS情報",className:"social"};
  return {label:"ニュース1媒体",className:"single"};
}
function renderTrendSourceHealth(data){
  const root=$("trendSourceHealth");
  if(!root)return;
  const rows=Array.isArray(data.sourceHealth)?data.sourceHealth:[];
  if(!rows.length){root.innerHTML="";return}
  root.innerHTML=rows.map(x=>
    '<span class="'+(x.ok?'ok':'ng')+'">'+esc(x.label||x.source||"source")+' '+(x.ok?'✓':'×')+'</span>'
  ).join("");
}
function trendTopicState(item){
  return String(item.userState||"");
}

function trendPrompt(item){
  const char=trendCharacter((item.title||"")+" "+(item.summary||""));
  const jp=Number(item.jpCount)||0;
  const foreign=Number(item.foreignCount)||0;
  return [
    "Sanrio fan infoのX投稿案を作成してください。",
    "話題："+(item.title||""),
    item.url?("参考URL："+item.url):"",
    item.source?("情報源："+item.source):"",
    item.relatedCount>1?("同一話題の確認媒体数："+item.relatedCount):"",
    (jp===0&&foreign>0)?"日本語ニュースではまだ薄い可能性がある先取り候補です。":"",
    char?("関連キャラ："+char):"",
    "話題分類："+trendCategory(item),
    "条件：280字以内。事実確認できる内容だけ。最初の1〜2行で興味を引き、宣伝口調を避ける。必要ならAmazon・楽天へ自然につなげる。未確認情報は断定しない。"
  ].filter(Boolean).join("\n");
}
function trendSourceLabel(item){
  if(item.sourceType==="official")return "公式";
  if(item.sourceType==="reddit")return "Reddit";
  return item.region==="JP"?"国内ニュース":item.region==="KR"?"韓国ニュース":"海外ニュース";
}
async function renderTrendRadar(force=false){
  const root=$("trendList"),status=$("trendStatus");
  if(!root||!status)return [];
  if(!cloudConfigured()){
    status.textContent="管理で同期キーを設定すると使えます。";
    root.innerHTML="";
    $("trendHero")&&( $("trendHero").innerHTML='<div class="empty compact-empty">同期キー設定後に表示されます。</div>' );
    return [];
  }
  status.textContent=force?"最新情報を更新中…":"Trend Radarを読み込み中…";
  try{
    let data;
    if(!force){
      const cached=localStorage.getItem(TREND_CACHE_KEY);
      if(cached){
        try{
          const parsed=JSON.parse(cached);
          if(parsed&&Array.isArray(parsed.items)&&(Date.now()-new Date(parsed.savedAt||0).getTime())<20*60*1000)data=parsed;
        }catch(e){}
      }
    }
    if(!data){
      data=await trendRequest(force);
      localStorage.setItem(TREND_CACHE_KEY,JSON.stringify({...data,savedAt:new Date().toISOString()}));
    }
    renderTrendSourceHealth(data);
    const history=await dbGetAll();
    const allRows=(Array.isArray(data.items)?data.items:[])
      .filter(x=>!["used","skip","dislike"].includes(trendTopicState(x)))
      .map(x=>({...x,_localScore:trendLocalScore(x,history)}))
      .filter(x=>trendAgeHours(x.publishedAt||x.firstSeenAt)<=trendRangeHours)
      .sort((a,b)=>b._localScore-a._localScore);

    const rows=allRows.slice(0,5);
    status.textContent=(data.cached?"キャッシュ":"最新取得")+" ・ "+trendRangeHours+"時間以内 "+rows.length+"件"+
      (data.groupedCount?(" / "+data.groupedCount+"話題から選別"):"")+
      (data.fetchedAt?" ・ "+new Date(data.fetchedAt).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"");

    const cardHtml=(x,i,hero=false)=>{
      const char=trendCharacter((x.title||"")+" "+(x.summary||""));
      const affinity=characterAffinity(history,char);
      const age=Math.round(trendAgeHours(x.publishedAt||x.firstSeenAt));
      const related=Math.max(1,Number(x.relatedCount)||1);
      const opportunity=trendOpportunity(x,history);
      const trust=trendTrust(x);
      const category=trendCategory(x);
      return '<article class="trend-item '+opportunity.className+(hero?' trend-hero-item':'')+'">'+
        (hero?'':'<div class="trend-rank">'+(i+1)+'</div>')+
        '<div class="trend-main">'+
          '<div class="trend-meta">'+
            '<span class="trend-opportunity '+opportunity.className+'">'+opportunity.label+'</span>'+
            '<span class="trend-category">'+esc(category)+'</span>'+
            '<span class="trend-trust '+trust.className+'">'+trust.label+'</span>'+
            (x.isNew?'<span class="trend-new">NEW 今日初検知</span>':'')+
            '<span>'+esc(trendSourceLabel(x))+'</span>'+
            (char?'<span>'+esc(char)+'</span>':'')+
            (age<240?'<span>'+age+'時間前</span>':'')+
            (related>1?'<span>関連 '+related+'媒体</span>':'')+
            ((Number(x.jpCount)||0)===0&&(Number(x.foreignCount)||0)>0?'<span class="trend-ahead">日本語記事 未検出</span>':'')+
          '</div>'+
          '<h3>'+esc(x.title||"話題")+'</h3>'+
          (x.summary?'<p>'+esc(String(x.summary).slice(0,180))+'</p>':'')+
          '<div class="trend-signals">'+
            (x.votes?'<span>▲ '+Number(x.votes).toLocaleString()+'</span>':'')+
            (x.comments?'<span>💬 '+Number(x.comments).toLocaleString()+'</span>':'')+
            (affinity?'<span>自分のCTR '+percentText(affinity)+'</span>':'')+
          '</div>'+
          trendSimilarHtml(history,x)+
          (Array.isArray(x.relatedItems)&&x.relatedItems.length>1?
            '<details class="trend-related"><summary>関連媒体 '+x.relatedItems.length+'件を見る</summary>'+
            '<div>'+x.relatedItems.slice(0,6).map(r=>'<a href="'+esc(r.url||"#")+'" target="_blank" rel="noopener">'+esc(r.source||"情報源")+'</a>').join("")+'</div></details>':'')+
          '<div class="trend-actions">'+
            (x.url?'<a class="small-btn link-btn" href="'+esc(x.url)+'" target="_blank" rel="noopener">元情報</a>':'')+
            '<button class="small-btn" data-trend-action="prompt" data-trend-id="'+esc(String(x.id||i))+'">投稿プロンプト</button>'+
            '<button class="small-btn trend-used" data-trend-action="used" data-trend-id="'+esc(String(x.id||i))+'">投稿した</button>'+
            '<button class="small-btn" data-trend-action="skip" data-trend-id="'+esc(String(x.id||i))+'">今回は使わない</button>'+
            '<button class="small-btn subtle" data-trend-action="dislike" data-trend-id="'+esc(String(x.id||i))+'">興味なし</button>'+
          '</div>'+
        '</div>'+
      '</article>';
    };

    root.innerHTML=rows.length?rows.map((x,i)=>cardHtml(x,i,false)).join(""):'<div class="empty compact-empty">条件に合う新しいトレンドはありません。</div>';
    root._trendRows=rows;

    const hero=$("trendHero");
    if(hero){
      const best=allRows.find(x=>["ahead","now","good"].includes(trendOpportunity(x,history).className))||allRows[0];
      hero.innerHTML=best?cardHtml(best,0,true):'<div class="empty compact-empty">今すぐ使う新規ネタはありません。</div>';
      hero._trendRows=best?[best]:[];
    }
    return rows;
  }catch(e){
    status.textContent="取得失敗："+e.message;
    root.innerHTML='<div class="empty compact-empty">Trend Radarを取得できませんでした。</div>';
    $("trendHero")&&( $("trendHero").innerHTML='<div class="empty compact-empty">新規ネタを取得できませんでした。</div>' );
    return [];
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


function timingStats(items){
  const eligible=items.filter(isAnalyticsEligible).filter(x=>postedTime(x));
  const days=["日","月","火","水","木","金","土"];
  const dayGroups=days.map((label,d)=>({label,rows:eligible.filter(x=>new Date(postedTime(x)).getDay()===d)}));
  const bands=[
    ["0-5時",0,6],["6-8時",6,9],["9-11時",9,12],["12-14時",12,15],
    ["15-17時",15,18],["18-20時",18,21],["21-23時",21,24]
  ].map(([label,a,b])=>({label,rows:eligible.filter(x=>{const h=new Date(postedTime(x)).getHours();return h>=a&&h<b})}));
  const calc=g=>{
    if(g.rows.length<3)return null;
    const imp=g.rows.reduce((s,x)=>s+metricNumber(x.impressions),0);
    const clicks=g.rows.reduce((s,x)=>s+metricNumber(x.urlClicks),0);
    return {...g,count:g.rows.length,avgImp:imp/g.rows.length,ctr:imp?clicks/imp:0};
  };
  return {days:dayGroups.map(calc).filter(Boolean).sort((a,b)=>b.avgImp-a.avgImp),bands:bands.map(calc).filter(Boolean).sort((a,b)=>b.avgImp-a.avgImp)};
}
function renderTimingAnalysis(items){
  const root=$("timingAnalysis");if(!root)return;
  const s=timingStats(items);
  const bestDay=s.days[0],bestBand=s.bands[0];
  if(!bestDay&&!bestBand){root.innerHTML='<div class="empty compact-empty">分析できる投稿がまだ足りません。</div>';return}
  root.innerHTML=
    '<div class="timing-best">'+
      (bestDay?'<div><span>表示に強い曜日</span><strong>'+bestDay.label+'曜</strong><small>'+bestDay.count+'投稿・平均 '+Math.round(bestDay.avgImp).toLocaleString()+'</small></div>':'')+
      (bestBand?'<div><span>表示に強い時間</span><strong>'+bestBand.label+'</strong><small>'+bestBand.count+'投稿・CTR '+percentText(bestBand.ctr)+'</small></div>':'')+
    '</div>'+
    '<div class="timing-list">'+
      s.days.slice(0,3).map(x=>'<span>'+x.label+'曜 '+Math.round(x.avgImp).toLocaleString()+'</span>').join("")+
      s.bands.slice(0,3).map(x=>'<span>'+x.label+' '+Math.round(x.avgImp).toLocaleString()+'</span>').join("")+
    '</div>';
}
function normalizedPostText(x){
  return String(x.text||"").toLowerCase()
    .replace(/https?:\/\/\S+/g," ").replace(/[#＃@＠][^\s]+/g," ")
    .replace(/[^\p{L}\p{N}]+/gu,"").slice(0,140);
}
function reuseRisk(items){
  const recent=items.filter(x=>{
    const t=lastUseTime(x);return t&&(Date.now()-t)<21*24*60*60*1000;
  });
  const groups=new Map();
  for(const x of recent){
    const key=normalizedPostText(x);
    if(key.length<20)continue;
    const k=key.slice(0,60);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(x);
  }
  const repeated=[...groups.values()].filter(g=>g.length>1).sort((a,b)=>b.length-a.length);
  const chars=["クロミ","キティ","マイメロ","シナモン","プリン","ポチャッコ"].map(c=>({
    char:c,count:recent.filter(x=>trendCharacter((x.title||"")+" "+(x.text||""))===c).length
  })).sort((a,b)=>b.count-a.count);
  return {repeated,topChar:chars[0]};
}
function renderReuseRisk(items){
  const root=$("reuseRiskAnalysis");if(!root)return;
  const r=reuseRisk(items);
  const bits=[];
  if(r.repeated.length)bits.push('<div class="risk-alert">似た文章を直近21日で繰り返している候補：'+r.repeated.length+'組</div>');
  if(r.topChar&&r.topChar.count>=4)bits.push('<div class="risk-alert">最近は「'+esc(r.topChar.char)+'」が'+r.topChar.count+'件で多め</div>');
  if(!bits.length)bits.push('<div class="risk-ok">大きな偏りは見つかりません。</div>');
  root.innerHTML=bits.join("");
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
  renderTimingAnalysis(items);
  renderReuseRisk(items);

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
  if(!root)return;
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
    if(archiveFilter==="media")return mediaArray(x.images).length>0||mediaArray(x.videos).length>0;
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
    const imgs=mediaArray(x.images||(x.image?[x.image]:[]));
    const vids=mediaArray(x.videos);
    return `<article class="archive-item">
      <div class="thumb-wrap">
        ${imgs[0]?'<img class="archive-thumb" src="'+esc(imgs[0])+'" alt="" loading="lazy">':(vids.length?'<div class="archive-thumb archive-video-thumb">🎬</div>':'<div class="archive-thumb"></div>')}
        ${(imgs.length||vids.length)?'<span class="image-count">'+(imgs.length?imgs.length+'枚':'')+(imgs.length&&vids.length?' / ':'')+(vids.length?vids.length+'動画':'')+'</span>':''}
      </div>
      <div class="archive-body">
        <h3>${esc(x.title||shortLabel(x))}${x.source==="x-analytics"?'<span class="edited-badge">X分析</span>':''}${x.source==="x-archive"?'<span class="edited-badge">Xアーカイブ</span>':''}${x.updatedAt?'<span class="edited-badge">修正済</span>':''}</h3>
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
            ${x.amazon?'<a class="small-btn link-btn" href="'+esc(normalizedUrl(x.amazon))+'" target="_blank" rel="noopener">Amazon</a>':''}
            ${x.rakuten?'<a class="small-btn link-btn" href="'+esc(normalizedUrl(x.rakuten))+'" target="_blank" rel="noopener">楽天</a>':''}
            ${(imgs.length||vids.length)?'<button class="small-btn" data-action="media" data-id="'+x.id+'">メディアを見る</button>':''}
            <button class="small-btn" data-action="${isCandidateExcluded(x)?'restore':'exclude'}" data-id="${x.id}">${isCandidateExcluded(x)?'候補に戻す':'候補にしない'}</button>
            <button class="small-btn danger" data-action="delete" data-id="${x.id}">削除</button>
          </div>
        </details>
      </div>
    </article>`}).join("")+
    (visible.length<total?'<button class="load-more" data-action="more">さらに50件表示</button>':'');
}
function showMedia(images=[],videos=[]){
  const imgs=mediaArray(images),vids=mediaArray(videos);
  $("modalImages").innerHTML=imgs.map(src=>'<img src="'+esc(src)+'" alt="保存画像">').join("")+vids.map(src=>'<video src="'+esc(src)+'" controls playsinline preload="metadata"></video>').join("");
  $("modalCount").textContent=(imgs.length?imgs.length+"枚":"")+(imgs.length&&vids.length?" / ":"")+(vids.length?vids.length+"動画":"");
  $("imageModal").classList.remove("hidden");document.body.style.overflow="hidden";
}
function showImages(images){showMedia(images,[])}
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

$("archiveSearch").addEventListener("input",()=>{archiveLimit=50;renderArchive()});

$("mergeDuplicates")?.addEventListener("click",mergeAllDuplicates);
$("cloudSaveSettings")?.addEventListener("click",saveCloudSettings);
$("cloudTest")?.addEventListener("click",cloudPing);
$("cloudPush")?.addEventListener("click",cloudPushAll);
$("archiveCloudRefresh")?.addEventListener("click",renderArchiveCloudStatus);
$("archiveMediaRepair")?.addEventListener("click",async()=>{await syncArchiveMediaLinks();await renderArchiveCloudStatus()});
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
  url.searchParams.set("v","20260923-3010");
  url.searchParams.set("refresh",Date.now().toString());
  location.replace(url.toString());
});

$("trendRefresh")?.addEventListener("click",()=>renderTrendRadar(true));
document.querySelectorAll(".trend-range").forEach(btn=>btn.addEventListener("click",()=>{
  trendRangeHours=Number(btn.dataset.trendRange)||24;
  document.querySelectorAll(".trend-range").forEach(x=>x.classList.toggle("active",x===btn));
  renderTrendRadar(false);
}));
async function handleTrendAction(e,root){
  const btn=e.target.closest("[data-trend-action]");if(!btn)return;
  const rows=root._trendRows||[];
  const item=rows.find((x,i)=>String(x.id||i)===String(btn.dataset.trendId));if(!item)return;
  const action=btn.dataset.trendAction;
  if(action==="prompt"){
    const prompt=trendPrompt(item);
    try{await navigator.clipboard.writeText(prompt);btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿プロンプト",1200)}
    catch(err){alert(prompt)}
    return;
  }
  if(["used","skip","dislike"].includes(action)){
    btn.disabled=true;
    try{
      await trendStateRequest(item.topicKey||item.id,action);
      localStorage.removeItem(TREND_CACHE_KEY);
      await renderTrendRadar(true);
    }catch(err){alert("保存できませんでした："+err.message);btn.disabled=false}
  }
}
$("trendList")?.addEventListener("click",e=>handleTrendAction(e,$("trendList")));
$("trendHero")?.addEventListener("click",e=>handleTrendAction(e,$("trendHero")));

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
  if(btn.dataset.action==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿文コピー",1200);
  }
  if(btn.dataset.action==="images"||btn.dataset.action==="media"){
    const imgs=item.images||(item.image?[item.image]:[]);showMedia(imgs,item.videos||[]);
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
  try{await maybeSyncArchiveMediaLinks()}catch(e){console.error("archive media sync",e)}
  try{await renderArchiveCloudStatus()}catch(e){console.error("archive cloud status",e)}
  try{await renderTrendRadar(false)}catch(e){console.error("renderTrendRadar",e)}
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