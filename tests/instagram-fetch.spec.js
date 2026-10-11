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
test('取得時刻、投稿日順、初回取得順、詳細条件を確認する',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 const items=[{title:'クロミバッグ',date:'2026-10-10',collectedAt:200,instagram:true,instagramAccount:'sunstar_now',url:'https://www.instagram.com/p/old/',source:'Instagram',paragraphs:[],images:[]},{title:'キティ文具',date:'2026-10-11',collectedAt:100,instagram:true,instagramAccount:'sunstar_now',url:'https://www.instagram.com/p/new/',source:'Instagram',paragraphs:[],images:[]}];
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items,accounts:[{account:'sunstar_now',enabled:true,region:'日本'}],instagramAccounts:[{account:'sunstar_now',enabled:true,region:'日本'}],instagramCollection:{lastSuccessfulAt:1791690000,lastCheckedAt:1791690000,state:'ok'}}}));
 await page.goto('/');await page.getByRole('tab',{name:'Instagram',exact:true}).click();
 await expect(page.locator('#instagramCollectionStatus')).toContainText('最終取得成功');
 await expect(page.locator('#instagramSort')).toHaveValue('published');
 await expect(page.locator('#newsList strong').first()).toContainText('キティ');
 await page.locator('#instagramSort').selectOption('new');
 await expect(page.locator('#newsList strong').first()).toContainText('クロミ');
 await expect(page.locator('#instagramRegionFilter')).toBeHidden();
 await page.getByText('詳細条件・アカウント管理',{exact:true}).click();await expect(page.locator('#instagramRegionFilter')).toBeVisible();
});
