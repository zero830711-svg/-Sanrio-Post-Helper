const {test,expect}=require('@playwright/test');
test('選択したアカウントのみ取得して結果を表示する',async({page})=>{
 let requests=[];
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',async r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  const accounts=[{account:'sunstar_now',enabled:true,region:'日本'},{account:'marimocraft',enabled:true,region:'日本'}];
  if(action==='instagram-fetch'){requests.push(r.request().postDataJSON());await new Promise(resolve=>setTimeout(resolve,200));return r.fulfill({json:{ok:true,checkedAt:1791690000,accounts:[{account:'sunstar_now'}],photoCount:2}});}
  return r.fulfill({json:action==='instagram-accounts'?{ok:true,accounts}:{ok:true,items:[],instagramAccounts:accounts}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'Instagram',exact:true}).click();
 const button=page.locator('#instagramFetchNow');await expect(button).toBeDisabled();
 await page.locator('#instagramAccountFilter').selectOption('sunstar_now');await expect(button).toBeEnabled();
 await button.click();await expect(button).toBeDisabled();await expect(page.locator('#instagramFetchStatus')).toContainText('写真2枚を取得');
 expect(requests).toEqual([{account:'sunstar_now'}]);await expect(page.locator('#instagramAccountFilter')).toHaveValue('sunstar_now');
});