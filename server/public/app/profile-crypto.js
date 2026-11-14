(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudProfileCrypto=api;})(globalThis,function(root){
  'use strict';
  let active=false;
  const messages={FORMAT:'Облачная копия имеет неверный формат.',SIZE:'Профиль должен быть не больше 750 КБ.',PASSWORD_LENGTH:'Нужна парольная фраза от 10 до 256 символов.',UNSUPPORTED:'Зашифрованный перенос недоступен в этом браузере. Можно перенести профиль файлом.',DECRYPT:'Не удалось открыть копию. Проверь парольную фразу.',CRYPTO:'Не удалось обработать копию. Повтори попытку.'};
  const supported=()=>!!root.Worker&&!!root.crypto?.subtle&&typeof root.crypto.randomUUID==='function';
  function perform(operation,value,passphrase,{signal,onProgress}={}){
    if(active)return Promise.reject(Error('Дождись окончания переноса профиля.'));
    if(signal?.aborted)return Promise.reject(new DOMException('Перенос отменён.','AbortError'));
    if(!supported())return Promise.reject(Error(messages.UNSUPPORTED));
    if(typeof passphrase!=='string'||passphrase.length<10||passphrase.length>256)return Promise.reject(Error(messages.PASSWORD_LENGTH));
    active=true;
    return new Promise((resolve,reject)=>{
      let worker,timer,id,finished=false;
      const finish=(error,result)=>{if(finished)return;finished=true;active=false;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(result);};
      const abort=()=>finish(new DOMException('Перенос отменён.','AbortError'));
      try{
        id=root.crypto.randomUUID();
        worker=new root.Worker('/app/profile-crypto-worker.js');
        worker.onmessage=event=>{const data=event.data;if(!data||data.id!==id)return;if(Number.isFinite(data.progress)){try{onProgress?.(Math.max(0,Math.min(1,data.progress)));}catch{}return;}if(data.error)finish(Error(messages[data.error]||messages.CRYPTO));else if(Object.hasOwn(data,'value'))finish(null,data.value);};
        worker.onerror=()=>finish(Error(messages.CRYPTO));timer=setTimeout(()=>finish(Error('Обработка копии заняла слишком много времени. Повтори попытку.')),30000);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        worker.postMessage({id,operation,passphrase,...(operation==='encrypt'?{profile:value}:{envelope:value})});
      }catch{finish(Error(messages.CRYPTO));}
    });
  }
  return{supported,encrypt:(profile,password,options)=>perform('encrypt',profile,password,options),decrypt:(envelope,password,options)=>perform('decrypt',envelope,password,options)};
});
