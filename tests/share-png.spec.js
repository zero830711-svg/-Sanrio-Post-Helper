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
test('PNGの準備と並行してJPEGを準備し、通常のChatGPTボタンから写真だけを渡す',async({page})=>{
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/share-fixture.webp',r=>r.fulfill({contentType:'image/webp',body:Buffer.from(webp,'base64')}));
 await page.goto('/');
 await page.evaluate(()=>{
  legacyCopyText=text=>{window.copiedPrompt=text;return true;};
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.pngShared={text:data.text,files:await Promise.all(data.files.map(async f=>({name:f.name,type:f.type,signature:Array.from(new Uint8Array(await f.slice(0,8).arrayBuffer()))})))}}});
  showTodayDetail({id:'png-test',title:'【サンリオ新商品情報】\n'+ '🌈✨可愛いグラデーション'.repeat(15),text:'リボンバッグの情報です。',images:[location.origin+'/share-fixture.webp',location.origin+'/share-fixture.webp']});
 });
 await expect(page.locator('#detailMediaStatus')).toContainText('写真の準備ができました');
 await page.getByRole('button',{name:'写真2を前へ',exact:true}).click();
 await page.evaluate(()=>{legacyCopyText=()=>false;});
 await page.locator('#detailChatGPTShare').click();
 await expect(page.locator('#detailChatGPTStatus')).toContainText('プロンプトをコピーできません');
 expect(await page.evaluate(()=>window.pngShared)).toBeUndefined();
 await page.evaluate(()=>{legacyCopyText=text=>{window.copiedPrompt=text;return true;};});
 await page.locator('#detailChatGPTShare').click();
 await expect.poll(()=>page.evaluate(()=>window.pngShared?.files.length)).toBe(2);
 const data=await page.evaluate(()=>pngShared);
 expect(data.text).toBeUndefined();expect(await page.evaluate(()=>copiedPrompt)).toContain('焼き直し投稿');
 for(const f of data.files){expect(f.name).toMatch(/^sanrio-[a-z0-9]+-photo-[12]\.jpg$/);expect(f.type).toBe('image/jpeg');expect(f.signature.slice(0,3)).toEqual([255,216,255]);}
 expect(await page.evaluate(()=>document.body.style.position)).toBe('');
});
test('変換できないデータは共有準備済みにせずエラーを返す',async({page})=>{
 await page.goto('/');
 const message=await page.evaluate(async()=>{try{await sharePhotoPng(new Blob(['broken image'],{type:'image/webp'}));return 'unexpected success';}catch(e){return e.message;}});
 expect(message).toContain('PNGに変換できません');
});

test('準備前に押しても非同期で共有せず、再タップでJPEG写真を渡す',async({page})=>{
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.goto('/');
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=1200;c.height=1200;
  const ctx=c.getContext('2d');ctx.fillStyle='#ff77cc';ctx.fillRect(0,0,1200,1200);
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg'));
  const png=await sharePhotoPng(blob);
  showTodayDetail({id:'rainbow-jpeg',title:'【サンリオ新商品情報】🌈✨レインボーシリーズ',text:'レインボーシリーズの情報です。',images:[]});
  detailImageBlobs=[png,png];detailJpegBlobs=[null,null];detailPhotoSelection=[1,0];updateDetailPhotoControls();
  legacyCopyText=text=>{window.jpegPrompt=text;return true;};
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  Object.defineProperty(navigator,'share',{value:async data=>{window.jpegShared={text:data.text,files:await Promise.all(data.files.map(async f=>{
   const img=new Image(),url=URL.createObjectURL(f);try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});return {name:f.name,type:f.type,width:img.naturalWidth,height:img.naturalHeight,signature:Array.from(new Uint8Array(await f.slice(0,3).arrayBuffer()))};}finally{URL.revokeObjectURL(url);}
  }))};}});
 });
 await page.locator('#detailChatGPTShare').click();
 await expect(page.locator('#detailChatGPTStatus')).toContainText('もう一度押して共有');
 expect(await page.evaluate(()=>window.jpegShared)).toBeUndefined();
 await page.locator('#detailChatGPTShare').click();
 await expect.poll(()=>page.evaluate(()=>window.jpegShared?.files.length)).toBe(2);
 const result=await page.evaluate(()=>({data:jpegShared,prompt:jpegPrompt}));
 expect(result.prompt).toContain('焼き直し投稿');expect(result.data.text).toBeUndefined();
 for(const [i,f] of result.data.files.entries()){
  expect(f.name).toMatch(new RegExp('^sanrio-[a-z0-9]+-photo-'+(i+1)+'\\.jpg$'));
  expect(f.type).toBe('image/jpeg');expect(f.signature).toEqual([255,216,255]);expect(f.width).toBe(1200);expect(f.height).toBe(1200);
 }
 expect(await page.evaluate(()=>document.body.style.position)).toBe('');
});
