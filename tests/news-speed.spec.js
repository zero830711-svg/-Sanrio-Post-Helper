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
 await page.locator('#newsFilterButtons').getByRole('button',{name:'投稿済み・見送り',exact:true}).click();await expect(page.locator('#newsList')).toContainText('見送り');
 await page.locator('#newsList').getByRole('button',{name:'戻す',exact:true}).click();await page.locator('#newsFilterButtons').getByRole('button',{name:'未投稿',exact:true}).click();await expect(page.locator('#newsList article')).toHaveCount(1);expect(detailCalls).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('情報元ごとの更新待ちを表示し、取得できたニュースを残す',async({page})=>{
 await setup(page,r=>r.fulfill({json:{ok:true,items:[item],warnings:['内部エラー詳細'],sourceStatuses:{'サンリオ公式':{state:'ok',count:0},'PR TIMES':{state:'partial',count:1},'サンキューマート':{state:'failed',count:0}}}}));
 await expect(page.locator('#newsList article')).toHaveCount(1);await expect(page.locator('#newsStatus')).toContainText('PR TIMES：一部更新待ち');await expect(page.locator('#newsStatus')).toContainText('サンキューマート：更新待ち');await expect(page.locator('#newsStatus')).not.toContainText('内部エラー');
 await expect(page.locator('#newsSourceFilter')).toBeHidden();await expect(page.locator('#newsSourceButtons').getByRole('button',{name:'すべて',exact:true})).toHaveAttribute('aria-pressed','true');await page.locator('#newsSourceButtons').getByRole('button',{name:'サンキューマート',exact:true}).click();await expect(page.locator('#newsSourceButtons').getByRole('button',{name:'サンキューマート',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('#newsList article')).toHaveCount(0);await expect(page.locator('#newsStatus')).toContainText('サンキューマート：更新待ち');await expect(page.locator('#newsStatus')).not.toContainText('PR TIMES');
 await page.locator('#newsSourceButtons').getByRole('button',{name:'すべて',exact:true}).click();await expect(page.locator('#newsList article')).toHaveCount(1);
});


test('一覧の見送りは同じ記事をまとめて保存し、画面に結果を知らせる',async({page})=>{
 const first={...item,title:'ハローキティのリボンバッグ 第1弾'};
 const copy={...first,source:'サンリオ公式',url:'https://www.sanrio.co.jp/news/goods/skip-test/'};
 const others=Array.from({length:12},(_,i)=>({...item,title:`サンリオのおでかけグッズ 第${i+2}弾`,url:`https://prtimes.jp/main/html/rd/p/${i+1000}.12345.html`}));
 let detailCalls=0;await setup(page,r=>{const action=new URL(r.request().url()).searchParams.get('action');if(action!=='list')detailCalls++;return r.fulfill({json:{ok:true,items:[first,copy,...others]}});});
 await expect(page.locator('#newsList article')).toHaveCount(5);
 const row=page.locator('#newsList article').filter({hasText:'ハローキティのリボンバッグ 第1弾'});await expect(row).toHaveCount(1);await row.getByRole('button',{name:'見送り',exact:true}).click();
 await expect(page.locator('#newsActionNotice')).toHaveText('見送りました');await expect(page.locator('#newsActionNotice')).toBeVisible();await expect(page.locator('#newsList')).not.toContainText(first.title);
 const marks=await page.evaluate(()=>JSON.parse(localStorage.getItem('sanrioNewsMarks')));expect(marks[first.url].kind).toBe('skip');expect(marks[copy.url].kind).toBe('skip');expect(detailCalls).toBe(0);
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await expect(page.locator('#newsList')).not.toContainText(first.title);
 await page.locator('#newsFilterButtons').getByRole('button',{name:'投稿済み・見送り',exact:true}).click();const skipped=page.locator('#newsList article').filter({hasText:first.title});await expect(skipped).toHaveCount(1);await skipped.getByRole('button',{name:'戻す',exact:true}).click();await expect(page.locator('#newsActionNotice')).toHaveText('一覧に戻しました');
 await page.locator('#newsFilterButtons').getByRole('button',{name:'未投稿',exact:true}).click();await expect(page.locator('#newsList')).toContainText(first.title);
});

test('見送りを保存できないときは一覧に残して画面内に理由を示す',async({page})=>{
 await page.addInitScript(()=>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(name==='sanrioNewsStatus')throw new Error('storage disabled');return open.call(this,name,...args);};const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='sanrioNewsMarks')throw new DOMException('quota','QuotaExceededError');return set.call(this,key,value);};});
 await setup(page,r=>r.fulfill({json:{ok:true,items:[item]}}));
 await page.locator('#newsList').getByRole('button',{name:'見送り',exact:true}).click();
 await expect(page.locator('#newsList article')).toHaveCount(1);await expect(page.locator('#newsActionNotice')).toContainText('見送りを保存できませんでした');await expect(page.locator('#newsActionNotice')).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('sanrioNewsMarks'))).toBeNull();
});

test('容量超過時も詳細から投稿済みを保存し、再読込後に戻せる',async({page})=>{
 await page.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='sanrioNewsMarks')throw new DOMException('quota','QuotaExceededError');return set.call(this,key,value);};});
 await setup(page,r=>r.fulfill({json:{ok:true,items:[item],item}}));
 await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.locator('#newsDone')).toBeEnabled();
 await page.locator('#newsDone').click();
 await expect(page.locator('#newsActionNotice')).toHaveText('投稿済みにしました');
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await page.locator('#newsFilterButtons').getByRole('button',{name:'投稿済み・見送り',exact:true}).click();
 await page.locator('#newsList').getByRole('button',{name:'戻す',exact:true}).click();
 await expect(page.locator('#newsActionNotice')).toHaveText('一覧に戻しました');
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsList article')).toHaveCount(1);
});
