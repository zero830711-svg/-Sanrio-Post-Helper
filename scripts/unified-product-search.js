(function(){
async function init(){
 var root=document.querySelector('.sf-unified-directory');if(!root)return;
 var source=root.querySelector('#sf-unified-search-data'),payload=source.textContent;
 if(source.dataset.encoding==='gzip-base64'){
  var bytes=Uint8Array.from(atob(payload.trim()),function(char){return char.charCodeAt(0);});
  payload=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 }
 var data=JSON.parse(payload);
 var search=root.querySelector('[data-sf-search]'),character=root.querySelector('[data-sf-character]'),kind=root.querySelector('[data-sf-kind]'),type=root.querySelector('[data-sf-type]');
 var sort=root.querySelector('[data-sf-sort]'),sortNote=root.querySelector('[data-sf-sort-note]');
 var results=root.querySelector('[data-sf-results]'),count=root.querySelector('[data-sf-count]'),more=root.querySelector('[data-sf-load-more]'),empty=root.querySelector('[data-sf-empty]'),links=root.querySelector('[data-sf-character-links]');
 var limit=48,matches=[];
 function norm(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('ja');}
 function node(tag,text,cls){var el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;}
 function button(label,url,cls){var a=node('a',label,'sf-search-button '+cls);a.href=url;a.target='_blank';a.rel='sponsored nofollow noopener';return a;}
 function card(item){
  var el=node('article');el.className='sf-directory-card';el.dataset.itemId=item.id;el.dataset.type=item.type;
  el.appendChild(node('span',item.type==='guide'?'商品ガイド':(item.type==='product'?'写真付き商品':'通販検索候補'),'sf-search-badge'));
  if(item.image){var img=node('img');img.src=item.image;img.alt=item.title;img.loading='lazy';img.decoding='async';el.appendChild(img);}
  var title=node('strong',item.title.length>80?item.title.slice(0,80)+'…':item.title);title.title=item.title;el.appendChild(title);
  if(item.shop)el.appendChild(node('small',item.shop));
  if(item.addedAt){var added=node('small','掲載日：'+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.addedAt)));el.appendChild(added);}
  if(item.url){var detail=node('a','商品ガイド・仕様を見る →');detail.href=item.url;el.appendChild(detail);}
  var amazon=item.amazon;if(item.type==='product'){var target=new URL('https://www.amazon.co.jp/s');target.searchParams.set('k',item.amazonQuery||item.title);target.searchParams.set('tag',data.amazonTag);amazon=target.href;}
  var buy=node('div','','sf-search-buy');if(amazon)buy.appendChild(button('Amazonで探す',amazon,'sf-search-amazon'));if(item.rakuten)buy.appendChild(button(item.type==='product'?'楽天で見る':'楽天で探す',item.rakuten,'sf-search-rakuten'));el.appendChild(buy);return el;
 }
 function show(){
  var q=norm(search.value).trim().split(/\s+/).filter(Boolean);
  matches=data.items.filter(function(item){if(character.value)if(item.characters.indexOf(character.value)===-1)return false;if(kind.value)if(item.kind!==kind.value)return false;if(type.value)if(item.type!==type.value)return false;var text=norm((item.search||'')+' '+item.title+' '+(item.shop||''));return q.every(function(term){return text.indexOf(term)!==-1;});});
  if(sort.value==='recent')matches.sort(function(a,b){return (Date.parse(b.addedAt)||0)-(Date.parse(a.addedAt)||0);});sortNote.hidden=sort.value!=='recent';
  var fragment=document.createDocumentFragment();matches.slice(0,limit).forEach(function(item){fragment.appendChild(card(item));});results.replaceChildren(fragment);
  var photos=matches.filter(function(x){return x.type==='product';}).length,guides=matches.filter(function(x){return x.type==='guide';}).length,candidates=matches.length-photos-guides;
  count.textContent=matches.length+'件中 '+Math.min(limit,matches.length)+'件を表示（写真付き商品 '+photos+'件・商品ガイド '+guides+'件'+(candidates?'・通販検索候補 '+candidates+'件':'')+'）';
  empty.hidden=matches.length!==0;more.hidden=matches.length<=limit;more.textContent='次の48件を表示（残り'+Math.max(0,matches.length-limit)+'件）';
  links.replaceChildren();var selected=data.characters.find(function(x){return x.key===character.value;});links.hidden=!selected;if(selected){var a=node('a',selected.name+'のキャラクター別商品一覧へ →');a.href=selected.url;links.appendChild(a);}
 }
 function resetLimit(){limit=48;show();}
 search.addEventListener('input',resetLimit);character.addEventListener('change',resetLimit);kind.addEventListener('change',resetLimit);type.addEventListener('change',resetLimit);
 sort.addEventListener('change',resetLimit);
 more.addEventListener('click',function(){limit+=48;show();});
 root.querySelector('[data-sf-reset]').addEventListener('click',function(){search.value='';character.value='';kind.value='';type.value='';sort.value='standard';resetLimit();search.focus();});
 var params=new URLSearchParams(location.search),initial=params.get('character')||'';initial=({'mymelody':'my-melody','hellokitty':'hello-kitty'})[initial]||initial;
 if(Array.from(character.options).some(function(x){return x.value===initial;}))character.value=initial;search.value=params.get('q')||'';if(Array.from(kind.options).some(function(x){return x.value===params.get('kind');}))kind.value=params.get('kind');if(params.get('type')==='product')type.value='product';if(params.get('sort')==='recent')sort.value='recent';show();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
