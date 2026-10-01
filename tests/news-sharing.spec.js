const {test,expect}=require('@playwright/test');
test('ニュースの写真を先に取得し、編集した本文と一緒に共有する',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.sharedNews={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/news.php?**',async route=>{
  const u=new URL(route.request().url()),action=u.searchParams.get('action');
  if(action==='image')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  const item={title:'ハローキティ＆クロミの新作',source:'PR TIMES',date:'2026-10-01',image:'https://example.invalid/thumb.png',facts:[{kind:'schedule',text:'10月上旬発売予定です。'},{kind:'price',text:'価格は1,290円（税込）です。'}],url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',images:Array.from({length:5},(_,i)=>'https://example.invalid/image'+i+'.png'),paragraphs:['価格は1,290円（税込）です。','リボンをあしらった、かわいいデザインの新作です。']};
  return route.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.goto('/');
 await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#todayHomePanel')).not.toBeVisible();
 await expect(page.locator('#lovelyPanel')).not.toBeVisible();
 await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.locator('#newsShare')).toBeEnabled();
 await expect(page.locator('#newsBrowse')).not.toBeVisible();
 await expect(page.locator('#newsImages img')).toHaveCount(5);
 expect(await page.locator('#newsEditor').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
 expect(await page.locator('#newsEditor').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(100);
 await expect(page.locator('#newsText')).toHaveValue(/10月上旬発売予定/);
 await expect(page.locator('#newsText')).toHaveValue(/1,290円/);
 await expect(page.locator('#newsText')).toHaveValue(/🎀/);
 await expect(page.locator('#newsText')).toHaveValue(/リボンをあしらった、かわいいデザイン/);
 expect(await page.evaluate(()=>newsHighlight({title:'新作',paragraphs:['送料は500円です。','詳細はこちらをご覧ください。']}))).toBe('');
 expect(await page.evaluate(()=>newsHighlight({title:'クロミ当りくじ',paragraphs:['ヒョウ柄がポイントのドレスがかわいい、クロミの当りくじが登場するよ！']}))).toBe('ヒョウ柄がポイントのドレスがかわいい、クロミの当りくじが登場✨');
 await page.getByRole('button',{name:'写真2を前へ',exact:true}).click();
 await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 1', {exact:true})}).getByRole('checkbox').uncheck();
 await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 5', {exact:true})}).getByRole('checkbox').check();
 await page.locator('#newsText').fill('確認済みの紹介文\n詳細：https://prtimes.jp/main/html/rd/p/000000122.000013308.html');
 await page.locator('#newsBack').click();
 await expect(page.locator('#newsBrowse')).toBeVisible();
 await expect(page.locator('#newsEditor')).not.toBeVisible();
 await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.locator('#newsText')).toHaveValue(/確認済みの紹介文/);
 await expect(page.locator('#newsImages .news-photo').first()).toContainText('1枚目');
 await expect(page.locator('#newsImages .news-photo').first().locator('img')).toHaveAttribute('alt','記事の写真 2');
 await page.locator('#newsShare').click();
 const shared=await page.evaluate(()=>window.sharedNews);
 expect(shared.text).toContain('確認済みの紹介文');
 expect(shared.files.map(f=>f.name)).toEqual(['news-2.png','news-3.png','news-4.png','news-5.png']);
 await page.locator('#newsDone').click();
 await expect(page.locator('#newsList article')).toHaveCount(0);
 await page.locator('#newsFilter').selectOption('hidden');
 await expect(page.locator('#newsList')).toContainText('投稿済み');
 await page.reload();
 await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsList article')).toHaveCount(0);
 await page.locator('#newsFilter').selectOption('hidden');
 await page.locator('#newsList').getByRole('button',{name:'戻す',exact:true}).click();
 await page.locator('#newsFilter').selectOption('new');
 await expect(page.locator('#newsList article')).toHaveCount(1);
 await expect(page.locator('#newsList')).toContainText('発表 10/1');
 await expect(page.locator('#newsList img')).toHaveAttribute('src','https://example.invalid/thumb.png');
 await page.getByRole('tab',{name:'今日の候補',exact:true}).click();
 await expect(page.locator('#newsPanel')).not.toBeVisible();
});

test('ニュース本文から商品ラインナップを優先し、確認できた日程と価格をまとめる',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>typeof newsDraft==='function');
 const result=await page.evaluate(()=>{
  const item={title:'クロミの新作グッズが登場',url:'https://www.sanrio.co.jp/news/goods/example/',paragraphs:['かわいいデザインの新作が登場するよ！',...Array(13).fill('イベントについてのご案内です。'),'毛布やコスメケースなど、ヒョウ柄のアイテムが揃います。','送料は500円です。'],facts:[{kind:'price',text:'1回880円（税込）です。'},{kind:'schedule',text:'10月3日から順次発売予定です。'}]};
  return {highlight:newsHighlight(item),draft:newsDraft(item),empty:newsDraft({title:'新作ニュース',url:item.url,paragraphs:[],facts:[]}),long:newsDraft({...item,title:'とても長い商品ニュース'.repeat(12),paragraphs:['かわいいデザインのバッグやポーチなどが揃います。']})};
 });
 expect(result.highlight).toBe('毛布やコスメケースなど、ヒョウ柄のアイテムが揃います');
 expect(result.draft).toContain(result.highlight);expect(result.draft).toContain('📅 10月3日から順次発売予定');expect(result.draft).toContain('💰 1回880円（税込）');
 expect(result.draft).not.toContain('送料');expect(result.empty).not.toMatch(/📅|💰|発売|販売中/);
 expect(Array.from(result.long).length).toBeLessThanOrEqual(280);
 expect(result.long).toContain('https://www.sanrio.co.jp/news/goods/example/');
});

