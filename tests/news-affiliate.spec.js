const {test,expect}=require('@playwright/test');
test('Instagramに購入リンクだけを追加し、地域・下書き・投稿記録を保持する',async({page})=>{
 const item={instagram:true,instagramAccount:'minilike_official',url:'https://www.instagram.com/p/Example/',title:'ハローキティのリボンバッグ',source:'Instagram (minilike_official)',paragraphs:['かわいいリボンのバッグです。'],images:[]};
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');return r.fulfill({json:a==='list'?{ok:true,items:[item]}:a==='instagram-accounts'?{ok:true,accounts:[]}:{ok:true,item}});});
 await page.goto('/');await page.getByRole('tab',{name:'Instagram',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await page.getByText('楽天・Amazonリンクを追加',{exact:true}).click();
 const url='https://hb.afl.rakuten.co.jp/hgc/test/?pc=https%3A%2F%2Fsearch.rakuten.co.jp%2Fsearch%2Fmall%2Fkitty';
 await page.locator('#newsAffiliateRakuten').fill(url);await page.locator('#newsAffiliateSave').click();await expect(page.locator('#newsReplyText')).toHaveValue(new RegExp('search%2Fmall%2Fkitty'));await expect(page.locator('#newsText')).not.toHaveValue(/instagram.com/);
 await page.locator('#newsAffiliatePlacement').selectOption('body');await page.locator('#newsAffiliateSave').click();await expect(page.locator('#newsText')).toHaveValue(/search%2Fmall%2Fkitty/);await expect(page.locator('#newsReplyBox')).toBeHidden();
 await page.getByText('海外の販売・開催地域を確認',{exact:true}).click();await page.locator('#newsConfirmedRegion').selectOption('香港');await expect(page.locator('#newsText')).toHaveValue(/香港の情報/);
 await page.locator('#newsBack').click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue(url);await expect(page.locator('#newsText')).toHaveValue(/香港の情報/);
 await page.locator('#newsPostedUrl').fill('https://x.com/fan/status/123');await page.locator('#newsDone').click();await page.locator('#newsFilter').selectOption('all');await expect(page.locator('#newsList')).toContainText('投稿記録：');await expect(page.locator('#newsList').getByRole('link',{name:'投稿したXを確認'})).toHaveAttribute('href','https://x.com/fan/status/123');
});
