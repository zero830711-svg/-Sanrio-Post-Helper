const $=id=>document.getElementById(id);
const clean=v=>(v||"").trim();
const DB_NAME="sanrioPostHelperDB";
const STORE="popularPosts";
const LEGACY_KEY="sanrioPopularPostsV1";
let selectedImages=[];
let editingId=null;
let archiveFilter="all";
let archiveSort="newest";
let searchIndex=null;
let searchIndexSignature="";
const analyticsCharts={};

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
async function dbDelete(id){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);
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
function recommendationScore(x){
  const imp=Math.log10(metricNumber(x.impressions)+1)*18;
  const likes=Math.log10(metricNumber(x.likes)+1)*16;
  const saves=Math.log10(metricNumber(x.bookmarks)+1)*22;
  const clicks=Math.log10(metricNumber(x.urlClicks)+1)*24;
  const affiliate=hasAffiliate(x)?18:0;
  const days=Math.min(180,Math.max(0,(Date.now()-lastUseTime(x))/(24*60*60*1000)))*0.18;
  return imp+likes+saves+clicks+affiliate+days+stableDayJitter(x)*4;
}

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
function canRecommendToday(x){
  if(x.skippedAt){
    const st=new Date(x.skippedAt).getTime();
    if(Number.isFinite(st) && (Date.now()-st)<7*24*60*60*1000)return false;
  }
  if(!x.recommendedAt)return true;
  const d=new Date(x.recommendedAt);
  const t=d.getTime();
  if(!Number.isFinite(t))return true;
  if(recommendedDay(x)===localDayKey())return true;
  return (Date.now()-t)>=7*24*60*60*1000;
}

