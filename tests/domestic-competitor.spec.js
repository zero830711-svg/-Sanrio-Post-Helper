const {test,expect}=require('@playwright/test');
const domestic=require('../domestic-candidates.js'),competitor=require('../competitor-analysis.js');
const now=Date.parse('2026-10-14T08:00:00Z');
test('掲載日を発売日にせず、月・旬の精度と公式の根拠を保持する',()=>{
 const blog=domestic.extract({url:'https://lovely-fancy.net/a/',title:'2026年10月15日発売',date:'2026-10-14'},now);expect(blog.release).toBeNull();expect(blog.verified).toBe(false);
 const month=domestic.extract({url:'https://www.hatakeyamashoji.jp/a/',title:'サンリオ新作',manufacturerInfo:{facts:{発売時期:'2026年10月下旬'}},date:'2026-10-14'},now);expect(month.release.precision).toBe('下旬');expect(domestic.classify(month,now).kind).toBe('new');
 expect(domestic.dates('2026年2月31日発売')).toEqual([]);
 const release=domestic.extract({url:'https://www.sanrio.co.jp/news/a/',title:'2026年10月15日発売 ポチャッコ'},now);expect(domestic.classify(release,now).kind).toBe('soon');expect(domestic.today(Date.parse('2026-10-14T16:00:00Z'))).toBe('2026-10-15');
 expect(domestic.trusted('https://sanrio.co.jp.evil.test/')).toBe(false);expect(domestic.trusted('https://sanrio.co.jp@evil.test/')).toBe(false);
});
test('古い再入荷告知を現在の更新にせず、手動照合でも元検索リンクと見送りを保持する',()=>{
 const e={...domestic.extract({url:'https://www.sanrio.co.jp/news/a/',title:'再入荷',date:'2026-01-01',jan:'4900000000000'},now),manual:false};expect(domestic.classify(e,now).kind).not.toBe('update');
 e.manual=true;e.postIds=['archive'];const post={id:'archive',text:'2025年発売の商品紹介',amazon:'https://www.amazon.co.jp/s?k=ポチャッコ&tag=original-22',rakuten:'https://search.rakuten.co.jp/search/mall/ポチャッコ/',postedAt:'2025-01-01'};const original=JSON.stringify(post);
 expect(domestic.reuse([post],[e],now)).toHaveLength(1);expect(JSON.stringify(post)).toBe(original);
 expect(domestic.reuse([{...post,skippedAt:'2026-10-13T00:00:00Z'}],[e],now)).toEqual([]);expect(domestic.reuse([{...post,candidateExcluded:true}],[e],now)).toEqual([]);
 expect(domestic.reuse([{...post,lastRepostedAt:'2026-10-14T07:00:00Z'}],[e],now)).toEqual([]);expect(domestic.reuse([{...post,id:'different'}],[e],now)).toEqual([]);
});
test('競合数値の欠落・ゼロを区別し、URL・日時・不正値を検証する',()=>{
 const row=competitor.normalize({url:'https://x.com/sanrio_oshikatu/status/123',createdAt:'2026-10-14T12:00:00+09:00',text:'新作予約開始',likes:'0',reposts:''});expect(row.likes).toBe(0);expect(row.reposts).toBeNull();expect(row.impressions).toBeNull();expect(competitor.summarize([row]).top).toEqual([]);expect(competitor.summarize([row]).hours[12]).toBe(1);
 expect(()=>competitor.normalize({...row,url:'https://x.com/other/status/123'})).toThrow();expect(()=>competitor.normalize({...row,likes:'推定100'})).toThrow();expect(()=>competitor.normalize({...row,createdAt:'2026-10-14T12:00:00'})).toThrow();expect(competitor.merge([row],[{...row,likes:10}])).toHaveLength(1);
});
async function setup(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));return errors;
}
test('iPhone競合タブで手動・CSVを保存し、APIを自動実行しない',async({page})=>{
 const errors=await setup(page);let paid=0;await page.route('**/competitor.php?**',r=>{if(new URL(r.request().url()).searchParams.get('action')==='fetch')paid++;return r.fulfill({json:{ok:true,configured:false,monthlyLimit:1000,used:0}});});await page.goto('/');await page.getByRole('tab',{name:'競合分析',exact:true}).click();
 await page.getByText('公開投稿を手動で記録',{exact:true}).click();await page.locator('#competitorUrl').fill('https://x.com/sanrio_oshikatu/status/123');await page.locator('#competitorText').fill('ポチャッコ新作予約開始');await page.locator('#competitorLikes').fill('0');await page.locator('#competitorManualSave').click();await expect(page.locator('#competitorPosts')).toContainText('閲覧 取得不可');await expect(page.locator('#competitorPosts')).toContainText('いいね 0');
 await page.getByText('CSV取込',{exact:true}).click();await page.locator('#competitorCsv').setInputFiles({name:'sample.csv',mimeType:'text/csv',buffer:Buffer.from('url,createdAt,text,impressions,likes,reposts\nhttps://x.com/sanrio_oshikatu/status/124,2026-10-14T12:00:00+09:00,くじ発売,1000,100,10\n')});await expect(page.locator('#competitorSummary')).toContainText('2件');await expect(page.locator('#competitorPatterns')).toContainText('反応率上位1件');
 await page.reload();await page.getByRole('tab',{name:'競合分析',exact:true}).click();await expect(page.locator('#competitorSummary')).toContainText('2件');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(paid).toBe(0);expect(errors).toEqual([]);
});
test('発売間近ボタンと手動の元投稿照合が機能し、投稿準備後もリンクを変更しない',async({page})=>{
 const errors=await setup(page);const url='https://www.hatakeyamashoji.jp/new/';await page.route('**/lovely-watch.php?**',r=>{const q=new URL(r.request().url()).searchParams;return r.fulfill({json:q.get('action')==='detail'?{ok:true,item:{url,source:'畑山商事',title:'ポチャッコ新作',products:[],productIds:[],manufacturerInfo:{facts:{}}}}:{ok:true,items:q.get('source')==='hatakeyama'?[{url,source:'畑山商事',title:'ポチャッコ新作',date:'2026-10-14'}]:[]}});});await page.goto('/');const original={id:'archive',text:'ポチャッコ商品紹介です #pr',amazon:'https://www.amazon.co.jp/s?k=pochacco&tag=original-22',postedAt:'2025-01-01',images:[]};await page.evaluate(async p=>dbPut(p),original);
 await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#lovelyList [data-lovely-select]').click();await page.locator('#lovelyEvidenceEditor summary').click();await page.getByLabel('照合する元投稿ID（検索リンクの投稿も指定できます）').fill('archive');const date=new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10);await page.getByLabel('発売日（正確な日付が確認できた場合のみ）').fill(date);await page.getByLabel('商品・種類・セット内容と現在の告知を公式ページで確認しました').check();await page.getByRole('button',{name:'確認情報を保存',exact:true}).click();await expect(page.locator('#lovelyEvidenceEditor')).toContainText('確認情報を保存しました');await page.locator('#lovelyBack').click();await page.locator('[data-kind="soon"]').click();await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);
 await page.getByRole('tab',{name:'今日の候補',exact:true}).click();await expect(page.locator('#domesticReuseList')).toContainText('発売間近');const saved=await page.evaluate(async()=> (await dbGetAll()).find(p=>p.id==='archive'));expect(saved.amazon).toBe(original.amazon);expect(saved.text).toBe(original.text);expect(errors).toEqual([]);
});
