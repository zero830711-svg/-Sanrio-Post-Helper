const {test,expect}=require('@playwright/test');
test('新着の写真とAI操作を先に表示し、仕様とリンク入力は必要時だけ開く',async({page})=>{
 const image='https://image.rakuten.co.jp/test/cabinet/bag.jpg';
 const item={title:'サンリオのバッグ',url:'https://lovelyfancy.example/bag',ownRakuten:'https://a.r10.to/test',products:[],productInfo:{title:'長い販売ページの商品名'.repeat(40),itemCode:'test:bag',checkedAt:'2026-10-02T00:00:00Z',specs:{素材:'綿'},contents:[],images:[image]}};
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/image.rakuten.co.jp/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="pink"/></svg>'}));
 await page.route('**/lovely-watch.php?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('action')==='detail'?{ok:true,item}:{ok:true,items:[item]}}));
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#lovelyList button').click();await expect(page.locator('#lovelyConfirmed')).toBeEnabled();
 await expect(page.locator('.lovely-facts')).not.toHaveAttribute('open','');await expect(page.locator('#lovelyLinkDetails')).not.toHaveAttribute('open','');
 await expect(page.locator('#lovelyLinkSummary')).toContainText('楽天 設定済み');await expect(page.locator('[data-lovely-image]')).toBeVisible();
 const imageBox=await page.locator('[data-lovely-image]').boundingBox(),ai=await page.locator('#productAiGenerate').boundingBox(),top=await page.locator('#lovelyTitle').boundingBox();expect(imageBox.y).toBeLessThan(ai.y);expect(ai.y-top.y).toBeLessThan(800);
 await expect(page.locator('#lovelyAmazon')).not.toBeVisible();await page.locator('#lovelyLinkDetails summary').first().click();await expect(page.locator('#lovelyAmazon')).toBeVisible();
 await page.locator('#lovelyAmazon').fill('https://amzn.to/test');await expect(page.locator('#lovelyLinkSummary')).toContainText('Amazon・楽天');
 await page.locator('#lovelyOtherShare summary').click();await expect(page.locator('#lovelyShare')).toBeVisible();
});
