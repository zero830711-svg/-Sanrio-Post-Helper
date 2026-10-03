const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('news.js','utf8');
const code=source.slice(source.indexOf('async function newsAiPost('),source.indexOf('async function newsAiAdjust('));
async function run(statuses,{switchDuringWait=false}={}){
 const delays=[],timeouts=[],status={textContent:''};let calls=0;
 const ctx={newsState:{seq:1},cloudSettings:()=>({key:'test'}),newsApiUrl:()=>'/news.php',$:()=>status,AbortSignal:{timeout:n=>{timeouts.push(n);return undefined;}},setTimeout:fn=>fn(),fetch:async()=>{const s=statuses[Math.min(calls++,statuses.length-1)];return {ok:s===200,json:async()=>s===200?{ok:true,text:'AI文'}:{ok:false,error:'test error',retryable:s===503}};}};
 ctx.setTimeout=(fn,n)=>{delays.push(n);if(switchDuringWait)ctx.newsState.seq=2;fn();};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 let error;try{await ctx.newsAiDraftWithRetry({item:{url:'test'}},1);}catch(e){error=e;}
 return {calls,delays,timeouts,error};
}
(async()=>{
 let r=await run([503,503,200]);assert.equal(r.calls,3);assert.deepEqual(r.delays,[3000,6000]);assert.equal(r.error,undefined);assert.ok(r.timeouts.every(n=>n===85000));
 r=await run([503]);assert.equal(r.calls,3);assert.ok(r.error);
 for(const s of [400,401,402,403,429,500]){r=await run([s]);assert.equal(r.calls,1);assert.deepEqual(r.delays,[]);}
 r=await run([503],{switchDuringWait:true});assert.equal(r.calls,1);assert.ok(r.error);
 console.log('Retry cap, backoff, non-retryable errors, navigation cancellation and timeout passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
