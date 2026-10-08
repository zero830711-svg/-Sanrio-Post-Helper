const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const item={title:'サンリオのクリスマス菓子',source:'サンリオ公式',url:'https://www.sanrio.co.jp/news/goods/collage-test/',images:Array.from({length:8},(_,i)=>'https://example.invalid/'+i+'.png'),paragraphs:[]};
async function setup(page){
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedCollage=data.files.map(f=>({name:f.name,type:f.type}));}});});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/news.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');return a==='image'?r.fulfill({contentType:'image/png',body:png}):r.fulfill({json:a==='list'?{ok:true,items:[item]}:{ok:true,item}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();await expect(page.locator('#newsShare')).toBeEnabled();
}
test('8枚を2枚のPNGにまとめ、4枚だけなら1枚にまとめて共有する',async({page})=>{
 await setup(page);await page.locator('#newsCollageMode').check();await expect(page.locator('#newsCollagePreview img')).toHaveCount(2);await expect(page.locator('#newsShare')).toBeEnabled();await expect(page.locator('#newsEditorStatus')).toContainText('8枚を2枚に');
 await page.locator('#newsShare').click();expect(await page.evaluate(()=>window.sharedCollage)).toEqual([{name:'news-collage-1.png',type:'image/png'},{name:'news-collage-2.png',type:'image/png'}]);
 for(let n=5;n<=8;n++)await page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 '+n,{exact:true})}).getByRole('checkbox').uncheck();
 await expect(page.locator('#newsCollagePreview img')).toHaveCount(1);await expect(page.locator('#newsShare')).toBeEnabled();await page.locator('#newsShare').click();expect(await page.evaluate(()=>window.sharedCollage)).toHaveLength(1);
 await page.locator('#newsCollageMode').uncheck();await expect(page.locator('#newsCollagePreview')).not.toBeVisible();await page.locator('#newsShare').click();expect((await page.evaluate(()=>window.sharedCollage)).map(f=>f.name)).toEqual(['news-1.png','news-2.png','news-3.png','news-4.png']);
});
test('まとめ設定と8枚の順番を再起動後も復元する',async({page})=>{
 await setup(page);await page.locator('#newsCollageMode').check();await expect(page.locator('#newsShare')).toBeEnabled();await page.getByRole('button',{name:'写真2を前へ',exact:true}).click();await expect(page.locator('#newsShare')).toBeEnabled();
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsFilter').selectOption('draft');await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();await expect(page.locator('#newsCollageMode')).toBeChecked();await expect(page.locator('#newsShare')).toBeEnabled();expect(await page.evaluate(()=>newsState.selected)).toEqual([1,0,2,3,4,5,6,7]);await expect(page.locator('#newsCollagePreview img')).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('縦横比と写真の順番を保ち、切り取りせず2×2に配置する',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>typeof newsCollageFiles==='function');
 const result=await page.evaluate(async()=>{
  const files=[];for(const [i,color] of ['#ff0000','#00ff00','#0000ff','#ffff00'].entries()){const c=document.createElement('canvas');c.width=i%2?20:100;c.height=i%2?100:20;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,c.width,c.height);files.push(new File([await new Promise(r=>c.toBlob(r,'image/png'))],i+'.png',{type:'image/png'}));}
  const output=await newsCollageFiles(files),img=new Image(),url=URL.createObjectURL(output[0]);await new Promise(r=>{img.onload=r;img.src=url;});const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);URL.revokeObjectURL(url);const pixel=(a,b)=>Array.from(x.getImageData(a,b,1,1).data);return {width:c.width,height:c.height,centers:[[400,400],[1200,400],[400,1200],[1200,1200]].map(p=>pixel(...p)),margins:[pixel(400,50),pixel(850,400)]};
 });
 expect(result.width).toBe(1600);expect(result.height).toBe(1600);expect(result.centers).toEqual([[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]]);expect(result.margins).toEqual([[255,255,255,255],[255,255,255,255]]);
});
