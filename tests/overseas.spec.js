const {test,expect}=require('@playwright/test');
const foreign='https://www.sanrio.com/products/old-overseas';
const domestic='https://lovely-fancy.net/sanrio/2026/10/';
async function setup(page){
 const overseasCalls=[];
 await page.addInitScript(({foreign,domestic})=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  const d={url:domestic,title:'国内のキティ商品',note:'国内下書き'};
  const o={url:foreign,title:'古い海外候補',overseas:true,postText:'古い海外下書き',selectedPhotos:['0']};
  localStorage.setItem('sphLovelyDiscoveryV1',JSON.stringify({draft:o,drafts:{[foreign]:o,[domestic]:d},firstSeen:{[foreign]:'2026-10-01',[domestic]:'2026-10-01'},hidden:{[foreign]:'skip',[domestic]:'skip'},identities:{[foreign]:{},[domestic]:{}},sourceChecks:{overseas:{initialized:true},lovely:{initialized:true}},countryFilter:'KR',sourceFilter:'overseas',shortLinks:{saved:{url:'https://a.r10.to/example'}}}));
 },{foreign,domestic});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/overseas.php?**',r=>{overseasCalls.push(r.request().url());return r.fulfill({json:{ok:true,items:[{url:foreign,title:'古い海外候補',overseas:true}]}});});
 await page.route('**/lovely-watch.php?**',r=>r.fulfill({json:{ok:true,items:new URL(r.request().url()).searchParams.has('source')?[]:[{url:domestic,title:'国内のキティ商品',source:'Lovely Fancy',products:[],productIds:[],needsReview:true}],nextPage:null}}));
 await page.goto('/');return overseasCalls;
}
test('ホームはInstagramを含む4タブで、旧海外情報を取得しない',async({page})=>{
 const calls=await setup(page);
 await expect(page.locator('.home-tabs [role="tab"]')).toHaveText(['今日の候補','新作ニュース','Instagram','新着商品']);
 await expect(page.locator('#homeOverseasTab, #overseasPanel')).toHaveCount(0);
 await page.reload();await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 await page.locator('#lovelyRestoreBox > summary').click();await page.locator('#lovelyRestore').click();
 await page.locator('#lovelyFilter').selectOption('all');await expect(page.locator('#lovelyList')).toContainText('国内のキティ商品');
 await expect(page.locator('#lovelyList')).not.toContainText('古い海外候補');
 await page.getByRole('tab',{name:'新着商品',exact:true}).press('Home');await expect(page.getByRole('tab',{name:'今日の候補',exact:true})).toBeFocused();
 await page.getByRole('tab',{name:'今日の候補',exact:true}).press('End');await expect(page.getByRole('tab',{name:'新着商品',exact:true})).toBeFocused();
 await page.getByRole('tab',{name:'新着商品',exact:true}).press('ArrowRight');await expect(page.getByRole('tab',{name:'今日の候補',exact:true})).toBeFocused();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
 expect(calls).toEqual([]);
});
test('海外候補の端末キャッシュだけを削除し、国内の下書きと紹介リンクを残す',async({page})=>{
 await setup(page);
 const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')));
 expect(s.draft).toBeUndefined();expect(s.drafts[foreign]).toBeUndefined();expect(s.drafts[domestic].note).toBe('国内下書き');
 for(const key of ['firstSeen','hidden','identities']){expect(s[key][foreign]).toBeUndefined();expect(s[key][domestic]).toBeDefined();}
 expect(s.sourceChecks.overseas).toBeUndefined();expect(s.sourceChecks.lovely.initialized).toBe(true);expect(s.countryFilter).toBeUndefined();expect(s.sourceFilter).toBe('all');expect(s.shortLinks.saved.url).toBe('https://a.r10.to/example');
});
