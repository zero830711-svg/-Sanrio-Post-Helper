const {test,expect}=require('@playwright/test');
async function seed(page){
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof renderToday==='function');
 await page.evaluate(async()=>{
  const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="pink"/></svg>');
  window.compactFixture={id:'compact-fixture',title:'サンリオのかわいい商品を紹介する見やすい投稿',text:'商品について確認した内容です。\n'.repeat(15)+'https://amzn.to/example',images:[svg,svg,svg],amazon:'https://amzn.to/example',rakuten:'https://a.r10.to/example',impressions:50000,likes:1500,bookmarks:260};
  await dbPutMany([compactFixture,{...compactFixture,id:'compact-fixture-2'}]);
  getRoleBasedPicks=async()=>[compactFixture,{...compactFixture,id:'compact-fixture-2'}];stampRecommendations=async()=>{};preloadDetailImages=()=>{};
  await renderToday();document.querySelector('#todayHomePanel').scrollIntoView();
 });
}
test('候補を小さく表示し、補助操作を必要な時だけ開ける',async({page})=>{
 await seed(page);const cards=page.locator('.today-news-row');await expect(cards).toHaveCount(2);
 for(const c of await cards.all()){expect((await c.boundingBox()).height).toBeLessThan(150);}
 await expect(cards.nth(1).getByRole('button',{name:'投稿準備'})).toBeInViewport();
 await expect(cards.first().getByRole('button')).toHaveCount(1);
 await cards.first().getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#detailCandidateSkip')).toBeVisible();
});
test('詳細の操作を上部に表示し、本文と写真の拡大から戻れる',async({page})=>{
 await seed(page);await page.evaluate(()=>showTodayDetail(compactFixture));
 await expect(page.locator('#detailTextPreview')).toBeVisible();await expect(page.locator('#detailText')).not.toBeVisible();await expect(page.locator('#detailCopyImage')).toHaveCount(0);
 for(const id of ['detailChatGPTShare','detailThreadsShare','detailBlogShare']){await expect(page.locator('#'+id)).toBeVisible();expect((await page.locator('#'+id).boundingBox()).height).toBeGreaterThanOrEqual(44);}
 await page.locator('#detailTextMore summary').click();await expect(page.locator('#detailText')).toBeVisible();await expect(page.locator('#detailTextPreview')).not.toBeVisible();await page.locator('#detailTextMore summary').click();
 await page.getByRole('button',{name:'写真1を拡大',exact:true}).click();await expect(page.locator('#imageModal')).toBeVisible();await page.locator('#closeModal').click();await expect(page.locator('#todayDetailModal')).toBeVisible();
 await expect(page.locator('#detailCopyImage')).toHaveCount(0);
});

test('一覧は右の1ボタンで開き、詳細のリンクを横書きで確認できる',async({page})=>{
 for(const width of [390,375,320]){
  await page.setViewportSize({width,height:844});await seed(page);
  const card=page.locator('.today-news-row').first();
  await expect(card.getByRole('button')).toHaveCount(1);
  await card.getByRole('button',{name:'投稿準備'}).click();
  await expect(page.locator('#todayDetailModal')).toBeVisible();
  
  const body=page.locator('#detailCandidateTools');
  await expect(body.locator('.today-affiliate-link-row')).toHaveCount(2);
  await expect(page.locator('#detailChatGPTShare')).toHaveText('ChatGPT');
  await expect(page.locator('#detailThreadsShare')).toHaveText('Threads');
  await expect(page.locator('#detailBlogShare')).toHaveText('ブログ');
  await expect(body.getByRole('button',{name:'コピー',exact:true})).toHaveCount(2);
  for(const row of await body.locator('.today-affiliate-link-row').all()){
   const link=await row.locator('a').boundingBox();expect(link.width).toBeGreaterThanOrEqual(44);expect(link.height).toBeLessThan(70);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#closeDetailModal').click();
 }
});
test('新着商品も写真と右の1ボタンで開き、戻れる',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 const item={url:'https://lovelyfancy.example/product1',title:'サンリオの新作リボン付きマスコット',date:'2026-10-01',products:[],images:[]};
 await page.route('**/lovely-watch.php?**',route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  return route.fulfill({json:action==='list'?{ok:true,items:[item],fetchedAt:'2026-10-01T12:00:00Z'}:action==='settings'?{ok:true,configured:true}:{ok:true,item}});
 });
 await page.goto('/');
 await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 const row=page.locator('#lovelyList .lovely-row');await expect(row).toHaveCount(1);
 expect((await row.boundingBox()).height).toBeLessThan(150);await expect(row.getByRole('button')).toHaveCount(1);
 await row.getByRole('button',{name:'投稿準備'}).click();
 await expect(page.locator('#lovelyEditor')).toBeVisible();await expect(page.locator('#lovelyBrowse')).not.toBeVisible();
 await page.locator('#lovelyBack').click();await expect(row).toBeVisible();
});

