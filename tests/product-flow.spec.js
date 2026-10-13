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
test('楽天在庫の下書きで検索アフィリエイト付き本文を編集・保存して復元する',async({page})=>{
 const row=entry();const calls=await setup(page,row);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#flowFinal')).toHaveValue(/#pr/);expect(await page.locator('#flowFinal').inputValue()).toContain(search);
 await page.locator('#flowBody').fill('🎀 編集した本文');await page.locator('#flowSave').click();
 await expect(page.locator('#flowStatus')).toContainText('保存しました');
 expect(calls.filter(c=>c.action==='save')[0].data.body).toBe('🎀 編集した本文');
 await page.locator('#flowBack').click();await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#flowBody')).toHaveValue('🎀 編集した本文');
 await page.locator('#flowLinkMode').selectOption('none');await expect(page.locator('#flowFinal')).not.toHaveValue(/hb\\.afl/);
 await expect(page.locator('#flowFinal')).not.toHaveValue(/#pr/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('楽天の在庫候補から入力せず下書きを準備する',async({page})=>{
 const row=entry(false),calls=await setup(page,row,{candidate:true});
 await expect(page.locator('#flowSources')).toContainText('ハローキティのマスコット');
 await page.locator('#flowSources').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#flowEditor')).toBeVisible();
 await expect(page.locator('#flowTitle')).toHaveText(row.item.title);
 await expect(page.locator('#flowLink')).toHaveValue('');
 expect(calls.filter(c=>c.action==='prepare-stock').map(c=>c.data)).toEqual([{code:row.item.code}]);
});
test('自動準備の停止設定と投稿済み記録を保存する',async({page})=>{
 const calls=await setup(page,entry());await page.locator('#flowAuto').uncheck();
 await expect(page.locator('#flowAuto')).not.toBeChecked();expect(calls.find(c=>c.action==='settings').data.enabled).toBe(false);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();await page.locator('#flowDone').click();
 await expect(page.locator('#flowCount')).toHaveText('0件の楽天在庫下書き');
 await page.locator('#flowFilter').selectOption('done');await expect(page.locator('#flowCount')).toHaveText('1件の楽天在庫下書き');
});
test('選択した写真4枚とリンク付き本文を共有する',async({page})=>{
 const row=entry();row.item.images=Array.from({length:5},(_,i)=>'https://thumbnail.image.rakuten.co.jp/test-'+i+'.png');row.selected=[0,1,2,3];
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async d=>{window.__shared={text:d.text,count:d.files.length};},configurable:true});
 });
 await setup(page,row);await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await page.locator('#flowConfirm').check();await expect(page.locator('#flowShare')).toBeEnabled();
 await page.locator('#flowPhotos input').nth(4).click();await expect(page.locator('#flowPhotos input').nth(4)).not.toBeChecked();
 await page.locator('#flowShare').click();expect(await page.evaluate(()=>window.__shared.count)).toBe(4);
 expect(await page.evaluate(()=>window.__shared.text)).toContain('#pr');
});
