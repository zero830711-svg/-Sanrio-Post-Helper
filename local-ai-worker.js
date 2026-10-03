import {CreateMLCEngine} from 'https://esm.run/@mlc-ai/web-llm@0.2.79';
let engine;
self.onmessage=async({data})=>{
 const {id,action,model,messages}=data;
 try{
  if(action==='load'){
   engine=await CreateMLCEngine(model,{initProgressCallback:p=>self.postMessage({id,type:'progress',text:p.text})},{context_window_size:2048});
   self.postMessage({id,type:'loaded'});
  }else if(action==='generate'){
   if(!engine)throw Error('AIを読み込んでください。');
   await engine.resetChat();
   const chunks=await engine.chat.completions.create({messages,stream:true,stream_options:{include_usage:true},temperature:0.3,max_tokens:300});
   let text='',tokens=0;
   for await(const c of chunks){text+=c.choices?.[0]?.delta?.content||'';tokens=c.usage?.completion_tokens||tokens;self.postMessage({id,type:'chunk',text});}
   self.postMessage({id,type:'done',text,tokens});
  }
 }catch(e){self.postMessage({id,type:'error',text:e.message||String(e)});}
};
