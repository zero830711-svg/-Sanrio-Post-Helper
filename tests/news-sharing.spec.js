const {test,expect}=require('@playwright/test');
test('ニュースはGeminiを呼ばず通常の下書きを使い、編集と共有を維持する',async({page})=>{
 const item={url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',title:'ハローキティのリボンバッグ',source:'PR TIMES',paragraphs:['リボン付きバッグです。'],images:[]};
 let aiCalls=0;
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'share',{value:async data=>{window.sharedPlainNews=data.text},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  if(action==='ai-draft'){aiCalls++;return r.fulfill({status:429,json:{ok:false,error:'利用上限'}});}
  return r.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.locator('#newsText')).toHaveValue(/リボンバッグ/);
 await expect(page.locator('#newsShare')).toBeEnabled();
 await expect(page.locator('#newsAiRetry')).toBeEnabled();await expect(page.locator('#newsAiStatus')).toContainText('文字数制限なし');await expect(page.locator('#newsAiChoice')).not.toBeVisible();
 await page.locator('#newsText').fill('確認して編集したニュース本文');
 await page.locator('#newsBackBottom').click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(page.locator('#newsText')).toHaveValue('確認して編集したニュース本文');
 await page.locator('#newsShare').click();expect(await page.evaluate(()=>window.sharedPlainNews)).toBe('確認して編集したニュース本文');expect(aiCalls).toBe(0);
});
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
 await expect(page.locator('#newsEditorStatus')).toContainText('選んだ写真を取得できません');await expect(page.locator('#newsShare')).toBeDisabled();
 await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 2',{exact:true})}).getByRole('checkbox').uncheck();
 await expect(page.locator('#newsShare')).toBeEnabled();
});


test('一覧の日程は発表日と分け、明記された発売・開催日だけを表示する',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>typeof newsScheduleLabel==='function');
 const labels=await page.evaluate(()=>[
  newsScheduleLabel({title:'10/3（土）〜順次発売！「クロミ当りくじ」'}),
  newsScheduleLabel({title:'サンリオ新作',facts:[{kind:'schedule',text:'開催期間：10月7日（水）～11月8日（日）'}]}),
  newsScheduleLabel({title:'10月上旬発売予定の新作'}),
  newsScheduleLabel({facts:[{kind:'schedule',text:'10月7日から11月8日まで開催します。'}]}),
  newsScheduleLabel({title:'2026年10月発売予定の新作'}),
  newsScheduleLabel({title:'10月1日発表のニュース',date:'2026-10-01'}),
  newsScheduleLabel({title:'ニュース',facts:[{kind:'schedule',text:'10月1日発表、10月3日発売予定です。'}]})
 ]);
 expect(labels).toEqual(['10/3順次発売','10/7〜11/8開催','10月上旬発売予定','10/7〜11/8開催','10月発売予定','','10/3発売予定']);
});

