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
test('新着商品は確認済み情報と自分のリンクだけ送信し、選んだ写真と本文を共有',async({page})=>{
 let input;
 const item={url:'https://lovelyfancy.example/product1',title:'キティのリボンバッグ',date:'2026-10-01',products:[],productInfo:{title:'リボンバッグ',specs:{素材:'ポリエステル'},contents:[],images:[]}};
 await page.route('**/lovely-watch.php?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('action')==='detail'?{ok:true,item}:{ok:true,items:[item]}}));
 await setup(page,r=>{input=r.request().postDataJSON();return r.fulfill({json:{ok:true,configured:true,text:'🎀 リボンバッグを紹介します\nAmazon：https://amzn.to/test\n#pr'}})});
 await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#lovelyList button').click();
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();
 await page.locator('#productAiGenerate').click();await expect(page.locator('#productAiStatus')).toContainText('チェック');
 await page.locator('#lovelyAmazon').fill('https://amzn.to/test');await page.locator('#lovelyNote').fill('リボン付き');
 await page.locator('#lovelyPhotos').setInputFiles({name:'test.png',mimeType:'image/png',buffer:png});
 await page.locator('#lovelyConfirmed').check();await page.locator('#productAiGenerate').click();
 await expect(page.locator('#productAiText')).toHaveValue(/リボンバッグ/);
 expect(input.mode).toBe('product');expect(input.text).toContain('ポリエステル');expect(input.text).toContain('リボン付き');expect(Object.keys(input)).not.toContain('images');
 await page.locator('#productAiShare').click();expect((await page.evaluate(()=>window.aiShared)).files).toEqual(['test.png']);
 await page.locator('#lovelyNote').fill('補足を変更');await page.locator('#lovelyConfirmed').check();await page.locator('#productAiShare').click();await expect(page.locator('#productAiStatus')).toContainText('変わりました');
});
