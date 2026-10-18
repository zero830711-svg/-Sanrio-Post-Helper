(()=>{
'use strict';
const file=document.getElementById('sph-import-file'),host=document.getElementById('sph-import-list');
if(!file||!host)return;
async function request(action,p){const r=await fetch(SPHImportConfig.root+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-WP-Nonce':SPHImportConfig.nonce},body:JSON.stringify(p)});const d=await r.json();if(!r.ok)throw new Error(d.message||'取り込みできませんでした。');return d;}
file.onchange=async()=>{
 host.replaceChildren();const f=file.files[0];if(!f)return;
 if(f.size>2*1024*1024){host.textContent='ファイルは2MB以下にしてください。';return;}
 let rows;try{const data=JSON.parse(await f.text());rows=Array.isArray(data)?data:[data];if(rows.length>20)throw Error();}catch{host.textContent='20商品以内のJSONファイルを選んでください。';return;}
 for(const p of rows){
  const card=document.createElement('section'),title=document.createElement('h2'),note=document.createElement('p'),button=document.createElement('button'),source=document.createElement('p');
  title.textContent=p.title||'商品名なし';source.textContent='出典：'+(p.source||'未入力')+' ／ JAN：'+(p.jan||'未入力');button.textContent='重複を確認して下書きに追加';button.type='button';
  card.append(title,source,note,button);host.append(card);
  try{const d=await request('check',p);if(d.duplicates.length){note.textContent='登録済み：'+d.duplicates.map(x=>x.title+'（'+x.status+'）').join('、');button.disabled=true;}else note.textContent='重複は見つかりません。内容は公開前に編集できます。';}catch(e){note.textContent=e.message;button.disabled=true;}
  button.onclick=async()=>{button.disabled=true;try{const d=await request('import',p);note.textContent='下書きを作成しました。画像・本文・購入先を確認してから公開してください。';const a=document.createElement('a');a.href=d.edit;a.textContent='WordPressで下書きを編集';card.append(a);}catch(e){note.textContent=e.message;button.disabled=false;}};
 }
};
})();
