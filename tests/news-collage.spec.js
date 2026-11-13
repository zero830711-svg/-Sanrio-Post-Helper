const {test,expect}=require('@playwright/test');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const item={title:'サンリオのクリスマス菓子',source:'サンリオ公式',url:'https://www.sanrio.co.jp/news/goods/collage-test/',images:Array.from({length:8},(_,i)=>'https://example.invalid/'+i+'.png'),paragraphs:[]};
async function setup(page,source=item){
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedCollage=data.files.map(f=>({name:f.name,type:f.type}));}});});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/news.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');return a==='image'?r.fulfill({contentType:'image/png',body:png}):r.fulfill({json:a==='list'?{ok:true,items:[source]}:{ok:true,item:source}});});
 await page.goto('/');await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();await expect(page.locator('#newsShare')).toBeEnabled();
}
function choose(page,n){return page.locator('.news-photo').filter({has:page.getByAltText('記事の写真 '+n,{exact:true})}).getByRole('checkbox').check();}
function mode(page,size){return page.locator('#newsCollageControls [data-collage-size="'+size+'"]');}
test('4枚モードは余り1枚を個別に共有する',async({page})=>{
 await setup(page);
 await mode(page,4).click();await choose(page,8);
 await expect(page.locator('#newsImages select')).toHaveCount(0);
 await expect(page.locator('#newsCollagePreview img')).toHaveCount(2);
 await page.locator('#newsShare').click();
 expect((await page.evaluate(()=>window.sharedCollage)).map(f=>f.name)).toEqual(['news-collage-1.png','news-8.png']);
});
test('縦横比と写真の順番を保ち、切り取りせず2×2に配置する',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>typeof newsCollageFiles==='function');
 const result=await page.evaluate(async()=>{
  const files=[];for(const [i,color] of ['#ff0000','#00ff00','#0000ff','#ffff00'].entries()){const c=document.createElement('canvas');c.width=i%2?20:100;c.height=i%2?100:20;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,c.width,c.height);files.push(new File([await new Promise(r=>c.toBlob(r,'image/png'))],i+'.png',{type:'image/png'}));}
  const output=await newsCollageFiles(files),img=new Image(),url=URL.createObjectURL(output[0]);await new Promise(r=>{img.onload=r;img.src=url;});const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);URL.revokeObjectURL(url);const pixel=(a,b)=>Array.from(x.getImageData(a,b,1,1).data);return {width:c.width,height:c.height,centers:[[400,400],[1200,400],[400,1200],[1200,1200]].map(p=>pixel(...p)),margins:[pixel(400,50),pixel(850,400)]};
 });
 expect(result.width).toBe(1600);expect(result.height).toBe(1600);expect(result.centers).toEqual([[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]]);expect(result.margins).toEqual([[255,255,255,255],[255,255,255,255]]);
});

test('6枚ずつ選択順に自動でまとめ、7枚目と並べ替えを再読込後も保持する',async({page})=>{
 await setup(page);
 await mode(page,6).click();
 for(const n of [8,6,7])await choose(page,n);
 await page.getByRole('button',{name:'写真8を前へ',exact:true}).click();
 await expect(page.locator('#newsCollagePreview img')).toHaveCount(2);
 expect(await page.evaluate(()=>newsCollageGroups())).toEqual([[0,1,2,7,3,5],[6]]);
 const dimensions=await page.locator('#newsCollagePreview img').first().evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight];});
 expect(dimensions).toEqual([1600,2400]);
 await page.reload();await page.getByRole('tab',{name:'新作ニュース',exact:true}).click();
 await page.locator('#newsFilterButtons').getByRole('button',{name:'準備中',exact:true}).click();
 await page.locator('#newsList').getByRole('button',{name:'投稿準備',exact:true}).click();
 await expect(mode(page,6)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#newsCollagePreview img')).toHaveCount(2);
 expect(await page.evaluate(()=>newsCollageGroups())).toEqual([[0,1,2,7,3,5],[6]]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
