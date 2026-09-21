const $=id=>document.getElementById(id);
const clean=v=>(v||"").trim();
const DB_NAME="sanrioPostHelperDB";
const STORE="popularPosts";
const LEGACY_KEY="sanrioPopularPostsV1";
let selectedImages=[];

function build(){
  const title=clean($("title").value)||"気になるサンリオグッズ";
  const source=clean($("source").value);
  const amazon=clean($("amazon").value);
  const rakuten=clean($("rakuten").value);
  const links=[amazon&&("Amazon："+amazon),rakuten&&("楽天："+rakuten)].filter(Boolean).join("\n");
  $("xOutput").value=("🎀 "+title+"\n\n"+(source?source.slice(0,180):"以前話題になったアイテムをもう一度チェック。")+(links?"\n\n"+links:"")).trim();
  $("threadsOutput").value=("🎀 "+title+"\n\n"+(source||"以前紹介した人気アイテムをあらためてチェック。今も探している人向けに、見つけやすい形でまとめ直しました。")+(links?"\n\n購入先\n"+links:"")).trim();
  $("blogOutput").value=("# "+title+"\n\n以前紹介した人気グッズの中から、今も気になる人が多そうなアイテムをまとめ直しました。\n\n## 商品について\n"+(source||"過去に紹介した内容をもとに、現在チェックしやすい形で整理しています。")+"\n\n## 今買えるショップ\n"+(links||"購入先URLを追加してください。")+"\n\n## ひとこと\n過去に話題になった商品でも、再販や在庫復活で見つかることがあります。気になる場合は販売ページで最新の在庫状況を確認してください。");
}

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
async function renderArchive(){
  const q=clean($("archiveSearch").value).toLowerCase();
  const all=await dbGetAll();
  const items=all.filter(x=>((x.title+" "+x.text+" "+x.memo).toLowerCase().includes(q)));
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
        <h3>${esc(x.title)}</h3>
        <p>${esc(x.text)}</p>
        <div class="archive-actions">
          <button class="small-btn" data-action="copy" data-id="${x.id}">投稿文コピー</button>
          <button class="small-btn" data-action="load" data-id="${x.id}">呼び出す</button>
          ${imgs.length?'<button class="small-btn" data-action="images" data-id="'+x.id+'">画像を見る</button>':''}
          <button class="small-btn danger" data-action="delete" data-id="${x.id}">削除</button>
        </div>
      </div>
    </article>`}).join("");
}
function resetArchiveForm(){
  ["archiveTitle","archiveText","archiveAmazon","archiveRakuten","archiveMemo"].forEach(id=>$(id).value="");
  $("archiveImage").value="";selectedImages=[];renderPreview();
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

$("generate").addEventListener("click",build);

document.querySelectorAll(".copy").forEach(btn=>btn.addEventListener("click",async()=>{
  const t=$(btn.dataset.target);if(!t.value)return;
  await navigator.clipboard.writeText(t.value);
  const old=btn.textContent;btn.textContent="コピー済み";setTimeout(()=>btn.textContent=old,1200);
}));

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");$(btn.dataset.tab).classList.add("active");
}));

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
  await dbPut({
    id:Date.now().toString(),
    title,text,images:[...selectedImages],
    amazon:clean($("archiveAmazon").value),
    rakuten:clean($("archiveRakuten").value),
    memo:clean($("archiveMemo").value),
    savedAt:new Date().toISOString()
  });
  resetArchiveForm();await renderArchive();alert("保存しました");
});

$("archiveSearch").addEventListener("input",renderArchive);

$("archiveList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-action]");if(!btn)return;
  const items=await dbGetAll();const item=items.find(x=>x.id===btn.dataset.id);if(!item)return;
  if(btn.dataset.action==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿文コピー",1200);
  }
  if(btn.dataset.action==="load"){
    $("title").value=item.title||"";$("source").value=item.text||"";$("amazon").value=item.amazon||"";$("rakuten").value=item.rakuten||"";
    document.querySelector('[data-tab="create"]').click();window.scrollTo({top:0,behavior:"smooth"});
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

(async()=>{await migrateLegacy();await renderArchive()})();