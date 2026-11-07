const {test,expect}=require('@playwright/test');
test('otaota drafts and posting marks stay independent of Sanrio data',async({page})=>{
 const item={url:'https://prtimes.jp/main/html/rd/p/000000001.000000001.html',title:'ちいかわ 新商品',date:'2026-10-30',source:'PR TIMES',image:'https://prcdn.freetls.fastly.net/release_image/1/1/test.png'};let aiCalls=0;
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');localStorage.setItem('sanrioNewsMarks',JSON.stringify({'https://example.com/sanrio':'done'}));});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>{let a=new URL(r.request().url()).searchParams.get('action');if(a==='draft'){aiCalls++;return r.fulfill({json:{ok:true,text:'💖 新しいグッズです'}})}return r.fulfill({json:{ok:true,items:[item],failed:[],fetchedAt:'2026-10-30T00:00:00Z'}})});
 await page.goto('/');await page.locator('#accountOta').click();await expect(page.locator('#otaPanel')).toBeVisible();await expect(page.locator('#homeTodayTab')).toBeHidden();await page.locator('#otaRefresh').click();await expect(page.locator('#otaList')).toContainText('ちいかわ');await expect(page.locator('#otaList .ota-thumb')).toHaveAttribute('src',item.image);await expect(page.locator('#otaList')).toContainText('発表 10/30');await expect(page.locator('[data-ota-filter="all"]')).toHaveAttribute('aria-pressed','true');await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();expect(aiCalls).toBe(0);await page.locator('#otaText').fill('自分で編集した文章');await page.locator('#otaBack').click();await page.reload();await expect(page.locator('#otaPanel')).toBeVisible();await page.locator('[data-ota-filter="draft"]').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#otaText')).toHaveValue('自分で編集した文章');await page.locator('#otaDone').click();await page.locator('#accountSanrio').click();await expect(page.locator('#homeTodayTab')).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sanrioNewsMarks')))).toEqual({'https://example.com/sanrio':'done'});
});
test('otaota editor saves reply and shows article photos with explicit rights confirmation',async({page})=>{
 const url='https://prtimes.jp/main/html/rd/p/000000001.000000001.html',photo='https://prcdn.freetls.fastly.net/release_image/1/1/test.png';let aiCalls=0,imageCalls=0;
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');if(a==='draft'){aiCalls++;return r.fulfill({json:{ok:true,text:'💖 生成文'}})}return r.fulfill({json:{ok:true,items:[{url,title:'ちいかわ 新商品',date:'2026-10-30',image:photo}],failed:[],fetchedAt:'2026-10-30T00:00:00Z'}})});
 await page.route('**/news.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');if(a==='image'){imageCalls++;return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')})}return r.fulfill({json:{ok:true,item:{url,title:'ちいかわ 新商品',images:[photo],facts:[{text:'11月発売予定'}]}}})});
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#otaImages img')).toHaveCount(1);expect(aiCalls).toBe(0);await page.locator('#otaReply').fill('自分の返信 https://example.com/search?q=original');await page.getByLabel('写真1を選択').check();await expect.poll(()=>imageCalls).toBe(1);await expect(page.locator('#otaShare')).toBeEnabled();await page.locator('#otaBack').click();await page.reload();await page.locator('[data-ota-filter="draft"]').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#otaReply')).toHaveValue('自分の返信 https://example.com/search?q=original');await expect(page.getByLabel('写真1を選択')).toBeChecked();
});
test('free-account count includes source URL and blocks overlong sharing without changing drafts',async({page})=>{
 const url='https://prtimes.jp/main/html/rd/p/000000001.000000001.html';
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');window.shareCalls=[];Object.defineProperty(navigator,'share',{configurable:true,value:async d=>window.shareCalls.push(d.text)});});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items:[{url,title:'ちいかわ 新商品',date:'2026-10-30'}],failed:[],fetchedAt:'2026-10-30T00:00:00Z'}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,item:{url,images:[],facts:[]}}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();
 await page.locator('#otaText').fill('あ'.repeat(130));await expect(page.locator('#otaCount')).toContainText('260 / 280');await page.locator('#otaIncludeLink').check();await expect(page.locator('#otaCount')).toContainText('文字数を超えています');await page.locator('#otaShare').click();expect(await page.evaluate(()=>window.shareCalls)).toEqual([]);await expect(page.locator('#otaText')).toHaveValue('あ'.repeat(130));
 await page.locator('#otaText').fill('あ'.repeat(100));await page.locator('#otaShare').click();expect(await page.evaluate(()=>window.shareCalls.length)).toBe(1);expect(await page.evaluate(()=>window.shareCalls[0])).toContain(url);
 await page.locator('#otaReply').fill('あ'.repeat(141));await expect(page.locator('#otaReplyCount')).toContainText('282 / 280');
});
test('combine four or eight selected article photos and restore the selection',async({page})=>{
 const url='https://prtimes.jp/main/html/rd/p/000000001.000000001.html';const photos=Array.from({length:8},(_,i)=>`https://prcdn.freetls.fastly.net/release_image/1/1/photo${i}.png`);
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');window.shared=[];Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async d=>{window.shared.push((d.files||[]).map(f=>({name:f.name,type:f.type,size:f.size})));}})});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items:[{url,title:'ちいかわ 新商品',date:'2026-10-30'}],failed:[],fetchedAt:'2026-10-30T00:00:00Z'}}));
 await page.route('**/news.php?**',r=>{const action=new URL(r.request().url()).searchParams.get('action');if(action==='image')return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')});return r.fulfill({json:{ok:true,item:{url,images:photos,facts:[]}}})});
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#otaImages img')).toHaveCount(8);await page.locator('#otaText').fill('新商品');await page.locator('#otaCollageMode').check();
 for(let i=1;i<=4;i++)await page.getByLabel(`写真${i}を選択`).check();await expect(page.locator('#otaPhotoStatus')).toContainText('共有用 1枚を準備', {timeout:20000});await expect(page.locator('#otaCollagePreview img')).toHaveCount(1);await page.locator('#otaShare').click();expect((await page.evaluate(()=>window.shared))[0]).toHaveLength(1);for(let i=1;i<=4;i++)await page.getByLabel(`写真${i}を選択`).uncheck();await page.locator('#otaShare').click();expect((await page.evaluate(()=>window.shared))[1]).toHaveLength(0);for(let i=1;i<=4;i++)await page.getByLabel(`写真${i}を選択`).check();
 for(let i=5;i<=8;i++)await page.getByLabel(`写真${i}を選択`).check();await expect(page.locator('#otaPhotoStatus')).toContainText('共有用 2枚を準備', {timeout:20000});await page.locator('#otaShare').click();expect((await page.evaluate(()=>window.shared))[2]).toHaveLength(2);
 await page.locator('#otaBack').click();await page.reload();await page.locator('[data-ota-filter="draft"]').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#otaCollageMode')).toBeChecked();await expect(page.getByLabel('写真8を選択')).toBeChecked();await expect(page.locator('#otaPhotoStatus')).toContainText('共有用 2枚を準備',{timeout:20000});
});
test('manual entry form is absent from otaota news',async({page})=>{
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.goto('/');await page.locator('#accountOta').click();
 await expect(page.locator('#otaManualTitle, #otaManualUrl, #otaManualAdd')).toHaveCount(0);
 await expect(page.locator('#otaList')).toBeVisible();
});

test('filters unrelated fashion candidates while retaining character goods',async({page})=>{
 const items=[{url:'https://prtimes.jp/1',title:'韓国発ベビー・キッズ服ブランド「モイモルン」POP UP STORE'},{url:'https://prtimes.jp/2',title:'THE FRANKIE SHOPが、H BEAUTY&YOUTHにてPOPUPを開催'},{url:'https://prtimes.jp/3',title:'Able Carry POP-UPイベントを開催'},{url:'https://prtimes.jp/4',title:'ちいかわの新作グッズとポップアップ'}];
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items,failed:[],fetchedAt:'2026-11-05T00:00:00Z'}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();
 await expect(page.locator('#otaList')).toContainText('ちいかわ');await expect(page.locator('#otaList')).not.toContainText('モイモルン');await expect(page.locator('#otaList')).not.toContainText('FRANKIE');await expect(page.locator('#otaList')).not.toContainText('Able Carry');
});

test('AI draft uses actual link setting for length checks',async({page})=>{
 const url='https://prtimes.jp/main/html/rd/p/000000001.000000001.html',text='あ'.repeat(130);
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/news.php?**',r=>r.fulfill({json:{ok:true,item:{images:[],facts:[]}}}));
 await page.route('**/otaota.php?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('action')==='draft'?{ok:true,text}:{ok:true,items:[{url,title:'ちいかわ 新商品'}],failed:[],fetchedAt:'2026-11-07T00:00:00Z'}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();
 await page.locator('#otaAi').click();await expect(page.locator('#otaText')).toHaveValue(text);
 await page.locator('#otaText').fill('元の文章');await page.locator('#otaIncludeLink').check();await page.locator('#otaAi').click();await expect(page.locator('#otaText')).toHaveValue('元の文章');await expect(page.locator('#otaEditorStatus')).toContainText('長すぎます');
});

test('excludes game and specified franchise news while retaining character goods',async({page})=>{
 const items=[{url:'https://prtimes.jp/1',title:'11月6日より初展示！ TEKKEN 8 ニーナ フィギュア'},{url:'https://prtimes.jp/2',title:'仮面ライダーカブト エポスカード 誕生'},{url:'https://prtimes.jp/3',title:'ノーゲーム・ノーライフ 白 のフィギュア'},{url:'https://prtimes.jp/4',title:'ポケモンと一緒にスポーツを楽しめるイベント'},{url:'https://prtimes.jp/5',title:'ディズニー新作ぬいぐるみ登場'},{url:'https://prtimes.jp/6',title:'ポケモンの新作ゲームを配信開始'}];
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items,failed:[],fetchedAt:'2026-11-07T00:00:00Z'}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();const list=page.locator('#otaList');await expect(list).toContainText('ポケモンと一緒');await expect(list).toContainText('ディズニー');await expect(list).not.toContainText('TEKKEN');await expect(list).not.toContainText('仮面ライダー');await expect(list).not.toContainText('ノーゲーム');await expect(list).not.toContainText('新作ゲーム');
});

test('supports four topics while preserving saved drafts',async({page})=>{
 const old='https://prtimes.jp/old',items=[{url:'https://prtimes.jp/a',title:'ちいかわ 新作'},{url:'https://prtimes.jp/b',title:'ポケモン 新商品'},{url:'https://prtimes.jp/c',title:'ディズニー 新作'}, {url:'https://prtimes.jp/d',title:'一般記事'}];
 await page.addInitScript(({old})=>{localStorage.setItem('sanrioCloudSyncKey','test-key');localStorage.setItem('otaotaNewsV1',JSON.stringify({[old]:{item:{url:old,title:'別作品 保存済み'},text:'保存された本文'}}));},{old});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items,failed:[],fetchedAt:'2026-11-07T00:00:00Z'}}));await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();let list=page.locator('#otaList');await expect(list).toContainText('ちいかわ');await expect(list).toContainText('ポケモン');await expect(list).toContainText('ディズニー');await expect(list).not.toContainText('一般記事');await page.locator('[data-ota-category="pokemon"]').click();await expect(list).toContainText('ポケモン');await expect(list).not.toContainText('ちいかわ');await page.locator('[data-ota-category="all"]').click();await page.locator('[data-ota-filter="draft"]').click();await expect(list).toContainText('別作品 保存済み');
});