function recommendationReasons(x){
  const reasons=[];
  const age=Math.max(0,Math.floor((Date.now()-postedTime(x))/(24*60*60*1000)));
  const clicks=metricNumber(x.urlClicks);
  const saves=metricNumber(x.bookmarks);
  const likes=metricNumber(x.likes);
  const impressions=metricNumber(x.impressions);
  if(age>=60)reasons.push(age+"日空き");
  else if(age>=30)reasons.push("30日以上空き");
  if(clicks>0)reasons.push("クリック実績あり");
  else if(saves>=100)reasons.push("保存100+");
  else if(likes>=500)reasons.push("いいね500+");
  else if(impressions>=50000)reasons.push("表示5万+");
  if(hasAffiliate(x))reasons.push("アフィリエイト系");
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
async function renderAnalytics(){
  const summary=$("analyticsSummary");
  if(!summary)return;
  const items=await dbGetAll();
  const total=items.length;
  const totalImp=items.reduce((s,x)=>s+metricNumber(x.impressions),0);
  const totalLikes=items.reduce((s,x)=>s+metricNumber(x.likes),0);
  const totalSaves=items.reduce((s,x)=>s+metricNumber(x.bookmarks),0);
  const totalClicks=items.reduce((s,x)=>s+metricNumber(x.urlClicks),0);
  summary.innerHTML=[
    ["投稿",total.toLocaleString()],
    ["表示",totalImp.toLocaleString()],
    ["いいね",totalLikes.toLocaleString()],
    ["保存",totalSaves.toLocaleString()],
    ["クリック",totalClicks.toLocaleString()]
  ].map(([k,v])=>'<div class="analytics-stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join("");

  if(typeof Chart==="undefined")return;
  const topImp=[...items].sort((a,b)=>metricNumber(b.impressions)-metricNumber(a.impressions)).slice(0,10);
  const topSave=[...items].sort((a,b)=>metricNumber(b.bookmarks)-metricNumber(a.bookmarks)).slice(0,10);

  destroyChart("impressions");
  destroyChart("bookmarks");
  destroyChart("character");

  const impEl=$("impressionsChart");
  if(impEl)analyticsCharts.impressions=new Chart(impEl,{
    type:"bar",
    data:{labels:topImp.map(shortLabel),datasets:[{label:"表示数",data:topImp.map(x=>metricNumber(x.impressions))}]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:"y",plugins:{legend:{display:false}}}
  });
  const saveEl=$("bookmarksChart");
  if(saveEl)analyticsCharts.bookmarks=new Chart(saveEl,{
    type:"bar",
    data:{labels:topSave.map(shortLabel),datasets:[{label:"保存数",data:topSave.map(x=>metricNumber(x.bookmarks))}]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:"y",plugins:{legend:{display:false}}}
  });

  const chars=[
    ["キティ",/ハローキティ|キティ/],
    ["クロミ",/クロミ/],
    ["マイメロ",/マイメロ/],
    ["シナモン",/シナモン/],
    ["プリン",/ポムポムプリン/],
    ["ポチャッコ",/ポチャッコ/]
  ];
  const charData=chars.map(([name,re])=>{
    const rows=items.filter(x=>re.test(String(x.title||"")+" "+String(x.text||"")));
    const avg=rows.length?Math.round(rows.reduce((s,x)=>s+metricNumber(x.likes)+metricNumber(x.bookmarks)*2+metricNumber(x.urlClicks)*3,0)/rows.length):0;
    return {name,avg,count:rows.length};
  });
  const charEl=$("characterChart");
  if(charEl)analyticsCharts.character=new Chart(charEl,{
    type:"bar",
    data:{labels:charData.map(x=>x.name),datasets:[{label:"平均反応スコア",data:charData.map(x=>x.avg)}]},
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
  for(const r of rows){
    const postId=clean(r["ポストID"]);
    if(!postId)continue;
    const id="xanalytics-"+postId;
    const prev=byId.get(id);
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
      lastRepostedAt:prev&&prev.lastRepostedAt
    };
    await dbPut(item);
    if(prev)updated++; else added++;
    byId.set(id,item);
  }
  return {added,updated,total:added+updated};
}

async function getReadyItems(){
  const all=await dbGetAll();
  return all
    .filter(x=>safeReuseItem(x)&&canRecommendToday(x))
    .sort((a,b)=>{
      const at=recommendedDay(a)===localDayKey()?1:0;
      const bt=recommendedDay(b)===localDayKey()?1:0;
      if(at!==bt)return bt-at;
      return recommendationScore(b)-recommendationScore(a);
    });
}

async function stampRecommendations(items){
  const today=localDayKey();
  for(const item of items){
    if(recommendedDay(item)===today)continue;
    item.recommendedAt=new Date().toISOString();
    await dbPut(item);
  }
}

async function getRevenuePick(){
  const all=await dbGetAll();
  const today=localDayKey();
  return all
    .filter(x=>safeReuseItem(x)&&hasAffiliate(x)&&recommendedDay(x)!==today)
    .sort((a,b)=>{
      const c=metricNumber(b.urlClicks)-metricNumber(a.urlClicks);
      return c || recommendationScore(b)-recommendationScore(a);
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

async function renderToday(){
  const root=$("todayList");
  const items=(await getReadyItems()).slice(0,3);
  if(!items.length){
    root.innerHTML='<div class="empty">今すぐ出せる候補はありません。</div>';
    return;
  }
  await stampRecommendations(items);
  root.innerHTML=items.map((x,i)=>{
    const imgs=x.images||(x.image?[x.image]:[]);
    return '<article class="today-item featured">'+
      (imgs[0]?'<img src="'+imgs[0]+'" alt="">':'<div class="today-rank">'+(i+1)+'</div>')+
      '<div class="today-main"><div class="today-rank-label">おすすめ '+(i+1)+'</div><h3>'+esc(x.title)+'</h3>'+
      '<div class="today-meta">'+esc(formatPostedMeta(x))+'</div>'+
      '<div class="recommend-reason">選定理由：'+esc(recommendationReasons(x).join("・"))+'</div>'+
      '<p class="today-preview">'+esc(x.text)+'</p>'+
      '<div class="metric-chips">'+
        (x.impressions?'<span>表示 '+esc(x.impressions)+'</span>':'')+
        (x.likes?'<span>♥ '+esc(x.likes)+'</span>':'')+
        (x.bookmarks?'<span>保存 '+esc(x.bookmarks)+'</span>':'')+
        (x.urlClicks?'<span>クリック '+esc(x.urlClicks)+'</span>':'')+
      '</div>'+
      '<div class="today-actions">'+
        (x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'')+
        '<button class="small-btn" data-today-action="copy" data-id="'+x.id+'">投稿文コピー</button>'+
        '<button class="small-btn" data-today-action="reposted" data-id="'+x.id+'">再投稿済みにする</button>'+
        '<button class="small-btn skip-btn" data-today-action="skip" data-id="'+x.id+'">見送る</button>'+
      '</div></div></article>';
  }).join("");
}

async function renderRecentUsed(){
  const root=$("recentUsedList");
  const cutoff=Date.now()-7*24*60*60*1000;
  const items=(await dbGetAll())
    .filter(x=>{
      const t=new Date(x.lastRepostedAt||"").getTime();
      return Number.isFinite(t)&&t>=cutoff;
    })
    .sort((a,b)=>new Date(b.lastRepostedAt)-new Date(a.lastRepostedAt))
    .slice(0,3);
  if(!items.length){root.innerHTML='<div class="empty compact-empty">今週はまだありません。</div>';return}
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
  if(!x){root.innerHTML='<div class="empty">今すぐ出せる収益候補はありません。</div>';return}
  root.innerHTML='<article class="revenue-pick">'+
    '<div class="revenue-label">収益候補</div>'+
    '<h3>'+esc(x.title)+'</h3>'+
    '<div class="today-meta">'+esc(formatPostedMeta(x))+'</div>'+
    '<div class="recommend-reason">選定理由：'+esc(recommendationReasons(x).join("・"))+'</div>'+
    '<p class="today-preview">'+esc(x.text)+'</p>'+
    '<div class="metric-chips">'+
      (x.impressions?'<span>表示 '+esc(x.impressions)+'</span>':'')+
      (x.bookmarks?'<span>保存 '+esc(x.bookmarks)+'</span>':'')+
      (x.urlClicks?'<span>クリック '+esc(x.urlClicks)+'</span>':'')+
    '</div>'+
    '<div class="today-actions">'+
      (x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'')+
      '<button class="small-btn" data-revenue-action="copy" data-id="'+x.id+'">投稿文コピー</button>'+
      '<button class="small-btn" data-revenue-action="reposted" data-id="'+x.id+'">再投稿済みにする</button>'+
    '</div></article>';
}

async function renderArchive(){
  const q=clean($("archiveSearch").value).toLowerCase();
  const all=await dbGetAll();
  const flexIds=searchIds(all,q);
  const now=Date.now();
  const readyCutoff=30*24*60*60*1000;
  let items=all.filter(x=>{
    const hay=((x.title+" "+x.text+" "+x.memo+" "+(x.impressions||"")+" "+(x.likes||"")+" "+(x.bookmarks||"")).toLowerCase());
    const matches=!q || hay.includes(q) || (flexIds&&flexIds.has(String(x.id)));
    if(!matches)return false;
    if(archiveFilter==="ready")return safeReuseItem(x);
    if(archiveFilter==="affiliate")return hasAffiliate(x);
    if(archiveFilter==="amazon")return hasAmazonAffiliate(x);
    if(archiveFilter==="rakuten")return hasRakutenAffiliate(x);
    if(archiveFilter==="both")return hasAmazonAffiliate(x)&&hasRakutenAffiliate(x);
    if(archiveFilter==="stale")return isLikelyExpiredNews(x);
    return true;
  });
  if(archiveSort==="impressions")items.sort((a,b)=>metricNumber(b.impressions)-metricNumber(a.impressions));
  else if(archiveSort==="likes")items.sort((a,b)=>metricNumber(b.likes)-metricNumber(a.likes));
  else if(archiveSort==="bookmarks")items.sort((a,b)=>metricNumber(b.bookmarks)-metricNumber(a.bookmarks));
  else if(archiveSort==="clicks")items.sort((a,b)=>metricNumber(b.urlClicks)-metricNumber(a.urlClicks));
  else items.sort((a,b)=>String(b.postedAt||b.savedAt||"").localeCompare(String(a.postedAt||a.savedAt||"")));
  const root=$("archiveList");
  if(!items.length){root.innerHTML='<div class="empty">保存した人気投稿はまだありません。</div>';return}
  root.innerHTML=items.map(x=>{
    const imgs=x.images||(x.image?[x.image]:[]);
    return `<article class="archive-item">
      <div class="thumb-wrap">
        ${imgs[0]?'<img class="archive-thumb" src="'+imgs[0]+'" alt="">':'<div class="archive-thumb"></div>'}
        ${imgs.length>1?'<span class="image-count">'+imgs.length+'枚</span>':''}
      </div>
      <div class="archive-body">
        <h3>${esc(x.title)}${x.source==="x-analytics"?'<span class="edited-badge">X分析</span>':''}${x.updatedAt?'<span class="edited-badge">修正済</span>':''}</h3>
        <p class="status-line">${x.lastRepostedAt?'最終再投稿：'+new Date(x.lastRepostedAt).toLocaleDateString('ja-JP'):'まだ再投稿していません'}${x.repostCount?' ・ '+x.repostCount+'回':''}</p>
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
            <button class="small-btn danger" data-action="delete" data-id="${x.id}">削除</button>
          </div>
        </details>
      </div>
    </article>`}).join("");
}
function resetArchiveForm(){
  ["archiveTitle","archiveText","archiveAmazon","archiveRakuten","archiveImpressions","archiveLikes","archiveBookmarks","archiveMemo"].forEach(id=>$(id).value="");
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
  $("archiveAmazon").value=item.amazon||"";
  $("archiveRakuten").value=item.rakuten||"";
  $("archiveImpressions").value=item.impressions||"";
  $("archiveLikes").value=item.likes||"";
  $("archiveBookmarks").value=item.bookmarks||"";
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
    status.textContent=result.total+"件を処理しました（新規 "+result.added+"件 / 更新 "+result.updated+"件）";
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderAnalytics();
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
      amazon:clean($("archiveAmazon").value),
      rakuten:clean($("archiveRakuten").value),
      impressions:clean($("archiveImpressions").value),
      likes:clean($("archiveLikes").value),
      bookmarks:clean($("archiveBookmarks").value),
      memo:clean($("archiveMemo").value),
      updatedAt:now
    };
  }else{
    item={
      id:Date.now().toString(),
      title,text,images:[...selectedImages],
      amazon:clean($("archiveAmazon").value),
      rakuten:clean($("archiveRakuten").value),
      impressions:clean($("archiveImpressions").value),
      likes:clean($("archiveLikes").value),
      bookmarks:clean($("archiveBookmarks").value),
      memo:clean($("archiveMemo").value),
      savedAt:now,
      repostCount:0
    };
  }

  await dbPut(item);
  const wasEdit=!!editingId;
  resetArchiveForm();
  await renderArchive();
  await renderAnalytics();
  alert(wasEdit?"修正を保存しました":"保存しました");
});

$("cancelEdit").addEventListener("click",resetArchiveForm);

$("archiveSearch").addEventListener("input",renderArchive);


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
    item.lastRepostedAt=new Date().toISOString();
    item.repostCount=(item.repostCount||0)+1;
    await dbPut(item);
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
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
    item.lastRepostedAt=new Date().toISOString();
    item.repostCount=(item.repostCount||0)+1;
    await dbPut(item);
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderArchive();
  }
  if(btn.dataset.todayAction==="skip"){
    item.skippedAt=new Date().toISOString();
    await dbPut(item);
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderArchive();
  }
});

