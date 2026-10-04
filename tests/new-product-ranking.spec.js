const {test,expect}=require('@playwright/test');
const ranking=require('../new-product-ranking.js');
const characters=[{key:'マイメロ',re:/マイメロ/},{key:'クロミ',re:/クロミ/}];
const history=[...Array.from({length:3},(_,i)=>({id:'water'+i,text:'マイメロディ 水筒 2020年発売',impressions:10000,urlClicks:400,bookmarks:40,reposts:10})),...Array.from({length:6},(_,i)=>({id:'other'+i,text:'クロミ ポーチ',impressions:10000,urlClicks:20,bookmarks:2,reposts:1}))];
test('複数投稿の実績を使用し、低表示・重複・削除済み・複数キャラを過大評価しない',()=>{
 const model=ranking.build(history,characters);expect(model.has('マイメロ|水筒')).toBeTruthy();
 const bad=[...Array.from({length:8},()=>({...history[0]})),...Array.from({length:4},(_,i)=>({id:'tiny'+i,text:'マイメロ 水筒',impressions:10,urlClicks:10})),...history.filter(p=>p.id.startsWith('other'))];
 expect(ranking.build(bad,characters).size).toBe(0);
 expect(ranking.build(history.map(p=>({...p,deletedAt:'2026-10-01'})),characters).size).toBe(0);
 expect(ranking.theme({title:'マイメロ クロミ 水筒'},characters)).toBeNull();
 const singleSpike=history.map((p,i)=>({...p,urlClicks:i===0?1000:20,bookmarks:2,reposts:1}));expect(ranking.build(singleSpike,characters).size).toBe(0);
});
test('おすすめは4件目に未知の商品を残し、実績なしでは元の順序を維持する',()=>{
 const groups=Array.from({length:7},(_,i)=>({item:{title:i<5?'マイメロ 水筒':'新しいグッズ',url:String(i)}}));
 const model=ranking.build(history,characters),result=ranking.rank(groups,model,characters);
 expect(result[3].item.url).toBe('5');expect(result[0].rankingReason).toContain('過去3投稿');
 expect(ranking.rank(groups,new Map(),characters).map(g=>g.item.url)).toEqual(groups.map(g=>g.item.url));
 expect(result[0].rankingReason).not.toContain('2020');
});
test('iPhone一覧でおすすめ・新着順切替、情報元絞込、追加ページにも適用しAIを呼ばない',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 let aiCalls=0;await page.route('**/news.php?**',r=>{if(new URL(r.request().url()).searchParams.get('action')?.includes('groq'))aiCalls++;return r.fulfill({json:{ok:true,items:[]}});});
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams,source=q.get('source'),second=q.get('page')==='2';
  const items=source==='skater'?(second?[{url:'https://www.skater-onlineshop.com/shop/g/g4973307721236/',source:'スケーター',title:'マイメロディ ステンマグ 新商品',date:'2026-10-03'}]:[{url:'https://www.skater-onlineshop.com/shop/g/g4973307091827/',source:'スケーター',title:'マイメロディ 水筒',date:'2026-10-02'}]):!source?[{url:'https://lovely-fancy.net/new/',source:'Lovely Fancy',title:'クロミ ポーチ',date:'2026-10-04'}]:[];
  return r.fulfill({json:{ok:true,items,nextPage:source==='skater'&&!second?2:null}});
 });
 await page.goto('/');await page.evaluate(async posts=>{for(const p of posts)await dbPut(p)},history);
 await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyList .lovely-row-title').first()).toHaveText('マイメロディ 水筒');
 await expect(page.locator('.lovely-ranking-reason')).toContainText('マイメロ×水筒：過去3投稿');
 await page.locator('#lovelySort').selectOption('date');await expect(page.locator('#lovelyList .lovely-row-title').first()).toHaveText('クロミ ポーチ');
 await expect(page.locator('.lovely-ranking-reason')).toHaveCount(0);
 await page.locator('#lovelySort').selectOption('recommended');await page.locator('#lovelyMore').click();
 await expect(page.locator('#lovelyList .lovely-row-title').first()).toHaveText('マイメロディ ステンマグ 新商品');
 await page.locator('#lovelySourceFilter').selectOption('lovely');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);
 expect(aiCalls).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