test('filters Disney and San-X topics',async({page})=>{
 const items=[{url:'https://prtimes.jp/1',title:'ディズニー 新作'},{url:'https://prtimes.jp/2',title:'リラックマ 新作'},{url:'https://prtimes.jp/3',title:'すみっコぐらし 新作'},{url:'https://prtimes.jp/4',title:'ちいかわ 新作'}];
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items,failed:[],fetchedAt:'2026-11-07T00:00:00Z'}}));await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();let list=page.locator('#otaList');await page.locator('[data-ota-category="sanx"]').click();await expect(list).toContainText('リラックマ');await expect(list).toContainText('すみっコぐらし');await expect(list).not.toContainText('ディズニー');await page.locator('[data-ota-category="disney"]').click();await expect(list).toContainText('ディズニー');await expect(list).not.toContainText('リラックマ');
});

test('manufacturer source tabs keep candidates separate',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/otaota.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');if(a==='manufacturer_detail')return r.fulfill({json:{ok:true,item:{images:['https://www.bandai.co.jp/candy/published/bnc_files/product/h78/000000486850hk-product-main.jpg'],facts:[]}}});if(a==='draft')return r.fulfill({json:{ok:true,text:'ちいかわの新商品です #ちいかわ'}});if(a==='manufacturer_image')return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')});const item=a==='bandai'?{url:'https://www.bandai.co.jp/candy/products/2026/4570117923098000.html',title:'ちいかわ 缶バッジ',source:'バンダイ',otaTopic:'chiikawa',manufacturer:true,manual:true,thumbnail:'https://www.bandai.co.jp/candy/published/bnc_files/product/h78/000000486850hk-product-main.jpg'}:a==='takara'?{url:'https://www.takaratomy-arts.co.jp/items/item.html?n=Y904455',title:'ディズニー フィギュア',source:'タカラトミーアーツ',otaTopic:'disney',manufacturer:true,manual:true}:{url:'https://prtimes.jp/main/html/rd/p/1.2.html',title:'ポケモン 新商品',source:'PR TIMES'};return r.fulfill({json:{ok:true,items:[item],failed:[],fetchedAt:'2026-11-07T00:00:00Z'}})});
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await expect(page.locator('#otaList')).toContainText('ポケモン');await page.locator('[data-ota-source="bandai"]').click();await expect(page.locator('#otaList')).toContainText('ちいかわ 缶バッジ');await expect(page.locator('#otaList .ota-thumb')).toHaveAttribute('src','https://www.bandai.co.jp/candy/published/bnc_files/product/h78/000000486850hk-product-main.jpg');await expect(page.locator('#otaList')).not.toContainText('ポケモン');await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await expect(page.locator('#otaSource')).toHaveAttribute('href','https://www.bandai.co.jp/candy/products/2026/4570117923098000.html');await expect(page.locator('#otaAi')).toBeEnabled();await expect(page.locator('#otaImages img')).toHaveCount(1);await page.locator('#otaAi').click();await expect(page.locator('#otaText')).toHaveValue('ちいかわの新商品です #ちいかわ');await page.getByLabel('写真1を選択').check();await expect(page.locator('#otaPhotoStatus')).toContainText('準備しました');await page.locator('#otaBack').click();await page.locator('[data-ota-source="takara"]').click();await expect(page.locator('#otaList')).toContainText('ディズニー フィギュア');
});

