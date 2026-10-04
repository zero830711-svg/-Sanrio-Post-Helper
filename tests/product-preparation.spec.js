const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const url='https://www.skater-onlineshop.com/shop/g/g4973307091827/';
const storeUrl='https://item.rakuten.co.jp/casmin/pnb1-kitty/';
const affiliate='https://hb.afl.rakuten.co.jp/hgc/test12345678/?pc=test';
const thumbnail='https://www.skater-onlineshop.com/img/goods/S/pnb1_hkt_pkg.jpg';
const listing={source:'スケーター',url,title:'ハローキティ 食パン抜き型',date:'',jan:'4973307091827',thumbnail,products:[],productIds:[],needsReview:true};
const matched={...listing,products:[{store:'楽天',url:storeUrl}],productIds:['rakuten:casmin:pnb1-kitty'],needsReview:false,retailerStatus:'楽天公式店 casmin：JANで照合済み',manufacturerInfo:{facts:{商品名:listing.title,特徴:'食パンやクッキーの抜き型'},text:'',checkedAt:'2026-10-04T00:00:00Z'},productInfo:{title:'ハローキティ 食パン抜き型',url:storeUrl,itemCode:'casmin:10001234',searchKeyword:'4973307091827',jan:'4973307091827',specs:{},contents:[],images:['https://image.rakuten.co.jp/casmin/cabinet/pnb1-kitty.jpg'],checkedAt:'2026-10-04T00:00:00Z'}};
async function setup(page){
 await page.route('https://www.skater-onlineshop.com/img/goods/**',r=>r.fulfill({contentType:'image/png',body:png}));
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.skaterShared={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('action')==='product-groq-draft')return r.fulfill({json:{ok:true,configured:true,text:'🎀 ハローキティの食パン抜き型 ✨\n🍞 食パンやクッキーに\n\n🛍️ '+affiliate+'\n\n#サンリオ #pr'}});
  return r.fulfill({json:{ok:true,items:[]}});
 });
}

const otherUrl='https://www.skater-onlineshop.com/shop/g/g4973307103957/';
const other={...listing,url:otherUrl,title:'別の商品',jan:'4973307103957'};
async function routes(page,detail){
 await setup(page);
 await page.route('**/lovely-watch.php?**',async r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('action')==='detail')return r.fulfill({json:{ok:true,item:await detail(q)}});
  if(q.get('action')==='affiliate')return r.fulfill({json:{ok:true,affiliate:{itemCode:matched.productInfo.itemCode,url:affiliate}}});
  if(q.get('action')==='image')return r.fulfill({contentType:'image/png',body:png});
  return r.fulfill({json:{ok:true,items:q.get('source')==='skater'?[listing,other]:[],nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();
}
async function open(page,product=url){await page.locator('[data-lovely-select="'+product+'"]').click();await expect(page.locator('#lovelyConfirmed')).toBeEnabled();}
test('商品を切り替えて戻ると本文・写真・確認状態を保持し再取得しない',async({page})=>{
 let images=0;await routes(page,q=>q.get('url')===url?matched:{...matched,...other});
 await page.route('**/lovely-watch.php?*action=image*',r=>{images++;return r.fulfill({contentType:'image/png',body:png})});
 await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await page.locator('#lovelyPostText').fill('🎀 編集した本文\n'+affiliate+'\n#pr');
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');await page.locator('#lovelyConfirmed').check();
 await page.locator('#lovelyBack').click();await open(page,otherUrl);await page.locator('#lovelyBack').click();await open(page);
 await expect(page.locator('#lovelyPostText')).toHaveValue(/編集した本文/);await expect(page.locator('[data-lovely-image="0"]')).toBeChecked();await expect(page.locator('#lovelyConfirmed')).toBeChecked();expect(images).toBe(1);
 await page.locator('#lovelyPostShare').click();expect((await page.evaluate(()=>window.skaterShared)).files).toHaveLength(1);
});
test('ページを再読み込みしても本文と選択写真を復元し確認はやり直せる',async({page})=>{
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await page.locator('#lovelyPostText').fill('🎀 保存した下書き\n'+affiliate+'\n#pr');await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');await page.locator('#lovelyConfirmed').check();
 await page.reload();await page.getByRole('tab',{name:'新着商品',exact:true}).click();await open(page);
 await expect(page.locator('#lovelyPostText')).toHaveValue(/保存した下書き/);await expect(page.locator('[data-lovely-image="0"]')).toBeChecked();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');await expect(page.locator('#lovelyConfirmed')).not.toBeChecked();
});
test('楽天掲載待ちから再照合してリンクを取得し手動本文を保つ',async({page})=>{
 let calls=0;await routes(page,q=>{calls++;return q.get('refresh')==='1'?matched:{...matched,products:[],retailerStatus:'楽天掲載待ち・要確認',productInfo:{...matched.productInfo,itemCode:'',url:'',images:[]}}});
 await open(page);await page.locator('#lovelyPostText').fill('🎀 手動で用意した本文');await page.locator('#lovelyRetailerRetry').click();
 await expect(page.locator('#lovelyReview')).toContainText('JANで照合済み');await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);await expect(page.locator('#lovelyPostText')).toHaveValue('🎀 手動で用意した本文');expect(calls).toBe(2);
});
test('再照合で画像が変わったら古い写真選択と確認チェックを解除する',async({page})=>{
 await routes(page,q=>q.get('refresh')==='1'?{...matched,productInfo:{...matched.productInfo,images:['https://image.rakuten.co.jp/casmin/cabinet/changed.jpg']}}:matched);
 await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyRetailerRetry').click();
 await expect(page.locator('#lovelyProductInfo img')).toHaveAttribute('src',/changed.jpg/);await expect(page.locator('[data-lovely-image="0"]')).not.toBeChecked();await expect(page.locator('#lovelyConfirmed')).not.toBeChecked();
});
test('リンク設定済みでは入力欄を折りたたみ変更中は勝手に閉じない',async({page})=>{
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await expect(page.locator('#lovelyLinkTools')).not.toHaveAttribute('open','');await page.locator('#lovelyLinkSummary').click();await page.locator('#lovelyAmazon').fill('https://amzn.to/test');await expect(page.locator('#lovelyAmazon')).toBeVisible();
 await page.locator('#lovelyAmazon').fill('https://amzn.to/edited');await expect(page.locator('#lovelyAmazon')).toHaveValue('https://amzn.to/edited');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('読み込み完了順が逆でも一覧順と初回取得日が変わらない',async({page})=>{
 await setup(page);let round=0;
 await page.route('**/lovely-watch.php?**',async r=>{
  const q=new URL(r.request().url()).searchParams,source=q.get('source')||'lovely';
  if(source==='lovely')round++;
  await new Promise(resolve=>setTimeout(resolve,(round===1?source==='skater':source!=='skater')?100:0));
  const item=source==='skater'?listing:source==='lovely'?{...other,source:'Lovely Fancy',date:'2026-10-01'}:null;
  return r.fulfill({json:{ok:true,items:item?[item]:[],nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 const order=await page.locator('[data-lovely-select]').evaluateAll(bs=>bs.map(b=>b.dataset.lovelySelect));const seen=await page.evaluate(()=>JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')).firstSeen);
 await expect(page.locator('#lovelyList')).toContainText('初回取得');await expect(page.locator('#lovelyList')).toContainText('掲載 2026-10-01');await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 expect(await page.locator('[data-lovely-select]').evaluateAll(bs=>bs.map(b=>b.dataset.lovelySelect))).toEqual(order);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')).firstSeen)).toEqual(seen);
});
