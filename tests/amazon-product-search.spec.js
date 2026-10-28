const {test,expect}=require('@playwright/test');
const url='https://www.amazon.co.jp/dp/B000000001?tag=test-22&ref_=api';
const item={title:'ハローキティ テストマスコット',url,image:'https://m.media-amazon.com/images/I/test.jpg'};
async function setup(page,{legacy=false,error=false,automatic=false,due=false,autoError=false,posted=false}={}){
 const calls=[],autoCalls=[];
 await page.addInitScript(({legacy,url,posted})=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  if(legacy)localStorage.setItem('sphAmazonScoutCandidatesV1',JSON.stringify([{id:'old',title:'保存済みのクロミ',affiliateUrl:url,draft:'💜 前に編集した本文\n'+url+'\n#PR',status:posted?'投稿済み':'未投稿',createdAt:'2026-10-01T00:00:00Z'}]));
 },{legacy,url,posted});
 await page.route('**/product-flow.php?**',r=>r.fulfill({json:{ok:true,entries:[],sources:[],sourceUpdatedAt:Math.floor(Date.now()/1000),rakutenConfigured:true}}));
 await page.route('**/amazon-creators.php?**',r=>{
  const action=new URL(r.request().url()).searchParams.get('action');
  const cached={ok:true,configured:true,partnerTag:'test-22',updatedAt:Math.floor(Date.now()/1000),nextAt:Math.floor(Date.now()/1000)+1800,autoState:'ok',lastQuery:'サンリオ',nextQuery:'ハローキティ ぬいぐるみ',items:automatic?[{...item,fetchedAt:Math.floor(Date.now()/1000)},{...item,fetchedAt:Math.floor(Date.now()/1000),url:url+'&duplicate=1'}]:[]};
  if(action==='candidates'){autoCalls.push(action);return r.fulfill({json:{...cached,nextAt:due?0:cached.nextAt}});}
  if(action==='discover'){autoCalls.push(action);return autoError?r.fulfill({status:502,json:{ok:false,error:'利用上限です。',stage:'product-search',upstreamStatus:429}}):r.fulfill({json:cached});}
  calls.push(r.request().postDataJSON());return error?r.fulfill({status:502,json:{ok:false,error:'商品APIの利用権限を確認できません。',stage:'product-search',upstreamStatus:403}}):r.fulfill({json:{ok:true,partnerTag:'test-22',items:[item,{title:'不正リンク',url:'https://www.amazon.co.jp.evil.test/dp/B000000002',image:''}]}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'商品検索',exact:true}).click();await page.getByRole('button',{name:'Amazon',exact:true}).click();await expect(page.locator('#flowProviderAmazon')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#flowProviderRakuten')).toHaveAttribute('aria-pressed','false');
 await page.locator('#amazonManualSearch > summary').click();await expect(page.locator('#amazonFlowSearch')).toBeEnabled();await expect(page.locator('#amazonFlowQuery')).toBeVisible();
 return {calls,autoCalls};
}
test('ブランドボタンからサンリオ商品を検索できる',async({page})=>{
 const {calls}=await setup(page);await page.locator('#amazonManualSearch > summary').click();
 await page.locator('#amazonBrandButtons').getByRole('button',{name:'TOPTOY'}).click();
 await expect(page.locator('#amazonFlowStatus')).toContainText('1件を取得');
 expect(calls).toEqual([{keywords:'TOPTOY サンリオ',page:1}]);
 await expect(page.locator('#amazonFlowResults')).toContainText(item.title);
 await expect(page.locator('#amazonBrandButtons').getByRole('button',{name:'TOPTOY'})).toHaveAttribute('aria-pressed','true');
});

test('ブランド検索はサンリオ関連を優先し、他の商品も残す',async({page})=>{
 await setup(page);
 const mixed=[{title:'TOP TOY ディズニー',url:'https://www.amazon.co.jp/dp/B000000101'},
 {title:'TOP TOY サンリオ クロミ',url:'https://www.amazon.co.jp/dp/B000000102'},
 {title:'TOP TOY ムーミン',url:'https://www.amazon.co.jp/dp/B000000103'},
 {title:'TOP TOY Hello Kitty',url:'https://www.amazon.co.jp/dp/B000000104'}];
 await page.route('**/amazon-creators.php?action=search',r=>r.fulfill({json:{ok:true,partnerTag:'test-22',items:mixed,hasMore:false}}));
 await page.locator('#amazonBrandButtons').getByRole('button',{name:'TOPTOY'}).click();
 await expect(page.locator('#amazonFlowResults .flow-card h3')).toHaveText(['TOP TOY サンリオ クロミ','TOP TOY Hello Kitty','TOP TOY ディズニー','TOP TOY ムーミン']);
});

for(const maker of ['バンダイ','タカラトミー','リーメント','エンスカイ','グルマンディーズ','ティーズファクトリー','ナカジマコーポレーション','ケイカンパニー','アガツマ','マリモクラフト','カミオジャパン','粧美堂','スケーター','セガ フェイブ','サンスター文具','ハシートップイン','サンタン','丸眞','サンアート']){
 test(maker+'ボタンはサンリオ商品を検索して関連候補を優先する',async({page})=>{
  const {calls}=await setup(page);
  const mixed=[{title:'他のキャラクター',url:'https://www.amazon.co.jp/dp/B000000101'},item];
  await page.route('**/amazon-creators.php?action=search',r=>{calls.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,items:mixed,partnerTag:'test-22',hasMore:false}});});
  await page.locator('#amazonBrandButtons').getByRole('button',{name:maker,exact:true}).click();
  await expect(page.locator('#amazonFlowResults .flow-card h3')).toHaveText([item.title,'他のキャラクター']);
  expect(calls.at(-1)).toEqual({keywords:maker+' サンリオ',page:1});
 });
}

