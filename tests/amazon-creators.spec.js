const {test,expect}=require('@playwright/test');
const id='amzn1.application-oa2-client.'+'a'.repeat(32),secret='FAKE_TEST_SECRET_NOT_REAL_123456';
async function prepare(page,fail=false){
 const calls=[];await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/amazon-creators.php?**',r=>{
  const action=new URL(r.request().url()).searchParams.get('action'),data=r.request().postDataJSON();calls.push({action,data});
  if(action==='search')return r.fulfill(fail?{status:403,json:{ok:false,error:'Amazonの商品APIの利用権限をまだ確認できません。'}}:{json:{ok:true,connected:true,partnerTag:'test-22',items:[{title:'ハローキティのテスト商品',url:'https://www.amazon.co.jp/dp/B000000001?tag=test-22',image:''}]}});
  return r.fulfill({json:{ok:true,configured:r.request().method()==='POST',version:'3.3',partnerTag:'test-22'}});
 });
 await page.goto('/amazon-creators.html');await expect(page.locator('#connectionStatus')).toContainText('認証情報ID');return calls;
}
test('Amazon認証情報を非公開APIへ保存し、検索商品を候補づくりに渡す',async({page})=>{
 const calls=await prepare(page);await page.locator('#credentialId').fill(id);await page.locator('#credentialSecret').fill(secret);await page.locator('#saveConnection').click();await expect(page.locator('#connectionStatus')).toContainText('商品APIに接続できました');
 expect(calls.find(c=>c.action==='settings'&&c.data)?.data).toEqual({credentialId:id,secret,version:'3.3',partnerTag:'test-22'});
 await expect(page.locator('#credentialSecret')).toHaveValue('');await expect(page.locator('#credentialId')).toHaveValue('');expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(secret);
 await page.getByRole('link',{name:'この商品を候補づくりへ'}).click();await expect(page.locator('#productTitle')).toHaveValue('ハローキティのテスト商品');await expect(page.locator('#productUrl')).toHaveValue('https://www.amazon.co.jp/dp/B000000001?tag=test-22');
});
test('認証CSVは読み込みだけで送信せず、シークレットを保存しない',async({page})=>{
 const calls=await prepare(page);await page.locator('#credentialCsv').setInputFiles({name:'credentials.csv',mimeType:'text/csv',buffer:Buffer.from('Credential ID,Credential Secret,Version\r\n"'+id+'","'+secret+'","3.3"\r\n')});
 await expect(page.locator('#credentialId')).toHaveValue(id);await expect(page.locator('#credentialSecret')).toHaveValue(secret);await expect(page.locator('#credentialVersion')).toHaveValue('3.3');
 expect(calls.filter(c=>c.data)).toHaveLength(0);expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(secret);
});
test('商品APIの利用権限エラーを接続成功として表示せず、自動再試行しない',async({page})=>{
 const calls=await prepare(page,true);await page.locator('#credentialId').fill(id);await page.locator('#credentialSecret').fill(secret);await page.locator('#saveConnection').click();
 await expect(page.locator('#connectionStatus')).toContainText('認証情報は保存済み');await expect(page.locator('#connectionStatus')).toContainText('利用権限');await expect(page.locator('#connectionStatus')).not.toContainText('接続できました');await expect(page.locator('#credentialSecret')).toHaveValue('');expect(calls.filter(c=>c.action==='search')).toHaveLength(1);
});
