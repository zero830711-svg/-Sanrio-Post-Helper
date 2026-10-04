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
 let images=0;await routes(page,q=>q.get('url')===url?matched:{...matched,...other,productIds:['rakuten:casmin:other'],productInfo:{...matched.productInfo,jan:other.jan,itemCode:'casmin:other',url:'https://item.rakuten.co.jp/casmin/other/'}});
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

test('通常のペーストだけで楽天リンクを保存しキーボードを閉じ投稿文へ戻る',async({page})=>{
 await page.addInitScript(()=>{
  window.clipboardReads=0;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.clipboardReads++;throw new Error('No second clipboard permission');}}});
 });
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await page.locator('#lovelyPostText').fill('🎀 編集済みの紹介文\n'+affiliate+'\n#pr');
 await page.locator('#lovelyLinkSummary').click();await page.locator('#lovelyRakuten').focus();
 expect(await page.locator('#lovelyRakuten').evaluate(input=>parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
 await expect(page.locator('#lovelyRakutenPaste')).toBeVisible();
 const link='https://a.r10.to/hNativePaste';
 await page.locator('#lovelyRakuten').evaluate((input,text)=>{const data=new DataTransfer();data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},link);
 await expect(page.locator('#lovelyRakuten')).toHaveValue(link);
 await expect(page.locator('#lovelyLinkTools')).not.toHaveAttribute('open','');
 await expect(page.locator('#lovelyPostStatus')).toContainText('作り直す');
 expect(await page.locator('#lovelyRakuten').evaluate(input=>document.activeElement===input)).toBeFalsy();
 expect(await page.evaluate(()=>window.clipboardReads)).toBe(0);
 await expect(page.locator('#lovelyPostText')).toHaveValue(/編集済みの紹介文/);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')).draft.ownRakuten)).toBe(link);
 await page.locator('#lovelyPostReset').click();await expect(page.locator('#lovelyPostText')).toHaveValue(/hNativePaste/);
});
test('通常のペーストで不正なURLを受け取っても入力済みリンクを壊さない',async({page})=>{
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await page.locator('#lovelyLinkSummary').click();await page.locator('#lovelyRakuten').focus();
 await page.locator('#lovelyRakuten').evaluate(input=>{const data=new DataTransfer();data.setData('text/plain','https://example.com/another-product');input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);await expect(page.locator('#lovelyRakuten')).toHaveAttribute('aria-invalid','true');
 await expect(page.locator('#rakutenAutoStatus')).toContainText('自分のアフィリエイトリンク');
 await expect(page.locator('#lovelyLinkTools')).toHaveAttribute('open','');
 expect(await page.locator('#lovelyRakuten').evaluate(input=>document.activeElement===input)).toBeTruthy();
});
test('通常のペーストで未編集の投稿文へ自分のリンクを反映しPNG共有できる',async({page})=>{
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyLinkSummary').click();
 const link='https://hb.afl.rakuten.co.jp/hgc/native123/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcasmin%2Fpnb1-kitty%2F';
 await page.locator('#lovelyRakuten').evaluate((input,text)=>{const data=new DataTransfer();data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},link);
 await expect(page.locator('#lovelyPostText')).toHaveValue(new RegExp('native123'));
 await expect(page.locator('[data-lovely-image="0"]')).toBeChecked();await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 expect((await page.evaluate(()=>window.skaterShared)).text).toContain(link);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('貼り付けボタンだけで既存の長いリンクを丸ごと置き換え保存する',async({page})=>{
 await page.addInitScript(()=>{window.clipboardReads=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.clipboardReads++;return 'https://a.r10.to/hButtonPaste';}}});});
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await page.locator('#lovelyLinkSummary').click();
 const button=page.locator('#lovelyRakutenPaste'),box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(48);
 expect(await button.evaluate(b=>parseFloat(getComputedStyle(b).fontSize))).toBeGreaterThanOrEqual(16);
 await button.click();
 await expect(page.locator('#lovelyRakuten')).toHaveValue('https://a.r10.to/hButtonPaste');
 await expect(page.locator('#lovelyPostText')).toHaveValue(/hButtonPaste/);
 await expect(page.locator('#lovelyLinkTools')).not.toHaveAttribute('open','');
 expect(await page.evaluate(()=>window.clipboardReads)).toBe(1);
 expect(await page.locator('#lovelyRakuten').evaluate(i=>document.activeElement===i)).toBeFalsy();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')).draft.ownRakuten)).toBe('https://a.r10.to/hButtonPaste');
});
test('読み取り拒否時も削除不要で全選択し通常のペーストで置き換える',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{throw new Error('NotAllowedError');}}});});
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);await page.locator('#lovelyLinkSummary').click();
 await page.locator('#lovelyRakutenPaste').click();await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 expect(await page.locator('#lovelyRakuten').evaluate(i=>[i.selectionStart,i.selectionEnd])).toEqual([0,affiliate.length]);
 await expect(page.locator('#rakutenAutoStatus')).toContainText('削除は不要');
 await page.locator('#lovelyRakuten').evaluate(input=>{const data=new DataTransfer();data.setData('text/plain','https://a.r10.to/hFallback');input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect(page.locator('#lovelyRakuten')).toHaveValue('https://a.r10.to/hFallback');
});
test('ボタンで不正なリンクを読んでも既存リンクと本文を維持する',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=> 'https://example.com/invalid'}});});
 await routes(page,()=>matched);await open(page);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 const body=await page.locator('#lovelyPostText').inputValue();await page.locator('#lovelyLinkSummary').click();await page.locator('#lovelyRakutenPaste').click();
 await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);await expect(page.locator('#lovelyPostText')).toHaveValue(body);
 await expect(page.locator('#rakutenAutoStatus')).toContainText('自分のアフィリエイトリンク');await expect(page.locator('#lovelyRakutenPaste')).toBeEnabled();
});