test('Amazon検索から編集・検索リンク・下書き復元・投稿済みまで',async({page})=>{
 const {calls}=await setup(page);expect(calls).toHaveLength(0);
 await page.locator('#amazonFlowQuery').fill('ハローキティ');await page.locator('#amazonFlowSearch').click();
 await expect(page.locator('#amazonFlowStatus')).toContainText('1件を取得');expect(calls).toEqual([{keywords:'ハローキティ',page:1}]);
 await expect(page.locator('#amazonFlowResults')).not.toContainText('不正リンク');
 await page.locator('#amazonFlowResults').getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#lovelyPostText')).toHaveValue(new RegExp('ref_=api'));
 await page.locator('#lovelyPostText').fill('🎀 編集した商品紹介');await page.locator('#amazonSharedSearchLink').click();
 const link=await page.locator('#lovelyAmazon').inputValue();expect(new URL(link).searchParams.get('k')).toBe(item.title);expect(new URL(link).searchParams.get('tag')).toBe('test-22');
 await page.locator('#lovelyPostText').fill('🎀 編集した商品紹介\n'+link+'\n#pr');
 await page.reload();await page.getByRole('tab',{name:'商品検索',exact:true}).click();
 await expect(page.locator('#amazonSearchArea')).toBeVisible();await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();
 await expect(page.locator('#lovelyPostText')).toHaveValue('🎀 編集した商品紹介\n'+link+'\n#pr');await expect(page.locator('#lovelyAmazon')).toHaveValue(link);
 await expect(page.locator('#lovelyAmazon')).toHaveValue(link);
 await page.locator('#lovelyDone').click();await page.locator('#amazonFlowFilter').selectOption('投稿済み');await expect(page.locator('#amazonFlowDrafts')).toContainText(item.title);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('既存Amazon候補の本文と紹介リンクを引き継ぎ、楽天へ切り替えられる',async({page})=>{
 const {calls}=await setup(page,{legacy:true});await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();
 await expect(page.locator('#lovelyPostText')).toHaveValue(/前に編集した本文/);await expect(page.locator('#lovelyAmazon')).toHaveValue(url);
 await page.getByRole('button',{name:'楽天',exact:true}).click();await expect(page.locator('#flowProviderRakuten')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#flowRakutenArea')).toBeVisible();await expect(page.locator('#amazonSearchArea')).toBeHidden();expect(calls).toHaveLength(0);
});
test('Amazonの商品権限エラーは表示し、保存済み下書きを保持する',async({page})=>{
 const {calls}=await setup(page,{legacy:true,error:true});await page.locator('#amazonFlowSearch').click();await expect(page.locator('#amazonFlowStatus')).toContainText('商品検索／HTTP 403');
 expect(calls).toHaveLength(1);await expect(page.locator('#amazonFlowDrafts')).toContainText('保存済みのクロミ');await expect(page.locator('#amazonFlowSearch')).toBeEnabled();
});
test('ニュース内でAmazon検索し、楽天リンクと編集本文を保持して紹介リンクを追加する',async({page})=>{
 await setup(page);
 const source={url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',title:'ニュースのキティ',source:'PR TIMES',paragraphs:['商品の紹介です。'],images:[]};
 await page.route('**/news.php?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('action')==='list'?{ok:true,items:[source]}:{ok:true,item:source}}));
 await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await page.locator('#newsText').fill('編集済みニュース本文');await page.getByText('楽天・Amazonリンクを追加',{exact:true}).click();
 await page.locator('#newsAffiliateRakuten').fill('https://a.r10.to/test');await page.locator('#newsAffiliateSave').click();await openNewsSearch(page,'amazon');
 await expect(page.locator('#newsInlineQuery')).toHaveValue(source.title);await expect(page.locator('#productFlowPanel')).toBeHidden();await expect(page.locator('#newsInlineResults article')).toHaveCount(1);await page.locator('#newsInlineResults').getByRole('button',{name:'紹介リンクを追加'}).click();
 await expect(page.locator('#newsPanel')).toBeVisible();await expect(page.locator('#newsAffiliateAmazon')).toHaveValue(url);await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/test');
 await expect(page.locator('#newsText')).toHaveValue('編集済みニュース本文');await expect(page.locator('#newsReplyText')).toHaveValue(/ref_=api/);
});

test('Amazonを開くとキャッシュ候補を自動表示し、同じASINは1件にする',async({page})=>{
 const {calls,autoCalls}=await setup(page,{automatic:true});
 await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);await expect(page.locator('#amazonAutoProgress')).toContainText('ハローキティ ぬいぐるみ');
 expect(autoCalls).toEqual(['candidates']);expect(calls).toHaveLength(0);
 await page.locator('#amazonAutoResults').getByRole('button',{name:'投稿準備'}).click();await page.locator('#lovelyDone').click();await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(0);
});
test('期限が来た時だけ次の検索を進め、上限エラーでもキャッシュ候補を残す',async({page})=>{
 const {calls,autoCalls}=await setup(page,{automatic:true,due:true,autoError:true});
 await expect(page.locator('#amazonAutoStatus')).toContainText('HTTP 429');await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);
 expect(autoCalls).toEqual(['candidates','discover']);expect(calls).toHaveLength(0);
});
test('投稿済み候補を自動一覧から除外するが保存済み下書きは残す',async({page})=>{
 await setup(page,{automatic:true,legacy:true,posted:true});await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(0);
 await page.locator('#amazonFlowFilter').selectOption('投稿済み');await expect(page.locator('#amazonFlowDrafts')).toContainText('保存済みのクロミ');
});
test('検索を上部に表示し、次ページを追記してASIN重複を除き、失敗時に結果を残す',async({page})=>{
 await setup(page);const pages=[];await page.route('**/amazon-creators.php?action=search',r=>{const d=r.request().postDataJSON();pages.push(d);const items=Array.from({length:10},(_,i)=>({title:'キティ 商品'+(d.page===2?i+9:i),url:'https://www.amazon.co.jp/dp/B'+String(d.page===2?i+9:i).padStart(9,'0')+'?tag=test-22',image:''}));return d.page===3?r.fulfill({status:502,json:{ok:false,error:'利用上限です。'}}):r.fulfill({json:{ok:true,items,partnerTag:'test-22',page:d.page,pageSize:10,hasMore:true}});});
 const searchBox=await page.locator('#amazonFlowQuery').boundingBox(),auto=await page.getByRole('heading',{name:'自動検索したAmazon候補'}).boundingBox();expect(searchBox.y).toBeLessThan(auto.y);
 await page.locator('#amazonFlowSearch').click();await expect(page.locator('#amazonFlowResults .flow-card')).toHaveCount(10);await expect(page.locator('#amazonFlowMore')).toBeEnabled({timeout:10000});await page.locator('#amazonFlowMore').click();await expect(page.locator('#amazonFlowResults .flow-card')).toHaveCount(19);await expect(page.locator('#amazonFlowStatus')).toContainText('2ページ取得済み');
 await expect(page.locator('#amazonFlowMore')).toBeEnabled({timeout:10000});await page.locator('#amazonFlowMore').click();await expect(page.locator('#amazonFlowStatus')).toContainText('利用上限');await expect(page.locator('#amazonFlowResults .flow-card')).toHaveCount(19);expect(pages.map(p=>p.page)).toEqual([1,2,3]);
 await page.locator('#amazonFlowQuery').fill('クロミ');await expect(page.locator('#amazonFlowMore')).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('外部で探した検索紹介URLを原文のまま追加・復元し、APIを呼ばない',async({page})=>{
 const {calls}=await setup(page);const search='https://www.amazon.co.jp/s?k=TOPTOY%20%E3%82%B5%E3%83%B3%E3%83%AA%E3%82%AA&tag=original-22&ref=manual';await page.locator('#amazonManualAddBox summary').click();await page.locator('#amazonManualTitle').fill('TOPTOY サンリオの検索候補');await page.locator('#amazonManualUrl').fill(search);await page.locator('#amazonManualConfirmed').check();await page.locator('#amazonManualAdd').click();await expect(page.locator('#lovelyAmazon')).toHaveValue(search);await page.locator('#lovelyPostText').fill('🎀 自分で編集した紹介');
 await page.reload();await page.getByRole('tab',{name:'商品検索',exact:true}).click();await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();await expect(page.locator('#lovelyAmazon')).toHaveValue(search);await expect(page.locator('#lovelyPostText')).toHaveValue('🎀 自分で編集した紹介');expect(calls).toHaveLength(0);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('sphAmazonScoutCandidatesV1')));expect(stored[0].affiliateUrl).toBe(search);expect(stored[0].manual).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('手動追加の不正URL・未確認を拒否し、同じASINの既存本文と元リンクを変更しない',async({page})=>{
 const {calls}=await setup(page,{legacy:true});await page.locator('#amazonManualAddBox summary').click();await page.locator('#amazonManualTitle').fill('別の名前');await page.locator('#amazonManualUrl').fill('https://amazon.co.jp.evil.test/dp/B000000001');await page.locator('#amazonManualConfirmed').check();await page.locator('#amazonManualAdd').click();await expect(page.locator('#amazonManualStatus')).toContainText('日本のAmazon');
 await page.locator('#amazonManualUrl').fill('https://www.amazon.co.jp/dp/B000000001?tag=changed-22');await page.locator('#amazonManualAdd').click();await expect(page.locator('#amazonManualStatus')).toContainText('一致を確認');await page.locator('#amazonManualConfirmed').check();await page.locator('#amazonManualAdd').click();await expect(page.locator('#lovelyAmazon')).toHaveValue(url);await expect(page.locator('#lovelyPostText')).toHaveValue(/前に編集した本文/);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sphAmazonScoutCandidatesV1')).length)).toBe(1);expect(calls).toHaveLength(0);
});

test('取得済み候補だけを絞り込み20件ずつ表示し、状態と元位置を保持する',async({page})=>{
 const {calls}=await setup(page);let external=0;
 await page.route('**/amazon-creators.php?action=candidates',r=>{external++;return r.fulfill({json:{ok:true,configured:true,nextAt:Math.floor(Date.now()/1000)+1800,updatedAt:Math.floor(Date.now()/1000),items:Array.from({length:26},(_,i)=>({title:(i<23?'ハローキティ ポーチ ':'クロミ ぬいぐるみ ')+i,url:'https://www.amazon.co.jp/dp/C'+String(i).padStart(9,'0')+'?tag=test-22',fetchedAt:Math.floor(Date.now()/1000)}))}});});
 await page.locator('#amazonAutoRefresh').click();await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(20);await expect(page.locator('#amazonAutoCount')).toContainText('有効な取得 26件');
 await page.locator('#amazonAutoMore').click();await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(26);
 await page.locator('#amazonCharacterButtons').getByRole('button',{name:'クロミ',exact:true}).click();await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(3);
 await page.locator('#amazonCategoryButtons').getByRole('button',{name:'バッグ・ポーチ',exact:true}).click();await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(0);
 await page.locator('#amazonCategoryButtons').getByRole('button',{name:'すべて',exact:true}).click();await page.locator('#amazonAutoQuery').fill('25');await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);
 await page.locator('#amazonAutoResults').getByRole('button',{name:'投稿準備'}).click();await page.locator('#lovelyPostText').fill('編集した本文');await page.locator('#lovelyBack').click();await expect(page.locator('#lovelyEditor')).toBeHidden();await expect(page.locator('#amazonAutoResults')).toContainText('下書きあり');
 await page.locator('#amazonDraftsJump').click();await expect(page.locator('#amazonDraftsHeading')).toBeFocused();
 await page.locator('#amazonFlowDrafts').getByRole('button',{name:'確認・共有'}).click();await expect(page.locator('#lovelyPostText')).toHaveValue('編集した本文');await page.locator('#lovelyDone').click();await expect(page.locator('#amazonAutoCount')).toContainText('投稿済み・見送り 1件');
 expect(external).toBe(1);expect(calls).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('未設定応答を取得成功扱いにせず、読込済み候補と保存下書きを消さない',async({page})=>{
 await setup(page,{automatic:true,legacy:true});await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);
 await page.route('**/amazon-creators.php?action=candidates',r=>r.fulfill({json:{ok:true,configured:false,items:[],nextAt:0}}));
 await page.locator('#amazonAutoRefresh').click();await expect(page.locator('#amazonAutoStatus')).toContainText('保存領域の確認が必要');await expect(page.locator('#amazonAutoStatus')).toContainText('表示したまま');await expect(page.locator('#amazonAutoResults .flow-card')).toHaveCount(1);await expect(page.locator('#amazonFlowDrafts')).toContainText('保存済みのクロミ');
});
test('起動直後に設定が読み出せない時は、候補保持を断言せず下書きを区別する',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');localStorage.setItem('sphProductSearchProviderV1','amazon');});
 await page.route('**/amazon-creators.php?**',r=>r.fulfill({json:{ok:true,configured:false,items:[]}}));await page.goto('/');await page.getByRole('tab',{name:'商品検索',exact:true}).click();
 await expect(page.locator('#amazonAutoStatus')).toContainText('取得済み候補を読み込めていません');await expect(page.locator('#amazonAutoStatus')).not.toContainText('取得済み候補は保持');
});

async function openInlineNews(page){
 const data=await setup(page);
 const source={url:'https://prtimes.jp/main/html/rd/p/000000122.000013308.html',title:'タキシードサムのおしゃれなおうち',source:'PR TIMES',paragraphs:['フィギュアのニュースです。'],images:['https://example.invalid/photo.png']};
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 await page.route('**/news.php?**',r=>{const action=new URL(r.request().url()).searchParams.get('action');return action==='image'?r.fulfill({contentType:'image/png',body:png}):r.fulfill({json:action==='list'?{ok:true,items:[source]}:{ok:true,item:source}});});
 await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await page.locator('#newsImages input[type=checkbox]').first().check();
 await page.locator('#newsText').fill('写真と一緒に残す手直し本文');await page.getByText('楽天・Amazonリンクを追加',{exact:true}).click();
 return {...data,source};
}
test('楽天をニュース内で検索し5件ずつ表示、短縮リンクと写真を保持し検索紹介URLを原文追加する',async({page})=>{
 await openInlineNews(page);const selected=await page.evaluate(()=>newsState.selected.slice());let queries=[];
 const search='https://hb.afl.rakuten.co.jp/hgc/12345678.12345678.12345678.12345678/?pc=https%3A%2F%2Fsearch.rakuten.co.jp%2Fsearch%2Fmall%2Ftest%2520query%2F';
 await page.route('**/product-flow.php?action=affiliate-search',r=>{queries.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,items:Array.from({length:6},(_,i)=>({code:'shop:'+i,title:'サムの商品'+i,url:'https://item.rakuten.co.jp/shop/'+i+'/',affiliate:'https://a.r10.to/item'+i,shop:'通常ショップ',image:''})),searchAffiliate:search,hasMore:false}});});
 await page.locator('#newsAffiliateAmazon').fill('https://amzn.to/keep');await page.locator('#newsAffiliateRakuten').fill('https://a.r10.to/keep');await page.locator('#newsAffiliateSave').click();
 await openNewsSearch(page,'rakuten');await expect(page.locator('#newsInlineResults article')).toHaveCount(5);await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/keep');
 await page.locator('#newsInlineMore').click();await expect(page.locator('#newsInlineResults article')).toHaveCount(6);expect(queries).toHaveLength(1);
 await page.locator('#newsInlineQuery').fill('サム ROOM');await page.locator('#newsInlineRun').click();await expect.poll(()=>queries.length).toBe(2);expect(queries[1]).toEqual({keywords:'サム ROOM',page:1});
 await page.locator('#newsInlineSearchLink').click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue(search);await expect(page.locator('#newsAffiliateAmazon')).toHaveValue('https://amzn.to/keep');
 await expect(page.locator('#newsText')).toHaveValue('写真と一緒に残す手直し本文');expect(await page.evaluate(()=>newsState.selected)).toEqual(selected);await expect(page.locator('#newsReplyText')).toHaveValue(new RegExp('test%2520query'));await expect(page.locator('#productFlowPanel')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsFilterButtons').getByRole('button',{name:'準備中',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();await page.getByText('楽天・Amazonリンクを追加',{exact:true}).click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue(search);expect(await page.evaluate(()=>newsState.selected)).toEqual(selected);
});
test('Amazon検索語の修正・検索紹介リンク・エラーと遅い応答を別のニュースへ反映しない',async({page})=>{
 await openInlineNews(page);let calls=0,release;
 await page.route('**/amazon-creators.php?action=search',async r=>{calls++;if(calls===2){await new Promise(resolve=>release=resolve);return r.fulfill({json:{ok:true,items:[item],partnerTag:'test-22'}});}return r.fulfill({json:{ok:true,items:[item],partnerTag:'test-22',hasMore:false}});});
 await openNewsSearch(page,'amazon');await expect(page.locator('#newsInlineResults article')).toHaveCount(1);
 await page.locator('#newsInlineQuery').fill('サム ROOM');await page.locator('#newsInlineRun').click();await expect.poll(()=>calls).toBe(2);
 await page.locator('#newsBackBottom').click();release();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();if(!await page.locator('#newsAffiliateAmazon').isVisible())await page.getByText('楽天・Amazonリンクを追加',{exact:true}).click();await expect(page.locator('#newsInlinePanel')).toBeHidden();await expect(page.locator('#newsAffiliateAmazon')).toHaveValue('');
 await openNewsSearch(page,'amazon');await expect(page.locator('#newsInlineSearchLink')).toBeEnabled();await page.locator('#newsInlineSearchLink').click();await expect(page.locator('#newsAffiliateAmazon')).toHaveValue(/tag=test-22/);await expect(page.locator('#newsText')).toHaveValue('写真と一緒に残す手直し本文');
});

test('ニュースの外部検索はChromeへ開き、短縮リンクを原文反映して本文と写真を保持する',async({page})=>{
 await openInlineNews(page);const selected=await page.evaluate(()=>newsState.selected.slice());
 await page.locator('#newsExternalQuery').fill('サム ROOM & 限定');
 const query=encodeURIComponent('サム ROOM & 限定');
 await expect(page.locator('#newsRakutenOpen')).toHaveAttribute('href','googlechromes://search.rakuten.co.jp/search/mall/'+query+'/');
 await expect(page.locator('#newsAmazonOpen')).toHaveAttribute('href','com.amazon.mobile.shopping.web://www.amazon.co.jp/s?k='+query);
 await expect(page.locator('#newsRakutenPortal')).toHaveAttribute('href','googlechromes://affiliate.rakuten.co.jp/');
 await page.evaluate(()=>{window.clipboardValue='https://a.r10.to/hPfTZE';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>window.clipboardValue,writeText:async value=>{window.copiedValue=value;}}});});
 await page.locator('#newsRakutenCopy').click();expect(await page.evaluate(()=>window.copiedValue)).toBe('https://search.rakuten.co.jp/search/mall/'+query+'/');
 await page.locator('#newsRakutenPaste').click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/hPfTZE');
 await page.evaluate(()=>window.clipboardValue='https://amzn.asia/d/short?test=1');await page.locator('#newsAmazonPaste').click();await expect(page.locator('#newsAffiliateAmazon')).toHaveValue('https://amzn.asia/d/short?test=1');
 await expect(page.locator('#newsReplyText')).toHaveValue(/https:\/\/a.r10.to\/hPfTZE/);await expect(page.locator('#newsReplyText')).toHaveValue(/https:\/\/amzn.asia\/d\/short\?test=1/);
 await page.evaluate(()=>window.clipboardValue='https://amzn.asia.evil.invalid/short');await page.locator('#newsAmazonPaste').click();await expect(page.locator('#newsAffiliateAmazon')).toHaveValue('https://amzn.asia/d/short?test=1');await expect(page.locator('#newsAffiliateStatus')).toContainText('HTTPSリンクか確認');
 await page.evaluate(()=>{navigator.clipboard.readText=async()=>{throw new Error('denied');};});await page.locator('#newsRakutenPaste').click();await expect(page.locator('#newsAffiliateStatus')).toContainText('手動で貼り付け');
 await expect(page.locator('#newsText')).toHaveValue('写真と一緒に残す手直し本文');expect(await page.evaluate(()=>newsState.selected)).toEqual(selected);await expect(page.locator('#productFlowPanel')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.evaluate(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 desktop'}));await page.locator('#newsExternalQuery').fill('クロミ');await expect(page.locator('#newsAmazonOpen')).toHaveAttribute('href','https://www.amazon.co.jp/s?k='+encodeURIComponent('クロミ'));await expect(page.locator('#newsAmazonOpen')).toHaveAttribute('target','_blank');
});

async function openNewsSearch(page,kind){
 if(!await page.locator('#newsRakutenSearch').isVisible())await page.getByText('詳しく探す（アプリ内検索）',{exact:true}).click();
 await page.locator(kind==='rakuten'?'#newsRakutenSearch':'#newsAmazonSearch').click();
}
test('ニュース検索語を商品名中心に整え、編集した検索語と本文・写真を再読込後も残す',async({page})=>{
 await openInlineNews(page);
 expect(await page.evaluate(()=>newsSearchPhrase('リーメントから「タキシードサムのおしゃれなおうち TUXEDOSAM ROOM」が2026年10月26日発売！'))).toBe('タキシードサムのおしゃれなおうち TUXEDOSAM ROOM');
 expect(await page.evaluate(()=>newsSearchPhrase('クロミの「Anniversary Vanity Pouch BOOK」が発売！'))).toBe('クロミ Anniversary Vanity Pouch BOOK');
 expect(await page.evaluate(()=>newsSearchPhrase('【新商品】ハンギョドン ポーチ 2026年10月26日 発売！今すぐチェック'))).toBe('ハンギョドン ポーチ');
 expect(await page.evaluate(()=>newsSearchPhrase('ポチャッコ ぬいぐるみ'))).toBe('ポチャッコ ぬいぐるみ');
 await expect(page.locator('#newsAdvancedSearch')).not.toHaveAttribute('open','');await expect(page.locator('#newsRakutenSearch')).toBeHidden();
 await page.locator('#newsExternalQuery').fill('サム ROOM');
 await page.evaluate(()=>{document.querySelector('#newsRakutenOpen').addEventListener('click',e=>e.preventDefault(),{once:true});window.scrollTo(0,200);});
 await page.locator('#newsRakutenOpen').dispatchEvent('click');const y=await page.evaluate(()=>newsExternalPending.y);
 await page.reload();await expect(page.locator('#newsEditor')).toBeVisible();await expect(page.locator('#newsReturnBar')).toBeVisible();
 await expect(page.locator('#newsExternalQuery')).toHaveValue('サム ROOM');await expect(page.locator('#newsText')).toHaveValue('写真と一緒に残す手直し本文');
 expect(await page.evaluate(()=>newsState.selected.length)).toBe(1);await expect.poll(async()=>Math.abs(await page.evaluate(()=>window.scrollY)-y)).toBeLessThan(4);
 await page.locator('#newsReturnClose').click();await expect(page.locator('#newsReturnBar')).toBeHidden();await page.reload();await expect(page.locator('#newsReturnBar')).toBeHidden();
});
test('外部検索から復帰した位置に貼付欄を表示し、差し替え確認・手動貼付・別ニュースへの混入防止を行う',async({page})=>{
 await openInlineNews(page);
 await page.locator('#newsAffiliateRakuten').fill('https://a.r10.to/old');await page.locator('#newsAffiliateAmazon').fill('https://amzn.to/keep');await page.locator('#newsAffiliateSave').click();
 await page.evaluate(()=>{window.clipboardReads=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.clipboardReads++;return 'https://a.r10.to/new';}}});document.querySelector('#newsRakutenOpen').addEventListener('click',e=>e.preventDefault());});
 await page.locator('#newsRakutenOpen').dispatchEvent('click');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#newsReturnBar')).toBeVisible();expect(await page.evaluate(()=>window.clipboardReads)).toBe(0);
 await page.locator('#newsReturnPaste').click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/old');await expect(page.locator('#newsReturnStatus')).toContainText('差し替えますか');
 await page.locator('#newsReturnApply').click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/new');await expect(page.locator('#newsAffiliateAmazon')).toHaveValue('https://amzn.to/keep');
 await page.evaluate(()=>{navigator.clipboard.readText=async()=>{throw new Error('denied');};});await page.locator('#newsReturnPaste').click();await page.locator('#newsReturnInput').fill('https://a.r10.to/manual');await page.locator('#newsReturnApply').click();await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/manual');await expect(page.locator('#newsText')).toHaveValue('写真と一緒に残す手直し本文');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.evaluate(()=>{window.resolveCopy=null;navigator.clipboard.readText=()=>new Promise(resolve=>window.resolveCopy=resolve);});await page.locator('#newsReturnPaste').click();await page.locator('#newsReturnClose').click();await page.evaluate(()=>window.resolveCopy('https://a.r10.to/stale'));await expect(page.locator('#newsAffiliateRakuten')).toHaveValue('https://a.r10.to/manual');
 await page.locator('#newsRakutenOpen').dispatchEvent('click');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('#newsBackBottom').click();await expect(page.locator('#newsReturnBar')).toBeHidden();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#newsReturnBar')).toBeHidden();
});