test('shows acquired and filtered counts and explains an empty status',async({page})=>{
 const url='https://prtimes.jp/main/html/rd/p/1.2.html', item={url,title:'ちいかわ 新作グッズ',source:'PR TIMES'};
 await page.addInitScript(({item})=>{localStorage.setItem('sanrioCloudSyncKey','test-key');localStorage.setItem('otaotaNewsV1',JSON.stringify({[item.url]:{item,state:'done'}}))},{item});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items:[item],fetchedAt:'2026-11-07T00:00:00Z'}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();
 await expect(page.locator('#otaStatus')).toContainText('取得 1件');await expect(page.locator('#otaStatus')).toContainText('現在の条件：0件');await page.getByRole('button',{name:'すべての投稿状況を見る'}).click();await expect(page.locator('#otaList')).toContainText('ちいかわ');await expect(page.locator('#otaStatus')).toContainText('現在の条件：1件');
});
test('retries detail and photo failures without losing the edited draft',async({page})=>{
 const url='https://www.bandai.co.jp/candy/products/2026/4570117923098000.html',photo='https://www.bandai.co.jp/candy/published/a.jpg';let details=0,images=0;
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');if(a==='manufacturer_detail'){details++;return r.fulfill(details===1?{status:500,json:{ok:false,error:'取得失敗'}}:{json:{ok:true,item:{images:[photo],facts:[]}}})}if(a==='manufacturer_image'){images++;return r.fulfill(images===1?{status:500,body:'error'}:{contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=','base64')})}return r.fulfill({json:{ok:true,items:[{url,title:'ちいかわ 新作グッズ',source:'バンダイ',manufacturer:true,manual:true}],fetchedAt:'2026-11-07T00:00:00Z'}})});
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('[data-ota-source="bandai"]').click();await page.locator('#otaList').getByRole('button',{name:'投稿準備'}).click();await page.locator('#otaText').fill('編集中の文章');
 await expect(page.locator('#otaDetailRetry')).toBeVisible();await page.locator('#otaDetailRetry').click();await expect(page.locator('#otaImages img')).toHaveCount(1);await page.getByLabel('写真1を選択').check();await expect(page.locator('#otaPhotoRetry')).toBeVisible();await page.locator('#otaPhotoRetry').click();await expect(page.locator('#otaPhotoStatus')).toContainText('準備しました');await expect(page.locator('#otaText')).toHaveValue('編集中の文章');
});

