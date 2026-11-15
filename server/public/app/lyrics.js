/* Public lyric lookup only. A good cache entry outlives transient metadata and
   failed refreshes; imported user lyrics remain a separate, higher priority. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./core.js'):root.LolzCloudAppCore,common?require('./lyric-tempo.js'):root.LolzCloudLyricTempo);if(common)module.exports=api;else root.LolzCloudLyrics=api;})(typeof globalThis==='object'?globalThis:this,function(C,T){
  'use strict';
  const CACHE_TTL=30*86400000,SEARCH_TTL=10*60000,MAX_SEARCH_BYTES=4*1024*1024;
  const abort=()=>new DOMException('Cancelled','AbortError');
  const known=value=>!!value&&(value.instrumental||typeof value.plain==='string'&&value.plain.trim()||typeof value.synced==='string'&&value.synced.trim()||Array.isArray(value.lines)&&value.lines.length);
  const title=value=>String(value||'').replace(/\.(?:mp3|flac|m4a|ogg|wav|opus|aac)$/i,'').trim();
  const identity=value=>C.lyricsIdentity(T.detectVariant(title(value.title)).title)+'|'+C.lyricsIdentity(value.artist);
  const variantKey=track=>{const variant=T.detectVariant(title(track.title));return C.lyricsIdentity(variant.title)+'|'+variant.kind+'|'+(variant.explicitRate??'')+'|'+variant.unsafe;};
  const duration=value=>Number.isFinite(value)&&value>0&&value<=86400?value:0;
  function create({db,fetchJSON,now=Date.now}={}){
    const pending=new Map(),responses=new Map();let responseBytes=0,blockedUntil=0;
    async function query(url,signal,refresh=false){
      if(signal.aborted)throw abort();
      const cached=responses.get(url);if(!refresh&&cached&&cached.until>now())return cached.body;
      if(cached){responseBytes-=cached.bytes;responses.delete(url);}
      if(now()<blockedUntil){const error=Error('Сервис текстов просит подождать '+Math.ceil((blockedUntil-now())/1000)+' с.');error.status=429;error.retryAfterMs=blockedUntil-now();throw error;}
      let entry=pending.get(url);
      if(!entry){entry={controller:new AbortController(),users:0,settled:false};entry.promise=fetchJSON(url,{signal:entry.controller.signal,timeout:6000,limit:1024*1024,credentials:'omit',headers:{'Lrclib-Client':'LolzCloud-PWA/8 (https://lolzcloud.com)'}}).then(({body})=>{
        const bytes=JSON.stringify(body).length*2;if(bytes<=1024*1024){while(responses.size>=16||responseBytes+bytes>MAX_SEARCH_BYTES){const key=responses.keys().next().value;if(key===undefined)break;responseBytes-=responses.get(key).bytes;responses.delete(key);}responses.set(url,{body,bytes,until:now()+SEARCH_TTL});responseBytes+=bytes;}return body;
      }).catch(error=>{if(error.status===429)blockedUntil=Math.max(blockedUntil,now()+(Number.isFinite(error.retryAfterMs)&&error.retryAfterMs>0?error.retryAfterMs:60000));throw error;}).finally(()=>{entry.settled=true;if(pending.get(url)===entry)pending.delete(url);});pending.set(url,entry);}
      entry.users++;let onAbort;
      try{return await Promise.race([entry.promise,new Promise((_,reject)=>{onAbort=()=>reject(abort());signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();})]);}
      finally{signal.removeEventListener('abort',onAbort);entry.users--;if(!entry.users&&!entry.settled)entry.controller.abort();}
    }
    function cacheFor(value,track,metadata){
      if(!known(value)||![2,3].includes(value.policy))return null;
      const key=identity(metadata),parts=String(value.identity||'').split('|'),oldVariant=T.detectVariant(parts[0]),same=value.policy===3?value.metadataIdentity===key&&value.variantIdentity===variantKey(track):C.lyricsIdentity(oldVariant.title)+'|'+parts[1]===key&&oldVariant.kind===T.detectVariant(title(metadata.title)).kind;
      if(!same)return null;
      if(value.sourceUrl&&track.url&&C.sourceURL(value.sourceUrl)!==C.sourceURL(track.url)&&value.sourceId!==track.id)return null;
      const before=duration(value.sourceDuration)||duration(Number(parts[2])),after=duration(track.duration),lines=Array.isArray(value.lines)?value.lines:C.parseLyrics(value.synced);
      if(before&&after&&Math.abs(before-after)>2.5)return{...value,lines:[],synced:'',plain:value.plain||lines.map(line=>line.text).join('\n'),versionMismatch:true,adapted:false,tempo:null,stale:true};
      return{...value,lines};
    }
    async function forTrack(input,{signal,metadata:override,refresh=false}={}){
      let timedOut=false;const track={...input},metadata=override?{...override}:{...track},controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(()=>{timedOut=true;controller.abort();},6000);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const active=controller.signal;
      try{
        const imported=await db.userLyrics(track.id).catch(()=>null);if(active.aborted)throw abort();if(imported?.imported&&known(imported))return imported;
        const prefix=(!override||identity(override)===identity(track))&&T.detectVariant(title(metadata.title)).title.match(/^(.{2,100}?)\s+[-–—]\s+(.{2,250})$/u);
        if(!C.lyricsIdentity(metadata.title)||!C.lyricsIdentity(metadata.artist)&&!prefix)throw Error('Уточни название и исполнителя или импортируй свой TXT / LRC.');
        const saved=await db.lyrics(track.id).catch(()=>null),fallback=cacheFor(saved,track,metadata),material=fallback?.stale===true;
        if(active.aborted)throw abort();
        const upgrade=!!fallback&&!fallback.lines.length&&!duration(saved.sourceDuration)&&duration(track.duration)>0&&T.detectVariant(title(track.title)).marked;
        if(fallback&&!material&&!upgrade&&!refresh)return{...fallback,cacheStale:Number.isFinite(saved.expiresAt)&&saved.expiresAt<=now()};
        let lookup={title:title(metadata.title),artist:metadata.artist,duration:duration(track.duration),variantTitle:title(track.title)};
        if(prefix)lookup={...lookup,title:prefix[2].trim(),artist:prefix[1].trim()};
        const variant=T.detectVariant(lookup.variantTitle||lookup.title),clean=T.detectVariant(lookup.title),choose=rows=>T.selectRecord(rows,lookup,{parseLines:C.parseLyrics});
        try{
          let result,notFound=variant.marked;
          if(!variant.marked){const params=new URLSearchParams({track_name:lookup.title,artist_name:lookup.artist,...(lookup.duration?{duration:String(Math.round(lookup.duration))}:{})});try{const body=await query('https://lrclib.net/api/get?'+params,active,refresh);notFound=body?.name==='TrackNotFound'||body?.code==='TRACK_NOT_FOUND';if(!notFound)result=choose([body]);}catch(error){if(error.status!==404)throw error;notFound=true;}}
          if(notFound){const params=new URLSearchParams({track_name:clean.title,artist_name:lookup.artist}),body=await query('https://lrclib.net/api/search?'+params,active,refresh);if(!Array.isArray(body)||body.length>100)throw Error('Сервис текстов вернул неверный список записей.');result=choose(body);}
          if(!result?.found){if(fallback)return fallback;throw Error('Текст этой записи пока не найден. Уточни название и исполнителя.');}
          if(active.aborted)throw abort();
          const value={...result,policy:3,identity:identity(metadata)+'|'+track.duration,metadataIdentity:identity(metadata),variantIdentity:variantKey(track),sourceId:track.id,sourceUrl:C.sourceURL(track.url)||'',sourceDuration:duration(track.duration),cachedAt:now(),expiresAt:now()+CACHE_TTL,durationMatched:!result.versionMismatch};
          await db.saveLyrics(track.id,value).catch(()=>{});if(active.aborted)throw abort();return value;
        }catch(error){if(signal?.aborted)throw abort();if(fallback)return fallback;if(timedOut)throw Error('Сервис текстов не ответил за 6 секунд. Повтори поиск.');if(active.aborted)throw abort();throw error;}
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
    return{forTrack,cacheFor,clear(){for(const entry of pending.values())entry.controller.abort();pending.clear();responses.clear();responseBytes=0;}};
  }
  return{create,CACHE_TTL,SEARCH_TTL};
});
