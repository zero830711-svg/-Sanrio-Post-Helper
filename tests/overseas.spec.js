const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const photo='https://cdn.shopify.com/s/files/1/0416/8083/0620/files/test.jpg';
const candidate=(region,key)=>({overseas:true,region,sourceId:region==='KR'?'toytron':region==='US'?'us':'hongkong',source:'海外公式 '+region,url:'https://www.sanrio.com/products/'+key,title:'サンリオ '+key,thumbnail:photo,date:'',firstSeenAt:'2026-10-04T09:00:00Z',baseline:true,isNew:false,products:[],productIds:[],needsReview:true});
const items=[candidate('KR','korea'),candidate('US','america'),candidate('HK','hongkong')];
async function setup(page){
 const calls=[];let fail=false;
 await page.addInitScript(()=>{
  localStorage.setItem('sanrioCloudSyncKey','test-key');
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.overseasShared={text:data.text,files:data.files.map(f=>({name:f.name,type:f.type}))}},configurable:true});
 });
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 await page.route('**/lovely-watch.php?**',r=>r.fulfill({json:{ok:true,items:[],nextPage:2}}));
 await page.route('https://cdn.shopify.com/**',r=>r.fulfill({contentType:'image/png',body:png}));
 await page.route('**/overseas.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;calls.push(q.get('action'));
  if(q.get('action')==='image')return r.fulfill({contentType:'image/png',body:png});
  if(q.get('action')==='detail'){
   const item=items.find(i=>i.url===q.get('url'));
   return r.fulfill({json:{ok:true,item:{...item,manufacturerInfo:{facts:{商品名:item.title,掲載地域:item.region,日本での販売:'未確認',海外限定か:'未確認'},text:'海外の公式一覧',checkedAt:'2026-10-04T09:00:00Z'},productInfo:{title:item.title,url:'',itemCode:'',specs:{},contents:[],images:[photo],checkedAt:'2026-10-04T09:00:00Z'}}}});
  }
  if(fail)return r.fulfill({status:502,json:{ok:false,error:'収集APIの接続失敗'}});
  return r.fulfill({json:{ok:true,apiVersion:'3431',items,sourceHealth:[{label:'海外公式',ok:true}],fetchedAt:'2026-10-04T09:00:00Z',nextPage:null}});
 });
 await page.route('**/news.php?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('action')==='product-groq-draft'){
   const body=r.request().postDataJSON();expect(body.overseas).toBe(true);expect(body.region).toBe('KR');expect(body.links).toEqual([]);expect(body.text).toContain('日本国内販売・海外限定');
   return r.fulfill({json:{ok:true,configured:true,text:'🎀 海外グッズ情報【韓国】\nサンリオのアイテムをチェック 💖✨\n\n#サンリオ #pr'}});
  }
  return r.fulfill({json:{ok:true,items:[]}});
 });
 await page.goto('/');await page.getByRole('tab',{name:'新着商品',exact:true}).click();
 await expect(page.locator('#lovelyOverseasStatus')).toContainText('約30分');
 await expect(page.locator('#lovelyRefresh')).toBeEnabled();
 return {calls,fail:()=>{fail=true;}};
}
test('海外候補はリンクなしで一覧に残り、地域の選択を保存する',async({page})=>{
 const {calls}=await setup(page);
 await page.locator('#lovelySourceFilter').selectOption('overseas');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(3);
 await page.locator('#lovelyCountryFilter').selectOption('KR');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);
 await expect(page.locator('#lovelyCount')).toContainText('未紹介・要確認 1件');await expect(page.locator('#lovelyMore')).toBeHidden();
 await expect(page.locator('#lovelyList')).toContainText('発見');await expect(page.locator('#lovelyList')).not.toContainText('24時間以内の追加');
 const box=await page.locator('#lovelyCountryFilter').boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
 expect(await page.locator('#lovelyCountryFilter').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
 await page.reload();await expect(page.locator('#lovelySourceFilter')).toHaveValue('overseas');await expect(page.locator('#lovelyCountryFilter')).toHaveValue('KR');
 expect(calls).not.toContain('refresh');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('海外候補のAI文・PNG写真共有は紹介リンクを必須にしない',async({page})=>{
 const {calls}=await setup(page);await page.locator('#lovelyCountryFilter').selectOption('KR');await page.locator('#lovelyList button').click();
 await expect(page.locator('#lovelyConfirmed')).toBeEnabled();await expect(page.locator('#lovelySource')).toHaveText('海外の公式ページを確認');
 await expect(page.locator('#lovelyPostText')).toHaveValue(/海外グッズ情報【韓国】/);await expect(page.locator('#lovelyReview')).toContainText('日本での販売・海外限定・購入可否・発売日は未確認');
 await expect(page.locator('#rakutenRetry')).toBeHidden();await expect(page.locator('#lovelyConfirmationText')).toContainText('紹介リンクは任意');
 await page.locator('#lovelyPostAi').click();await expect(page.locator('#lovelyPostAiStatus')).toContainText('AI生成済み');
 await page.locator('[data-lovely-image="0"]').check();await expect(page.locator('#lovelyPhotoCount')).toContainText('1枚準備済み');
 await page.locator('#lovelyConfirmed').check();await page.locator('#lovelyPostShare').click();
 const share=await page.evaluate(()=>window.overseasShared);expect(share.text).toContain('海外グッズ情報【韓国】');expect(share.files).toEqual([{name:'product-1.png',type:'image/png'}]);
 expect(calls).toContain('detail');expect(calls).toContain('image');
 await page.locator('#lovelyDone').click();await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(0);await page.locator('#lovelyFilter').selectOption('used');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(1);
});
test('海外API失敗時は読み込んだ候補を残して原因を表示する',async({page})=>{
 const control=await setup(page);await page.locator('#lovelySourceFilter').selectOption('overseas');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(3);
 control.fail();await page.locator('#lovelyRefresh').click();await expect(page.locator('#lovelyOverseasStatus')).toContainText('収集APIの接続失敗');await expect(page.locator('#lovelyList .lovely-row')).toHaveCount(3);
 expect(await page.evaluate(()=>lovelyWatch.overseasThumbnailUrl('https://cdn.shopify.com/s/files/1/another-store/files/image.jpg'))).toBe('');
});
