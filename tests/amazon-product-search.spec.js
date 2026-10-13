const {test,expect}=require('@playwright/test');
const url='https://www.amazon.co.jp/dp/B000000001?tag=test-22&ref_=api';
const item={title:'ハローキティ テストマスコット',url,image:'https://m.media-amazon.com/images/I/test.jpg'};
async function setup(page,{legacy=false,error=false}={}){
 const calls=[];
 await page.addInitScript(({legacy,url})=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  if(legacy)localStorage.setItem('sphAmazonScoutCandidatesV1',JSON.stringify([{id:'old',title:'保存済みのクロミ',affiliateUrl:url,draft:'💜 前に編集した本文\n'+url+'\n#PR',status:'未投稿',createdAt:'2026-10-01T00:00:00Z'}]));
 },{legacy,url});
 await page.route('**/product-flow.php?**',r=>r.fulfill({json:{ok:true,entries:[],sources:[],sourceUpdatedAt:Math.floor(Date.now()/1000),rakutenConfigured:true}}));
 await page.route('**/amazon-creators.php?**',r=>{calls.push(r.request().postDataJSON());return error?r.fulfill({status:502,json:{ok:false,error:'商品APIの利用権限を確認できません。',stage:'product-search',upstreamStatus:403}}):r.fulfill({json:{ok:true,partnerTag:'test-22',items:[item,{title:'不正リンク',url:'https://www.amazon.co.jp.evil.test/dp/B000000002',image:''}]}});});
 await page.goto('/');await page.getByRole('tab',{name:'商品検索',exact:true}).click();await page.locator('#flowProvider').selectOption('amazon');
 return calls;
}
test('Amazon検索から編集・検索リンク・下書き復元・投稿済みまで',async({page})=>{
 const calls=await setup(page);expect(calls).toHaveLength(0);
 await page.locator('#amazonFlowQuery').fill('ハローキティ');await page.locator('#amazonFlowSearch').click();
 await expect(page.locator('#amazonFlowStatus')).toContainText('1件を取得');expect(calls).toEqual([{keywords:'ハローキティ'}]);
 await expect(page.locator('#amazonFlowResults')).not.toContainText('不正リンク');
 await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#amazonFlowFinal')).toHaveValue(new RegExp('ref_=api'));
 await page.locator('#amazonFlowBody').fill('🎀 編集した商品紹介');await page.locator('#amazonFlowMode').selectOption('search');
 const link=await page.locator('#amazonFlowLink').inputValue();expect(new URL(link).searchParams.get('k')).toBe(item.title);expect(new URL(link).searchParams.get('tag')).toBe('test-22');
 await expect(page.locator('#amazonFlowFinal')).toHaveValue(/#pr$/);
 await page.reload();await page.getByRole('tab',{name:'商品検索',exact:true}).click();
 await expect(page.locator('#amazonSearchArea')).toBeVisible();await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();
 await expect(page.locator('#amazonFlowBody')).toHaveValue('🎀 編集した商品紹介');await expect(page.locator('#amazonFlowLink')).toHaveValue(link);
 await page.locator('#amazonFlowMode').selectOption('none');await expect(page.locator('#amazonFlowFinal')).toHaveValue('🎀 編集した商品紹介');
 await page.locator('#amazonFlowDone').click();await page.locator('#amazonFlowFilter').selectOption('投稿済み');await expect(page.locator('#amazonFlowDrafts')).toContainText(item.title);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('既存Amazon候補の本文と紹介リンクを引き継ぎ、楽天へ切り替えられる',async({page})=>{
 const calls=await setup(page,{legacy:true});await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();
 await expect(page.locator('#amazonFlowBody')).toHaveValue('💜 前に編集した本文');await expect(page.locator('#amazonFlowLink')).toHaveValue(url);
 await page.locator('#flowProvider').selectOption('rakuten');await expect(page.locator('#flowRakutenArea')).toBeVisible();await expect(page.locator('#amazonSearchArea')).toBeHidden();expect(calls).toHaveLength(0);
});
test('Amazonの商品権限エラーは表示し、保存済み下書きを保持する',async({page})=>{
 const calls=await setup(page,{legacy:true,error:true});await page.locator('#amazonFlowSearch').click();await expect(page.locator('#amazonFlowStatus')).toContainText('商品検索／HTTP 403');
 expect(calls).toHaveLength(1);await expect(page.locator('#amazonFlowDrafts')).toContainText('保存済みのクロミ');await expect(page.locator('#amazonFlowSearch')).toBeEnabled();
});
test('ニュースの商品名を引き継ぎ、元ニュースへリンクを戻す',async({page})=>{
 await setup(page);let payload;
 await page.evaluate(()=>{document.addEventListener('sph-amazon-news-link',e=>{window.testAmazonNews=e.detail;});document.dispatchEvent(new CustomEvent('sph-amazon-product-search',{detail:{title:'ニュースのキティ',sourceUrl:'https://www.sanrio.co.jp/news/goods/test-20261001/'}}));});
 await expect(page.locator('#amazonFlowQuery')).toHaveValue('ニュースのキティ');await page.locator('#amazonFlowSearch').click();await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();
 await page.locator('#amazonFlowToNews').click();payload=await page.evaluate(()=>window.testAmazonNews);expect(payload).toEqual({sourceUrl:'https://www.sanrio.co.jp/news/goods/test-20261001/',link:url});
});
