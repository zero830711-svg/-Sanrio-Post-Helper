const {test,expect}=require('@playwright/test');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=';
test('候補のリンク編集と追加写真を保存し共有へ反映する',async({page})=>{
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.goto('/');
 const old='https://amzn.to/old',next='https://link.amazon/new',search='https://a.r10.to/search';
 const open=()=>page.evaluate(async old=>{await showTodayDetail({id:'candidate-edit-test',title:'マイメロディのバッグ',text:'バッグ紹介\nAmazon '+old,amazon:old,images:[]});},old);
 await open();await page.locator('summary').filter({hasText:'紹介リンクを修正・追加'}).click();
 await expect(page.locator('#candidateLinks')).toHaveValue(old);
 await page.locator('#candidateLinks').fill(next+'\n'+search);await page.locator('#candidateLinksSave').click();await expect(page.locator('#candidateEditStatus')).toContainText('リンクを保存しました');
 expect(await page.evaluate(()=>buildRewritePrompt(detailSelectedItem(),''))).toContain(next);expect(await page.evaluate(()=>buildRewritePrompt(detailSelectedItem(),''))).not.toContain(old);
 await page.locator('#candidatePhotos').setInputFiles({name:'added.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.locator('#candidatePhotoStatus')).toContainText('1枚追加');await expect(page.locator('#detailMedia img')).toHaveCount(1);
 await expect.poll(()=>page.evaluate(()=>detailJpegBlobs.filter(Boolean).length)).toBe(1);
 await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async d=>{window.candidateShared={text:d.text,photos:d.files.length};},configurable:true});});
 await page.locator('#detailChatGPTShare').click();await expect.poll(()=>page.evaluate(()=>window.candidateShared?.photos)).toBe(1);expect(await page.evaluate(()=>window.candidateShared.text)).toContain(search);
 await page.reload();await open();expect(await page.evaluate(()=>detailCurrentItem.amazon)).toBe(next);expect(await page.evaluate(()=>detailCurrentItem.rakuten)).toBe(search);await expect(page.locator('#detailMedia img')).toHaveCount(1);
 expect(await page.evaluate(()=>candidateLinkKind('https://amazon.com.evil.test/x'))).toBe('');
});
