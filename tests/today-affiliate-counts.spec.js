const {test,expect}=require('@playwright/test');
async function boot(page){
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof candidatePoolAnalysis==='function');
}
test('追加候補はリンクありを写真と反応より先に並べ重複商品をまとめる',async({page})=>{
 await boot(page);
 const result=await page.evaluate(()=>{
  const old=new Date(Date.now()-100*86400000).toISOString();
  const make=(id,props={})=>({id,title:'商品紹介 '+id+' の詳細情報',text:'商品を紹介する十分な長さの確認済み本文です。',postedAt:old,...props});
  const pool=[make('unlinked-photo',{images:['image.jpg'],impressions:900000}),make('linked-no-photo',{amazon:'https://amzn.to/linked',impressions:10}),make('linked-photo',{rakuten:'https://a.r10.to/photo',images:['image.jpg'],impressions:1}),make('linked-high',{amazon:'https://amzn.to/high',images:['image.jpg'],impressions:10000}),make('same-product',{amazon:'https://www.amazon.co.jp/dp/B012345678/?tag=test'}),make('same-product-copy',{amazon:'https://www.amazon.co.jp/dp/B012345678/?tag=test'})];
  return additionalTodayPicks(pool,[]).map(x=>x.id);
 });
 expect(result.indexOf('linked-no-photo')).toBeLessThan(result.indexOf('unlinked-photo'));
 expect(result.indexOf('linked-high')).toBeLessThan(result.indexOf('linked-photo'));
 expect(result.filter(id=>id.startsWith('same-product'))).toHaveLength(1);
});
test('総数と除外内訳が重複なく一致し元データを変更しない',async({page})=>{
 await boot(page);
 const result=await page.evaluate(()=>{
  const old=new Date(Date.now()-100*86400000).toISOString(),now=new Date().toISOString();
  const make=(id,props={})=>({id,title:'十分に長い商品紹介 '+id,text:'商品の魅力を紹介する十分な長さの本文です。',postedAt:old,...props});
  const items=[make('excluded',{candidateExcluded:true,candidateExcludedChangedAt:now,text:''}),make('short',{text:''}),make('wait',{postedAt:now}),make('dated',{text:'7月10日開催のイベントをご紹介します。十分な本文があります。'}),make('skip',{skippedAt:now}),make('cooldown',{amazon:'https://www.amazon.co.jp/dp/B012345678/'}),make('recent-same',{amazon:'https://www.amazon.co.jp/dp/B012345678/',lastRepostedAt:now}),make('ready'),make('ready-copy',{postId:'123'}),make('ready-copy2',{postId:'123'})];
  const before=JSON.stringify(items),a=candidatePoolAnalysis(items);
  return {total:a.total,posts:a.posts,counts:a.counts,ready:a.ready.length,same:before===JSON.stringify(items)};
 });
 expect(result).toEqual({total:10,posts:9,counts:{excluded:1,short:1,interval:2,dated:1,skipped:1,sameProduct:1},ready:3,same:true});
 expect(Object.values(result.counts).reduce((a,b)=>a+b,0)+result.ready).toBe(result.total);
});
test('もっと見るでも先頭枠とリンク優先を保持し件数を表示する',async({page})=>{
 await boot(page);
 await page.evaluate(async()=>{
  await dbDeleteMany((await dbGetAll()).map(x=>x.id));
  const old=new Date(Date.now()-100*86400000).toISOString();
  const make=(id,props={})=>({id,title:'独立した商品 '+id+' の紹介',text:'商品について確認した情報を紹介する十分な長さの本文です。',postedAt:old,...props});
  const base=make('base',{amazon:'https://amzn.to/base',images:['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>']});
  const rows=[base,make('no-link',{images:['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'],impressions:999999}),...Array.from({length:7},(_,i)=>make('linked-'+i,{amazon:'https://amzn.to/item'+i,impressions:100+i}))];
  await dbPutMany(rows);getRoleBasedPicks=async()=>[{...base,_role:'久しぶり'}];stampRecommendations=async()=>{};todayAdditionalLimit=0;await renderToday();
 });
 await expect(page.locator('#todayMore')).toContainText('あと8件');
 await page.locator('#todayMore').click();await expect(page.locator('.today-news-row')).toHaveCount(6);
 expect(await page.locator('.today-news-row').evaluateAll(rows=>rows.map(r=>r.querySelector('[data-id]').dataset.id))).toEqual(['base','linked-6','linked-5','linked-4','linked-3','linked-2']);
 await expect(page.locator('#todayCountsSummary')).toContainText('保存 9件 ／ 候補 9件');
 await page.locator('#todayCountsSummary').click();await expect(page.locator('#todayCounts')).toContainText('リンクあり：8件');
 await page.locator('#todayMore').click();await expect(page.locator('.today-news-row')).toHaveCount(9);await expect(page.locator('#todayMore')).toBeHidden();
});
