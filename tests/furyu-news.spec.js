const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const prize={url:'https://furyuprize.com/item/22561',source:'フリュー',prize:true,title:'クロミ たれ耳ロリータBIGぬいぐるみ',date:'',schedule:'2026年10月2週',facts:[{kind:'schedule',text:'2026年10月2週登場予定（店舗により時期が前後します）'}],paragraphs:['2026年10月2週登場予定（店舗により時期が前後します）','種類：1種','サイズ：約26cm'],images:['https://furyuprize.com/files/images/prz/pi-main-22561.webp'],image:'https://furyuprize.com/files/images/prz/pi-main-22561.webp'};
test('フリューを新作ニュースで絞り込み、URLなしの本文・PNGを共有する',async({page})=>{
 let aiCalls=0;
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async d=>{window.furyuShared={text:d.text,files:(d.files||[]).map(f=>f.type)}},configurable:true});});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('https://furyuprize.com/files/**',r=>r.fulfill({contentType:'image/png',body:png}));
 await page.route('**/news.php?**',r=>{
 const action=new URL(r.request().url()).searchParams.get('action');
 if(action==='image')return r.fulfill({contentType:'image/png',body:png});
 if(action==='ai-draft'){aiCalls++;return r.fulfill({json:{ok:true,configured:true,text:'💜 クロミのたれ耳ロリータBIGぬいぐるみ✨\n2026年10月2週登場予定。店舗により前後します。\n\n#サンリオ #クロミ #フリュープライズ'}});}
 return r.fulfill({json:action==='list'?{ok:true,items:[{url:'https://www.sanrio.co.jp/news/goods/test/',source:'サンリオ公式',title:'公式の新作',date:'2026-10-04'},prize]}:{ok:true,item:prize}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await expect(page.locator('#newsList .news-row')).toHaveCount(2);
 await page.locator('#newsSourceFilter').selectOption('フリュー');await expect(page.locator('#newsList .news-row')).toHaveCount(1);
 await expect(page.locator('#newsList')).toContainText('2026年10月2週登場予定');await expect(page.locator('#newsList')).not.toContainText('発表日未確認');
 await page.locator('#newsList button').click();
 await expect(page.locator('#newsText')).toHaveValue(/店舗により時期が前後/);
 expect(await page.locator('#newsText').inputValue()).not.toMatch(/https?:|詳細はこちら|#pr\b|価格/);
 await expect(page.locator('#newsSource')).toHaveAttribute('href',prize.url);await expect(page.locator('#newsShare')).toBeEnabled();expect(aiCalls).toBe(0);
 await page.locator('#newsShare').click();const shared=await page.evaluate(()=>window.furyuShared);expect(shared.text).not.toContain('https://');expect(shared.files).toEqual(['image/png']);
 await page.locator('#newsAiRetry').click();await expect(page.locator('#newsText')).toHaveValue(/店舗により前後します/);expect(await page.locator('#newsText').inputValue()).not.toMatch(/https?:|詳細はこちら|#pr\b/);expect(aiCalls).toBe(1);
 await page.locator('#newsDone').click();await expect(page.locator('#newsList .news-row')).toHaveCount(0);await page.locator('#newsFilter').selectOption('hidden');await expect(page.locator('#newsList .news-row')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
