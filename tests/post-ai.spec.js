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
async function today(page){
 await page.evaluate(()=>{
  preloadDetailImages=()=>{};
  imageBlob=async()=>new Blob(['image'],{type:'image/png'});
  showTodayDetail({id:'ai-test',title:'キティのリボンバッグ',text:'リボン付きバッグ。価格880円（税込）。https://amzn.to/test',amazon:'https://amzn.to/test',images:['data:image/png;base64,iVBORw0KGgo=','data:image/png;base64,iVBORw0KGgo=']});
  detailImageBlobs=[new Blob(['first'],{type:'image/png'}),new Blob(['second'],{type:'image/png'})];detailPhotoSelection=[1,0];renderDetailPhotos();
 });
}
test('今日の候補で本文を生成・編集し、元リンクと末尾prを保持して共有',async({page})=>{
 let input;
 await setup(page,r=>{input=r.request().postDataJSON();return r.fulfill({json:{ok:true,configured:true,text:'🎀 リボン付きバッグを紹介します\n\nAmazon：https://amzn.to/test\n#pr'}})});
 await today(page);await page.locator('#todayAiGenerate').click();
 await expect(page.locator('#todayAiText')).toHaveValue(/リボン付きバッグ/);
 expect(input.mode).toBe('rewrite');expect(input.links).toEqual([{kind:'amazon',url:'https://amzn.to/test'}]);expect(Object.keys(input)).not.toContain('images');
 await page.locator('#todayAiText').fill('確認したバッグをご紹介🎀\nAmazon：https://amzn.to/test\n#pr');
 await page.locator('#todayAiShare').click();
 expect((await page.evaluate(()=>window.aiShared)).text).toContain('確認したバッグ');
 expect((await page.evaluate(()=>window.aiShared)).files).toHaveLength(2);
 expect(await page.evaluate(()=>document.body.style.position)).toBe('');
});
test('生成中の手編集を上書きせず、失敗しても本文を残す',async({page})=>{
 let release,started;const wait=new Promise(r=>release=r),sent=new Promise(r=>started=r);let calls=0;
 await setup(page,async r=>{calls++;if(calls===1)return r.fulfill({json:{ok:true,configured:true,text:'バッグの紹介\nAmazon：https://amzn.to/test\n#pr'}});started();await wait;return r.fulfill({json:{ok:true,configured:true,text:'上書きしない文\nAmazon：https://amzn.to/test\n#pr'}})});
 await today(page);await page.locator('#todayAiGenerate').click();await expect(page.locator('#todayAiText')).toHaveValue(/バッグの紹介/);
 page.on('dialog',d=>d.accept());await page.locator('#todayAiGenerate').click();await sent;
 await page.locator('#todayAiText').fill('手動編集\nAmazon：https://amzn.to/test\n#pr');release();
 await expect(page.locator('#todayAiGenerate')).toBeEnabled();await expect(page.locator('#todayAiText')).toHaveValue(/^手動編集/);
 await page.locator('#todayAiText').fill('リンクなし #pr');await page.locator('#todayAiShare').click();await expect(page.locator('#todayAiStatus')).toContainText('元のURL');
});
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
