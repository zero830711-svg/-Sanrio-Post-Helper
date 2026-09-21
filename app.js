const $=id=>document.getElementById(id);
const clean=v=>(v||"").trim();
const ARCHIVE_KEY="sanrioPopularPostsV1";
let imageData="";

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

function getArchive(){
  try{return JSON.parse(localStorage.getItem(ARCHIVE_KEY)||"[]")}catch{return[]}
}
function setArchive(items){localStorage.setItem(ARCHIVE_KEY,JSON.stringify(items))}
function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

function renderArchive(){
  const q=clean($("archiveSearch").value).toLowerCase();
  const items=getArchive().filter(x=>((x.title+" "+x.text+" "+x.memo).toLowerCase().includes(q)));
  const root=$("archiveList");
  if(!items.length){root.innerHTML='<div class="empty">保存した人気投稿はまだありません。</div>';return}
  root.innerHTML=items.map(x=>`
    <article class="archive-item">
      ${x.image?'<img class="archive-thumb" src="'+x.image+'" alt="">':'<div class="archive-thumb"></div>'}
      <div class="archive-body">
        <h3>${esc(x.title)}</h3>
        <p>${esc(x.text)}</p>
        <div class="archive-actions">
          <button class="small-btn" data-action="copy" data-id="${x.id}">投稿文コピー</button>
          <button class="small-btn" data-action="load" data-id="${x.id}">呼び出す</button>
          ${x.image?'<a class="small-btn" href="'+x.image+'" download="'+encodeURIComponent(x.title||'image')+'.jpg">画像を開く</a>':''}
          <button class="small-btn danger" data-action="delete" data-id="${x.id}">削除</button>
        </div>
      </div>
    </article>`).join("");
}

function resetArchiveForm(){
  ["archiveTitle","archiveText","archiveAmazon","archiveRakuten","archiveMemo"].forEach(id=>$(id).value="");
  $("archiveImage").value="";
  $("archivePreview").src="";
  $("archivePreview").classList.add("hidden");
  imageData="";
}

$("generate").addEventListener("click",build);

document.querySelectorAll(".copy").forEach(btn=>btn.addEventListener("click",async()=>{
  const t=$(btn.dataset.target); if(!t.value)return;
  await navigator.clipboard.writeText(t.value);
  const old=btn.textContent;btn.textContent="コピー済み";setTimeout(()=>btn.textContent=old,1200);
}));

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");$(btn.dataset.tab).classList.add("active");
}));

$("archiveImage").addEventListener("change",e=>{
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{imageData=reader.result;$("archivePreview").src=imageData;$("archivePreview").classList.remove("hidden")};
  reader.readAsDataURL(file);
});

$("saveArchive").addEventListener("click",()=>{
  const title=clean($("archiveTitle").value);
  const text=clean($("archiveText").value);
  if(!title&&!text){alert("商品名か投稿文を入れてください");return}
  const items=getArchive();
  items.unshift({
    id:Date.now().toString(),
    title,text,image:imageData,
    amazon:clean($("archiveAmazon").value),
    rakuten:clean($("archiveRakuten").value),
    memo:clean($("archiveMemo").value),
    savedAt:new Date().toISOString()
  });
  try{setArchive(items)}catch(e){alert("保存容量が足りません。画像を減らしてもう一度試してください。");return}
  resetArchiveForm();renderArchive();alert("保存しました");
});

$("archiveSearch").addEventListener("input",renderArchive);

$("archiveList").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-action]"); if(!btn)return;
  const items=getArchive();const item=items.find(x=>x.id===btn.dataset.id);if(!item)return;
  if(btn.dataset.action==="copy"){
    await navigator.clipboard.writeText(item.text||"");
    btn.textContent="コピー済み";setTimeout(()=>btn.textContent="投稿文コピー",1200);
  }
  if(btn.dataset.action==="load"){
    $("title").value=item.title||"";$("source").value=item.text||"";$("amazon").value=item.amazon||"";$("rakuten").value=item.rakuten||"";
    document.querySelector('[data-tab="create"]').click();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  if(btn.dataset.action==="delete"){
    if(!confirm("この保存データを削除しますか？"))return;
    setArchive(items.filter(x=>x.id!==item.id));renderArchive();
  }
});

renderArchive();