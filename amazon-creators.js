(()=>{
'use strict';
const $=id=>document.getElementById(id),endpoint='https://fan-info.zombie.jp/sanrio-fan/sanrio-sync/amazon-creators.php';
let busy=false,configured=false,lastItems=[];
const CHARACTERS=[['ハローキティ','hello-kitty'],['マイメロディ','my-melody'],['リトルツインスターズ','little-twin-stars'],['ポムポムプリン','pompompurin'],['シナモロール','cinnamoroll'],['クロミ','kuromi'],['ポチャッコ','pochacco'],['ハンギョドン','hangyodon'],['タキシードサム','tuxedo-sam'],['けろけろけろっぴ','kerokerokeroppi'],['バッドばつ丸','bad-badtz-maru'],['あひるのペックル','ahiru-no-pekkle'],['ぐでたま','gudetama'],['マイスウィートピアノ','my-sweet-piano'],['ウィッシュミーメル','wish-me-mell'],['こぎみゅん','cogimyun'],['はなまるおばけ','hanamaru-obake'],['がおぱわるぅ','gaopoweru'],['ぼんぼんりぼん','bonbonribbon'],['ディアダニエル','dear-daniel'],['チャーミーキティ','charmmy-kitty'],['まるもふびより','marumofubiyori'],['コロコロクリリン','corocorokuririn'],['マロンクリーム','marroncream'],['シュガーバニーズ','sugar-bunnies'],['ウサハナ','usahana'],['マシュマロみたいなふわふわにゃんこ','marshmallow-fuwafuwa-nyanko'],['チョコキャット','chococat'],['KIRIMIちゃん.','kirimi-chan'],['おさるのもんきち','osaru-no-monkichi'],['ゴロピカドン','goropikadon'],['ジュエルペット','jewelpet'],['みんなのたあ坊','minna-no-taabou'],['リトルフォレストフェロォ','little-forest-fellow'],['ルロロマニック','ruroromannic'],['JOCHUM','jochum']];
const KINDS=[['ぬいぐるみ','plushies'],['バッグ・ポーチ','bags-pouches'],['文具・シール','stationery-stickers'],['生活雑貨','lifestyle-goods'],['推し活・収納','oshikatsu-storage'],['おもちゃ','toys'],['ファッション','fashion'],['本・カレンダー','books-calendars']];
function fillOptions(id,items){const select=$(id);for(const [label,value] of items){const option=document.createElement('option');option.value=value;option.textContent=label;option.dataset.label=label;select.append(option);}}
function guessedCharacter(title){const s=String(title||'');return CHARACTERS.find(([name])=>s.includes(name))||null;}
function guessedKind(title){const s=String(title||'');const rules=[[/ぬい|マスコット|抱き枕|ぬいぐるみ/,'plushies'],[/バッグ|ポーチ|ショルダー|リュック/,'bags-pouches'],[/シール|ステッカー|文具|ペン|ノート|メモ|マスキングテープ/,'stationery-stickers'],[/収納|カードホルダー|トレカ|アクスタ|缶バッジ|コレクトブック/,'oshikatsu-storage'],[/おもちゃ|玩具|パズル|ゲーム|ブロック/,'toys'],[/Tシャツ|靴下|パジャマ|衣類|服|ファッション/,'fashion'],[/カレンダー|絵本|書籍|コミック|ブック/,'books-calendars'],[/マグ|カップ|食器|タオル|ボトル|水筒|雑貨/,'lifestyle-goods']];const match=rules.find(([pattern])=>pattern.test(s));return match?KINDS.find(([,slug])=>slug===match[1])||null:null;}
function selectFor(className,items,guess){const select=document.createElement('select');select.className=className;select.setAttribute('aria-label',className==='catalog-character'?'商品キャラクター':'商品ジャンル');const first=document.createElement('option');first.value='';first.textContent='要確認';select.append(first);for(const [label,value] of items){const option=document.createElement('option');option.value=value;option.textContent=label;option.dataset.label=label;select.append(option);}if(guess)select.value=guess[1];return select;}
fillOptions('catalogCharacter',CHARACTERS);fillOptions('catalogKind',KINDS);
function syncKey(){return $('syncKey').value.trim()||localStorage.getItem('sanrioCloudSyncKey')||'';}
function status(text){$('connectionStatus').textContent=text;}
function setBusy(value){busy=value;for(const id of ['saveConnection','testConnection','searchApi','credentialCsv'])$(id).disabled=value;}
async function request(action,data){
 const key=syncKey();if(!key){$('syncField').hidden=false;throw new Error('アプリの同期キーを入力してください。');}
 const response=await fetch(endpoint+'?action='+action,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',signal:AbortSignal.timeout(60000)});
 let d;try{d=await response.json();}catch{throw new Error('接続先から応答を確認できませんでした。');}if(!response.ok||!d.ok){const diagnostic=['authentication','product-search'].includes(d.stage)&&Number.isInteger(d.upstreamStatus)?'（'+(d.stage==='authentication'?'認証':'商品検索')+'／HTTP '+d.upstreamStatus+'）':'';throw new Error((d.error||'Amazonに接続できませんでした。')+diagnostic);}return d;
}
function validProductUrl(url){try{const p=new URL(url);return p.protocol==='https:'&&p.hostname==='www.amazon.co.jp'&&!p.username&&!p.password&&!p.port;}catch{return false;}}
function render(data){
 lastItems=data.items||[];$('apiResults').replaceChildren();for(const item of lastItems){
  if(!validProductUrl(item.url))continue;
  const card=document.createElement('article');card.className='item';const title=document.createElement('h3');title.textContent=item.title;
  if(item.image){try{const u=new URL(item.image);if(u.protocol==='https:'&&['m.media-amazon.com','images-na.ssl-images-amazon.com','images-fe.ssl-images-amazon.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port){const img=document.createElement('img');img.src=u.href;img.alt='';img.className='product-image';img.loading='lazy';img.referrerPolicy='no-referrer';card.append(img);}}catch{}}
  const asin=String(item.asin||item.ASIN||'').toUpperCase();if(/^[A-Z0-9]{10}$/.test(asin)){const pick=document.createElement('label');pick.className='catalog-pick';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=asin;checkbox.setAttribute('aria-label','カタログ候補に選ぶ');pick.append(checkbox,document.createTextNode(' カタログ候補に選ぶ'));card.append(pick);const classification=document.createElement('details');classification.className='catalog-classification';const summary=document.createElement('summary');summary.textContent='キャラクター・ジャンルを確認';const fields=document.createElement('div');fields.className='catalog-item-fields';const charSelect=selectFor('catalog-character',CHARACTERS,guessedCharacter(item.title));const kindSelect=selectFor('catalog-kind',KINDS,guessedKind(item.title));fields.append(charSelect,kindSelect);classification.append(summary,fields);card.append(classification);}
  const links=document.createElement('div');links.className='buttons';const amazon=document.createElement('a');amazon.className='btn amazon';amazon.textContent='Amazonで確認';amazon.href=item.url;amazon.target='_blank';amazon.rel='noopener noreferrer';
  const choose=document.createElement('a');choose.className='btn outline';choose.textContent='この商品を候補づくりへ';const u=new URL('./amazon-scout.html',location.href);u.searchParams.set('title',item.title);u.searchParams.set('url',item.url);u.searchParams.set('tag',data.partnerTag||$('partnerTag').value);choose.href=u.href;
  links.append(amazon,choose);card.append(title,links);$('apiResults').append(card);
 }
}
async function search(check=false){
 const data=await request('search',{keywords:check?'サンリオ':$('apiQuery').value.trim()});
 status('Amazonの商品APIに接続できました。');render(data);$('searchStatus').textContent=data.items.length?data.items.length+'件を取得しました。':'接続できました。条件に合う商品はありませんでした。';return data;
}

$('catalogExport').onclick=()=>{
 const fallbackCharacter=$('catalogCharacter'),fallbackKind=$('catalogKind'),checked=[...document.querySelectorAll('#apiResults input[type="checkbox"]:checked')];
 if(!checked.length){$('catalogStatus').textContent='カタログ候補にする商品を選んでください。';return;}
 const byAsin=new Map(lastItems.map(item=>[String(item.asin||item.ASIN||'').toUpperCase(),item])),products=[],seen=new Set(),missing=[];
 for(const checkbox of checked){const asin=checkbox.value.toUpperCase();if(seen.has(asin))continue;seen.add(asin);const item=byAsin.get(asin),card=checkbox.closest('.item');if(!item||!card)continue;
  const charSelect=card.querySelector('.catalog-character'),kindSelect=card.querySelector('.catalog-kind'),character=charSelect?.value||fallbackCharacter.value,kind=kindSelect?.value||fallbackKind.value;
  if(!character||!kind){missing.push(String(item.title||'商品'));continue;}
  const charName=CHARACTERS.find(([,slug])=>slug===character)?.[0]||'',kindName=KINDS.find(([,slug])=>slug===kind)?.[0]||'';
  products.push({amazon_asin:asin,title:String(item.title||'').slice(0,300),query:(charName+' '+kindName+' '+String(item.title||'')).slice(0,240),character:charName,character_slug:character,kind:kindName,kind_slug:kind,source:item.url});
 }
 if(missing.length){$('catalogStatus').textContent='分類を確認してください。商品カード内の選択、または一括設定を指定します。未分類：'+missing.length+'件';return;}
 if(!products.length){$('catalogStatus').textContent='有効なASIN付き候補がありません。';return;}
 const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const url=URL.createObjectURL(new Blob([JSON.stringify(products,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='products-helper-'+stamp+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('catalogStatus').textContent=products.length+'件を書き出しました。内容を確認してからブログ/products-*.jsonへ追加してください。記事は作成されません。';
};
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
