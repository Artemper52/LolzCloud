'use strict';
const http=require('node:http'),fs=require('node:fs');
const path=require('node:path');
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function createMediaServer({links,cache,botName='lolzcloudbot',health=()=>({}),prefix='/telegram',catalog=null}) {
  if(!['/telegram','/music'].includes(prefix))throw Error('Invalid media route');
  const limits=new Map(),preparations=new Map();
  const prepared=id=>typeof cache.exists==='function'&&cache.exists(id);
  function publicAudioError(error) {
    const text=String(error?.message||'');
    if(/полный поддерживаемый|защищённый|SAMPLE-AES/i.test(text))return 'Источник не отдал поддерживаемый полный поток. Выбери другую запись этой песни.';
    if(/отрывок|предоставил доступ|требует.*доступ/i.test(text))return 'Источник ограничил доступ к полной записи. Выбери другой результат поиска.';
    if(/длинный|ограничение размера|слишком больш/i.test(text))return 'Запись превышает доступный размер или длительность. Выбери более короткий трек.';
    if(/много загрузок|Кэш временно заполнен/i.test(text))return 'Сейчас готовится много музыки. Повтори попытку через несколько секунд.';
    return 'Не удалось подготовить аудио. Повтори попытку чуть позже.';
  }
  return http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
      if(url.pathname===prefix+'/health')return json(res,200,{ok:true,...(botName?{bot:botName}:{}),...health()});
      const preparation=prefix==='/music'&&url.pathname.match(/^\/music\/prepare\/([1-9]\d{0,15})\/([a-f0-9]{24})$/);
      if(preparation){
        if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
        if(url.search||!links.valid(preparation[1],preparation[2]))return json(res,404,{error:'Not found'});
        const id=preparation[1],now=Date.now(),key='prepare:'+String(req.headers['x-real-ip']||req.socket.remoteAddress||'local').slice(0,100);
        let limit=limits.get(key);if(!limit||now-limit.start>=60000){limit={start:now,count:0};limits.set(key,limit);}
        if(limits.size>2000)for(const [key,row]of limits)if(now-row.start>=60000)limits.delete(key);
        if(++limit.count>600){res.setHeader('Retry-After','60');return json(res,429,{error:'Слишком много запросов. Подожди минуту.'});}
        if(prepared(id)){preparations.delete(id);return json(res,200,{state:'ready',audioUrl:links.audio(id)});}
        for(const [key,row]of preparations)if(row.state!=='preparing'&&row.until<=now)preparations.delete(key);
        let row=preparations.get(id);
        if(row?.state==='ready'){preparations.delete(id);row=null;}
        if(!row){
          if(preparations.size>=128){res.setHeader('Retry-After','5');return json(res,503,{error:'Сейчас готовится много музыки. Повтори попытку через несколько секунд.'});}
          row={state:'preparing',until:Infinity};preparations.set(id,row);
          // The response never waits for SoundCloud or conversion. Concurrent
          // polls share one bounded cache task, including metadata recovery.
          Promise.resolve().then(async()=>{
            if(!cache.state.get(id)&&catalog?.track)await catalog.track(id);
            if(!cache.state.get(id))throw Error('SoundCloud не предоставил доступ к этой записи.');
            await cache.prepare(id);row.state='ready';row.until=Date.now()+15000;
          }).catch(error=>{row.state='failed';row.error=publicAudioError(error);row.until=Date.now()+15000;});
        }
        if(row.state==='failed'){res.setHeader('Retry-After','15');return json(res,503,{error:row.error});}
        res.setHeader('Retry-After','1');return json(res,202,{state:'preparing',retryAfterMs:1000});
      }
      if(url.pathname===prefix+'/search'&&catalog){
        if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
        const peer=String(req.headers['x-real-ip']||req.socket.remoteAddress||'local').slice(0,100),now=Date.now();
        let limit=limits.get('search:'+peer);if(!limit||now-limit.start>=60000){limit={start:now,count:0};limits.set('search:'+peer,limit);}
        if(limits.size>2000)for(const [key,value]of limits)if(now-value.start>60000)limits.delete(key);
        if(++limit.count>120){res.setHeader('Retry-After','60');return json(res,429,{error:'Слишком много запросов. Подожди минуту и повтори поиск.'});}
        const query=(url.searchParams.get('q')||'').trim(),offset=url.searchParams.get('offset')||'0';
        if(query.length<2||query.length>140||!/^\d{1,3}$/.test(offset)||Number(offset)>300||Number(offset)%20)return json(res,400,{error:'Введи исполнителя, название или ссылку на трек SoundCloud.'});
        try{
          const found=await catalog.search(query,Number(offset));
          return json(res,200,{tracks:found.tracks.map(t=>({id:t.id,url:t.url,title:t.title,artist:t.artist,cover:t.cover,duration:t.duration,audioUrl:links.audio(t.id)})),nextOffset:found.next});
        }catch{return json(res,503,{error:'Не удалось получить музыку. Проверь соединение и повтори поиск.'});}
      }
      const asset={'/telegram/assets/welcome.jpg':['welcome.jpg','image/jpeg'],'/telegram/assets/icon.png':['icon.png','image/png']}[url.pathname];
      if(asset&&!url.search){
        const file=path.join(__dirname,'assets',asset[0]),stat=await fs.promises.stat(file);
        res.writeHead(200,{'Content-Type':asset[1],'Content-Length':stat.size,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD')return res.end();const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      const m=url.pathname.match(new RegExp('^'+prefix+'/audio/([1-9]\\d{0,15})/([a-f0-9]{24})\\.mp3$'));
      if(!m||!links.valid(m[1],m[2]))return json(res,404,{error:'Not found'});
      if(url.search)return json(res,404,{error:'Not found'});
      // Saved native queues outlive the bounded search index. A valid issued
      // signature may restore that track's public metadata by its fixed ID.
      if(!prepared(m[1])&&!cache.state.get(m[1])&&catalog?.track)await catalog.track(m[1]);
      if(!prepared(m[1])&&!cache.state.get(m[1]))return json(res,404,{error:'Not found'});
      req.setTimeout(120000);res.setTimeout(120000);
      const result=prepared(m[1])?{file:cache.filename(m[1])}:await cache.prepare(m[1]);if(res.destroyed)return;
      // Hold the same open file through headers and streaming. Cache eviction
      // cannot unlink a playing track, including paused/ranged native readers.
      const opened=typeof cache.open==='function'?await cache.open(m[1]):{handle:await fs.promises.open(result.file,'r'),release:()=>{}};
      let streaming=false;
      try {
      const stat=opened.stat||await opened.handle.stat();let start=0,end=stat.size-1,status=200;
      if(req.headers.range) {
        const range=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if(!range||!range[1]&&!range[2]){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
        if(!range[1])start=Math.max(0,stat.size-Number(range[2]));else start=Number(range[1]);
        if(range[1]&&range[2])end=Math.min(end,Number(range[2]));
        if(!Number.isSafeInteger(start)||start>end||start<0){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}status=206;
      }
      res.writeHead(status,{'Content-Type':'audio/mpeg','Content-Length':end-start+1,'Content-Disposition':`inline; filename="lolzcloud-${m[1]}.mp3"`,'Accept-Ranges':'bytes','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff',...(status===206?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
      if(req.method==='HEAD')return res.end();
      if(res.destroyed)return;
      const stream=opened.handle.createReadStream({start,end,autoClose:true});streaming=true;stream.once('close',opened.release);stream.on('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
      } finally {if(!streaming){await opened.handle.close().catch(()=>{});opened.release();}}
    } catch {if(!res.headersSent)json(res,503,{error:'Audio temporarily unavailable; retry shortly'});else res.destroy();}
  });
}
module.exports={createMediaServer};
