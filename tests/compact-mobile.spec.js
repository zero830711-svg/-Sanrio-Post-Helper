const {test,expect}=require('@playwright/test');
async function seed(page){
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof renderToday==='function');
 await page.evaluate(async()=>{
  const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="pink"/></svg>');
  window.compactFixture={id:'compact-fixture',title:'サンリオのかわいい商品を紹介する見やすい投稿',text:'商品について確認した内容です。\n'.repeat(15)+'https://amzn.to/example',images:[svg,svg,svg],amazon:'https://amzn.to/example',rakuten:'https://a.r10.to/example',impressions:50000,likes:1500,bookmarks:260};
  await dbPutMany([compactFixture,{...compactFixture,id:'compact-fixture-2'}]);
  getRoleBasedPicks=async()=>[compactFixture,{...compactFixture,id:'compact-fixture-2'}];stampRecommendations=async()=>{};preloadDetailImages=()=>{};
  await renderToday();document.querySelector('#todayHomePanel').scrollIntoView();
 });
}
test('候補を小さく表示し、補助操作を必要な時だけ開ける',async({page})=>{
 await seed(page);const cards=page.locator('.today-news-row');await expect(cards).toHaveCount(2);
 for(const c of await cards.all()){expect((await c.boundingBox()).height).toBeLessThan(150);}
 await expect(cards.nth(1).getByRole('button',{name:'投稿準備'})).toBeInViewport();
 await expect(cards.first().getByRole('button')).toHaveCount(1);
 await cards.first().getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#detailCandidateSkip')).toBeVisible();
});
test('全文画面で本文と写真を先に確認し、拡大から戻れる',async({page})=>{
 await seed(page);await page.evaluate(()=>showTodayDetail(compactFixture));
 await expect(page.locator('#detailTextPreview')).toBeVisible();await expect(page.locator('#detailText')).not.toBeVisible();await expect(page.locator('#detailCopyImage')).not.toBeVisible();
 for(const id of ['detailChatGPTShare','detailThreadsShare','detailBlogShare']){await expect(page.locator('#'+id)).toBeVisible();expect((await page.locator('#'+id).boundingBox()).height).toBeGreaterThanOrEqual(44);}
 await page.locator('#detailTextMore summary').click();await expect(page.locator('#detailText')).toBeVisible();await expect(page.locator('#detailTextPreview')).not.toBeVisible();await page.locator('#detailTextMore summary').click();
 await page.getByRole('button',{name:'写真1を拡大',exact:true}).click();await expect(page.locator('#imageModal')).toBeVisible();await page.locator('#closeModal').click();await expect(page.locator('#todayDetailModal')).toBeVisible();
 await page.locator('#detailExtraTools summary').click();await expect(page.locator('#detailCopyImage')).toBeVisible();
});

test('一覧は右の1ボタンで開き、詳細のリンクを横書きで確認できる',async({page})=>{
 for(const width of [390,375,320]){
  await page.setViewportSize({width,height:844});await seed(page);
  const card=page.locator('.today-news-row').first();
  await expect(card.getByRole('button')).toHaveCount(1);
  await card.getByRole('button',{name:'投稿準備'}).click();
  await expect(page.locator('#todayDetailModal')).toBeVisible();
  await page.locator('#detailExtraTools summary').click();
  const body=page.locator('#detailCandidateTools');
  await expect(body.locator('.today-affiliate-link-row')).toHaveCount(2);
  for(const row of await body.locator('.today-affiliate-link-row').all()){
   const link=await row.locator('a').boundingBox();expect(link.width).toBeGreaterThan(130);expect(link.height).toBeLessThan(70);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#closeDetailModal').click();
 }
});
test('新着商品も写真と右の1ボタンで開き、戻れる',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 const item={url:'https://lovelyfancy.example/product1',title:'サンリオの新作リボン付きマスコット',date:'2026-10-01',products:[],images:[]};
 await page.route('**/lovely-watch.php?**',route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  return route.fulfill({json:action==='list'?{ok:true,items:[item],fetchedAt:'2026-10-01T12:00:00Z'}:action==='settings'?{ok:true,configured:true}:{ok:true,item}});
 });
 await page.goto('/');
 await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 const row=page.locator('#lovelyList .lovely-row');await expect(row).toHaveCount(1);
 expect((await row.boundingBox()).height).toBeLessThan(150);await expect(row.getByRole('button')).toHaveCount(1);
 await row.getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#lovelyEditor')).toBeVisible();await expect(page.locator('#lovelyBrowse')).not.toBeVisible();
 await page.locator('#lovelyBack').click();await expect(row).toBeVisible();
});

test('ホーム見出しを1行にまとめ、候補を上からすぐ確認できる',async({page})=>{
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await seed(page);await page.evaluate(()=>scrollTo(0,0));
  const header=page.locator('.home-header');expect((await header.boundingBox()).height).toBeLessThan(70);
  const badge=await header.locator('.badge').boundingBox(), title=await header.locator('h1').boundingBox();
  expect(Math.abs(badge.y-title.y)).toBeLessThan(8);
  expect((await page.locator('.today-news-row').first().boundingBox()).y).toBeLessThan(250);
  await expect(page.locator('.today-news-row').nth(1).getByRole('button',{name:'投稿準備'})).toBeInViewport();
  await header.locator('.home-info>summary').click();await expect(page.locator('#forceLatest')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
});

test('今日の候補を5件ずつ追加し、重複なく追加候補の詳細を開ける',async({page})=>{
 await seed(page);
 await page.evaluate(async()=>{
  const rows=Array.from({length:11},(_,i)=>({...compactFixture,id:'more-fixture-'+i,title:'候補'+i+'番の商品専用マスコットのご紹介',text:'候補'+i+'番の商品を詳しく紹介します。'}));
  await dbPutMany(rows);getRoleBasedPicks=async()=>rows.slice(0,5);getReadyItems=async()=>rows;
  todayAdditionalLimit=0;await renderToday();
 });
 await expect(page.locator('.today-news-row')).toHaveCount(5);
 await expect(page.locator('#todayMore')).toHaveText('もっと見る（あと6件）');
 await page.locator('#todayMore').click();await expect(page.locator('.today-news-row')).toHaveCount(10);
 await expect(page.locator('#todayMore')).toHaveText('もっと見る（あと1件）');
 const title=await page.locator('.today-news-row').nth(5).locator('h3').textContent();
 await page.locator('.today-news-row').nth(5).getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#detailTitle')).toHaveText(title);
 await page.locator('#closeDetailModal').click();await expect(page.locator('.today-news-row')).toHaveCount(10);
 await page.locator('#todayMore').click();await expect(page.locator('.today-news-row')).toHaveCount(11);
 await expect(page.locator('#todayMore')).not.toBeVisible();
 const ids=await page.locator('.today-news-row button').evaluateAll(buttons=>buttons.map(b=>b.dataset.id));
 expect(new Set(ids).size).toBe(11);
});