test('warns about a similar candidate from a previously viewed source without hiding it',async({page})=>{
 const title='ちいかわ きらきらリボンチャームグミ 新発売';
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>{const a=new URL(r.request().url()).searchParams.get('action');const item=a==='bandai'?{url:'https://www.bandai.co.jp/candy/products/2026/1.html',source:'バンダイ',title}:{url:'https://prtimes.jp/main/html/rd/p/1.2.html',source:'PR TIMES',title};return r.fulfill({json:{ok:true,items:[item],fetchedAt:'2026-11-07T00:00:00Z'}})});
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('[data-ota-source="bandai"]').click();await expect(page.locator('#otaList')).toContainText('似た候補があります');await expect(page.locator('#otaList')).toContainText(title);await expect(page.locator('#otaList').getByRole('button',{name:'投稿準備'})).toBeVisible();
});

test('filters opanchu usagi candidates independently',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items:[{url:'https://prtimes.jp/1',title:'おぱんちゅうさぎ 新作ぬいぐるみ',source:'PR TIMES',otaTopic:'opanchu'},{url:'https://prtimes.jp/2',title:'ちいかわ 新作',source:'PR TIMES',otaTopic:'chiikawa'}],failed:[],fetchedAt:'2026-11-07T00:00:00Z'}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('[data-ota-category="opanchu"]').click();await expect(page.locator('#otaList')).toContainText('おぱんちゅうさぎ');await expect(page.locator('#otaList')).not.toContainText('ちいかわ');
});

test('filters Pingu candidates independently',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sanrioCloudSyncKey','test-key'));await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));
 await page.route('**/otaota.php?**',r=>r.fulfill({json:{ok:true,items:[{url:'https://prtimes.jp/1',title:'ピングー 新作ぬいぐるみ',source:'PR TIMES',otaTopic:'pingu'},{url:'https://prtimes.jp/2',title:'Pingu 新作',source:'PR TIMES',otaTopic:'pingu'},{url:'https://prtimes.jp/3',title:'ちいかわ 新作',source:'PR TIMES',otaTopic:'chiikawa'}],failed:[],fetchedAt:'2026-11-07T00:00:00Z'}}));
 await page.goto('/');await page.locator('#accountOta').click();await page.locator('#otaRefresh').click();await page.locator('[data-ota-category="pingu"]').click();await expect(page.locator('#otaList')).toContainText('ピングー');await expect(page.locator('#otaList')).toContainText('Pingu');await expect(page.locator('#otaList')).not.toContainText('ちいかわ');
});
