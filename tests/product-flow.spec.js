const {test,expect}=require('@playwright/test');
const product='https://item.rakuten.co.jp/shop1/kitty/';
const affiliate='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc='+encodeURIComponent(product);
const search='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc='+encodeURIComponent('https://search.rakuten.co.jp/search/mall/4901234567894/');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function entry(link=true){
 return {id:'test-id',item:{rakuten:true,rakutenService:'market',rakutenCode:'market:shop1:kitty',code:'market:shop1:kitty',url:product,title:'ハローキティのマスコット',source:'楽天市場',images:[],paragraphs:['JAN：4901234567894']},body:'🎀 ハローキティのマスコットが登場',selected:[],identity:{jan:'4901234567894',model:'',keyword:'4901234567894'},match:{link:link?search:'',linkMode:link?'search':'none',searchAffiliate:link?search:'',itemAffiliate:link?affiliate:'',searchUrl:'https://search.rakuten.co.jp/search/mall/4901234567894/',shopCount:link?2:0,matchStatus:link?'JAN・型番で照合済み':'商品一致の確認待ち',candidates:[]},warnings:[],createdAt:1,updatedAt:1,mark:''};
}
async function setup(page,row,{candidate=false}={}){
 const calls=[];let enabled=true,entries=candidate?[]:[row];
 const sources=candidate?[{code:row.item.code,service:'market',sourceLabel:'楽天市場',title:row.item.title,url:product,price:1500,shop:'テスト店'}]:[];
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/product-flow.php?**',r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  if(action==='image')return r.fulfill({contentType:'image/png',body:png});
  const data=r.request().postDataJSON();calls.push({action,data});
  if(action==='prepare-stock')entries=[row];
  if(action==='save'){row.body=data.body;row.selected=data.selected;row.match.linkMode=data.linkMode;}
  if(action==='mark')row.mark=data.mark;
  if(action==='settings')enabled=data.enabled;
  return r.fulfill({json:{ok:true,entries,entry:row,sources,sourceUpdatedAt:Math.floor(Date.now()/1000),enabled,rakutenConfigured:true,aiConfigured:true}});
 });
 await page.goto('/');await page.locator('#homeProductFlowTab').click();
 await expect(page.locator('#flowCount')).toHaveText((candidate?'0':'1')+'件の楽天在庫下書き');
 return calls;
}
test('楽天検索も共通の投稿準備を開き編集・復元して検索一覧へ戻る',async({page})=>{
 const row=entry(),calls=await setup(page,row);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#productFlowPanel #lovelyEditor')).toBeVisible();
 await expect(page.locator('#homeProductFlowTab')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#lovelyRakuten')).toHaveValue(search);
 await expect(page.locator('#lovelyLinkTools')).toHaveAttribute('open','');
 const manual='🎀 編集した本文\n'+search+'\n#pr';
 await page.locator('#lovelyPostText').fill(manual);await page.locator('#lovelyBack').click();
 await expect(page.locator('#flowBrowse')).toBeVisible();
 expect(calls.filter(c=>c.action==='save').at(-1).data.body).toBe(manual);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#lovelyPostText')).toHaveValue(manual);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.locator('#homeNewTab').click();
 await expect(page.locator('#lovelyPanel #lovelyEditor')).toHaveCount(1);
});
test('楽天候補から同じ写真・リンク・本文操作を開く',async({page})=>{
 const row=entry(false),calls=await setup(page,row,{candidate:true});
 await page.locator('#flowSources').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#productFlowPanel #lovelyEditor')).toBeVisible();
 await expect(page.locator('#lovelyTitle')).toHaveText(row.item.title);
 await expect(page.locator('#lovelyRakuten')).toHaveValue('');
 await expect(page.locator('#lovelyRakutenAppOpen')).toHaveAttribute('href',product);
 await expect(page.locator('#lovelyPostAi')).toBeVisible();
 expect(calls.filter(c=>c.action==='prepare-stock').map(c=>c.data)).toEqual([{code:row.item.code}]);
});
test('共通画面の投稿済み・見送りを楽天検索側へ記録する',async({page})=>{
 const calls=await setup(page,entry());await page.locator('#flowAuto').uncheck();
 expect(calls.find(c=>c.action==='settings').data.enabled).toBe(false);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();await page.locator('#lovelyDone').click();
 await expect(page.locator('#flowBrowse')).toBeVisible();
 await expect(page.locator('#flowCount')).toHaveText('0件の楽天在庫下書き');
 await page.locator('#flowFilter').selectOption('done');
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();await page.locator('#lovelySkip').click();
 expect(calls.filter(c=>c.action==='mark').map(c=>c.data.mark)).toEqual(['done','skip']);
});
test('楽天検索の写真を共通画面で選びリンク付き本文を共有する',async({page})=>{
 const row=entry();row.item.images=['https://image.rakuten.co.jp/test/image.png'];
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async d=>{window.__shared={text:d.text,count:d.files.length};},configurable:true});
 });
 const calls=await setup(page,row);await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await page.locator('[data-lovely-image="0"]').check();
 await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 expect(await page.evaluate(()=>window.__shared.count)).toBe(1);
 expect(await page.evaluate(()=>window.__shared.text)).toContain(search);
 expect(calls.some(c=>c.action==='retry')).toBe(false);
});
test('AIはボタンでのみ生成し入力済みのリンクと本文を保持する',async({page})=>{
 const row=entry();row.edited=false;row.body='以前の自動生成';await setup(page,row);let calls=0;
 const generated='🎀 キティのマスコット\n'+search+'\n#pr';
 await page.route('**/news.php?**',r=>{
  if(new URL(r.request().url()).searchParams.get('action')!=='product-groq-draft')return r.fulfill({json:{ok:true,items:[]}});
  calls++;expect(r.request().postDataJSON().links).toEqual([{kind:'rakuten',url:search}]);
  return r.fulfill({json:{ok:true,configured:true,text:generated}});
 });
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();expect(calls).toBe(0);
 await expect(page.locator('#lovelyPostText')).not.toHaveValue(/以前の自動生成/);
 await page.locator('#lovelyPostAi').click();await expect(page.locator('#lovelyPostText')).toHaveValue(generated);expect(calls).toBe(1);
 await page.locator('#lovelyBackBottom').click();await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#lovelyPostText')).toHaveValue(generated);
});
