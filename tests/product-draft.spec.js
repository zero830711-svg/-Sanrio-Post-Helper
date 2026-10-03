const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const link='https://a.r10.to/hPDrWT';
const item={url:'https://lovely-fancy.net/sanrio/2026/10/',title:'ウサハナ コスメポーチ',date:'2026-10-03',products:[{store:'楽天',url:'https://item.rakuten.co.jp/shop/pouch/'}],productIds:['rakuten:shop:pouch'],productInfo:{title:'販売ページ名',itemCode:'shop:pouch',url:'https://item.rakuten.co.jp/shop/pouch/',price:9999,availability:1,specs:{サイズ:'約200×130×55mm',素材:'ポリエステル'},images:['https://example.com/pouch.png']}};
async function setup(page){
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.sharedDraft={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('action')==='image')return r.fulfill({contentType:'image/png',body:png});
  if(q.get('action')==='detail')return r.fulfill({json:{ok:true,item}});
  if(q.get('action')==='affiliate')return r.fulfill({json:{ok:true,affiliate:{itemCode:'shop:pouch',url:'https://a.r10.to/hPDrWT'}}});
  return r.fulfill({json:{ok:true,items:q.get('source')==='hatakeyama'?[]:[item],nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#lovelyList button').click();
 await expect(page.locator('#lovelyRakuten')).toHaveValue(link);
}
test('商品情報の下書きと自分のリンクをそのままXに写真付き共有する',async({page})=>{
 await setup(page);
 const draft=page.locator('#lovelyPostText');
 await expect(draft).toHaveValue(/🎀 ウサハナ コスメポーチ ✨/);
 const text=await draft.inputValue();expect(text).toContain(link);expect(text).toContain('約200×130×55mm');expect(text).toContain('#pr');expect(text).not.toMatch(/9999|発売|在庫/);
 await expect(page.locator('#lovelyAiPanel')).toHaveCount(0);
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 const shared=await page.evaluate(()=>window.sharedDraft);expect(shared.text).toBe(text);expect(shared.files).toEqual([{name:'product-1.png',type:'image/png'}]);
 await page.locator('#lovelyShare').click();expect((await page.evaluate(()=>window.sharedDraft)).text).toContain('Sanrio fan info向け');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('手直しした文章を保持し、リンク変更後は作り直してから共有する',async({page})=>{
 await setup(page);const draft=page.locator('#lovelyPostText');
 const manual='🎀 私の紹介文 ✨\n'+link+'\n#サンリオ #pr';await draft.fill(manual);
 await page.locator('#lovelyRakuten').fill('https://a.r10.to/hNEW123');
 await expect(draft).toHaveValue(manual);await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 await expect(page.locator('#lovelyPostStatus')).toContainText('作り直す');expect(await page.evaluate(()=>window.sharedDraft)).toBeUndefined();
 await page.locator('#lovelyPostReset').click();await expect(draft).toHaveValue(/hNEW123/);await expect(page.locator('#lovelyConfirmed')).not.toBeChecked();
 const saved=await draft.inputValue();await draft.fill(saved.replace('🎀','💖'));await page.reload();await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(draft).toHaveValue(saved.replace('🎀','💖'));
});
