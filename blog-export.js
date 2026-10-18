(()=>{
'use strict';
let current=null;
const safe=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const characters=[['ハローキティ','hello-kitty'],['マイメロディ','my-melody'],['リトルツインスターズ','little-twin-stars'],['ポムポムプリン','pompompurin'],['シナモロール','cinnamoroll'],['クロミ','kuromi'],['ポチャッコ','pochacco'],['ハンギョドン','hangyodon'],['タキシードサム','tuxedo-sam'],['けろけろけろっぴ','kerokerokeroppi'],['バッドばつ丸','bad-badtz-maru'],['あひるのペックル','ahiru-no-pekkle'],['ぐでたま','gudetama'],['マイスウィートピアノ','my-sweet-piano'],['ウィッシュミーメル','wish-me-mell'],['こぎみゅん','cogimyun'],['はなまるおばけ','hanamaru-obake'],['がおぱわるぅ','gaopoweru'],['ぼんぼんりぼん','bonbonribbon'],['ディアダニエル','dear-daniel'],['チャーミーキティ','charmmy-kitty'],['まるもふびより','marumofubiyori'],['コロコロクリリン','corocorokuririn'],['マロンクリーム','marroncream'],['シュガーバニーズ','sugar-bunnies'],['ウサハナ','usahana'],['マシュマロみたいなふわふわにゃんこ','marshmallow-fuwafuwa-nyanko'],['チョコキャット','chococat'],['KIRIMIちゃん.','kirimi-chan'],['おさるのもんきち','osaru-no-monkichi'],['ゴロピカドン','goropikadon'],['ジュエルペット','jewelpet'],['みんなのたあ坊','minna-no-taabou'],['リトルフォレストフェロォ','little-forest-fellow'],['ルロロマニック','ruroromannic'],['JOCHUM','jochum']];
const kinds=[['ぬいぐるみ','plushies'],['バッグ・ポーチ','bags-pouches'],['文具・シール','stationery-stickers'],['生活雑貨','lifestyle-goods'],['推し活・収納','oshikatsu-storage'],['おもちゃ','toys'],['ファッション','fashion'],['本・カレンダー','books-calendars']];
function addOptions(select,values,placeholder){const first=document.createElement('option');first.value='';first.textContent=placeholder;select.append(first);for(const [label,value] of values){const option=document.createElement('option');option.value=value;option.textContent=label;option.dataset.label=label;select.append(option);}}
function payload(row,link){
 const item=row.item||{},identity=row.identity||{};
 const images=Array.isArray(row.selected)?row.selected.map(i=>(item.images||[])[i]):item.images||[];
 const character=characters.find(([name])=>String(item.title||'').includes(name))?.[0]||'';
 return {version:1,title:String(item.title||'').slice(0,300),jan:String(identity.jan||'').replace(/\D/g,''),model:String(identity.model||'').slice(0,80),character,source:safe(item.url),images:images.filter(x=>safe(x)).slice(0,4),facts:(item.paragraphs||[]).map(x=>String(x).slice(0,3000)).slice(0,15),affiliate:safe(link)};
}
function catalogPayload(row,character,kind){
 const item=row.item||{},identity=row.identity||{},title=String(item.title||'').slice(0,300),jan=String(identity.jan||'').replace(/\D/g,''),itemCode=String(item.itemCode||item.item_code||item.rakutenCode||'').slice(0,180);
 const source=safe(item.url),query=(character.name+' '+kind.name+' '+title).slice(0,240);
 const record={title,query,character:character.name,character_slug:character.slug,kind:kind.name,kind_slug:kind.slug,source};
 if(jan)record.jan=jan;else if(itemCode)record.rakuten_item_code=itemCode;else record.catalog_id='helper-'+Array.from((title+'|'+source)).reduce((h,c)=>((h*31+c.charCodeAt(0))>>>0),7).toString(16);
 if(item.image)record.image=safe(item.image)||undefined;
 return record;
}
function download(data,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
window.SPHBlogExport={payload,catalogPayload};
document.addEventListener('sph-blog-product',event=>{
 current=event.detail;
 const editor=document.getElementById('flowEditor');if(!editor)return;
 let box=document.getElementById('flowBlogExport');
 if(!box){box=document.createElement('section');box.id='flowBlogExport';box.className='card';box.style.marginTop='12px';
 const articleButton=document.createElement('button');articleButton.type='button';articleButton.className='small-btn';articleButton.textContent='ブログ用データを保存';
 const articleNote=document.createElement('p');articleNote.className='backup-note';articleNote.textContent='公式情報・JAN・選択中の紹介リンクを、商品記事の下書き用JSONに保存します。';
 articleButton.onclick=()=>{const row=current?.getProduct?.();if(!row)return;const p=payload(row,document.getElementById('flowLink')?.value||'');if(!p.title||!p.source){articleNote.textContent='商品名と出典URLが必要です。';return;}download(p,'sanrio-product-'+(p.jan||'draft')+'.json');articleNote.textContent='記事用データを保存しました。';};
 const heading=document.createElement('h3');heading.textContent='商品カタログ候補を書き出す';
 const help=document.createElement('p');help.className='backup-note';help.textContent='記事を作成せず、確認した商品情報をカタログへ渡すJSONです。キャラクターとジャンルを選んで保存してください。';
 const fields=document.createElement('div');fields.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:10px 0';
 const character=document.createElement('select');character.id='catalogRakutenCharacter';character.setAttribute('aria-label','カタログ商品のキャラクター');addOptions(character,characters,'キャラクターを選択');
 const kind=document.createElement('select');kind.id='catalogRakutenKind';kind.setAttribute('aria-label','カタログ商品のジャンル');addOptions(kind,kinds,'ジャンルを選択');
 const catalogButton=document.createElement('button');catalogButton.type='button';catalogButton.className='small-btn';catalogButton.textContent='カタログ候補JSONを保存';
 const catalogNote=document.createElement('p');catalogNote.className='backup-note';catalogNote.setAttribute('aria-live','polite');catalogNote.textContent='商品情報と分類を確認してから保存してください。';
 catalogButton.onclick=()=>{const row=current?.getProduct?.();if(!row)return;const c=character.selectedOptions[0],k=kind.selectedOptions[0],product=row.item||{};if(!c?.value||!k?.value){catalogNote.textContent='キャラクターとジャンルを選んでください。';return;}const p=catalogPayload(row,{name:c.dataset.label,slug:c.value},{name:k.dataset.label,slug:k.value});if(!p.title||!p.source){catalogNote.textContent='商品名と出典URLを確認してください。';return;}download([p],'products-helper-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'.json');catalogNote.textContent='カタログ候補を1件保存しました。内容を確認してからブログ/products-*.jsonに追加してください。記事は作成されません。';};
 fields.append(character,kind);box.append(articleButton,articleNote,heading,help,fields,catalogButton,catalogNote);editor.append(box);
 }
 const guess=characters.find(([name])=>String(current?.getProduct?.().item?.title||'').includes(name));if(guess&&!document.getElementById('catalogRakutenCharacter').value)document.getElementById('catalogRakutenCharacter').value=guess[1];
});
})();