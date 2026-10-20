(function(){
 if(window.sfProductPositionsReady)return;window.sfProductPositionsReady=true;
 function locate(){
  if(!/^#sf-product-[a-f0-9]{16}$/.test(location.hash))return;
  var target=document.getElementById(location.hash.slice(1));if(!target)return;
  var group=target.closest('.sf-character-product-guides');
  var filter=group&&group.querySelector('[data-sf-catalog-category]');
  if(filter&&target.hidden){filter.value='';filter.dispatchEvent(new Event('change',{bubbles:true}));}
  requestAnimationFrame(function(){target.scrollIntoView({block:'start'});});
 }
 document.addEventListener('click',async function(event){
  var link=event.target.closest('.sf-product-position');if(!link)return;
  event.preventDefault();var url=new URL(link.getAttribute('href'),location.href).href;
  history.replaceState(null,'',link.getAttribute('href'));locate();
  try{
   if(navigator.share)await navigator.share({url:url});
   else if(navigator.clipboard){await navigator.clipboard.writeText(url);link.textContent='リンクをコピーしました';setTimeout(function(){link.textContent='商品リンクを共有';},2000);}
   else location.hash=link.getAttribute('href');
  }catch(error){if(error.name!=='AbortError')location.hash=link.getAttribute('href');}
 });
 window.addEventListener('hashchange',locate);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(locate,0);});else locate();
})();
