/* Portable candidate data only; never export authentication or connection settings. */
const candidateBackup=(()=>{
 'use strict';
 const arrays=new Set(['sphAmazonScoutCandidatesV1','sphCompetitorObservationsV1']);
 const objects=new Set(['sphDomesticEvidenceV1','sphLovelyDiscoveryV1','sphRakutenFlowShortLinksV1']);
 const keys=[...arrays,...objects];
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 function validate(key,value){
  if(arrays.has(key)?!Array.isArray(value)||value.some(r=>!object(r)||typeof r.id!=='string'):!object(value))throw new Error('候補バックアップの形式を確認してください。');
  function check(v,depth=0){if(depth>40)throw new Error('候補バックアップが複雑すぎます。');if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('候補バックアップの項目が不正です。');check(v[k],depth+1);}}}
  check(value);return value;
 }
 function collect(storage=localStorage){const result={};for(const key of keys){const raw=storage.getItem(key);if(raw!==null)result[key]=validate(key,JSON.parse(raw));}return result;}
 // Existing values win conflicts: restore must not replace edited text, links or usage marks.
 function merge(current,incoming){if(object(current)&&object(incoming)){const out={...incoming};for(const k of Object.keys(current))out[k]=k in incoming?merge(current[k],incoming[k]):current[k];return out;}return current;}
 function prepare(data,storage=localStorage){
  if(data===undefined)return {apply(){},rollback(){}};
  if(!object(data)||Object.keys(data).some(k=>!keys.includes(k)))throw new Error('候補バックアップの項目が不正です。');
  const changes=Object.entries(data).map(([key,value])=>{validate(key,value);const previous=storage.getItem(key);let next=value;
   if(previous!==null){const current=validate(key,JSON.parse(previous));if(arrays.has(key)){const map=new Map(value.map(r=>[r.id,r]));for(const r of current)map.set(r.id,r);next=[...map.values()];}else next=merge(current,value);}
   return {key,previous,next:JSON.stringify(next)};
  });
  let applied=[];
  function rollback(){for(const c of applied.reverse()){if(c.previous===null)storage.removeItem(c.key);else storage.setItem(c.key,c.previous);}applied=[];}
  return {apply(){try{for(const c of changes){storage.setItem(c.key,c.next);applied.push(c);}}catch(e){rollback();throw e;}},rollback};
 }
 return {collect,prepare};
})();
if(typeof module!=='undefined')module.exports=candidateBackup;
