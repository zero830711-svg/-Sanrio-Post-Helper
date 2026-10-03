const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function setup(page,respond){
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.aiShared={text:data.text,files:(data.files||[]).map(f=>f.name)}},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',async r=>{
  if(new URL(r.request().url()).searchParams.get('action')==='post-ai-draft')return respond(r);
  return r.fulfill({json:{ok:true,items:[],configured:true}});
 });
 await page.goto('/');
}
test('新着商品はAI生成枠なしで、写真と投稿依頼文をChatGPTへ共有',async({page})=>{
 let apiCalls=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const item={url:'https://lovelyfancy.example/product1',title:'キティのリボンバッグ',date:'2026-10-01',products:[],productInfo:{title:'リボンバッグ',specs:{素材:'ポリエステル'},contents:[],images:['https://example.invalid/product.png']}};
 await page.route('**/lovely-watch.php?**',r=>new URL(r.request().url()).searchParams.get('action')==='image'?r.fulfill({contentType:'image/png',body:png}):r.fulfill({json:new URL(r.request().url()).searchParams.get('action')==='detail'?{ok:true,item}:{ok:true,items:[item]}}));
 await setup(page,r=>{apiCalls++;return r.fulfill({json:{ok:false}})});
 await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#lovelyList button').click();
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();
 await expect(page.locator('#productAiPanel')).toHaveCount(0);
 await page.locator('#lovelyShare').click();await expect(page.locator('#lovelyShareStatus')).toContainText('チェック');
 await page.locator('#lovelyAmazon').fill('https://amzn.to/test');await expect(page.locator('#lovelyNote')).not.toBeVisible();await expect(page.locator('#lovelyPhotos')).not.toBeVisible();
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyShare').click();
 const shared=await page.evaluate(()=>window.aiShared);
 expect(shared.files).toEqual(['product-1.png']);expect(shared.text).toContain('リボンバッグ');expect(shared.text).toContain('ポリエステル');expect(shared.text).toContain('https://amzn.to/test');
 await page.locator('#lovelyBack').click();await expect(page.locator('#lovelyBrowse')).toBeVisible();await page.locator('#lovelyList button').click();
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();await expect(page.locator('#lovelyShare')).toBeVisible();await expect(page.locator('#productAiPanel')).toHaveCount(0);
 expect(apiCalls).toBe(0);expect(errors).toEqual([]);
});