test('初回は比較基準だけを作り次回に初めて取得した商品だけを絞り込む',async({page})=>{
 await setup(page);let phase=0;
 await page.route('**/lovely-watch.php?**',r=>{const q=new URL(r.request().url()).searchParams;return r.fulfill({json:{ok:true,items:q.get('source')==='skater'?(phase===0?[listing]:[listing,other]):[],nextPage:null}});});
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 await page.locator('#lovelyFilter').selectOption('recent');await expect(page.locator('[data-lovely-select]')).toHaveCount(0);
 phase=1;await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 await expect(page.locator('[data-lovely-select]')).toHaveCount(1);await expect(page.locator('[data-lovely-select]')).toHaveAttribute('data-lovely-select',otherUrl);
 await expect(page.locator('#lovelyRecentHelp')).toContainText('発売日ではありません');
 await page.locator('#lovelyFilter').selectOption('new');await expect(page.locator('[data-lovely-select]')).toHaveCount(2);
 await page.locator('#lovelyFilter').selectOption('recent');await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await expect(page.locator('[data-lovely-select]')).toHaveCount(0);
});
test('初回の次ページは新着扱いせず次回の次ページ追加を含める',async({page})=>{
 await setup(page);let phase=0;
 const third={...other,url:otherUrl+'?third',jan:'4973307103958',title:'次ページの追加商品'};
 await page.route('**/lovely-watch.php?**',r=>{const q=new URL(r.request().url()).searchParams,source=q.get('source'),p=Number(q.get('page')||1);return r.fulfill({json:{ok:true,items:source==='skater'?(p===1?[listing]:phase===0?[other]:[other,third]):[],nextPage:source==='skater'&&p===1?2:null}});});
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await page.locator('#lovelyMore').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 await page.locator('#lovelyFilter').selectOption('recent');await expect(page.locator('[data-lovely-select]')).toHaveCount(0);
 phase=1;await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await page.locator('#lovelyMore').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 await expect(page.locator('[data-lovely-select]')).toHaveCount(1);await expect(page.locator('[data-lovely-select]')).toHaveAttribute('data-lovely-select',third.url);
});
test('取得に失敗した情報元の比較結果を消さず再試行で追加を取得する',async({page})=>{
 await setup(page);let phase=0;
 await page.route('**/lovely-watch.php?**',r=>{const q=new URL(r.request().url()).searchParams;if(q.get('source')==='skater'&&phase===2)return r.fulfill({status:503,json:{ok:false,error:'Temporary unavailable'}});
 return r.fulfill({json:{ok:true,items:q.get('source')==='skater'?(phase===0?[listing]:[listing,other]):[],nextPage:null}});});
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 phase=1;await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await page.locator('#lovelyFilter').selectOption('recent');await expect(page.locator('[data-lovely-select]')).toHaveCount(1);
 phase=2;await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await expect(page.locator('[data-lovely-select]')).toHaveCount(1);
 phase=3;await page.locator('#lovelyMore').click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await expect(page.locator('[data-lovely-select]')).toHaveCount(1);
});
