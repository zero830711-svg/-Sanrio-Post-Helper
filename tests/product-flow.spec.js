const {test,expect}=require('@playwright/test');
const source='https://www.instagram.com/p/TestProduct001/';
const product='https://item.rakuten.co.jp/shop1/kitty/';
const affiliate='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc='+encodeURIComponent(product);
const search='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc='+encodeURIComponent('https://search.rakuten.co.jp/search/mall/4901234567894/');
function entry(link=true){return {id:'test-id',item:{url:source,title:'ハローキティの新作マスコット',source:'Instagram（テスト）',images:[],paragraphs:['JAN：4901234567894']},body:'🎀 ハローキティのマスコットが登場',selected:[],identity:{jan:'4901234567894',model:'',keyword:'4901234567894'},match:{link:link?search:'',linkMode:link?'search':'none',searchAffiliate:link?search:'',itemAffiliate:link?affiliate:'',searchUrl:'https://search.rakuten.co.jp/search/mall/4901234567894/',shopCount:link?2:0,matchStatus:link?'JAN・型番で照合済み':'商品一致の確認待ち',candidates:link?[]:[{code:'shop1:kitty',title:'ハローキティのマスコット',shop:'テスト店',url:product,affiliate,image:''}]},warnings:[],createdAt:1,updatedAt:1,mark:''};}
async function setup(page,row){
 const calls=[];await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/product-flow.php?**',r=>{
  const action=new URL(r.request().url()).searchParams.get('action'),data=r.request().postDataJSON();calls.push({action,data});
  if(action==='save'){row.body=data.body;row.selected=data.selected;row.match.linkMode=data.linkMode;}
  if(action==='confirm'){row.match.itemAffiliate=affiliate;row.match.searchAffiliate=search;row.match.link=affiliate;row.match.linkMode='item';row.match.matchStatus='商品一致を手動確認済み';}
  if(action==='mark')row.mark=data.mark;
  return r.fulfill({json:{ok:true,entries:[row],entry:row,enabled:true,rakutenConfigured:true,aiConfigured:true}});
 });
 await page.goto('/');await page.locator('#homeProductFlowTab').click();await expect(page.locator('#flowCount')).toHaveText('1件');return calls;
}
test('新商品タブで検索アフィリエイト付き本文を編集・保存して復元する',async({page})=>{
 const row=entry();const calls=await setup(page,row);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#flowFinal')).toHaveValue(/#pr/);expect(await page.locator('#flowFinal').inputValue()).toContain(search);
 expect(await page.locator('#flowFinal').inputValue()).not.toContain(source);
 await page.locator('#flowBody').fill('🎀 編集した本文');await page.locator('#flowSave').click();
 await expect(page.locator('#flowStatus')).toContainText('保存しました');
 expect(calls.filter(c=>c.action==='save')[0].data.body).toBe('🎀 編集した本文');
 await page.locator('#flowBack').click();await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#flowBody')).toHaveValue('🎀 編集した本文');
 await page.locator('#flowLinkMode').selectOption('none');await expect(page.locator('#flowFinal')).not.toHaveValue(/hb\.afl/);
 await expect(page.locator('#flowFinal')).not.toHaveValue(/#pr/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('商品未確認の候補に自動リンクを付けず、明示確認で採用する',async({page})=>{
 const calls=await setup(page,entry(false));await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#flowLink')).toHaveValue('');
 await page.getByText('楽天の商品一致を確認・変更',{exact:true}).click();
 await page.getByRole('button',{name:'写真・商品が一致するので採用',exact:true}).click();
 await expect(page.locator('#flowLink')).toHaveValue(affiliate);
 expect(calls.filter(c=>c.action==='confirm')).toHaveLength(1);
 expect(calls.filter(c=>c.action==='tick')).toHaveLength(0);
});
test('自動準備の停止設定と投稿済み記録を保存する',async({page})=>{
 const calls=await setup(page,entry());await page.locator('#flowAuto').uncheck();
 expect(calls.find(c=>c.action==='settings').data.enabled).toBe(false);
 await page.getByRole('button',{name:'確認・共有',exact:true}).click();await page.locator('#flowDone').click();
 await expect(page.locator('#flowCount')).toHaveText('0件');
 await page.locator('#flowFilter').selectOption('done');await expect(page.locator('#flowCount')).toHaveText('1件');
});
test('選択した写真4枚とリンク付き本文を共有する',async({page})=>{
 const row=entry();row.item.images=Array.from({length:5},(_,i)=>'https://scontent.cdninstagram.com/test-'+i+'.png');row.selected=[0,1,2,3];
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async d=>{window.__shared={text:d.text,count:d.files.length};},configurable:true});
 });
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 await page.route('**/news.php?action=image**',r=>r.fulfill({contentType:'image/png',body:png}));
 await page.route('https://scontent.cdninstagram.com/**',r=>r.fulfill({contentType:'image/png',body:png}));
 await setup(page,row);await page.getByRole('button',{name:'確認・共有',exact:true}).click();
 await expect(page.locator('#flowShare')).toBeEnabled();
 await page.locator('#flowPhotos input').nth(4).click();await expect(page.locator('#flowPhotos input').nth(4)).not.toBeChecked();
 await page.locator('#flowShare').click();expect(await page.evaluate(()=>window.__shared.count)).toBe(4);
 expect(await page.evaluate(()=>window.__shared.text)).toContain('#pr');
});
