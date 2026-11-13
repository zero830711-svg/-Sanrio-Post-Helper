const {test,expect}=require('@playwright/test');
const image='https://image.rakuten.co.jp/shop/img/product.png';
const now=Math.floor(Date.now()/1000);
const source=(key,title,overrides={})=>({code:'shop:'+key,title,service:'market',sourceAt:now,url:'https://item.rakuten.co.jp/shop/'+key+'/',image,dedupeKey:'title:'+key,...overrides});
const draft=(item,mark='')=>({id:item.code,item:{rakuten:true,rakutenCode:item.code,rakutenService:item.service,rakutenDedupeKey:item.dedupeKey,title:item.title,url:item.url,images:[item.image],sourceAt:item.sourceAt},match:{linkMode:'item',link:'https://a.r10.to/test'},body:'',selected:[],mark,updatedAt:now});
async function setup(page,sources,entries=[]){
 const calls=[];
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');sessionStorage.setItem('sphPrivateShareInitAttempted','1');});
 await page.route('https://**/*',route=>{
  const url=new URL(route.request().url()),action=url.searchParams.get('action');
  if(!url.pathname.endsWith('/product-flow.php'))return route.fulfill({json:{ok:true,items:[]}});
  const data=route.request().postDataJSON();calls.push(action);
  let entry;
  if(action==='prepare-stock'){entry=draft(sources.find(item=>item.code===data.code));entries.push(entry);}
  if(action==='mark'){entry=entries.find(row=>row.id===data.id);entry.mark=data.mark;}
  if(action==='image')return route.abort();
  return route.fulfill({json:{ok:true,entry,entries,sources,sourceUpdatedAt:now,rakutenConfigured:true}});
 });
 await page.goto('/');
 return calls;
}
test('楽天候補は検索なしで最大5件。対象外と重複を除き、見送りを再読み込み後も保持する',async({page})=>{
 const items=[
  source('snoopy','サンリオ スヌーピー フィギュア'),source('old','クロミ 食玩',{sourceAt:now-15*86400}),source('book','キティのぬりえ',{service:'books'}),
  source('done','クロミ 投稿済みマスコット'),source('skip','ウサハナ 見送り済みマスコット'),
  source('main','【送料無料】ポチャッコ マスコット'),source('copy','ポチャッコ マスコット 別店舗',{dedupeKey:'title:main'}),
  ...Array.from({length:5},(_,i)=>source('extra'+i,'シナモロール フィギュア '+i)),
  source('appendix','ハローキティ 付録つきムック',{service:'books',url:'https://books.rakuten.co.jp/rb/123/'})
 ];
 const calls=await setup(page,items,[draft(items[3],'done'),draft(items[4],'skip')]);
 const list=page.locator('#todayRakutenList');
 await expect(list.locator('article')).toHaveCount(5);
 await expect(list.locator('h4').first()).toHaveText('ポチャッコ マスコット');
 await expect(list).not.toContainText(/スヌーピー|投稿済み|見送り済み|別店舗|ぬりえ|クロミ 食玩/);
 expect(calls).toEqual(['list']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await list.getByRole('button',{name:'見送り：ポチャッコ マスコット',exact:true}).click();
 await expect(list).not.toContainText('ポチャッコ');
 await page.reload();
 await expect(list.locator('article')).toHaveCount(5);
 await expect(list).not.toContainText('ポチャッコ');
});
test('今日の候補から共通の投稿準備を開き、元の一覧へ戻って投稿済みを記録する',async({page})=>{
 const item=source('pocha','ポチャッコ マスコット');
 const calls=await setup(page,[item]);
 const list=page.locator('#todayRakutenList');
 await list.getByRole('button',{name:/投稿準備/}).click();
 await expect(page.locator('#todayRakutenEditor #lovelyEditor')).toBeVisible();
 await expect(page.locator('#lovelyTitle')).toHaveText(item.title);
 await expect(page.locator('#lovelyRakuten')).toHaveValue('https://a.r10.to/test');
 await expect(page.locator('#homeTodayTab')).toHaveAttribute('aria-selected','true');
 await page.locator('#lovelyBack').click();
 await expect(list).toBeVisible();
 await list.getByRole('button',{name:/投稿準備/}).click();
 await page.locator('#lovelyDone').click();
 await expect(page.locator('#todayRakutenEditor')).toBeHidden();
 await expect(page.locator('#todayRakutenPanel')).toBeHidden();
 expect(calls.filter(action=>action==='prepare-stock')).toHaveLength(1);
 expect(calls).toContain('mark');
 expect(calls).not.toContain('retry');
});
