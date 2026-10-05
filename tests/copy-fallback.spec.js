const {test,expect}=require('@playwright/test');
async function setup(page,failCount){
 await page.addInitScript(count=>{window.copyCalls=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copyCalls.push(text);if(window.copyCalls.length<=count)throw new Error('NotAllowedError');}}});},failCount);
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.goto('/');await page.waitForFunction(()=>typeof copyTextFromClick==='function');
 await page.evaluate(()=>{const b=document.createElement('button');b.id='copyRegression';b.textContent='リンクをコピー';b.onclick=()=>copyTextFromClick('https://example.invalid/share?token=example',b,'リンクをコピーしました');document.body.prepend(b);});
}
test('コピー再試行の成功時に救済画面を閉じ、元のボタンへ戻る',async({page})=>{
 await setup(page,1);await page.locator('#copyRegression').click();await expect(page.locator('#copyFallbackPanel')).toBeVisible();
 await expect(page.locator('#copyFallbackText')).toHaveValue('https://example.invalid/share?token=example');
 await page.locator('#copyFallbackPanel').getByRole('button',{name:'もう一度コピー',exact:true}).click();await expect(page.locator('#copyFallbackPanel')).toHaveCount(0);await expect(page.locator('#copyRegression')).toHaveText('リンクをコピーしました');await expect(page.locator('#copyRegression')).toBeFocused();expect(await page.evaluate(()=>window.copyCalls)).toEqual(['https://example.invalid/share?token=example','https://example.invalid/share?token=example']);
});
test('コピー失敗では手動コピー欄を残し、通常のコピー成功では画面を出さない',async({page})=>{
 await setup(page,2);await page.locator('#copyRegression').click();await page.locator('#copyFallbackPanel').getByRole('button',{name:'もう一度コピー',exact:true}).click();await expect(page.locator('#copyFallbackTitle')).toHaveText('自動コピーできませんでした');await expect(page.locator('#copyFallbackText')).toBeVisible();
 await page.getByRole('button',{name:'閉じる',exact:true}).click();await expect(page.locator('#copyFallbackPanel')).toHaveCount(0);await expect(page.locator('#copyRegression')).toBeFocused();await page.locator('#copyRegression').click();await expect(page.locator('#copyRegression')).toHaveText('リンクをコピーしました');await expect(page.locator('#copyFallbackPanel')).toHaveCount(0);
});
