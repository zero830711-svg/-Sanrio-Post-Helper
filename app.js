const $=id=>document.getElementById(id);
const clean=v=>(v||"").trim();

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

$("generate").addEventListener("click",build);
document.querySelectorAll(".copy").forEach(btn=>btn.addEventListener("click",async()=>{
  const t=$(btn.dataset.target);
  if(!t.value)return;
  await navigator.clipboard.writeText(t.value);
  const old=btn.textContent;
  btn.textContent="コピー済み";
  setTimeout(()=>btn.textContent=old,1200);
}));