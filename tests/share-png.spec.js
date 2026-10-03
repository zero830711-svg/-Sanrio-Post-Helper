const {test,expect}=require('@playwright/test');
const webp='UklGRiQAAABXRUJQVlA4TBcAAAAvAQAAEA9wBa1rwF9G9VH/oYUKRPQ/AAA=';
test('WebPとJPEGをPNGの実データへ変換し、サイズ・透明度・画素を保つ',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async base64=>{
  const webpBytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const read=async blob=>{
   const url=URL.createObjectURL(blob),img=new Image();
   try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {width:c.width,height:c.height,pixels:Array.from(x.getImageData(0,0,c.width,c.height).data)};}finally{URL.revokeObjectURL(url);}
  };
  const canvas=document.createElement('canvas');canvas.width=7;canvas.height=3;const x=canvas.getContext('2d');x.fillStyle='#ff3377';x.fillRect(0,0,7,3);
  const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
  const results=[];
  for(const original of [new Blob([webpBytes],{type:'image/webp'}),jpeg,new Blob([webpBytes],{type:'image/jpeg'})]){
   const before=await read(original),png=await sharePhotoPng(original),after=await read(png);
   results.push({before,after,type:png.type,signature:Array.from(new Uint8Array(await png.slice(0,8).arrayBuffer()))});
  }
  return results;
 },webp);
 for(const r of result){expect(r.type).toBe('image/png');expect(r.signature).toEqual([137,80,78,71,13,10,26,10]);expect(r.after).toEqual(r.before);}
 expect(result[0].after.pixels[7]).toBe(80);
});
test('取得時に変換を済ませ、ChatGPT共有にPNGファイルを選択順で渡す',async({page})=>{
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/share-fixture.webp',r=>r.fulfill({contentType:'image/webp',body:Buffer.from(webp,'base64')}));
 await page.goto('/');
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.pngShared={text:data.text,files:await Promise.all(data.files.map(async f=>({name:f.name,type:f.type,signature:Array.from(new Uint8Array(await f.slice(0,8).arrayBuffer()))})))}}});
  showTodayDetail({id:'png-test',title:'リボンバッグ',text:'リボンバッグの情報です。',images:[location.origin+'/share-fixture.webp',location.origin+'/share-fixture.webp']});
 });
 await expect(page.locator('#detailMediaStatus')).toContainText('写真の準備ができました');
 await page.getByRole('button',{name:'写真2を前へ',exact:true}).click();
 await page.locator('#detailChatGPTShare').click();
 await expect.poll(()=>page.evaluate(()=>window.pngShared?.files.length)).toBe(2);
 const data=await page.evaluate(()=>pngShared);
 expect(data.text).toContain('焼き直し投稿');
 for(const f of data.files){expect(f.name).toMatch(/\.png$/);expect(f.type).toBe('image/png');expect(f.signature).toEqual([137,80,78,71,13,10,26,10]);}
 expect(await page.evaluate(()=>document.body.style.position)).toBe('');
});
test('変換できないデータは共有準備済みにせずエラーを返す',async({page})=>{
 await page.goto('/');
 const message=await page.evaluate(async()=>{try{await sharePhotoPng(new Blob(['broken image'],{type:'image/webp'}));return 'unexpected success';}catch(e){return e.message;}});
 expect(message).toContain('PNGに変換できません');
});
