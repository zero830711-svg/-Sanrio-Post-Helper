/* Local archive metrics only. No AI calls and no reuse of old product facts. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.newProductRanking=api;
})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  const types=[
    ['水筒',/水筒|ステン(?:レス)?(?:ボトル|マグ)|ステンマグ|タンブラー|ウォーターボトル/i],
    ['弁当箱',/弁当箱|ランチボックス|シール(?:容器|ボックス)/i],
    ['カトラリー',/カトラリー|箸|お箸|スプーン|フォーク|コンビセット|トリオセット/i],
    ['スマホ用品',/iPhone|スマホ|スマートフォン|MagSafe|モバイルバッテリー|充電器/i],
    ['ぬいぐるみ',/ぬいぐるみ|ぬい|マスコット/i],
    ['キーホルダー',/キーホルダー|キーリング|キーチェーン|チャーム/i],
    ['ポーチ',/ポーチ/i],['バッグ',/バッグ|トート|リュック|エコバッグ/i],
    ['タオル',/タオル|ハンカチ/i],['文具',/文具|ノート|ペンケース|ボールペン|シャープペン|付箋|ステッカー|シール/i],
    ['食器',/マグカップ|コップ|プレート|食器|お皿/i],['衣類',/Tシャツ|パジャマ|ルームウェア|靴下|ソックス/i]
  ];
  const number=v=>Number.isFinite(Number(String(v??'').replace(/,/g,'')))?Math.max(0,Number(String(v??'').replace(/,/g,''))):0;
  const median=values=>{const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length?(a.length%2?a[m]:(a[m-1]+a[m])/2):0;};
  function theme(item,characters){
    const text=String(item.title||item.text||'').normalize('NFKC').replace(/https?:\/\/\S+/g,'');
    const chars=characters.filter(c=>c.re.test(text)).map(c=>c.key);
    // Charmmy Kitty also contains Kitty; prefer the more specific identity.
    if(chars.includes('チャーミーキティ'))chars.splice(chars.indexOf('キティ'),chars.includes('キティ')?1:0);
    const category=types.find(([,re])=>re.test(text));
    return chars.length===1&&category?{key:chars[0]+'|'+category[0],label:chars[0]+'×'+category[0]}:null;
  }
  function build(history,characters){
    const unique=new Map();
    for(const post of history){
      if(post.deletedAt||post.deleted||post.isDeleted)continue;
      const id=String(post.postId||post.id||post.text||'');if(!id)continue;
      const old=unique.get(id);if(!old||number(post.impressions)>number(old.impressions))unique.set(id,post);
    }
    const samples=[...unique.values()].filter(p=>number(p.impressions)>=1000).map(p=>{
      const impressions=number(p.impressions);return {theme:theme(p,characters),click:Math.min(.2,number(p.urlClicks)/impressions),response:Math.min(.1,(number(p.bookmarks)+number(p.reposts))/impressions)};
    });
    const model=new Map();if(samples.length<6)return model;
    const baseline={click:Math.max(.001,median(samples.map(p=>p.click))),response:Math.max(.0005,median(samples.map(p=>p.response)))};
    const groups=new Map();for(const sample of samples){if(!sample.theme)continue;const key=sample.theme.key;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(sample);}
    for(const [key,group] of groups){
      if(group.length<3)continue;
      const confidence=group.length/(group.length+5);
      const click=1+(median(group.map(p=>p.click))/baseline.click-1)*confidence;
      const response=1+(median(group.map(p=>p.response))/baseline.response-1)*confidence;
      const score=.65*Math.min(4,click)+.35*Math.min(4,response);
      if(score<=1.15)continue;
      const metric=click>=response?'クリック':'保存・リポスト';
      model.set(key,{score,reason:group[0].theme.label+'：過去'+group.length+'投稿で'+metric+'率が全体より高め'});
    }
    return model;
  }
  function rank(groups,model,characters){
    const rated=groups.map((group,index)=>{const t=theme(group.item,characters),match=t&&model.get(t.key);return {...group,rankingScore:match?.score||0,rankingReason:match?.reason||'',rankingIndex:index};});
    const preferred=rated.filter(g=>g.rankingScore).sort((a,b)=>b.rankingScore-a.rankingScore||a.rankingIndex-b.rankingIndex);
    const unexplored=rated.filter(g=>!g.rankingScore),result=[];
    while(preferred.length||unexplored.length){const explore=(result.length+1)%4===0;result.push((explore&&unexplored.length||!preferred.length?unexplored:preferred).shift());}
    return result;
  }
  return {theme,build,rank};
});
