const {test,expect}=require('@playwright/test');
const make=(id,title)=>({tipsOnly:true,source:'ガシャポン公式',title,url:'https://gashapon.jp/products/detail.php?jan_code='+id,images:[],paragraphs:[],facts:[],date:''});
async function setup(page,items){
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',r=>{const u=new URL(r.request().url());return r.fulfill({json:u.searchParams.get('action')==='list'?{ok:true,items:typeof items==='function'?items():items}:{ok:true,item:(typeof items==='function'?items():items).find(i=>i.url===u.searchParams.get('url'))}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
}
test('商品番号の違うニュースを分け、投稿済みが他の商品に広がらない',async({page})=>{
 const a=make('4582770054712000','サンリオキャラクターズ マスコット'),b=make('4570118183781000',a.title);await setup(page,[a,b]);await expect(page.locator('#newsList article')).toHaveCount(2);
 await page.locator('#newsList article').first().getByRole('button',{name:'投稿準備'}).click();await page.locator('#newsDone').click();await expect(page.locator('#newsList article')).toHaveCount(1);await expect(page.locator('#newsList article')).not.toContainText('投稿済み');
 const arts=await page.evaluate(()=>{const a={tipsOnly:true,title:'サンリオキャラクターズ マスコット',url:'https://www.takaratomy-arts.co.jp/items/item.html?n=Y123456'};return [newsSameStory(a,{...a,url:'https://www.takaratomy-arts.co.jp/items/item.html?n=Y654321'}),newsSameStory(a,{...a,url:a.url+'&utm_source=x'})];});expect(arts).toEqual([false,true]);
});
test('編集文と写真の順番・AI案を再読み込み後に復元し、再生成しない',async({page})=>{
 const item={...make('4582770054712000','サンリオキャラクターズ マスコット'),images:['https://example.com/a.png','https://example.com/b.png']};let ai=0;
 await setup(page,[item]);
 await page.unroute('**/news.php?**');await page.route('**/news.php?**',r=>{const action=new URL(r.request().url()).searchParams.get('action');if(action==='image')return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')});if(action==='ai-draft'){ai++;return r.fulfill({json:{ok:true,configured:true,text:'🎀 保存するAI文',drafts:[{text:'🎀 保存するAI文'},{text:'💖 2番のAI文'},{text:'✨ 3番のAI文'}]}});}return r.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});});
 await page.locator('#newsList button').click();await page.locator('#newsAiRetry').click();await expect(page.locator('#newsAiChoiceLabel')).toBeVisible();await page.locator('#newsAiChoice').selectOption('1');await page.locator('#newsText').fill('💖 手直し済みの投稿文');await page.getByRole('button',{name:'写真2を前へ',exact:true}).click();
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsFilter').selectOption('draft');await expect(page.locator('#newsList article')).toHaveCount(1);await expect(page.locator('#newsList article')).toContainText('準備中');await page.locator('#newsList button').click();await expect(page.locator('#newsText')).toHaveValue('💖 手直し済みの投稿文');await expect(page.locator('#newsAiChoice')).toHaveValue('1');await expect(page.locator('#newsAiChoiceLabel')).toBeVisible();expect(await page.evaluate(()=>newsState.selected)).toEqual([1,0]);expect(ai).toBe(1);await expect(page.locator('#newsDraftStatus')).toContainText('復元');
 await page.locator('#newsDone').click();await expect(page.locator('#newsList article')).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(newsStorageKey('Drafts'))).entries)).toHaveLength(0);
});
test('初回をNEWにせず、発表日なしの追加情報を上に表示する',async({page})=>{
 const a={...make('4582770054712000','既存ニュース'),source:'サンキューマート',date:'2026-09-25'};const b=make('4570118183781000','新しく見つけた商品');let items=[a];await setup(page,()=>items);await expect(page.locator('#newsList')).not.toContainText('NEW');await expect(page.locator('#newsList')).toContainText('発表 9/25');items=[a,b];await page.locator('#newsRefresh').click();await expect(page.locator('#newsList article')).toHaveCount(2);await expect(page.locator('#newsList article').first()).toContainText('NEW');await expect(page.locator('#newsList article').first()).toContainText(b.title);await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await expect(page.locator('#newsList')).not.toContainText('NEW');await expect(page.locator('#newsList article').first()).toContainText(b.title);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
