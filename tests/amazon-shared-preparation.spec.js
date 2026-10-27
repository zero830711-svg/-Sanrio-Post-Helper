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
 await expect(page.locator('#amazonFlowSearch')).toBeEnabled();await expect(page.locator('#amazonFlowQuery')).toBeVisible();
 return {calls,autoCalls};
}
test('Amazonの共通投稿準備で短縮リンクと編集本文を保存し復元する',async({page})=>{
 const {calls}=await setup(page);await page.locator('#amazonFlowSearch').click();
 await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#amazonSearchArea #lovelyEditor')).toBeVisible();
 await expect(page.locator('#lovelyLinkTools')).toHaveAttribute('open','');
 await expect(page.locator('#lovelyPhotos')).toBeVisible();await expect(page.locator('#lovelyPostAi')).toBeVisible();
 await page.locator('#lovelyAmazon').fill('https://amzn.to/shortTest');
 const body='🎀 編集した紹介\nhttps://amzn.to/shortTest\n#pr';await page.locator('#lovelyPostText').fill(body);
 await page.locator('#lovelyBack').click();await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();
 await expect(page.locator('#lovelyAmazon')).toHaveValue('https://amzn.to/shortTest');await expect(page.locator('#lovelyPostText')).toHaveValue(body);
 await page.locator('#lovelyDone').click();await expect(page.locator('#lovelyEditor')).toBeHidden();
 expect((await page.evaluate(()=>JSON.parse(localStorage.getItem('sphAmazonScoutCandidatesV1'))))[0].status).toBe('投稿済み');
 expect(calls).toHaveLength(1);
});
test('保存済みAmazonの検索紹介リンクを変更せず引き継ぐ',async({page})=>{
 await setup(page);const search='https://www.amazon.co.jp/s?k=TOPTOY%20%E3%82%B5%E3%83%B3%E3%83%AA%E3%82%AA&tag=original-22&ref=manual';
 await page.locator('#amazonManualAddBox summary').click();await page.locator('#amazonManualTitle').fill('TOPTOY サンリオ');await page.locator('#amazonManualUrl').fill(search);await page.locator('#amazonManualConfirmed').check();await page.locator('#amazonManualAdd').click();
 await expect(page.locator('#lovelyAmazon')).toHaveValue(search);await page.locator('#lovelyBack').click();
 await page.reload();await page.getByRole('tab',{name:'商品検索',exact:true}).click();await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();await expect(page.locator('#lovelyAmazon')).toHaveValue(search);
});
test('AmazonのAI本文は押したときだけ生成し自分のリンクを保持する',async({page})=>{
 await setup(page);let calls=0;const link='https://amzn.to/example123';
 await page.route('**/news.php?**',r=>{if(new URL(r.request().url()).searchParams.get('action')!=='product-groq-draft')return r.fulfill({json:{ok:true,items:[]}});calls++;expect(r.request().postDataJSON().links).toEqual([{kind:'amazon',url:link}]);return r.fulfill({json:{ok:true,configured:true,text:'🎀 商品紹介\n'+link+'\n#pr'}})});
 await page.locator('#amazonFlowSearch').click();await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();await page.locator('#lovelyAmazon').fill(link);
 expect(calls).toBe(0);await page.locator('#lovelyPostAi').click();await expect(page.locator('#lovelyPostText')).toHaveValue('🎀 商品紹介\n'+link+'\n#pr');expect(calls).toBe(1);
});
test('照合用写真を表示し端末の写真を選択して共有する',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async d=>window.sharedProduct={count:d.files.length,text:d.text},configurable:true})});
 await setup(page);await page.locator('#amazonFlowSearch').click();await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#lovelyProductInfo img[alt="商品照合用プレビュー"]')).toHaveAttribute('src',item.image);
 await page.locator('#lovelyPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 await expect.poll(()=>page.evaluate(()=>window.sharedProduct?.count)).toBe(1);
});
