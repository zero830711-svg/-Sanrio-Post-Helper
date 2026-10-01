const {test,expect}=require('@playwright/test');
test('ニュースの写真を先に取得し、編集した本文と一緒に共有する',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.sharedNews={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/news.php?**',async route=>{
  const u=new URL(route.request().url()),action=u.searchParams.get('action');
  if(action==='image')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  const item={title:'ハローキティ＆クロミの新作',source:'PR TIMES',date:'2026-10-01',url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',images:['https://example.invalid/image.png'],paragraphs:['10月上旬の新作アイテムについての発表です。']};
  return route.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.goto('/');
 await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#todayHomePanel')).not.toBeVisible();
 await expect(page.locator('#lovelyPanel')).not.toBeVisible();
 await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.locator('#newsShare')).toBeEnabled();
 await expect(page.locator('#newsImages img')).toHaveCount(1);
 expect(await page.locator('#newsEditor').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
 expect(await page.locator('#newsEditor').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(100);
 await page.locator('#newsText').fill('確認済みの紹介文\n詳細：https://prtimes.jp/main/html/rd/p/000000122.000013308.html');
 await page.locator('#newsShare').click();
 const shared=await page.evaluate(()=>window.sharedNews);
 expect(shared.text).toContain('確認済みの紹介文');
 expect(shared.files).toEqual([{name:'news-1.png',type:'image/png'}]);
 await page.getByRole('tab',{name:'今日の候補',exact:true}).click();
 await expect(page.locator('#newsPanel')).not.toBeVisible();
});