document.querySelectorAll(".filter-btn").forEach(btn=>btn.addEventListener("click",()=>{
  archiveFilter=btn.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  renderArchive();
}));

document.querySelectorAll(".character-btn").forEach(btn=>btn.addEventListener("click",()=>{
  const input=$("archiveSearch");
  const same=input.value===btn.dataset.character;
  input.value=same?"":btn.dataset.character;
  document.querySelectorAll(".character-btn").forEach(x=>x.classList.remove("active"));
  if(!same)btn.classList.add("active");
  renderArchive();
}));

document.querySelectorAll(".sort-btn").forEach(btn=>btn.addEventListener("click",()=>{
  archiveSort=btn.dataset.sort;
  document.querySelectorAll(".sort-btn").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  renderArchive();
}));

$("exportBackup").addEventListener("click",async()=>{
  const items=await dbGetAll();
  const payload={version:1,exportedAt:new Date().toISOString(),items};
  const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
  const file=new File([blob],"sanrio-post-helper-backup.json",{type:"application/json"});
  try{
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      await navigator.share({files:[file],title:"Sanrio Post Helper バックアップ"});
      return;
    }
  }catch(e){
    if(e && e.name==="AbortError")return;
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="sanrio-post-helper-backup.json";
  document.body.appendChild(a);a.click();a.remove();
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
    for(const item of items){
      if(!item.id)item.id=Date.now().toString()+Math.random().toString(16).slice(2);
      await dbPut(item);
    }
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
    await renderAnalytics();
    alert("バックアップを読み込みました");
  }catch(err){
    alert("バックアップファイルを読み込めませんでした");
  }
  e.target.value="";
});

$("archiveList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-action]");if(!btn)return;
  const items=await dbGetAll();const item=items.find(x=>x.id===btn.dataset.id);if(!item)return;
  if(btn.dataset.action==="sharex"){
    await shareToX(item,btn);
  }
  if(btn.dataset.action==="reposted"){
    item.lastRepostedAt=new Date().toISOString();
    item.repostCount=(item.repostCount||0)+1;
    await dbPut(item);
    await renderArchive();
    await renderToday();
    await renderRevenuePick();
    await renderRecentUsed();
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
  if(btn.dataset.action==="delete"){
    if(!confirm("この保存データを削除しますか？"))return;
    await dbDelete(item.id);await renderArchive();
  }
});

$("closeModal").addEventListener("click",closeImages);
$("imageModal").addEventListener("click",e=>{if(e.target===$("imageModal"))closeImages()});

(async()=>{await migrateLegacy();await renderArchive();await renderToday();await renderRevenuePick();await renderRecentUsed();await renderAnalytics()})();