test('ホーム見出しを1行にまとめ、候補を上からすぐ確認できる',async({page})=>{
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await seed(page);await page.evaluate(()=>scrollTo(0,0));
  const header=page.locator('.home-header');expect((await header.boundingBox()).height).toBeLessThan(70);
  const badge=await header.locator('.badge').boundingBox(), title=await header.locator('h1').boundingBox();
  expect(Math.abs(badge.y-title.y)).toBeLessThan(8);
  expect((await page.locator('.today-news-row').first().boundingBox()).y).toBeLessThan(250);
  await expect(page.locator('.today-news-row').nth(1).getByRole('button',{name:'投稿準備'})).toBeInViewport();
  await header.locator('.home-info>summary').click();await expect(page.locator('#forceLatest')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
});

test('今日の候補を5件ずつ追加し、重複なく追加候補の詳細を開ける',async({page})=>{
 await seed(page);
 await page.evaluate(async()=>{
  const rows=Array.from({length:11},(_,i)=>({...compactFixture,id:'more-fixture-'+i,title:'候補'+i+'番の商品専用マスコットのご紹介',text:'候補'+i+'番の商品を詳しく紹介します。'}));
  await dbPutMany(rows);getRoleBasedPicks=async()=>rows.slice(0,5);getReadyItems=async()=>rows;
  todayAdditionalLimit=0;await renderToday();
 });
 await expect(page.locator('.today-news-row')).toHaveCount(5);
 await expect(page.locator('#todayMore')).toHaveText('もっと見る（あと6件）');
 await page.locator('#todayMore').click();await expect(page.locator('.today-news-row')).toHaveCount(10);
 await expect(page.locator('#todayMore')).toHaveText('もっと見る（あと1件）');
 const title=await page.locator('.today-news-row').nth(5).locator('h3').textContent();
 await page.locator('.today-news-row').nth(5).getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#detailTitle')).toHaveText(title);
 await page.locator('#closeDetailModal').click();await expect(page.locator('.today-news-row')).toHaveCount(10);
 await page.locator('#todayMore').click();await expect(page.locator('.today-news-row')).toHaveCount(11);
 await expect(page.locator('#todayMore')).not.toBeVisible();
 const ids=await page.locator('.today-news-row button').evaluateAll(buttons=>buttons.map(b=>b.dataset.id));
 expect(new Set(ids).size).toBe(11);
});

test('候補の写真を4枚まで選び、並べた順で共有・保存する',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{
  compactFixture.images=Array.from({length:5},(_,i)=>'https://example.invalid/photo-'+i+'.png');
  imageBlob=async src=>new Blob([src],{type:'image/png'});
  legacyCopyText=()=>true;
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.photoShare={text:data.text,photos:await Promise.all(data.files.map(f=>f.text()))};},configurable:true});
  showTodayDetail(compactFixture);
  detailImageBlobs=compactFixture.images.map(src=>new Blob([src],{type:'image/png'}));detailJpegBlobs=compactFixture.images.map(src=>new Blob([src],{type:'image/jpeg'}));renderDetailPhotos();
 });
 await expect(page.locator('[data-detail-select]:checked')).toHaveCount(4);
 await page.locator('[data-detail-select="4"]').click();await expect(page.locator('[data-detail-select="4"]')).not.toBeChecked();
 await page.locator('[data-detail-select="0"]').uncheck();await page.locator('[data-detail-select="4"]').check();
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'写真5を前へ',exact:true}).click();
 await page.locator('#detailChatGPTShare').click();
 await expect.poll(()=>page.evaluate(()=>window.photoShare?.photos)).toEqual([4,1,2,3].map(i=>'https://example.invalid/photo-'+i+'.png'));
 await page.evaluate(()=>{showTodayDetail(compactFixture);detailImageBlobs=compactFixture.images.map(src=>new Blob([src],{type:'image/png'}));detailJpegBlobs=compactFixture.images.map(src=>new Blob([src],{type:'image/jpeg'}));renderDetailPhotos();});
 expect(await page.evaluate(()=>detailPhotoSelection)).toEqual([4,1,2,3]);
 await page.locator('#detailDownloadAllPhotos').click();
 await expect.poll(()=>page.evaluate(()=>window.photoShare?.photos)).toEqual([4,1,2,3].map(i=>'https://example.invalid/photo-'+i+'.png'));
 expect(await page.evaluate(()=>detailSelectedItem().images)).toEqual([4,1,2,3].map(i=>'https://example.invalid/photo-'+i+'.png'));
});
test('写真がない候補は写真付き候補の後に表示する',async({page})=>{
 await seed(page);
 await page.evaluate(async()=>{
  const empty={...compactFixture,id:'no-photo',images:[],impressions:999999};
  getRoleBasedPicks=async()=>[empty,{...compactFixture,id:'with-photo'}];getReadyItems=async()=>[];
  await renderToday();
 });
 expect(await page.locator('.today-news-row button').evaluateAll(nodes=>nodes.map(n=>n.dataset.id))).toEqual(['with-photo','no-photo']);
});

