/* Opaque encrypted v1 storage. Authentication stays in the same-origin HttpOnly cookie. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudProfileCloud=api;})(globalThis,function(root){
  'use strict';
  const MAX_RESPONSE=1050000;
  function problem(code,message){const error=Error(message);error.code=code;return error;}
  const cancelled=()=>new DOMException('Перенос отменён.','AbortError');
  const ownerID=value=>Number.isSafeInteger(value)&&value>0&&String(value).length<=15?value:null;
  const clone=value=>structuredClone(value);
  function create({owner,crypto=root.LolzCloudProfileCrypto,fetcher=(...args)=>root.fetch(...args)}={}){
    if(typeof owner!=='function')throw TypeError('An account owner accessor is required.');
    let epoch=0,active=null;const records=new WeakMap();
    function current(snapshot){const row=snapshot&&records.get(snapshot);return!!row&&row.epoch===epoch&&row.owner===ownerID(owner());}
    function cancel(){epoch++;active?.controller.abort();active=null;}
    async function request(path,ctx,{method='GET',body,csrf}={}){
      ctx.check();const controller=new AbortController(),abort=()=>controller.abort();ctx.signal.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,12000);let reader;
      try{
        if(ctx.signal.aborted)throw cancelled();
        const response=await fetcher(path,{method,credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
        ctx.check();
        if(!response.ok){const messages={401:['AUTH','Войди в аккаунт, чтобы открыть облачную копию.'],403:['AUTH','Вход изменился. Обнови аккаунт и повтори перенос.'],409:['CONFLICT','Облачная копия уже изменилась на другом устройстве. Открой её заново перед сохранением.'],429:['RATE','Слишком много запросов. Подожди немного и повтори.']},entry=messages[response.status]||['SERVICE','Не удалось связаться с облаком. Повтори попытку.'];throw problem(...entry);}
        const limit=path==='/api/session'?131072:MAX_RESPONSE,length=Number(response.headers.get('content-length'));
        if(response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')||Number.isFinite(length)&&length>limit)throw problem('FORMAT','Облако вернуло неверный ответ.');
        if(!response.body?.getReader)throw problem('FORMAT','Облако вернуло пустой ответ.');
        reader=response.body.getReader();const chunks=[];let size=0;
        for(;;){ctx.check();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw problem('SIZE','Облачная копия превышает допустимый размер.');}chunks.push(part.value);}
        ctx.check();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw problem('FORMAT','Облако вернуло неверный ответ.');}
        if(!value||typeof value!=='object'||Array.isArray(value))throw problem('FORMAT','Облако вернуло неверный ответ.');return value;
      }catch(error){ctx.check();if(controller.signal.aborted)throw problem('TIMEOUT','Облако не ответило вовремя. Повтори попытку.');throw error;}
      finally{clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);reader?.releaseLock();}
    }
    async function session(ctx){const value=await request('/api/session',ctx);if(value.authenticated!==true||ownerID(value.user?.id)!==ctx.owner||typeof value.csrf!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.csrf))throw problem('AUTH','Аккаунт изменился. Обнови вход и повтори перенос.');return value;}
    async function stored(ctx){const value=await request('/api/profile',ctx);if(ownerID(value.ownerId)!==ctx.owner)throw problem('OWNER','Аккаунт облачной копии изменился. Открой её заново.');if(!Number.isSafeInteger(value.revision)||value.revision<0||value.envelope!==null&&(!value.envelope||typeof value.envelope!=='object'||Array.isArray(value.envelope))||value.updatedAt!==null&&(!Number.isFinite(value.updatedAt)||value.updatedAt<0)||value.revision===0&&value.envelope!==null||value.revision>0&&value.envelope===null)throw problem('FORMAT','Облачная копия имеет неверный формат.');return value;}
    function proof(ctx,value,profile){const result=Object.freeze({ownerId:ctx.owner,revision:value.revision,updatedAt:value.updatedAt,empty:profile===null,profile:clone(profile)});records.set(result,{owner:ctx.owner,epoch:ctx.epoch,revision:value.revision,profile:clone(profile)});return result;}
    async function run(action,{signal,onProgress}={}){
      if(active)throw problem('BUSY','Дождись окончания переноса профиля.');
      if(signal?.aborted)throw cancelled();const id=ownerID(owner());if(!id)throw problem('AUTH','Войди в аккаунт, чтобы открыть облачную копию.');
      const ticket={epoch,owner:id,controller:new AbortController()},abort=()=>ticket.controller.abort();active=ticket;signal?.addEventListener('abort',abort,{once:true});
      const ctx={epoch:ticket.epoch,owner:id,signal:ticket.controller.signal,check(){if(ticket.controller.signal.aborted||ticket.epoch!==epoch)throw cancelled();if(ownerID(owner())!==id)throw problem('OWNER','Аккаунт изменился. Операция отменена.');},progress(value){ctx.check();try{onProgress?.(value);}catch(error){if(error?.code==='OWNER'||error?.name==='AbortError')throw error;}}};
      try{ctx.check();return await action(ctx);}finally{signal?.removeEventListener('abort',abort);if(active===ticket)active=null;}
    }
    async function read(password,options){return run(async ctx=>{await session(ctx);const value=await stored(ctx);if(value.envelope===null){await session(ctx);ctx.check();return proof(ctx,value,null);}const profile=await crypto.decrypt(value.envelope,password,{signal:ctx.signal,onProgress:ctx.progress});ctx.check();await session(ctx);ctx.check();return proof(ctx,value,profile);},options);}
    async function validate(snapshot,options){return run(async ctx=>{const row=snapshot&&records.get(snapshot);if(!current(snapshot)||!row?.profile)throw problem('PREVIEW','Сначала открой облачную копию заново.');await session(ctx);const value=await stored(ctx);if(value.revision!==row.revision)throw problem('CONFLICT','Облачная копия изменилась. Открой её заново перед добавлением.');await session(ctx);ctx.check();if(!current(snapshot))throw problem('OWNER','Аккаунт изменился. Операция отменена.');return clone(row.profile);},options);}
    async function push(profile,password,{overwrite=null,...options}={}){return run(async ctx=>{
      await session(ctx);const value=await stored(ctx),prior=overwrite&&records.get(overwrite);
      if(value.envelope!==null){if(!current(overwrite)||!prior)throw problem('EXISTS','В облаке уже есть копия. Сначала открой её, затем подтверди замену.');if(prior.revision!==value.revision)throw problem('CONFLICT','Облачная копия изменилась. Открой её заново перед заменой.');}
      const envelope=await crypto.encrypt(profile,password,{signal:ctx.signal,onProgress:ctx.progress});ctx.check();const verified=await session(ctx);ctx.check();
      const saved=await request('/api/profile',ctx,{method:'PUT',csrf:verified.csrf,body:{revision:value.revision,envelope}});
      if(ownerID(saved.ownerId)!==ctx.owner)throw problem('OWNER','Аккаунт облачной копии изменился. Проверь копию после обновления входа.');
      if(!Number.isSafeInteger(saved.revision)||saved.revision!==value.revision+1||!Number.isFinite(saved.updatedAt)||saved.updatedAt<0)throw problem('FORMAT','Не удалось подтвердить сохранение. Открой облачную копию и проверь её.');
      ctx.check();await session(ctx);ctx.check();return proof(ctx,saved,profile);
    },options);}
    return{supported:()=>!!crypto?.supported?.(),read,push,validate,current,cancel};
  }
  return{create};
});
