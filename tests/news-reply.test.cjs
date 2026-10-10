const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('news.js','utf8'),ctx={};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function newsSplitReply'),source.indexOf('function newsReadSeen')),ctx);
const item={url:'https://www.sanrio.co.jp/news/goods/test/'};
const entry={item,text:'🎀 本文\n\n🔎 詳細：\n'+item.url+'\n\n#サンリオ'};
ctx.newsSetupReply(entry);assert.equal(entry.text,'🎀 本文\n\n#サンリオ');assert.equal(entry.replyText,'🔎 詳細はこちら\n'+item.url);assert.equal(entry.includeLink,false);
entry.replyText='公式を確認\n'+item.url;ctx.newsApplyGenerated(entry,'💜 AI本文\n\n🔎 詳細はこちら\n'+item.url+'\n\n#サンリオ');assert.equal(entry.text,'💜 AI本文\n\n#サンリオ');assert.equal(entry.replyText,'公式を確認\n'+item.url);
entry.includeLink=true;ctx.newsApplyGenerated(entry,'💜 次の本文\n\n🔎 詳細：\n'+item.url);assert.equal(entry.text,'💜 次の本文\n\n公式を確認\n'+item.url);ctx.newsSetupReply(entry);assert.equal(entry.includeLink,true);
assert.equal(ctx.newsSplitReply('手動リンク https://example.com/',item).text,'手動リンク https://example.com/');
console.log('Reply split, migration, custom reply preservation and generated inclusion passed');
