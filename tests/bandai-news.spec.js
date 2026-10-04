const {test,expect}=require('@playwright/test');
for(const source of ['バンダイ キャンディ','バンダイ おもちゃ'])test(source+'を絞り込み、公式の発売時期とURLなし本文で準備する',async({page})=>{
 const candy={source:'バンダイ キャンディ',tipsOnly:true,title:'SANRIO CHARACTERS FRIENDS 6',url:'https://www.bandai.co.jp/candy/products/2027/4570117930669000.html',schedule:'発売時期：2027年2月',facts:[{kind:'schedule',text:'発売時期：2027年2月'}],paragraphs:[],images:[],date:''};
 const toy={...candy,source:'バンダイ おもちゃ',title:'ぷちとも Sanrio characters みんなでクリスマス',url:'https://toy.bandai.co.jp/ja/item/01_21086/',schedule:'発売時期：2026年10月10日',facts:[{kind:'schedule',text:'発売時期：2026年10月10日'}]};
 let ai=0;await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',r=>{const q=new URL(r.request().url()).searchParams;if(q.get('action')==='ai-draft')ai++;return r.fulfill({json:q.get('action')==='list'?{ok:true,items:[candy,toy]}:{ok:true,item:q.get('url')===candy.url?candy:toy}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsSourceFilter').selectOption(source);await expect(page.locator('#newsList .news-row')).toHaveCount(1);await page.locator('#newsList button').click();
 const item=source===candy.source?candy:toy;await expect(page.locator('#newsText')).toHaveValue(new RegExp(item.schedule));expect(await page.locator('#newsText').inputValue()).not.toMatch(/https?:|詳細はこちら|#pr\b/);await expect(page.locator('#newsDate')).toHaveText(item.schedule);await expect(page.locator('#newsSource')).toHaveAttribute('href',item.url);expect(ai).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
