(()=>{
'use strict';
const $=id=>document.getElementById(id),endpoint='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/amazon-creators.php';
let busy=false,configured=false;
function syncKey(){return $('syncKey').value.trim()||localStorage.getItem('sanrioCloudSyncKey')||'';}
function status(text){$('connectionStatus').textContent=text;}
function setBusy(value){busy=value;for(const id of ['saveConnection','testConnection','searchApi','credentialCsv'])$(id).disabled=value;}
async function request(action,data){
 const key=syncKey();if(!key){$('syncField').hidden=false;throw new Error('アプリの同期キーを入力してください。');}
 const response=await fetch(endpoint+'?action='+action,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',signal:AbortSignal.timeout(60000)});
 let d;try{d=await response.json();}catch{throw new Error('接続先から応答を確認できませんでした。');}if(!response.ok||!d.ok)throw new Error(d.error||'Amazonに接続できませんでした。');return d;
}
function validProductUrl(url){try{const p=new URL(url);return p.protocol==='https:'&&p.hostname==='www.amazon.co.jp'&&!p.username&&!p.password&&!p.port;}catch{return false;}}
function render(data){
 $('apiResults').replaceChildren();for(const item of data.items||[]){
  if(!validProductUrl(item.url))continue;
  const card=document.createElement('article');card.className='item';const title=document.createElement('h3');title.textContent=item.title;
  if(item.image){try{const u=new URL(item.image);if(u.protocol==='https:'&&['m.media-amazon.com','images-na.ssl-images-amazon.com','images-fe.ssl-images-amazon.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port){const img=document.createElement('img');img.src=u.href;img.alt='';img.className='product-image';img.loading='lazy';img.referrerPolicy='no-referrer';card.append(img);}}catch{}}
  const links=document.createElement('div');links.className='buttons';const amazon=document.createElement('a');amazon.className='btn amazon';amazon.textContent='Amazonで確認';amazon.href=item.url;amazon.target='_blank';amazon.rel='noopener noreferrer';
  const choose=document.createElement('a');choose.className='btn outline';choose.textContent='この商品を候補づくりへ';const u=new URL('./amazon-scout.html',location.href);u.searchParams.set('title',item.title);u.searchParams.set('url',item.url);u.searchParams.set('tag',data.partnerTag||$('partnerTag').value);choose.href=u.href;
  links.append(amazon,choose);card.append(title,links);$('apiResults').append(card);
 }
}
async function search(check=false){
 const data=await request('search',{keywords:check?'サンリオ':$('apiQuery').value.trim()});
 status('Amazonの商品APIに接続できました。');render(data);$('searchStatus').textContent=data.items.length?data.items.length+'件を取得しました。':'接続できました。条件に合う商品はありませんでした。';return data;
}
$('saveConnection').onclick=async()=>{
 if(busy)return;setBusy(true);status('認証情報を保存しています…');
 try{
  const d=await request('settings',{credentialId:$('credentialId').value.trim(),secret:$('credentialSecret').value.trim(),version:$('credentialVersion').value,partnerTag:$('partnerTag').value.trim()});configured=d.configured;
  $('credentialSecret').value='';$('credentialId').value='';status('保存しました。Amazonの商品APIを確認しています…');
  await search(true);
 }catch(e){$('credentialSecret').value='';status((configured?'認証情報は保存済みです。':'')+e.message);}finally{setBusy(false);}
};
$('testConnection').onclick=async()=>{if(busy)return;setBusy(true);status('保存済みの認証情報で確認中…');try{await search(true);}catch(e){status(e.message);}finally{setBusy(false);}};
$('searchApi').onclick=async()=>{if(busy)return;setBusy(true);$('apiResults').replaceChildren();$('searchStatus').textContent='商品を取得しています…';try{await search();}catch(e){$('searchStatus').textContent=e.message;}finally{setBusy(false);}};
function csvRows(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('CSVの形式を確認してください。');row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
$('credentialCsv').onchange=async()=>{
 const file=$('credentialCsv').files[0];if(!file)return;
 try{
  if(file.size>32768)throw new Error('認証情報のCSVを選んでください。');
  const rows=csvRows((await file.text()).replace(/^\uFEFF/,''));if(rows.length<2)throw new Error('CSVの見出しと認証情報を確認してください。');
  const headers=rows[0].map(v=>v.toLowerCase().replace(/[\s_-]/g,'')),id=headers.findIndex(v=>/credentialid|clientid|認証情報id/.test(v)),secret=headers.findIndex(v=>/secret|シークレット/.test(v)),version=headers.findIndex(v=>/version|バージョン/.test(v));
  if(id<0||secret<0||version<0||!/^(?:3\.1|3\.2|3\.3)$/.test((rows[1][version]||'').trim()))throw new Error('CSVを読み込めませんでした。認証情報IDとシークレットを手入力してください。');
  $('credentialId').value=(rows[1][id]||'').trim();$('credentialSecret').value=(rows[1][secret]||'').trim();$('credentialVersion').value=rows[1][version].trim();status('CSVを読み込みました。内容を確認して「保存して接続確認」を押してください。');
 }catch(e){$('credentialId').value='';$('credentialSecret').value='';status(e.message);}finally{$('credentialCsv').value='';}
};
$('syncField').hidden=!!syncKey();
setBusy(true);
request('settings').then(d=>{configured=d.configured;$('credentialVersion').value=d.version;$('partnerTag').value=d.partnerTag;status(configured?'認証情報は保存済みです。「保存済みの接続を確認」を押してください。':'認証情報IDとシークレットを入力するか、保存したCSVを読み込んでください。');}).catch(e=>status(e.message)).finally(()=>setBusy(false));
window.addEventListener('pagehide',()=>{$('credentialSecret').value='';$('credentialId').value='';$('syncKey').value='';$('credentialCsv').value='';});
})();
