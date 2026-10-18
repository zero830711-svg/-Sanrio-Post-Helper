(()=>{
'use strict';
let current=null;
const safe=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
function payload(row,link){
 const item=row.item||{},identity=row.identity||{};
 const images=Array.isArray(row.selected)?row.selected.map(i=>(item.images||[])[i]):item.images||[];
 const character=String(item.title||'').match(/シナモロール|クロミ|マイメロディ|ポムポムプリン|ポチャッコ|ハローキティ|ハンギョドン|けろけろけろっぴ|タキシードサム|バッドばつ丸|あひるのペックル|リトルツインスターズ|ウサハナ/)?.[0]||'';
 return {version:1,title:String(item.title||'').slice(0,300),jan:String(identity.jan||'').replace(/\D/g,''),model:String(identity.model||'').slice(0,80),character,source:safe(item.url),images:images.filter(x=>safe(x)).slice(0,4),facts:(item.paragraphs||[]).map(x=>String(x).slice(0,3000)).slice(0,15),affiliate:safe(link)};
}
window.SPHBlogExport={payload};
document.addEventListener('sph-blog-product',event=>{
 current=event.detail;
 const editor=document.getElementById('flowEditor');if(!editor||document.getElementById('flowBlogExport'))return;
 const box=document.createElement('section'),b=document.createElement('button'),note=document.createElement('p');
 b.id='flowBlogExport';b.type='button';b.className='small-btn';b.textContent='ブログ用データを保存';
 note.className='backup-note';note.textContent='公式情報・JAN・選択中の紹介リンクをJSONに保存します。WordPressの商品取り込みで重複を確認して下書きにできます。';
 b.onclick=()=>{
  const row=current?.getProduct?.();if(!row)return;const p=payload(row,document.getElementById('flowLink')?.value||'');
  if(!p.title||!p.source){note.textContent='商品名と出典URLが必要です。';return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='sanrio-product-'+(p.jan||'draft')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  note.textContent='データを保存しました。WordPressの「商品取り込み」でこのJSONを選択してください。本文は原文から確認して編集できます。';
 };
 box.append(b,note);editor.append(box);
});
})();
