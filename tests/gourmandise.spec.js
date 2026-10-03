const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const url='https://www.gourmandise.jp/view/item/000000011006';
const storeUrl='https://item.rakuten.co.jp/gourmandise/test-100/';
const affiliate='https://hb.afl.rakuten.co.jp/hgc/test12345678/?pc=test';
const listing={source:'グルマンディーズ',url,title:'10月下旬発売予定 サンリオ テストポーチ',date:'',thumbnail:'',products:[],productIds:[],needsReview:true};
const matched={...listing,products:[{store:'楽天',url:storeUrl}],productIds:['rakuten:gourmandise:test-100'],needsReview:false,retailerStatus:'楽天公式店：型番・JANで照合済み',manufacturerInfo:{facts:{商品名:listing.title,発売時期:'10月下旬発売予定',ラインナップ:'マイメロディ / ポムポムプリン'},text:'',checkedAt:'2026-10-04T00:00:00Z'},productInfo:{title:'サンリオ テストポーチ',url:storeUrl,itemCode:'gourmandise:10001234',searchKeyword:'TEST-100',jan:'',specs:{},contents:['マイメロディ','ポムポムプリン'],images:['https://image.rakuten.co.jp/gourmandise/cabinet/test-100.jpg'],checkedAt:'2026-10-04T00:00:00Z'}};
async function setup(page){
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.gourShared={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/news.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('action')==='product-groq-draft')return r.fulfill({json:{ok:true,configured:true,text:'🎀 サンリオのテストポーチ ✨\n🗓️ 10月下旬発売予定\n\n🛍️ '+affiliate+'\n\n#サンリオ #pr'}});
  return r.fulfill({json:{ok:true,items:[]}});
 });
}
test('グルマンディーズを統合し、照合後にブログの重複をまとめてAI文・PNGを共有する',async({page})=>{
 await setup(page);const calls=[];
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;calls.push(q.get('action'));
  if(q.get('action')==='detail')return r.fulfill({json:{ok:true,item:matched}});
  if(q.get('action')==='affiliate')return r.fulfill({json:{ok:true,affiliate:{itemCode:matched.productInfo.itemCode,url:affiliate}}});
  if(q.get('action')==='image')return r.fulfill({contentType:'image/png',body:png});
  const items=q.get('source')==='gourmandise'?[listing]:q.get('source')==='hatakeyama'?[]:[{url:'https://lovely-fancy.net/sanrio/2026/9/',title:'同じポーチのブログ記事',date:'2026-10-03',productIds:matched.productIds}];
  return r.fulfill({json:{ok:true,items,nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(2);
 expect(calls).not.toContain('detail');expect(calls).not.toContain('affiliate');
 await page.locator('[data-lovely-select="'+url+'"]').click();
 await expect(page.locator('#lovelyRakuten')).toHaveValue(affiliate);
 await expect(page.locator('#lovelyReview')).toContainText('照合済み');
 await expect(page.locator('#lovelySource')).toHaveText('メーカーの商品ページを確認');
 await expect(page.locator('#lovelySource')).toHaveAttribute('href',url);
 await expect(page.locator('#lovelyRakutenSearch')).toHaveAttribute('href',/TEST-100.*sid=312278/);
 await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);
 await page.locator('#lovelyPostAi').click();await expect(page.locator('#lovelyPostAiStatus')).toContainText('AI生成済み');
 await expect(page.locator('#lovelyPostText')).toHaveValue(/10月下旬発売予定/);
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 const share=await page.evaluate(()=>window.gourShared);expect(share.text).toContain(affiliate);expect(share.files).toEqual([{name:'product-1.png',type:'image/png'}]);
 await page.locator('#lovelyDone').click();await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('楽天掲載待ちでは紹介リンクとメーカー写真を自動入力しない',async({page})=>{
 await setup(page);const calls=[];
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;calls.push(q.get('action'));
  if(q.get('action')==='detail')return r.fulfill({json:{ok:true,item:{...matched,products:[],productIds:[],needsReview:true,retailerStatus:'楽天掲載待ち・要確認',productInfo:{...matched.productInfo,itemCode:'',url:'',images:[]}}}});
  return r.fulfill({json:{ok:true,items:q.get('source')==='gourmandise'?[listing]:[],nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();await page.locator('#lovelyList button').click();
 await expect(page.locator('#lovelyReview')).toHaveText('楽天掲載待ち・要確認');
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();
 await expect(page.locator('#lovelyRakuten')).toHaveValue('');await expect(page.locator('[data-lovely-image]')).toHaveCount(0);
 await expect(page.locator('#lovelyProducts a')).toHaveCount(0);
 expect(calls).not.toContain('affiliate');expect(calls).not.toContain('image');
});
test('メーカーが接続失敗しても既存候補を残し、次の取得で回復する',async({page})=>{
 await setup(page);let fail=true;
 await page.route('**/lovely-watch.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('source')==='gourmandise'&&fail)return r.fulfill({status:502,json:{ok:false,error:'一時的な接続失敗'}});
  const items=q.get('source')==='gourmandise'?[listing]:q.get('source')==='hatakeyama'?[]:[{url:'https://lovely-fancy.net/sanrio/2026/9/',title:'既存のサンリオ商品',productIds:['rakuten:example:other']}];
  return r.fulfill({json:{ok:true,items,nextPage:null}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyStatus')).toContainText('グルマンディーズ：一時的な接続失敗');await expect(page.locator('#lovelyList')).toContainText('既存のサンリオ商品');
 fail=false;await page.locator('#lovelyMore').click();await expect(page.locator('#lovelyList')).toContainText(listing.title);await expect(page.locator('#lovelyMore')).toBeHidden();
});
