const {test,expect}=require('@playwright/test');
for(const source of ['タカラトミーアーツ','リーメント'])test(source+'の新作ネタを絞り込み、公式の時期表記とURLなし本文を使用する',async({page})=>{
 const arts={source:'タカラトミーアーツ',tipsOnly:true,title:'サンリオ キラキラツインチャーム',url:'https://www.takaratomy-arts.co.jp/items/item.html?n=Y111372',schedule:'発売時期：2026年10月',facts:[{kind:'schedule',text:'発売時期：2026年10月'}],paragraphs:[],images:[],date:''};
 const rement={...arts,source:'リーメント',title:'タキシードサムのおしゃれなおうち',url:'https://www.re-ment.co.jp/product/r70125',schedule:'発売時期：2026年10月26日',facts:[{kind:'schedule',text:'発売時期：2026年10月26日'}]};
 let ai=0;await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',r=>{const q=new URL(r.request().url()).searchParams;if(q.get('action')==='ai-draft')ai++;return r.fulfill({json:q.get('action')==='list'?{ok:true,items:[arts,rement]}:{ok:true,item:q.get('url')===arts.url?arts:rement}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsSourceFilter').selectOption(source);await expect(page.locator('#newsList .news-row')).toHaveCount(1);await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 const item=source===arts.source?arts:rement;await expect(page.locator('#newsText')).toHaveValue(new RegExp(item.schedule));expect(await page.locator('#newsText').inputValue()).not.toMatch(/https?:|詳細はこちら|#pr\b/);await expect(page.locator('#newsDate')).toHaveText(item.schedule);await expect(page.locator('#newsSource')).toHaveAttribute('href',item.url);expect(ai).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
