const {test,expect}=require('@playwright/test');
async function seed(page){
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof renderToday==='function');
 await page.evaluate(async()=>{
  const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="pink"/></svg>');
  window.compactFixture={id:'compact-fixture',title:'サンリオのかわいい商品を紹介する見やすい投稿',text:'商品について確認した内容です。\n'.repeat(15)+'https://amzn.to/example',images:[svg,svg,svg],impressions:50000,likes:1500,bookmarks:260};
  getRoleBasedPicks=async()=>[compactFixture,{...compactFixture,id:'compact-fixture-2'}];stampRecommendations=async()=>{};preloadDetailImages=()=>{};
  await renderToday();document.querySelector('#todayHomePanel').scrollIntoView();
 });
}
test('候補を小さく表示し、補助操作を必要な時だけ開ける',async({page})=>{
 await seed(page);const cards=page.locator('.today-compact-card');await expect(cards).toHaveCount(2);
 for(const c of await cards.all()){expect((await c.boundingBox()).height).toBeLessThan(270);}
 await expect(cards.nth(1).getByRole('button',{name:'内容・共有'})).toBeInViewport();
 await cards.first().getByText('その他',{exact:true}).click();await expect(cards.first().getByRole('button',{name:'見送る',exact:true})).toBeVisible();
});
test('全文画面で本文と写真を先に確認し、拡大から戻れる',async({page})=>{
 await seed(page);await page.evaluate(()=>showTodayDetail(compactFixture));
 await expect(page.locator('#detailTextPreview')).toBeVisible();await expect(page.locator('#detailText')).not.toBeVisible();await expect(page.locator('#detailCopyImage')).not.toBeVisible();
 for(const id of ['detailChatGPTShare','detailThreadsShare','detailBlogShare']){await expect(page.locator('#'+id)).toBeVisible();expect((await page.locator('#'+id).boundingBox()).height).toBeGreaterThanOrEqual(44);}
 await page.locator('#detailTextMore summary').click();await expect(page.locator('#detailText')).toBeVisible();await expect(page.locator('#detailTextPreview')).not.toBeVisible();await page.locator('#detailTextMore summary').click();
 await page.getByRole('button',{name:'写真1を拡大',exact:true}).click();await expect(page.locator('#imageModal')).toBeVisible();await page.locator('#closeModal').click();await expect(page.locator('#todayDetailModal')).toBeVisible();
 await page.locator('#detailExtraTools summary').click();await expect(page.locator('#detailCopyImage')).toBeVisible();
});
