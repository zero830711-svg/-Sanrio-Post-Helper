const {test,expect}=require('@playwright/test');
const url='https://item.rakuten.co.jp/sanrio/4550337000000/',affiliate='https://hb.afl.rakuten.co.jp/hgc/original1234/?pc='+encodeURIComponent(url);
const image='https://image.rakuten.co.jp/sanrio/cabinet/202610/pouch.jpg?_ex=1200x1200';
const item={source:'サンリオ公式 楽天市場店',url,title:'ハローキティ ポーチ',date:'',catalogUpdate:true,priceAtFetch:2200,thumbnail:image,products:[{store:'楽天',url}],productIds:['rakuten:sanrio:4550337000000'],needsReview:false,retailerStatus:'公式楽天店のAPI更新商品。新発売・発売日・在庫は未確認。',productInfo:{url,itemCode:'sanrio:10012345',title:'ハローキティ ポーチ',images:[image],checkedAt:'2026-10-17T08:00:00Z',specs:{},contents:[]}};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function setup(page){
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key')});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('https://image.rakuten.co.jp/**',r=>r.fulfill({contentType:'image/png',body:png}));
}
test('公式楽天店は更新候補として表示し、APIコードを渡して画像・紹介リンク・下書きを保持する',async({page})=>{
 await setup(page);const calls=[];
 await page.route('**/lovely-watch.php?**',r=>{const q=new URL(r.request().url()).searchParams;calls.push(Object.fromEntries(q));if(q.get('action')==='settings')return r.fulfill({json:{ok:true,configured:true}});
  if(q.get('action')==='list')return r.fulfill({json:{ok:true,items:q.get('source')==='sanrio'?[item]:[],nextPage:null}});
  expect(q.get('code')).toBe(item.productInfo.itemCode);expect(q.get('url')).toBe(url);
  if(q.get('action')==='affiliate')return r.fulfill({json:{ok:true,affiliate:{itemCode:item.productInfo.itemCode,url:affiliate}}});
  if(q.get('action')==='image')return r.fulfill({contentType:'image/png',body:png});
  return r.fulfill({json:{ok:true,item}});
 });
 await page.goto('/');expect(calls.length).toBe(0);await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await page.locator('#lovelySourceFilter').selectOption('sanrio');await expect(page.locator('#lovelyList')).toContainText('公式楽天店の更新商品（新発売は未確認）');
 await expect(page.locator('#lovelyList')).toContainText('発売：未確認');await expect(page.locator('#lovelyList img')).toHaveAttribute('src',image);
 await page.locator('#lovelyList button').click();await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await expect(page.locator('#lovelyProductInfo')).toContainText('2,200円');await expect(page.locator('#lovelyPostText')).toHaveValue(new RegExp('ハローキティ ポーチ'));expect(await page.locator('#lovelyPostText').inputValue()).not.toMatch(/新発売|在庫あり|2200|2,200/);
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyPostText').fill('手直しした本文\n'+affiliate);await page.reload();await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyPostText')).toHaveValue('手直しした本文\n'+affiliate);await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('公式楽天店の追加取得は絞り込み元だけを読み、失敗時にも取得済み候補を残す',async({page})=>{
 await setup(page);const pages=[];let fail=false;
 await page.route('**/lovely-watch.php?**',r=>{const q=new URL(r.request().url()).searchParams;if(q.get('action')!=='list')return r.fulfill({json:{ok:true,item}});
  if(q.get('source')!=='sanrio')return r.fulfill({json:{ok:true,items:[],nextPage:null}});pages.push(q.get('page'));
  if(fail)return r.fulfill({status:502,json:{ok:false,error:'楽天APIに接続できませんでした。'}});
  const next=q.get('page')==='1';return r.fulfill({json:{ok:true,items:next?[item]:[item,{...item,url:url.replace('000000','000001'),title:'マイメロディ ポーチ',productIds:['rakuten:sanrio:4550337000010'],productInfo:{...item.productInfo,url:url.replace('000000','000001'),itemCode:'sanrio:10012346'}}],nextPage:next?2:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await expect(page.locator('#lovelyRefresh')).toBeEnabled();await page.locator('#lovelySourceFilter').selectOption('sanrio');await page.locator('#lovelyMore').click();await expect(page.locator('#lovelyList button')).toHaveCount(2);expect(pages).toEqual(['1','2']);
 fail=true;await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyStatus')).toContainText('接続できません');await expect(page.locator('#lovelyList button')).toHaveCount(2);
});
