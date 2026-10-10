// Candidate-specific edits stay separate from the imported archive.
const candidateEditCache=new Map();
let candidateEditOpenSeq=0;
function candidateEditDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('sanrioCandidateEdits',1);req.onupgradeneeded=()=>req.result.createObjectStore('edits',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function candidateReadEdit(id){if(candidateEditCache.has(id))return candidateEditCache.get(id);const db=await candidateEditDB();try{return await new Promise((resolve,reject)=>{const req=db.transaction('edits').objectStore('edits').get(id);req.onsuccess=()=>{candidateEditCache.set(id,req.result||null);resolve(req.result||null);};req.onerror=()=>reject(req.error);});}finally{db.close();}}
async function candidateWriteEdit(item,patch){const id=canonicalPostKey(item);const previous=await candidateReadEdit(id);const edit={...previous,...patch,id,updatedAt:Date.now()};const db=await candidateEditDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('edits','readwrite');tx.objectStore('edits').put(edit);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存できませんでした'));});candidateEditCache.set(id,edit);return edit;}finally{db.close();}}
function candidateLinkKind(raw){let u;try{u=new URL(raw);}catch{return '';}
 if(u.protocol!=='https:'||u.username||u.password)return '';
 const host=u.hostname.toLowerCase();if(/^(?:[a-z0-9-]+\.)*(?:amazon\.(?:co\.jp|com|jp|co\.uk|de|fr|it|es|ca|com\.au)|amzn\.(?:to|asia)|link\.amazon|a\.co)$/.test(host))return 'amazon';if(/^(?:[a-z0-9-]+\.)*rakuten\.(?:co\.jp|com)$/.test(host)||host==='r10.to'||host==='a.r10.to')return 'rakuten';return '';
}
function candidateReplaceLinks(item,lines){const old=todayAffiliateLinks(item);let text=String(item.text||'');
 const replacements=new Map(old.map((link,i)=>[link.url,lines[i]||'']));
 text=text.replace(/https?:\/\/[^\s<>"']+/g,raw=>{const end=raw.match(/[.,!?。，！？;；:：)）\]】」』]+$/)?.[0]||'';const url=end?raw.slice(0,-end.length):raw;return replacements.has(url)?replacements.get(url)+end:raw;});
 return {text:text.replace(/\n{3,}/g,'\n\n').trim(),amazon:lines.filter(u=>candidateLinkKind(u)==='amazon').join('\n'),rakuten:lines.filter(u=>candidateLinkKind(u)==='rakuten').join('\n'),affiliateUrl:''};
}
function candidateApplyEdit(item,edit){if(!edit)return item;const additions=Array.isArray(edit.photos)?edit.photos:[];const base=mediaArray(item._candidateBaseImages||item.images||(item.image?[item.image]:[]));
 return {...item,...(edit.links||{}),image:'',images:[...base,...additions],_candidateBaseImages:base,_candidateAddedPhotos:additions};}
async function candidateLoadItem(item){try{return candidateApplyEdit(item,await candidateReadEdit(canonicalPostKey(item)));}catch{candidateEditCache.delete(canonicalPostKey(item));return item;}}
function candidateEditRender(item){$('candidateLinks').value=todayAffiliateLinks(item).map(x=>x.url).join('\n');$('candidateEditStatus').textContent='変更はこの端末・ブラウザに保存し、共有へ反映します。';$('candidatePhotoStatus').textContent='追加写真も含め、共有する写真を4枚まで選べます。';}
async function candidateRefresh(item,edit,selection){if(detailCurrentItem!==item)return;const next=candidateApplyEdit(item,edit);await showTodayDetail(next,true);if(selection){detailPhotoSelection=selection;keepDetailPhotoChoice();}}
$('candidateLinksSave').addEventListener('click',async()=>{const item=detailCurrentItem;if(!item)return;const button=$('candidateLinksSave');button.disabled=true;
 try{const lines=$('candidateLinks').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>12)throw new Error('リンクは12本までです。');if(lines.some(u=>!candidateLinkKind(u)))throw new Error('Amazon・楽天のhttpsリンクを1行に1本入力してください。');const patch=candidateReplaceLinks(item,[...new Set(lines)]);const selection=detailPhotoSelection.slice();const edit=await candidateWriteEdit(item,{links:patch});await candidateRefresh(item,edit,selection);if(detailCurrentItem&&canonicalPostKey(detailCurrentItem)===canonicalPostKey(item))$('candidateEditStatus').textContent='リンクを保存しました。ChatGPT・Threads・ブログ共有に反映します。';}
 catch(e){$('candidateEditStatus').textContent=e.message||'保存できませんでした。';}finally{button.disabled=false;}});
function candidateDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
$('candidatePhotos').addEventListener('change',async()=>{const item=detailCurrentItem,files=Array.from($('candidatePhotos').files||[]);$('candidatePhotos').value='';if(!item||!files.length)return;$('candidatePhotos').disabled=true;
 try{const existing=item._candidateAddedPhotos||[];if(existing.length+files.length>8)throw new Error('追加写真は8枚までです。');const photos=[];for(const file of files){if(!file.type.startsWith('image/'))throw new Error('写真ファイルを選んでください。');if(file.size>15*1024*1024)throw new Error('写真は1枚15MB以下にしてください。');photos.push(await candidateDataURL(await sharePhotoPng(file)));}
 const base=mediaArray(item.images||(item.image?[item.image]:[]));const selected=detailPhotoSelection.slice();for(let i=0;i<photos.length&&selected.length<4;i++)selected.push(base.length+i);
 const edit=await candidateWriteEdit(item,{photos:[...existing,...photos]});await candidateRefresh(item,edit,selected);if(detailCurrentItem&&canonicalPostKey(detailCurrentItem)===canonicalPostKey(item))$('candidatePhotoStatus').textContent=photos.length+'枚追加して保存しました。使う写真を4枚まで選んでください。';
 }catch(e){$('candidatePhotoStatus').textContent=e.message||'写真を保存できませんでした。';}finally{$('candidatePhotos').disabled=false;}});
