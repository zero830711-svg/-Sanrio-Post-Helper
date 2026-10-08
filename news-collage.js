// Use downloaded originals; contain each image without cropping or changing it.
async function newsCollageFiles(files){
 const output=[];
 for(let start=0;start<files.length;start+=4){
  const group=files.slice(start,start+4);if(group.length===1){output.push(group[0]);continue;}
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=Math.ceil(group.length/2)*800;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('画像をまとめられませんでした。');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<group.length;i++){
   const url=URL.createObjectURL(group[i]);const img=new Image();
   try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('写真を読み込めませんでした。'));img.src=url;});
    const scale=Math.min(784/img.naturalWidth,784/img.naturalHeight);const width=img.naturalWidth*scale,height=img.naturalHeight*scale;
    ctx.drawImage(img,(i%2)*800+(800-width)/2,Math.floor(i/2)*800+(800-height)/2,width,height);
   }finally{URL.revokeObjectURL(url);}
  }
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNGを作れませんでした。')),'image/png'));
  output.push(new File([blob],'news-collage-'+(Math.floor(start/4)+1)+'.png',{type:'image/png'}));canvas.width=canvas.height=0;
 }
 return output;
}
