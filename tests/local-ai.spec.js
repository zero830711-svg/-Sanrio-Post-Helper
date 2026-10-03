const {test,expect}=require('@playwright/test');
test('WebGPU非対応ではモデルを取得せず理由を表示する',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 await page.goto('/local-ai-test.html');await expect(page.locator('#support')).toContainText('WebGPUが使えません');await expect(page.locator('#load')).toBeDisabled();await expect(page.locator('#generate')).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('試作の測定・2回目生成・失敗からの復帰を検証する（AI速度測定ではない）',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>({})},configurable:true});
  window.Worker=class{
   postMessage(d){setTimeout(()=>{
    if(d.action==='load')return this.onmessage({data:{id:d.id,type:'loaded'}});
    window.testMessages=d.messages;
    if(window.failLocalAi)return this.onmessage({data:{id:d.id,type:'error',text:'GPUメモリ不足'}});
    this.onmessage({data:{id:d.id,type:'chunk',text:'🎀 ウサハナ'}});
    this.onmessage({data:{id:d.id,type:'done',text:'🎀 ウサハナ フェイスポーチ ✨ 三角マチ付きです。',tokens:30}});
   },20);}
   terminate(){}
  };
 });
 await page.goto('/local-ai-test.html');await page.locator('#load').click();await expect(page.locator('#generate')).toBeEnabled();
 await page.locator('#generate').click();await expect(page.locator('#output')).toHaveValue(/ウサハナ/);await expect(page.locator('#report')).toContainText('生成秒');await expect(page.locator('#report')).toContainText('Qwen2.5-0.5B');await expect(page.locator('#checks')).toContainText('目視');
 await page.locator('#generate').click();await expect(page.locator('#report')).toContainText('"回": 2');
 const messages=await page.evaluate(()=>window.testMessages);expect(messages[0].content).toContain('素材は書かない');expect(messages[1].content).toContain('価格・発売日・販売状況：未確認');
 await page.evaluate(()=>window.failLocalAi=true);await page.locator('#generate').click();await expect(page.locator('#status')).toContainText('GPUメモリ不足');await expect(page.locator('#generate')).toBeDisabled();await expect(page.locator('#load')).toBeEnabled();
 await page.locator('#load').click();await expect(page.locator('#generate')).toBeEnabled();
});

test('53％の準備中は日本語で説明し、完了後に生成ボタンが使える',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>({})},configurable:true});
  window.Worker=class{postMessage(d){window.finishLoad=()=>this.onmessage({data:{id:d.id,type:'loaded'}});setTimeout(()=>this.onmessage({data:{id:d.id,type:'progress',text:'Fetching param cache[4/8]: 141MB fetched. 53% completed'}}),10);}terminate(){}};
 });
 await page.goto('/local-ai-test.html');await page.locator('#load').click();
 await expect(page.locator('#generate')).toBeDisabled();await expect(page.locator('#generate')).toHaveText('AI準備中（53%）');await expect(page.locator('#status')).toContainText('141MB取得済み');await expect(page.locator('#status')).toContainText('準備が終わると');await expect(page.locator('#status')).not.toContainText('Fetching');
 await page.evaluate(()=>window.finishLoad());await expect(page.locator('#generate')).toBeEnabled();await expect(page.locator('#generate')).toHaveText('投稿文を生成して測定');
});