test('保存とリンクの操作を折りたたまず上部にまとめ、数値を重複させない',async({page})=>{
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await seed(page);await page.evaluate(()=>showTodayDetail(compactFixture));
  const tools=page.locator('#detailExtraTools');
  expect(await tools.evaluate(el=>el.tagName)).toBe('DIV');await expect(tools.locator('summary')).toHaveCount(0);
  await expect(page.locator('#detailMeta')).toContainText('♥ 1,500');
  await expect(page.locator('#detailMeta')).toContainText('保存率');
  await expect(page.locator('#detailCandidateTools .metric-chips')).toHaveCount(0);
  const content=await page.locator('.detail-sheet').textContent();expect(content.match(/1,500/g)).toHaveLength(1);
  await expect(page.locator('#detailCandidateSkip')).toHaveCount(1);
  await expect(page.locator('#detailCopyImage')).toHaveCount(0);
  const bottom=await tools.evaluate(el=>el.getBoundingClientRect().bottom),textTop=await page.locator('.detail-text-section').evaluate(el=>el.getBoundingClientRect().top);
  expect(bottom).toBeLessThanOrEqual(textTop);
  for(const button of await tools.locator('button').all()){
   expect(await button.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12);
   expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.locator('#todayDetailModal').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
  await page.locator('#closeDetailModal').click();
 }
});

test('共有と写真保存を1行にまとめ、詳細を開いた時に写真が見える',async({page})=>{
 await page.setViewportSize({width:390,height:844});await seed(page);
 await page.evaluate(()=>{compactFixture.title='ポムポムプリンのお部屋コーデ3点セット';compactFixture.text='ポムポムプリンのお部屋コーデをご紹介。\n\n写真からお気に入りを選んでください。\n'.repeat(8);showTodayDetail(compactFixture);});
 const bar=page.locator('.detail-share-actions');
 await expect(bar.locator('button')).toHaveCount(4);
 const buttons=await bar.locator('button').all(),positions=await Promise.all(buttons.map(b=>b.boundingBox()));
 expect(Math.max(...positions.map(p=>p.y))-Math.min(...positions.map(p=>p.y))).toBeLessThan(2);
 await expect(page.locator('#detailMedia .detail-media-item').first()).toBeInViewport();
 expect(await page.locator('#detailMedia').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(650);
 await expect(page.locator('#detailTextPreview')).toBeVisible();
 await page.locator('#detailTextMore summary').click();await expect(page.locator('#detailText')).toHaveText(/お気に入り/);
});

test('写真なしの役割候補は追加候補の写真付き投稿より後に表示する',async({page})=>{
 await seed(page);
 await page.evaluate(async()=>{
  const rows=Array.from({length:8},(_,i)=>({...compactFixture,id:'photo-priority-'+i,title:'写真優先候補'+i+'の商品',text:'写真優先候補'+i+'の商品紹介',images:i===4?[]:compactFixture.images}));
  getRoleBasedPicks=async()=>rows.slice(0,5);getReadyItems=async()=>rows;
  todayAdditionalLimit=0;await renderToday();
 });
 await expect(page.locator('.today-news-row')).toHaveCount(5);
 await expect(page.locator('.today-rank-inline')).toHaveCount(0);
 await page.locator('#todayMore').click();
 await expect(page.locator('.today-news-row')).toHaveCount(8);
 await expect(page.locator('.today-news-row').last().locator('h3')).toHaveText('写真優先候補4の商品');
});
