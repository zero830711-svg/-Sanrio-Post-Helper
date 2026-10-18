const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context={window:{},document:{addEventListener(){}},URL};
vm.runInNewContext(fs.readFileSync('blog-export.js','utf8'),context);
const payload=context.window.SPHBlogExport.payload;
test('secrets and generated social text are not exported',()=>{
 const out=payload({key:'SECRET',body:'AI TEXT',identity:{jan:'4973307730078',model:'KNBH1'},item:{title:'ポチャッコ',url:'https://example.com/product',paragraphs:['仕様'],images:[]}},'https://a.r10.to/hTEST');
 assert(!JSON.stringify(out).includes('SECRET'));assert(!JSON.stringify(out).includes('AI TEXT'));assert.equal(out.jan,'4973307730078');assert.equal(out.affiliate,'https://a.r10.to/hTEST');
});
test('unsafe URLs are rejected',()=>{
 const out=payload({item:{title:'test',url:'javascript:alert(1)',images:['https://example.com/img.jpg','javascript:bad'],paragraphs:[]}},'https://user:pass@example.com/');
 assert.equal(out.source,'');assert.equal(out.affiliate,'');assert.equal(out.images.length,1);
});
test('size limits bound untrusted product data',()=>{
 const out=payload({item:{title:'a'.repeat(1000),url:'https://example.com',paragraphs:Array(50).fill('a'.repeat(4000))}},'');
 assert.equal(out.title.length,300);assert.equal(out.facts.length,15);assert.equal(out.facts[0].length,3000);
});
test('only selected images are exported and character is recognized',()=>{
 const out=payload({selected:[1],item:{title:'クロミ ミラー',url:'https://example.com',images:['https://example.com/a.jpg','https://example.com/b.jpg']}},'');
 assert.equal(out.images.length,1);assert.equal(out.images[0],'https://example.com/b.jpg');assert.equal(out.character,'クロミ');
});