test('公式とPR TIMESの同じ商品ニュースをまとめ、両方の記事を確認できる',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 const official={title:'3caratから「おとなのカラビナ」が登場！',source:'サンリオ公式',date:'2026-10-01',url:'https://www.sanrio.co.jp/news/goods/carabiner/',images:[],paragraphs:[],facts:[{kind:'schedule',text:'10月3日発売予定'}]};
 const press={...official,title:'新作グッズ「おとなのカラビナ」を発売',source:'PR TIMES',url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html'};
 const press2={...press,title:'「おとなのカラビナ」新作グッズが登場！',url:'https://prtimes.jp/main/html/rd/p/000000124.000013308.html'};
 const press3={...press,title:'新作グッズ「おとなのカラビナ」を発売！',url:'https://prtimes.jp/main/html/rd/p/000000125.000013308.html'};
 const other={...press,title:'第2弾「おとなのカラビナ」を発売',url:'https://prtimes.jp/main/html/rd/p/000000123.000013308.html'};
 await page.route('**/news.php?**',route=>{const action=new URL(route.request().url()).searchParams.get('action');return route.fulfill({json:action==='list'?{ok:true,items:[press,official,press2,press3,press,other]}:{ok:true,item:official}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsList article')).toHaveCount(2);
 await expect(page.locator('#newsList article').first()).toContainText('サンリオ公式');
 await expect(page.locator('#newsList article').first()).toContainText('PR TIMES');
 await expect(page.locator('.news-schedule').first()).toHaveText('10/3発売予定');
 await page.locator('#newsList article').first().getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#newsRelatedSources a')).toHaveCount(4);
 await expect(page.locator('#newsRelatedSources a').filter({hasText:'PR TIMES'}).first()).toHaveAttribute('href',press.url);
 await page.locator('#newsDone').click();
 await expect(page.locator('#newsList article')).toHaveCount(1);
 expect(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('sanrioNewsMarks'))))).toEqual(expect.arrayContaining([official.url,press.url,press2.url,press3.url]));
 await page.locator('#newsFilter').selectOption('hidden');
 await expect(page.locator('#newsList article')).toHaveCount(1);
 await page.locator('#newsList').getByRole('button',{name:'戻す'}).click();
 await page.locator('#newsFilter').selectOption('new');await expect(page.locator('#newsList article')).toHaveCount(2);
 const safe=await page.evaluate(()=>{const a={source:'サンリオ公式',title:'「クロミ当りくじ」',date:'2026-10-01'};const b={...a,source:'PR TIMES'};return [
  newsSameStory(a,{...b,title:'「ハローキティ当りくじ」'}),
  newsSameStory(a,{...b,date:'2025-10-01'}),
  newsSameStory({...a,facts:[{kind:'schedule',text:'10月3日発売'}]},{...b,facts:[{kind:'schedule',text:'11月3日発売'}]}),
  newsSameStory({...a,title:'サンリオ新作ニュース1'},{...b,title:'サンリオ新作ニュース2'})
 ];});
 expect(safe).toEqual([false,false,false,false]);
});

test('不要なAI設定とお試しボタンを表示せず、設定APIも呼ばない',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 let settingsCalls=0;
 await page.route('**/news.php?**',route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  if(action==='ai-settings')settingsCalls++;
  return route.fulfill({json:{ok:true,items:[]}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsStatus')).toContainText('0 / 0件');
 for(const id of ['newsAiSettings','newsAiKey','newsAiSave','newsAiRemove','newsExample'])await expect(page.locator('#'+id)).toHaveCount(0);
 expect(settingsCalls).toBe(0);
});

test('同じ取得元の重複と短い同一見出しをまとめ、URLの追跡パラメータを無視する',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(()=>{const a={source:'PR TIMES',title:'クロミ新作情報',date:'2026-10-01',url:'https://prtimes.jp/main/html/rd/p/1.2.html'};return [
 newsSameStory(a,{...a,url:'https://prtimes.jp/main/html/rd/p/3.2.html',title:'クロミ新作情報！'}),
 newsSameStory(a,{...a,url:a.url+'?utm_source=x#release'}),
 newsSameStory(a,{...a,url:'https://prtimes.jp/main/html/rd/p/4.2.html',title:'ハローキティ新作情報'}),
 newsSameStory(a,{...a,url:'https://prtimes.jp/main/html/rd/p/5.2.html',date:'2025-10-01'})
 ];});expect(result).toEqual([true,true,false,false]);
});

test('ルートバリア×ウサハナの公式・PR見出しをまとめ、異なる商品や時期は分ける',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 const official={title:'ネイチャーリパブリックの「ルートバリア」にウサハナ限定デザインが登場♪',source:'サンリオ公式',date:'2026-10-02',url:'https://www.sanrio.co.jp/news/goods/root-barrier/',images:[],paragraphs:[]};
 const press={...official,title:'〈ルートバリア×ウサハナ〉スキンケア時間が楽しくなるようなコラボレーションアイテムを発売',source:'PR TIMES',date:'2026-10-01',url:'https://prtimes.jp/main/html/rd/p/000000001.000000002.html'};
 await page.route('**/news.php?**',route=>{const action=new URL(route.request().url()).searchParams.get('action');return route.fulfill({json:action==='list'?{ok:true,items:[official,press]}:{ok:true,item:official}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsList article')).toHaveCount(1);
 await expect(page.locator('#newsList article')).toContainText('サンリオ公式・PR TIMES');
 await page.locator('#newsList article').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#newsRelatedSources a')).toHaveCount(2);
 const safe=await page.evaluate(({official,press})=>[
  newsSameStory(official,press),newsSameStory(press,official),
  newsSameStory(official,{...press,title:press.title.replaceAll('ウサハナ','クロミ')}),
  newsSameStory(official,{...press,title:press.title.replaceAll('ルートバリア','ビタペアCセラム')}),
  newsSameStory(official,{...press,date:'2026-09-01'}),
  newsSameStory(official,{...press,title:'第2弾'+press.title}),
  newsSameStory({...official,facts:[{kind:'schedule',text:'10月3日発売'}]},{...press,facts:[{kind:'schedule',text:'11月3日発売'}]}),
  newsSameStory({...official,title:'ウサハナ「サンリオキャラクターズ」グッズ発売'},{...press,title:'〈サンリオキャラクターズ×ウサハナ〉限定グッズ発売'})
 ],{official,press});expect(safe).toEqual([true,true,false,false,false,false,false,false]);
 await page.locator('#newsDone').click();await expect(page.locator('#newsList article')).toHaveCount(0);
 expect(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('sanrioNewsMarks'))))).toEqual(expect.arrayContaining([official.url,press.url]));
});

test('Groq設定とボタン生成、生成中の編集保護と失敗時の本文保持',async({page})=>{
 const item={url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',title:'クロミのバッグ',source:'PR TIMES',paragraphs:['リボン付きバッグです。'],images:[]};
 let calls=0,release;let response={ok:true,configured:true,text:'🎀💜 クロミのリボンバッグ ✨\n\n#サンリオ'};
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',async r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  if(action==='groq-settings'){expect(r.request().postDataJSON().apiKey).toBe('gsk_test_12345678901234567890');return r.fulfill({json:{ok:true,configured:true}});}
  if(action==='ai-draft'){calls++;if(calls===2)await new Promise(resolve=>release=resolve);return r.fulfill({json:response});}
  return r.fulfill({json:action==='list'?{ok:true,items:[item]}:{ok:true,item}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();expect(calls).toBe(0);
 await page.locator('#newsGroqSettings summary').click();await page.locator('#newsGroqKey').fill('gsk_test_12345678901234567890');await page.locator('#newsGroqSave').click();await expect(page.locator('#newsGroqKey')).toHaveValue('');await expect(page.locator('#newsGroqStatus')).toContainText('保存しました');
 expect(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('gsk_test')))).toBe(false);
 await page.locator('#newsAiRetry').click();await expect(page.locator('#newsText')).toHaveValue(response.text);await expect(page.locator('#newsAiStatus')).toContainText('文字数制限なし');
 await page.locator('#newsAiRetry').click();await expect.poll(()=>calls).toBe(2);await page.locator('#newsText').fill('手動で編集した本文');release();await expect(page.locator('#newsAiStatus')).toContainText('手動編集を優先');await expect(page.locator('#newsText')).toHaveValue('手動で編集した本文');
 response={ok:false,error:'Groqの利用上限です（429）。'};await page.locator('#newsAiRetry').click();await expect(page.locator('#newsAiStatus')).toContainText('429');await expect(page.locator('#newsText')).toHaveValue('手動で編集した本文');await expect(page.locator('#newsAiRetry')).toBeEnabled();
});
