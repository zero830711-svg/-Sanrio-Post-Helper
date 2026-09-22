(()=>{"use strict";
const $=id=>document.getElementById(id);
const log=$("log"); log.textContent="BUILD 3050 準備完了。\n";
const say=s=>{log.textContent+=s+"\n";log.scrollTop=log.scrollHeight};
const rel=f=>(f.webkitRelativePath||f._relativePath||f.name||"").replace(/\\/g,"/");
let fs=[],tw=[],md=[],plan={};
const KEY="sanrioCloudSyncKey"; $("k").value=localStorage.getItem(KEY)||"";

function acceptFiles(list,label){
  fs=[...list]; $("p").disabled=!fs.length; $("r").disabled=true; $("plan").textContent="";
  $("s").textContent=fs.length?fs.length+"ファイル読込済み（"+label+"）":"ファイルを取得できませんでした";
  say("選択完了："+fs.length+"ファイル");
}
async function readDirectory(handle,prefix=""){
  const out=[];
  for await(const [name,entry] of handle.entries()){
    const p=prefix?prefix+"/"+name:name;
    if(entry.kind==="file"){
      const file=await entry.getFile();
      try{Object.defineProperty(file,"_relativePath",{value:p,configurable:true})}catch(e){}
      out.push(file);
    }else if(entry.kind==="directory"){
      out.push(...await readDirectory(entry,p));
    }
  }
  return out;
}

$("pickdir").onclick=async()=>{
  say("フォルダ選択を開始…");
  if(!window.showDirectoryPicker){say("このChromeでは新方式が使えません。予備：従来方式を使ってください。");return}
  try{
    $("pickdir").disabled=true;$("s").textContent="フォルダを読み込み中…";
    const dir=await window.showDirectoryPicker({mode:"read"});
    const list=await readDirectory(dir,dir.name);
    acceptFiles(list,"Chrome");
  }catch(e){
    if(e?.name==="AbortError")say("フォルダ選択をキャンセルしました");
    else say("フォルダ読込失敗："+(e?.message||e));
  }finally{$("pickdir").disabled=false}
};
$("f").onchange=()=>acceptFiles($("f").files,"従来方式");

function parseTweetJs(text){
  const m=text.match(/=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if(!m)return [];
  try{return JSON.parse(m[1])}catch(e){say("tweets.js解析失敗："+e.message);return []}
}
function findTweetFile(){
  return fs.find(f=>/data\/tweets\.js$/i.test(rel(f))||/^tweets\.js$/i.test(f.name));
}
function mediaPostId(f){
  const p=rel(f);
  let m=p.match(/tweets_media\/(\d+)-/i);
  if(!m)m=f.name.match(/^(\d+)-/);
  return m?m[1]:"";
}
function isMedia(f){return /\.(jpe?g|png|gif|mp4|mov|webm)$/i.test(f.name)}

const db=()=>new Promise((res,rej)=>{const q=indexedDB.open("sanrioPostHelperDB",1);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
const all=()=>db().then(d=>new Promise((res,rej)=>{const q=d.transaction("popularPosts").objectStore("popularPosts").getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)}));
const put=x=>db().then(d=>new Promise((res,rej)=>{const t=d.transaction("popularPosts","readwrite");t.objectStore("popularPosts").put(x);t.oncomplete=res;t.onerror=()=>rej(t.error)}));

$("p").onclick=async()=>{
  say("解析開始…");
  try{
    const x=findTweetFile();
    if(!x){say("tweets.js が見つかりません。Xアーカイブの一番上のフォルダを選んでください。");return}
    say("tweets.js 発見："+rel(x));
    tw=parseTweetJs(await x.text());
    md=fs.filter(isMedia).filter(f=>mediaPostId(f));
    const old=await all(),ids=new Set(old.map(v=>String(v.postId||"")));
    let same=0,newCount=0;
    for(const w of tw){const id=String((w.tweet||w).id||"");if(!id)continue;ids.has(id)?same++:newCount++}
    const imgs=md.filter(f=>/\.(jpe?g|png|gif)$/i.test(f.name)).length,vids=md.length-imgs;
    plan={same,newCount,imgs,vids};
    $("s").textContent="投稿 "+tw.length+"件 / 写真 "+imgs+"枚 / 動画 "+vids+"本";
    $("plan").textContent="既存一致 "+same+"件 / 新規 "+newCount+"件";
    $("r").disabled=!tw.length;
    say("解析完了");
  }catch(e){say("解析エラー："+(e?.message||e))}
};

function merge(o,t,id){return {...o,id:o.id||"xarchive-"+id,postId:id,xUrl:"https://x.com/i/web/status/"+id,text:t.full_text||t.text||o.text||"",postedAt:t.created_at||o.postedAt||"",source:o.source==="x-analytics"?"x-analytics":"x-archive",updatedAt:new Date().toISOString()}}
async function sendMedia(c){
  const fd=new FormData();c.forEach(x=>{fd.append("post_ids[]",x.id);fd.append("media[]",x.f,x.f.name)});
  const q=await fetch($("a").value,{method:"POST",headers:{Authorization:"Bearer "+$("k").value},body:fd});
  if(!q.ok)throw Error("media HTTP "+q.status);return q.json();
}
async function pushPosts(items){
  const u=$("a").value.replace(/archive-media-batch\.php(?:\?.*)?$/,"api2580.php?action=push");
  let completed=0,failed=[];
  const preview=x=>String(x?.text||"").replace(/\s+/g," ").slice(0,80);
  const send=async batch=>{
    const q=await fetch(u,{method:"POST",headers:{Authorization:"Bearer "+$("k").value,"Content-Type":"application/json"},body:JSON.stringify({items:batch})});
    let detail="",body=null; try{body=await q.json();detail=body?.error||""}catch(e){detail="応答をJSONとして読めません"}
    if(!q.ok || body?.ok===false){
      const e=new Error(`HTTP ${q.status}${detail?"："+detail:""}`); e.status=q.status;e.detail=body;throw e;
    }
  };
  const save=async(batch,offset)=>{
    try{await send(batch);completed+=batch.length;say(`投稿同期 ${completed}/${items.length}`)}
    catch(e){
      if(batch.length>1){
        const mid=Math.ceil(batch.length/2);say(`投稿バッチ失敗（${batch.length}件）：${e.message} → 分割して再試行`);
        await save(batch.slice(0,mid),offset);await save(batch.slice(mid),offset+mid);return;
      }
      const item=batch[0];failed.push(item);
      say(`投稿をスキップ（他は継続）: id=${item?.id||""}, postId=${item?.postId||""}, 本文=${preview(item)} / ${e.message}`);
    }
  };
  for(let i=0;i<items.length;i+=25)await save(items.slice(i,i+25),i);
  if(failed.length)say(`投稿同期完了（一部失敗 ${failed.length}件）。失敗ID: ${failed.map(x=>x.postId||x.id).join(", ")}`);
}

$("r").onclick=async()=>{
  $("r").disabled=true;localStorage.setItem(KEY,$("k").value);say("取り込み開始…");
  try{
    const old=await all(),by=new Map(old.map(x=>[String(x.postId||x.id),x])),merged=[];
    for(const w of tw){const t=w.tweet||w,id=String(t.id||"");if(!id)continue;const x=merge(by.get(id)||{},t,id);await put(x);by.set(id,x);merged.push(x)}
    say("投稿データ "+merged.length+"件を統合");
    const jobs=md.map(f=>({f,id:mediaPostId(f)})).filter(x=>x.id),chunks=[];for(let i=0;i<jobs.length;i+=20)chunks.push(jobs.slice(i,i+20));
    const doneKey="xArchiveBatchDoneV5",done=new Set(JSON.parse(localStorage.getItem(doneKey)||"[]"));const pending=chunks.map((c,i)=>({c,i})).filter(x=>!done.has(x.i));
    say("メディア対象 "+jobs.length+"件 / 未処理 "+pending.length+"バッチ");
    let next=0,ok=0,fail=0;
    async function worker(){while(true){const n=next++;if(n>=pending.length)return;const {c,i}=pending[n];try{const z=await sendMedia(c);for(const r of z.results||[]){if(!r.ok||!r.publicUrl)continue;const j=c[r.index],item=by.get(j.id);if(!item)continue;const k=/\.(mp4|mov|webm)$/i.test(j.f.name)?"videos":"images",list=Array.isArray(item[k])?item[k]:[];if(!list.includes(r.publicUrl)){item[k]=[...list,r.publicUrl];await put(item);by.set(j.id,item)}}done.add(i);localStorage.setItem(doneKey,JSON.stringify([...done]));ok+=c.length;$("g").value=(ok+fail)/Math.max(1,jobs.length);say("メディア "+Math.min(ok,jobs.length)+"/"+jobs.length)}catch(e){fail+=c.length;say("失敗バッチ "+(i+1)+"："+e.message)}}}
    await Promise.all([worker(),worker(),worker()]);
    say("メディア完了 成功 "+ok+" / 失敗 "+fail);
    const ids=new Set(tw.map(w=>String((w.tweet||w).id||""))),final=[...by.values()].filter(x=>ids.has(String(x.postId||"")));
    try{await pushPosts(final);say("投稿＋メディアURLをクラウド同期完了")}catch(e){say("投稿同期失敗："+e.message)}
    say("完了：既存 "+plan.same+" / 新規 "+plan.newCount+" / 写真 "+plan.imgs+" / 動画 "+plan.vids);
  }catch(e){say("取り込みエラー："+(e?.message||e))}
  $("r").disabled=false;
};
})();
