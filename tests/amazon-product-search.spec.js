const {test,expect}=require('@playwright/test');
const url='https://www.amazon.co.jp/dp/B000000001?tag=test-22&ref_=api';
const item={title:'ハローキティ テストマスコット',url,image:'https://m.media-amazon.com/images/I/test.jpg'};
async function setup(page,{legacy=false,error=false,automatic=false,due=false,autoError=false,posted=false}={}){
 const calls=[],autoCalls=[];
 await page.addInitScript(({legacy,url,posted})=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  if(legacy)localStorage.setItem('sphAmazonScoutCandidatesV1',JSON.stringify([{id:'old',title:'保存済みのクロミ',affiliateUrl:url,draft:'💜 前に編集した本文\n'+url+'\n#PR',status:posted?'投稿済み':'未投稿',createdAt:'2026-10-01T00:00:00Z'}]));
 },{legacy,url,posted});
 await page.route('**/product-flow.php?**',r=>r.fulfill({json:{ok:true,entries:[],sources:[],sourceUpdatedAt:Math.floor(Date.now()/1000),rakutenConfigured:true}}));
 await page.route('**/amazon-creators.php?**',r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  const cached={ok:true,configured:true,partnerTag:'test-22',updatedAt:Math.floor(Date.now()/1000),nextAt:Math.floor(Date.now()/1000)+1800,autoState:'ok',lastQuery:'サンリオ',nextQuery:'ハローキティ ぬいぐるみ',items:automatic?[{...item,fetchedAt:Math.floor(Date.now()/1000)},{...item,fetchedAt:Math.floor(Date.now()/1000),url:url+'&duplicate=1'}]:[]};
  if(action==='candidates'){autoCalls.push(action);return r.fulfill({json:{...cached,nextAt:due?0:cached.nextAt}});}
  if(action==='discover'){autoCalls.push(action);return autoError?r.fulfill({status:502,json:{ok:false,error:'利用上限です。',stage:'product-search',upstreamStatus:429}}):r.fulfill({json:cached});}
  calls.push(r.request().postDataJSON());return error?r.fulfill({status:502,json:{ok:false,error:'商品APIの利用権限を確認できません。',stage:'product-search',upstreamStatus:403}}):r.fulfill({json:{ok:true,partnerTag:'test-22',items:[item,{title:'不正リンク',url:'https://www.amazon.co.jp.evil.test/dp/B000000002',image:''}]}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'商品検索',exact:true}).click();await page.getByRole('button',{name:'Amazon',exact:true}).click();await expect(page.locator('#flowProviderAmazon')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#flowProviderRakuten')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#amazonFlowSearch')).toBeEnabled();await page.getByText('特定の商品を検索',{exact:true}).click();
 return {calls,autoCalls};
}
test('Amazon検索から編集・検索リンク・下書き復元・投稿済みまで',async({page})=>{
 const {calls}=await setup(page);expect(calls).toHaveLength(0);
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
 const {calls}=await setup(page,{legacy:true});await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();
 await expect(page.locator('#amazonFlowBody')).toHaveValue('💜 前に編集した本文');await expect(page.locator('#amazonFlowLink')).toHaveValue(url);
 await page.getByRole('button',{name:'楽天',exact:true}).click();await expect(page.locator('#flowProviderRakuten')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#flowRakutenArea')).toBeVisible();await expect(page.locator('#amazonSearchArea')).toBeHidden();expect(calls).toHaveLength(0);
});
test('Amazonの商品権限エラーは表示し、保存済み下書きを保持する',async({page})=>{
 const {calls}=await setup(page,{legacy:true,error:true});await page.locator('#amazonFlowSearch').click();await expect(page.locator('#amazonFlowStatus')).toContainText('商品検索／HTTP 403');
 expect(calls).toHaveLength(1);await expect(page.locator('#amazonFlowDrafts')).toContainText('保存済みのクロミ');await expect(page.locator('#amazonFlowSearch')).toBeEnabled();
});
test('ニュースの商品名を引き継ぎ、楽天リンクと編集本文を保持してAmazonリンクを戻す',async({page})=>{
 await setup(page);
 const source={url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',title:'ニュースのキティ',source:'PR TIMES',paragraphs:['商品の紹介です。'],images:[]};
 await page.route('**/news.php?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('action')==='list'?{ok:true,items:[source]}:{ok:true,item:source}}));
 await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await page.locator('#newsText').fill('編集済みニュース本文');await page.getByText('楽天・Amazonリンクを追加',{exact:true}).click();
 await page.locator('#newsAffiliateRakuten').fill('https://a.r10.to/test');await page.locator('#newsAffiliateSave').click();await page.locator('#newsAmazonSearch').click();
 await expect(page.locator('#amazonFlowQuery')).toHaveValue(source.title);await page.locator('#amazonFlowSearch').click();await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();
 await page.locator('#amazonFlowToNews').click();
 await expect(page.locator('#newsPanel')).toBeVisible();await expect(page.locator('#newsAffiliateAmazon')).toHaveValue(url);await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/test');
 await expect(page.locator('#newsText')).toHaveValue('編集済みニュース本文');await expect(page.locator('#newsReplyText')).toHaveValue(/ref_=api/);
});

test('Amazonを開くとキャッシュ候補を自動表示し、同じASINは1件にする',async({page})=>{
 const {calls,autoCalls}=await setup(page,{automatic:true});
 await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);await expect(page.locator('#amazonAutoProgress')).toContainText('ハローキティ ぬいぐるみ');
 expect(autoCalls).toEqual(['candidates']);expect(calls).toHaveLength(0);
 await page.locator('#amazonAutoResults').getByRole('button',{name:'投稿準備'}).click();await page.locator('#amazonFlowDone').click();await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(0);
});
test('期限が来た時だけ次の検索を進め、上限エラーでもキャッシュ候補を残す',async({page})=>{
 const {calls,autoCalls}=await setup(page,{automatic:true,due:true,autoError:true});
 await expect(page.locator('#amazonAutoStatus')).toContainText('HTTP 429');await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);
 expect(autoCalls).toEqual(['candidates','discover']);expect(calls).toHaveLength(0);
});
test('投稿済み候補を自動一覧から除外するが保存済み下書きは残す',async({page})=>{
 await setup(page,{automatic:true,legacy:true,posted:true});await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(0);
 await page.locator('#amazonFlowFilter').selectOption('投稿済み');await expect(page.locator('#amazonFlowDrafts')).toContainText('保存済みのクロミ');
});
