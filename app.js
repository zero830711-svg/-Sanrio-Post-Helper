const $=id=>document.getElementById(id);
const clean=v=>(v||"").trim();
const DB_NAME="sanrioPostHelperDB";
const STORE="popularPosts";
const LEGACY_KEY="sanrioPopularPostsV1";
let selectedImages=[];
let editingId=null;
let archiveFilter="all";

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

function normalizeXPostUrl(value){
  let v=clean(value);
  if(!v)return "";
  if(!/^https?:\/\//i.test(v))v="https://"+v;
  try{
    const u=new URL(v);
    const host=u.hostname.toLowerCase().replace(/^www\./,"");
    if(!["x.com","twitter.com","mobile.twitter.com"].includes(host))return "";
    const m=u.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if(!m)return "";
    return "https://x.com/"+m[1]+"/status/"+m[2];
  }catch(e){return ""}
}

function xPostTitle(url){
  try{
    const u=new URL(url);
    const handle=u.pathname.split("/").filter(Boolean)[0]||"";
    return handle?"X投稿 @"+handle:"X投稿";
  }catch(e){return "X投稿"}
}

async function saveXPostUrl(raw){
  const xUrl=normalizeXPostUrl(raw);
  if(!xUrl){alert("Xの投稿リンクを貼ってください");return false}
  const all=await dbGetAll();
  if(all.some(x=>normalizeXPostUrl(x.xUrl||"")===xUrl)){
    alert("このX投稿はすでに保存されています");
    return false;
  }
  await dbPut({
    id:"x-"+Date.now().toString(),
    title:xPostTitle(xUrl),
    text:"",
    images:[],
    amazon:"",
    rakuten:"",
    memo:"",
    xUrl,
    savedAt:new Date().toISOString(),
    repostCount:0
  });
  $("xPostUrl").value="";
  await renderArchive();
  await renderToday();
  return true;
}

async function getReadyItems(){
  const all=await dbGetAll();
  const now=Date.now();
  const cutoff=30*24*60*60*1000;
  return all.filter(x=>{
    const last=x.lastRepostedAt?new Date(x.lastRepostedAt).getTime():0;
    return !last || (now-last)>=cutoff;
  }).sort((a,b)=>{
    const al=a.lastRepostedAt?new Date(a.lastRepostedAt).getTime():0;
    const bl=b.lastRepostedAt?new Date(b.lastRepostedAt).getTime():0;
    return al-bl;
  });
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
  root.innerHTML=items.map(x=>{
    const imgs=x.images||(x.image?[x.image]:[]);
    return '<article class="today-item">'+
      (imgs[0]?'<img src="'+imgs[0]+'" alt="">':(x.xUrl?'<div class="today-x-placeholder">X</div>':'<div class="archive-thumb"></div>'))+
      '<div><h3>'+esc(x.title)+'</h3><div class="today-actions">'+
      (x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'<button class="small-btn" data-today-action="sharex" data-id="'+x.id+'">Xへ共有</button>')+
      itemLinkButtons(x)+
      '</div></div></article>';
  }).join("");
}

async function renderArchive(){
  const q=clean($("archiveSearch").value).toLowerCase();
  const all=await dbGetAll();
  const now=Date.now();
  const readyCutoff=30*24*60*60*1000;
  const items=all.filter(x=>{
    const matches=((x.title+" "+x.text+" "+x.memo+" "+(x.xUrl||"")).toLowerCase().includes(q));
    if(!matches)return false;
    if(archiveFilter==="ready"){
      const last=x.lastRepostedAt?new Date(x.lastRepostedAt).getTime():0;
      return !last || (now-last)>=readyCutoff;
    }
    return true;
  });
  const root=$("archiveList");
  if(!items.length){root.innerHTML='<div class="empty">保存した人気投稿はまだありません。</div>';return}
  root.innerHTML=items.map(x=>{
    const imgs=x.images||(x.image?[x.image]:[]);
    return `<article class="archive-item">
      <div class="thumb-wrap">
        ${imgs[0]?'<img class="archive-thumb" src="'+imgs[0]+'" alt="">':(x.xUrl?'<div class="x-placeholder">X</div>':'<div class="archive-thumb"></div>')}
        ${imgs.length>1?'<span class="image-count">'+imgs.length+'枚</span>':''}
      </div>
      <div class="archive-body">
        <h3>${esc(x.title)}${x.xUrl?'<span class="x-link-badge">Xリンク</span>':''}${x.updatedAt?'<span class="edited-badge">修正済</span>':''}</h3>
        <p class="status-line">${x.lastRepostedAt?'最終再投稿：'+new Date(x.lastRepostedAt).toLocaleDateString('ja-JP'):'まだ再投稿していません'}${x.repostCount?' ・ '+x.repostCount+'回':''}</p>
        <p>${esc(x.text)}</p>
        <div class="archive-actions">
          ${x.xUrl?'<a class="small-btn link-btn" href="'+esc(x.xUrl)+'" target="_blank" rel="noopener">Xで見る</a>':'<button class="small-btn" data-action="sharex" data-id="'+x.id+'">Xへ共有</button>'}
          <button class="small-btn" data-action="reposted" data-id="${x.id}">再投稿済みにする</button>
          <button class="small-btn" data-action="edit" data-id="${x.id}">修正</button>
          ${x.amazon?'<a class="small-btn link-btn" href="'+esc(normalizedUrl(x.amazon))+'" target="_blank" rel="noopener">Amazon</a>':''}
          ${x.rakuten?'<a class="small-btn link-btn" href="'+esc(normalizedUrl(x.rakuten))+'" target="_blank" rel="noopener">楽天</a>':''}
          ${x.text?'<button class="small-btn" data-action="copy" data-id="'+x.id+'">投稿文コピー</button>':''}
          ${imgs.length?'<button class="small-btn" data-action="images" data-id="'+x.id+'">画像を見る</button>':''}
          <button class="small-btn danger" data-action="delete" data-id="${x.id}">削除</button>
        </div>
      </div>
    </article>`}).join("");
}
function resetArchiveForm(){
  ["archiveTitle","archiveText","archiveAmazon","archiveRakuten","archiveMemo"].forEach(id=>$(id).value="");
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


$("saveXLink").addEventListener("click",async()=>{
  let value=clean($("xPostUrl").value);
  if(!value && navigator.clipboard){
    try{value=await navigator.clipboard.readText();$("xPostUrl").value=value}catch(e){}
  }
  if(await saveXPostUrl(value))alert("X投稿リンクを保存しました");
});

$("xPostUrl").addEventListener("paste",()=>{
  setTimeout(async()=>{
    const value=clean($("xPostUrl").value);
    if(normalizeXPostUrl(value)){
      if(await saveXPostUrl(value))alert("X投稿リンクを保存しました");
    }
  },0);
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
      memo:clean($("archiveMemo").value),
      updatedAt:now
    };
  }else{
    item={
      id:Date.now().toString(),
      title,text,images:[...selectedImages],
      amazon:clean($("archiveAmazon").value),
      rakuten:clean($("archiveRakuten").value),
      memo:clean($("archiveMemo").value),
      savedAt:now,
      repostCount:0
    };
  }

  await dbPut(item);
  const wasEdit=!!editingId;
  resetArchiveForm();
  await renderArchive();
  alert(wasEdit?"修正を保存しました":"保存しました");
});

$("cancelEdit").addEventListener("click",resetArchiveForm);

$("archiveSearch").addEventListener("input",renderArchive);

$("pickToday").addEventListener("click",renderToday);

$("todayList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-today-action]");
  if(!btn)return;
  const items=await dbGetAll();
  const item=items.find(x=>x.id===btn.dataset.id);
  if(!item)return;
  if(btn.dataset.todayAction==="sharex")await shareToX(item,btn);
});

document.querySelectorAll(".filter-btn").forEach(btn=>btn.addEventListener("click",()=>{
  archiveFilter=btn.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));
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

(async()=>{await migrateLegacy();await renderArchive();await renderToday()})();