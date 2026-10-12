const {test,expect}=require('@playwright/test');
async function setup(page,{fail=false,delay=false}={}){
 const item={instagram:true,instagramAccount:'sanriogiftgatehk',url:'https://www.instagram.com/p/PhotoTest/',title:'キティの新商品',source:'Instagram',paragraphs:['商品のお知らせ'],images:[0,1,2,3].map(i=>'https://example.com/'+i+'.jpg')};
 const calls=[];
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('https://example.com/**',r=>r.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1cAAAAASUVORK5CYII=','base64'),contentType:'image/png'}));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',async r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  if(action==='instagram-photo-read'){calls.push({action,data:r.request().postDataJSON()});if(fail)return r.fulfill({status:502,json:{ok:false,error:'写真を読み取れませんでした。'}});return r.fulfill({json:{ok:true,configured:true,readings:[{index:0,original:'10/16 HK$100',japanese:'10月16日 香港ドル100'}]}});}
  if(action==='ai-draft'){calls.push({action,data:r.request().postDataJSON()});if(delay)await new Promise(resolve=>setTimeout(resolve,500));return r.fulfill({json:{ok:true,configured:true,text:'🎀 キティの新商品\n香港で10月16日発売予定✨'}});}
  if(action==='image')return r.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1cAAAAASUVORK5CYII=','base64'),contentType:'image/png'});
  return r.fulfill({json:action==='list'?{ok:true,items:[item]}:action==='instagram-accounts'?{ok:true,accounts:[]}:{ok:true,item}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'Instagram',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 return calls;
}
test('写真の文字と原文から生成し、読取結果を保存・復元する',async({page})=>{
 const calls=await setup(page);await expect(page.locator('#newsPhotoUse')).toBeChecked();await page.locator('#newsAiRetry').click();
 await expect(page.locator('#newsText')).toHaveValue(/香港で10月16日/);
 expect(calls).toEqual([{action:'instagram-photo-read',data:{url:'https://www.instagram.com/p/PhotoTest/',photoIndices:[0,1,2]}},{action:'ai-draft',data:{url:'https://www.instagram.com/p/PhotoTest/',photoIndices:[0,1,2]}}]);
 await page.locator('#newsPhotoReadingsBox summary').click();await expect(page.locator('#newsPhotoReadings')).toContainText('香港ドル100');
 await page.reload();await page.getByRole('tab',{name:'Instagram',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await page.locator('#newsPhotoReadingsBox summary').click();await expect(page.locator('#newsPhotoReadings')).toContainText('HK$100');
});
test('原文のみへ切り替えると写真読取を呼ばない',async({page})=>{
 const calls=await setup(page);await page.locator('#newsPhotoUse').uncheck();await page.locator('#newsAiRetry').click();await expect(page.locator('#newsText')).toHaveValue(/香港で/);
 expect(calls).toEqual([{action:'ai-draft',data:{url:'https://www.instagram.com/p/PhotoTest/'}}]);
});
test('写真読取失敗時は本文を保持し、原文のみで再生成できる',async({page})=>{
 const calls=await setup(page,{fail:true});const before=await page.locator('#newsText').inputValue();await page.locator('#newsAiRetry').click();await expect(page.locator('#newsAiStatus')).toContainText('写真を読み取れませんでした');
 await expect(page.locator('#newsText')).toHaveValue(before);expect(calls).toHaveLength(1);
 await page.locator('#newsPhotoUse').uncheck();await page.locator('#newsAiRetry').click();await expect(page.locator('#newsText')).toHaveValue(/香港で/);
});
test('写真を使うAI生成中も手動編集を保持する',async({page})=>{
 await setup(page,{delay:true});await page.locator('#newsAiRetry').click();await expect(page.locator('#newsAiStatus')).toContainText('投稿文を作成中');
 await page.locator('#newsText').fill('自分で編集した本文');await expect(page.locator('#newsAiStatus')).toContainText('手動編集を優先');await expect(page.locator('#newsText')).toHaveValue('自分で編集した本文');
});
