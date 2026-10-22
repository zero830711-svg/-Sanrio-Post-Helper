const {test,expect}=require('@playwright/test');
const names={lovely:'Lovely Fancy',hatakeyama:'畑山商事',gourmandise:'グルマンディーズ',skater:'スケーター',sanrio:'サンリオ公式 楽天市場店',fashion:'楽天ファッション'};
const item=(source,key,productIds=[])=>({source:names[source],url:'https://example.com/'+source+'/'+key,title:names[source]+' '+key,date:'2026-10-04',products:[],productIds,needsReview:true});
const fresh=Object.fromEntries(Object.keys(names).map(source=>[source,item(source,'未紹介商品')]));
const blogUsed=item('lovely','紹介済み商品',['rakuten:test:shared']);
const makerUsed=item('hatakeyama','同じ紹介済み商品',['rakuten:test:shared']);
async function setup(page,{pages=false,recent=false}={}){
 const requests=[];
 await page.addInitScript(({blogUsed,fresh,recent})=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  const saved={hidden:{[blogUsed.url]:'used'}};
  if(recent){saved.sourceChecks=Object.fromEntries(Object.keys(fresh).map(source=>[source,{initialized:true,recentUrls:[]}]));saved.firstSeen={[blogUsed.url]:'2026-10-01T00:00:00Z'};}
  localStorage.setItem('sphLovelyDiscoveryV1',JSON.stringify(saved));
 },{blogUsed,fresh,recent});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams,source=q.get('source')||'lovely',p=Number(q.get('page')||1);
  if(q.get('action')==='detail')return r.fulfill({json:{ok:true,item:{...fresh[source],url:q.get('url')}}});
  requests.push({source,page:p});
  const items=p===1?[fresh[source],...(source==='lovely'?[blogUsed]:source==='hatakeyama'?[makerUsed]:[])]:[item(source,'追加商品')];
  return r.fulfill({json:{ok:true,items,nextPage:pages&&p===1?2:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 return requests;
}
test('情報元を6種類で絞り、すべてへ戻すと統合一覧を表示する',async({page})=>{
 const requests=await setup(page);await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(6);
 for(const source of Object.keys(names)){
  await page.locator('#lovelySourceButtons [data-source="'+source+'"]').click();
  await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(1);
  await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveAttribute('data-lovely-select',fresh[source].url);
  await expect(page.locator('#lovelyCount')).toContainText('未紹介・要確認 1件');
 }
 await page.locator('#lovelySourceButtons [data-source="all"]').click();await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(6);
 expect(requests).toHaveLength(6);
 for(const selector of ['#lovelySourceButtons button:first-child','#lovelyFilter']){
  const size=await page.locator(selector).boundingBox();expect(size.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator(selector).evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(12);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('別の情報元で紹介済みの同じ商品を未紹介に戻さず、投稿準備から戻っても絞り込みを保つ',async({page})=>{
 await setup(page);await page.locator('#lovelySourceButtons [data-source="hatakeyama"]').click();
 await expect(page.locator('#lovelyCount')).toContainText('紹介済み 1件');
 await page.locator('#lovelyFilter').selectOption('used');
 await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(1);
 await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveAttribute('data-lovely-select',makerUsed.url);
 await expect(page.locator('#lovelyList')).toContainText('紹介済み ・ 畑山商事');
 await page.locator('#lovelyFilter').selectOption('new');await page.locator('#lovelyList [data-lovely-select]').click();
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();await page.locator('#lovelyBack').click();
 await expect(page.locator('#lovelySourceFilter')).toHaveValue('hatakeyama');await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(1);
 // Reload without the seed init-script overwriting this user choice.
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sphLovelyDiscoveryV1')).sourceFilter)).toBe('hatakeyama');
});
test('情報元で絞ったもっと見るはその情報元のみを追加し、ほかの続きも保持する',async({page})=>{
 const requests=await setup(page,{pages:true});await page.locator('#lovelySourceButtons [data-source="skater"]').click();await page.locator('#lovelyMore').click();
 await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(2);await expect(page.locator('#lovelyMore')).toBeHidden();
 expect(requests.filter(x=>x.page===2)).toEqual([{source:'skater',page:2}]);
 await page.locator('#lovelySourceButtons [data-source="gourmandise"]').click();await expect(page.locator('#lovelyMore')).toBeVisible();await page.locator('#lovelyMore').click();
 await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(2);
 expect(requests.filter(x=>x.page===2)).toEqual([{source:'skater',page:2},{source:'gourmandise',page:2}]);
 await page.locator('#lovelySourceButtons [data-source="all"]').click();await expect(page.locator('#lovelyMore')).toBeVisible();
});
test('前回確認後に追加と情報元の条件を同時に適用する',async({page})=>{
 await setup(page,{recent:true});await page.locator('#lovelyFilter').selectOption('recent');
 await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(6);
 await page.locator('#lovelySourceButtons [data-source="lovely"]').click();await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveCount(1);
 await expect(page.locator('#lovelyList [data-lovely-select]')).toHaveAttribute('data-lovely-select',fresh.lovely.url);
 await expect(page.locator('#lovelyRecentHelp')).toBeVisible();
});

test('楽天市場の商品画面をアプリで開くリンクを投稿準備に表示する',async({page})=>{
 fresh.lovely.products=[{store:'楽天',url:'https://item.rakuten.co.jp/shop/kitty/'}];
 await setup(page);
 await page.locator('#lovelySourceButtons [data-source="lovely"]').click();
 await page.locator('#lovelyList [data-lovely-select]').first().click();
 await expect(page.locator('#lovelyRakutenAppOpen')).toBeVisible();
 await expect(page.locator('#lovelyRakutenAppOpen')).toHaveAttribute('href','https://item.rakuten.co.jp/shop/kitty/');
 await expect(page.locator('#lovelyRakutenAffiliateOpen')).toContainText(/楽天アフィリエイトを(?:Chromeで)?開く/);
});