test('ニュースを5件ずつ表示し、戻った時も表示件数を維持する',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 const items=Array.from({length:12},(_,i)=>({title:'サンリオ新作ニュース'+i,source:'サンリオ公式',url:'https://www.sanrio.co.jp/news/goods/test-'+i+'/',images:[],paragraphs:[]}));
 await page.route('**/news.php?**',route=>{
  const u=new URL(route.request().url());return route.fulfill({json:u.searchParams.get('action')==='list'?{ok:true,items}:{ok:true,item:items.find(i=>i.url===u.searchParams.get('url'))}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsList article')).toHaveCount(5);await expect(page.locator('#newsMore')).toHaveText('もっと見る（あと7件）');
 await page.locator('#newsMore').click();await expect(page.locator('#newsList article')).toHaveCount(10);
 await page.locator('#newsList article').nth(6).getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#newsShare')).toBeEnabled();
 await page.locator('#newsBack').click();await expect(page.locator('#newsList article')).toHaveCount(10);
 await page.locator('#newsMore').click();await expect(page.locator('#newsList article')).toHaveCount(12);await expect(page.locator('#newsMore')).not.toBeVisible();
 await page.locator('#newsFilter').selectOption('all');await expect(page.locator('#newsList article')).toHaveCount(5);
});

test('写真ファイルの取得中に本文とプレビューを確認し、編集した状態で開き直せる',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.fastShared=data.files.map(f=>f.name);},configurable:true});
 });
 const item={title:'サンリオの新作リボングッズ',source:'PR TIMES',url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',images:['https://example.invalid/1.png','https://example.invalid/2.png'],paragraphs:['リボンをあしらったかわいいデザインです。']};
 const pending=[];let details=0,images=0;
 await page.route('**/news.php?**',async route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  if(action==='image'){images++;await new Promise(resolve=>pending.push(async()=>{await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});resolve();}));return;}
  if(action==='detail')details++;
  await route.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await page.locator('#newsList').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#newsImages img')).toHaveCount(2);
 await expect(page.locator('#newsText')).toHaveValue(/リボン/);await expect(page.locator('#newsShare')).toBeDisabled();
 await page.locator('#newsText').fill('写真の取得を待たずに編集した本文');
 await page.getByRole('button',{name:'写真2を前へ',exact:true}).click();
 await expect.poll(()=>pending.length).toBe(2);
 await page.locator('#newsBack').click();await page.locator('#newsList').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#newsText')).toHaveValue('写真の取得を待たずに編集した本文');
 await expect(page.locator('#newsImages img').first()).toHaveAttribute('alt','記事の写真 2');
 expect(details).toBe(1);expect(images).toBe(2);
 await Promise.all(pending.map(release=>release()));
 await expect(page.locator('#newsShare')).toBeEnabled();await page.locator('#newsShare').click();
 expect(await page.evaluate(()=>window.fastShared)).toEqual(['news-2.png','news-1.png']);
});
test('選んだ写真を取得できないときは、不完全な写真共有をしない',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 const item={title:'サンリオ新作',source:'サンリオ公式',url:'https://www.sanrio.co.jp/news/goods/example/',images:['https://example.invalid/1.png','https://example.invalid/2.png'],paragraphs:[]};
 await page.route('**/news.php?**',route=>{
  const u=new URL(route.request().url()),action=u.searchParams.get('action');
  if(action==='image')return u.searchParams.get('index')==='1'?route.fulfill({status:502,json:{ok:false,error:'写真を取得できません'}}):route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  return route.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#newsEditorStatus')).toContainText('一部の写真を取得できません');await expect(page.locator('#newsShare')).toBeDisabled();
 await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 2',{exact:true})}).getByRole('checkbox').uncheck();
 await expect(page.locator('#newsShare')).toBeEnabled();
});
