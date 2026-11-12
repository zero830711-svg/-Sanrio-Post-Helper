const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('news.js','utf8'),store=new Map();
const notice={hidden:true,textContent:'',classList:{toggle(name,on){this[name]=on;}}};
const fields={instagramAccountFilter:{value:'all'},instagramRegionFilter:{value:'all'},instagramSearch:{value:''},newsEditorStatus:{textContent:''},newsActionNotice:notice};
const context={URL,Date,Set,Map,JSON,Array,Math,console,clearTimeout:()=>{},setTimeout:()=>1,window:{scrollTo:()=>{}},$:id=>fields[id]||null,localStorage:{setItem:(k,v)=>store.set(k,v)},newsState:{items:[],marks:{},drafts:new Map(),instagramAccounts:[],item:null},instagramRegion:()=>'',instagramSearchText:s=>String(s).toLowerCase(),newsRender:()=>{context.renders++;context.newsGroups();},newsSaveDrafts:()=>{context.draftSaves++;},renders:0,draftSaves:0,calls:0};
vm.createContext(context);
vm.runInContext(code.slice(0,code.indexOf('function newsStorageKey')),context);
vm.runInContext(code.slice(code.indexOf('function newsScheduleLabel'),code.indexOf('function newsSourceLinks')),context);
vm.runInContext(code.slice(code.indexOf('let newsMarkNoticeTimer'),code.indexOf('async function newsLoad')),context);
vm.runInContext('const originalSameStory=newsSameStory;newsSameStory=(...args)=>{calls++;return originalSameStory(...args)};',context);
(async()=>{
const first={url:'https://www.sanrio.co.jp/news/goods/skip-one/',title:'サンリオ新作バッグ 第1弾',source:'サンリオ公式',date:'2026-11-11'};
const duplicate={...first,url:'https://prtimes.jp/main/html/rd/p/1.2.html',source:'PR TIMES'};
context.newsState.items=[first,duplicate,...Array.from({length:95},(_,i)=>({...first,url:'https://www.sanrio.co.jp/news/goods/item-'+i+'/',title:'サンリオ新作バッグ 第'+(i+2)+'弾'}))];
let groups=context.newsGroups(),comparisons=context.calls;assert.equal(groups.find(g=>g.url===first.url).members.length,2);assert.ok(comparisons>0);assert.equal(context.newsGroups(),groups);assert.equal(context.calls,comparisons);
assert.equal(await context.newsMark(first.url,'skip'),true);assert.equal(context.newsState.marks[first.url].kind,'skip');assert.equal(context.newsState.marks[duplicate.url].kind,'skip');assert.equal(JSON.parse(store.get('sanrioNewsMarks'))[first.url].kind,'skip');assert.equal(context.calls,comparisons,'mark and rerender should reuse groups');assert.equal(context.draftSaves,0,'unrelated drafts are not rewritten');assert.equal(notice.textContent,'見送りました');assert.equal(notice.hidden,false);
assert.equal(await context.newsMark(first.url,null),true);assert.equal(context.newsState.marks[first.url],undefined);assert.equal(context.newsState.marks[duplicate.url],undefined);assert.equal(notice.textContent,'一覧に戻しました');
const draft={item:first,text:'保持する下書き'};context.newsState.drafts.set(first.url,draft);context.localStorage.setItem=()=>{throw new Error('quota')};assert.equal(await context.newsMark(first.url,'skip'),false);assert.equal(context.newsState.marks[first.url],undefined);assert.equal(context.newsState.drafts.get(first.url),draft);assert.match(notice.textContent,/保存できませんでした/);assert.equal(notice.classList['is-error'],true);
context.newsState.items=context.newsState.items.slice();context.newsGroups();assert.ok(context.calls>comparisons,'new data should rebuild groups');
let fallback;
context.newsMarkDatabase=async marks=>{if(marks!==undefined)fallback=JSON.parse(JSON.stringify(marks));return fallback;};
assert.equal(await context.newsMark(first.url,'done'),true);
assert.equal(fallback[first.url].kind,'done');assert.equal(notice.textContent,'投稿済みにしました');
await vm.runInContext('newsMarkReady=undefined;newsMarkFallback=false;newsState.marks={};newsRestoreMarks()',context);
assert.equal(context.newsState.marks[first.url].kind,'done');
assert.equal(await context.newsMark(first.url,null),true);assert.equal(fallback[first.url],undefined);
console.log('News skip: grouped marks, cached grouping, restore, quota failure and draft preservation passed');

})().catch(error=>{console.error(error);process.exitCode=1;});