test('Amazonアプリで商品・検索を開く導線とブラウザの代替を用意し紹介URLを保持する',async({page})=>{
 await setup(page);await page.locator('#amazonFlowQuery').fill('クロミ ポーチ');
 await expect(page.locator('#amazonSearchExternal')).toHaveAttribute('href',/^com\.amazon\.mobile\.shopping\.web:\/\/www\.amazon\.co\.jp\/s\?k=/);
 await expect(page.locator('#amazonSearchWeb')).toHaveAttribute('href',/^https:\/\/www\.amazon\.co\.jp\/s\?k=/);
 await page.locator('#amazonFlowSearch').click();
 const card=page.locator('#amazonFlowResults article').first();await expect(card.getByRole('link',{name:'Amazonアプリで開く',exact:true})).toHaveAttribute('href',url.replace('https://','com.amazon.mobile.shopping.web://'));
 await card.getByRole('button',{name:'投稿準備',exact:true}).click();await expect(page.locator('#amazonSharedApp')).toHaveAttribute('href',url.replace('https://','com.amazon.mobile.shopping.web://'));await expect(page.locator('#lovelySource')).toHaveAttribute('href',url);await expect(page.locator('#lovelyAmazon')).toHaveValue(url);
 expect(await page.evaluate(()=>{const a=document.createElement('a');return amazonAppAnchor(a,'https://www.amazon.co.jp.evil.invalid/dp/B000000001');})).toBe(false);
 expect(await page.evaluate(()=>{const a=document.createElement('a');return amazonAppAnchor(a,'https://user@www.amazon.co.jp/dp/B000000001');})).toBe(false);
 await expect(page.locator('#lovelyPostText')).toHaveValue(new RegExp('https://www.amazon.co.jp/dp/B000000001'));
});
