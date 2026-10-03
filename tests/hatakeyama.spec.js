const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const hat={source:'畑山商事',url:'https://www.hatakeyamashoji.jp/news/news_2026-9-6/',title:'サンリオ ショルダーポシェットホワイトアニマルズ',date:'2026-09-15',thumbnail:'https://www.hatakeyamashoji.jp/wp/wp-content/uploads/7-27.jpg',productIds:['rakuten:petitpoche:63204234-4237'],products:[{store:'楽天',url:'https://item.rakuten.co.jp/petitpoche/63204234-4237/'}],manufacturerInfo:{facts:{商品名:'ショルダーポシェットホワイトアニマルズ',発売時期:'2026年9月上旬',素材:'ポリエステル'},text:'発売時期：2026年9月上旬\n背面にはしっぽ付き',checkedAt:'2026-10-03T00:00:00Z'},productInfo:{title:'ショルダーポシェット',url:'https://item.rakuten.co.jp/petitpoche/63204234-4237/',itemCode:'petitpoche:63204234-4237',checkedAt:'2026-10-03T00:00:00Z',specs:{},images:['https://www.hatakeyamashoji.jp/wp/wp-content/uploads/7-27.jpg']}};
const blog={url:'https://lovely-fancy.net/sanrio/2026/1/',title:'ブログの同じ商品',date:'2026-10-02',productIds:hat.productIds};
async function setup(page){
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.sharedProduct={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
}
test('畑山とブログを1件にまとめ、メーカー写真・発売資料・紹介リンクを共有する',async({page})=>{
 await setup(page);
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('action')==='image')return r.fulfill({contentType:'image/png',body:png});
  if(q.get('action')==='detail')return r.fulfill({json:{ok:true,item:hat}});
  if(q.get('action')==='affiliate')return r.fulfill({json:{ok:true,affiliate:{itemCode:hat.productInfo.itemCode,url:'https://hb.afl.rakuten.co.jp/hgc/test12345678/?pc=test'}}});
  return r.fulfill({json:{ok:true,items:q.get('source')==='hatakeyama'?[hat]:[blog],nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);await expect(page.locator('#lovelyList')).toContainText('畑山商事');
 await page.locator('#lovelyList button').click();await expect(page.locator('#lovelySource')).toHaveText('メーカーの記事を確認');
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();
 await expect(page.locator('#lovelyRakuten')).toHaveValue(/hb.afl.rakuten.co.jp/);
 await expect(page.locator('.lovely-product-facts').first()).not.toHaveAttribute('open');
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyShare').click();
 const shared=await page.evaluate(()=>window.sharedProduct);expect(shared.files).toEqual([{name:'product-1.png',type:'image/png'}]);expect(shared.text).toContain('2026年9月上旬');expect(shared.text).toContain('背面にはしっぽ付き');expect(shared.text).toContain(hat.url);
 await page.locator('#lovelyDone').click();await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(0);
 await page.locator('#lovelyFilter').selectOption('used');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('畑山が失敗してもブログを表示し、もっと見るで畑山を再取得する',async({page})=>{
 await setup(page);let fail=true;
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('source')==='hatakeyama'&&fail)return r.fulfill({status:502,json:{ok:false,error:'一時的な接続失敗'}});
  return r.fulfill({json:{ok:true,items:q.get('source')==='hatakeyama'?[hat]:[blog],nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyStatus')).toContainText('一時的な接続失敗');await expect(page.locator('#lovelyList')).toContainText(blog.title);
 fail=false;await page.locator('#lovelyMore').click();await expect(page.locator('#lovelyList')).toContainText('畑山商事');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);await expect(page.locator('#lovelyMore')).toBeHidden();
});
