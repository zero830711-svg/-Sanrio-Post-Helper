const {test,expect}=require('@playwright/test');
const backup=require('../candidate-backup.js');
const memory=initial=>{const m=new Map(Object.entries(initial));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('候補バックアップに認証を含めず、既存の本文・リンク・状態を保持して復元する',()=>{
 const original={id:'one',body:'編集済み',affiliateUrl:'https://www.amazon.co.jp/s?k=kitty&tag=original-22',status:'見送り'};
 const s=memory({sphAmazonScoutCandidatesV1:JSON.stringify([original]),sanrioCloudSyncKey:'private',sphCompetitorObservationsV1:'[{"id":"123","likes":0}]'});
 const data=backup.collect(s);expect(JSON.stringify(data)).not.toContain('private');expect(data.sphCompetitorObservationsV1[0].likes).toBe(0);
 const incoming={sphAmazonScoutCandidatesV1:[{...original,body:'古い本文',affiliateUrl:'changed',status:'未投稿'},{id:'two',body:'追加'}],sphDomesticEvidenceV1:{a:{price:'100円'}}};
 backup.prepare(incoming,s).apply();expect(JSON.parse(s.getItem('sphAmazonScoutCandidatesV1'))).toEqual([original,{id:'two',body:'追加'}]);
 expect(()=>backup.prepare({sanrioCloudSyncKey:'bad'},s)).toThrow();expect(()=>backup.prepare({sphDomesticEvidenceV1:JSON.parse('{"__proto__":{}}')},s)).toThrow();
 backup.prepare(undefined,s).apply();expect(s.getItem('sanrioCloudSyncKey')).toBe('private');
});
test('保存容量不足なら候補の部分復元を巻き戻し、不正形式を事前に拒否する',()=>{
 const s=memory({sphAmazonScoutCandidatesV1:'[]'}),set=s.setItem;s.setItem=(k,v)=>{if(k==='sphDomesticEvidenceV1')throw new Error('quota');set(k,v);};
 expect(()=>backup.prepare({sphAmazonScoutCandidatesV1:[{id:'one'}],sphDomesticEvidenceV1:{}},s).apply()).toThrow('quota');expect(s.getItem('sphAmazonScoutCandidatesV1')).toBe('[]');
 expect(()=>backup.prepare({sphAmazonScoutCandidatesV1:{}},s)).toThrow();
});
test('iPhoneで候補を含むバックアップを復元し、競合UIを表示せず保存資料を維持する',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sanrioCloudSyncKey','test-key');localStorage.setItem('sphCompetitorObservationsV1','[{"id":"old","likes":1}]');});
 await page.route('**/api2580.php?**',r=>r.fulfill({json:{ok:true,items:[]}}));await page.route('**/archive-media-batch.php?**',r=>r.fulfill({json:{ok:true,items:[],manifest:[],stats:{}}}));
 let competitorCalls=0;page.on('request',r=>{if(r.url().includes('competitor.php'))competitorCalls++;});
 await page.goto('/');expect(await page.locator('#homeCompetitorTab').count()).toBe(0);expect(await page.locator('#competitorPanel').count()).toBe(0);
 page.on('dialog',d=>d.accept());
 // The input can accept a file while its management panel is collapsed.
 const data={version:2,items:[],candidateData:{sphAmazonScoutCandidatesV1:[{id:'new',title:'復元したキティ',body:'元の本文',itemUrl:'https://www.amazon.co.jp/s?k=kitty&tag=original-22',status:'見送り'}],sphDomesticEvidenceV1:{},sphCompetitorObservationsV1:[{id:'new-observation',likes:0}]}};
 await page.locator('#importBackup').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sphAmazonScoutCandidatesV1')||'[]').length)).toBe(1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sphCompetitorObservationsV1')).length)).toBe(2);expect(competitorCalls).toBe(0);
});
