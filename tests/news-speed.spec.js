const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const item={title:'ハローキティのリボンバッグ',source:'PR TIMES',url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',paragraphs:['かわいいバッグです。'],images:Array.from({length:6},(_,i)=>'https://example.invalid/image'+i+'.png')};
async function setup(page,handler){
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',handler);
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
}
test('選択した共有写真だけ取得し、失敗した1枚だけを再試行する',async({page})=>{
 const calls=[];let failed=false;
 await setup(page,r=>{
  const u=new URL(r.request().url()),action=u.searchParams.get('action');
  if(action==='image'){
   const i=Number(u.searchParams.get('index'));calls.push(i);
   if(i===1&&!failed){failed=true;return r.fulfill({status:502,json:{ok:false,error:'写真取得失敗'}});}
   return r.fulfill({contentType:'image/png',body:png});
  }
  return r.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.getByRole('button',{name:'写真2を再試行',exact:true})).toBeVisible();
 await expect(page.locator('#newsPhotoStatus3')).toContainText('準備しました');
 expect(calls.sort()).toEqual([0,1,2,3]);await expect(page.locator('#newsShare')).toBeDisabled();
 await page.getByRole('button',{name:'写真2を再試行',exact:true}).click();await expect(page.locator('#newsShare')).toBeEnabled();
 expect(calls.filter(i=>i===1)).toHaveLength(2);expect(calls.filter(i=>i!==1)).toHaveLength(3);
 await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 1',{exact:true})}).getByRole('checkbox').uncheck();
 await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 5',{exact:true})}).getByRole('checkbox').check();
 await expect(page.locator('#newsPhotoStatus4')).toContainText('準備しました');await expect(page.locator('#newsShare')).toBeEnabled();expect(calls.filter(i=>i===4)).toHaveLength(1);expect(calls).not.toContain(5);
});
test('一覧から見送りと復元ができ、詳細や写真を取得しない',async({page})=>{
 let detailCalls=0;
 await setup(page,r=>{const action=new URL(r.request().url()).searchParams.get('action');if(action!=='list')detailCalls++;return r.fulfill({json:{ok:true,items:[item]}});});
 await page.locator('#newsList').getByRole('button',{name:'見送り',exact:true}).click();await expect(page.locator('#newsList article')).toHaveCount(0);
 await page.locator('#newsFilter').selectOption('hidden');await expect(page.locator('#newsList')).toContainText('見送り');
 await page.locator('#newsList').getByRole('button',{name:'戻す',exact:true}).click();await page.locator('#newsFilter').selectOption('new');await expect(page.locator('#newsList article')).toHaveCount(1);expect(detailCalls).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('情報元ごとの更新待ちを表示し、取得できたニュースを残す',async({page})=>{
 await setup(page,r=>r.fulfill({json:{ok:true,items:[item],warnings:['内部エラー詳細'],sourceStatuses:{'サンリオ公式':{state:'ok',count:0},'PR TIMES':{state:'partial',count:1},'サンキューマート':{state:'failed',count:0}}}}));
 await expect(page.locator('#newsList article')).toHaveCount(1);await expect(page.locator('#newsStatus')).toContainText('PR TIMES：一部更新待ち');await expect(page.locator('#newsStatus')).toContainText('サンキューマート：更新待ち');await expect(page.locator('#newsStatus')).not.toContainText('内部エラー');
 await page.locator('#newsSourceFilter').selectOption('サンキューマート');await expect(page.locator('#newsList article')).toHaveCount(0);await expect(page.locator('#newsStatus')).toContainText('サンキューマート：更新待ち');await expect(page.locator('#newsStatus')).not.toContainText('PR TIMES');
 await page.locator('#newsSourceFilter').selectOption('all');await expect(page.locator('#newsList article')).toHaveCount(1);
});
