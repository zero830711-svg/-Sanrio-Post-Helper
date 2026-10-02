const {test,expect}=require('@playwright/test');
test('楽天収集は手動で始まり、基準・新発見を分けて既存の投稿準備へ渡す',async({page})=>{
 let calls=0;
 const item={title:'クロミのバッグ',url:'https://item.rakuten.co.jp/testshop/bag/',source:'楽天API',apiItemCode:'testshop:123',productIds:['rakuten:testshop:bag'],products:[{store:'楽天',url:'https://item.rakuten.co.jp/testshop/bag/'}],ownRakuten:'https://hb.afl.rakuten.co.jp/hgc/abcdefgh/?pc=test',price:1000,shopName:'テスト店',productInfo:{title:'クロミのバッグ',itemCode:'testshop:123',url:'https://item.rakuten.co.jp/testshop/bag/',checkedAt:'2026-10-02T00:00:00Z',specs:{},contents:[],images:[]}};
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/lovely-watch.php?**',r=>{const action=new URL(r.request().url()).searchParams.get('action');if(action==='discover'){calls++;return r.fulfill({json:{ok:true,keyword:'サンリオ',initial:calls===1,fetchedAt:'2026-10-02T00:00:00Z',items:[{...item,discovered:calls>1}]}});}return r.fulfill({json:{ok:true,items:[]}});});
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#rakutenDiscoveryPanel summary').click();expect(calls).toBe(0);
 await page.locator('#rakutenDiscoveryRefresh').click();await expect(page.locator('#rakutenDiscoveryStatus')).toContainText('初回の比較基準');
 await page.locator('#rakutenDiscoveryFilter').selectOption('new');await expect(page.locator('#rakutenDiscoveryList')).toContainText('ありません');
 await page.locator('#rakutenDiscoveryRefresh').click();await expect(page.locator('#rakutenDiscoveryList')).toContainText('今回新しく発見');
 await page.locator('[data-rakuten-prepare]').click();await expect(page.locator('#lovelyTitle')).toHaveText('クロミのバッグ');await expect(page.locator('#lovelyRakuten')).toHaveValue(item.ownRakuten);await expect(page.locator('#lovelySource')).toHaveText('楽天の販売ページを確認');await expect(page.locator('#lovelyConfirmed')).not.toBeChecked();
 await page.locator('#lovelySkip').click();await expect(page.locator('#rakutenDiscoveryList')).not.toContainText('クロミのバッグ');
});
