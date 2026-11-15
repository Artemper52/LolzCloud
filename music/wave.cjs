'use strict';
const {tasteProfile,rankCandidates}=require('../source/integrations/wave.cjs');
const {DEFAULTS,validatePreferences,contextProfile,contextLabel,searchHint,normalize:norm}=require('../source/integrations/wave-preferences.cjs');
const {parseRequest}=require('../source/integrations/wave-request.cjs');
const {DAY,fingerprints,prunePlayed}=require('../source/integrations/wave-history.cjs');
const {publicTrack}=require('../telegram/state.cjs');
const MAX_BODY=1000000,MAX_RESPONSE=256*1024;
function invalid(message='Некорректные настройки волны.'){return Object.assign(Error(message),{status:400});}
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw invalid();return value;}
function text(value,max,{empty=true}={}){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)||!empty&&!value.trim())throw invalid();return value.trim();}
function number(value,min,max,{integer=false}={}){if(!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw invalid();return value;}
function sourceURL(value){value=text(value,500,{empty:false});if(!/^https:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+\/?$/.test(value)||new URL(value).pathname.startsWith('/sets/'))throw invalid('Волна поддерживает публичные записи SoundCloud.');return value.replace('www.soundcloud.com','soundcloud.com').replace(/\/$/,'');}
const TRACK_KEYS=['id','url','title','artist','cover','duration','genre','tags','description','releaseYear','bpm','artistUrl'];
function track(value,history=false){
 object(value,history?TRACK_KEYS.concat(['seconds','playedAt','quickSkip','liked']):TRACK_KEYS);
 const row={url:sourceURL(value.url),title:text(value.title,180,{empty:false}),artist:text(value.artist||'',100),duration:number(value.duration??0,0,1200)};
 if(value.id!==undefined&&value.id!==null){const id=String(value.id);if(!/^[1-9]\d{0,15}$/.test(id)||!Number.isSafeInteger(Number(id)))throw invalid();row.id=Number(id);}else row.id=null;
 for(const [key,max]of [['cover',2048],['genre',80],['tags',300],['description',600],['artistUrl',500]])if(value[key]!==undefined)row[key]=text(value[key],max);
 if(row.cover){try{const u=new URL(row.cover);if(u.protocol!=='https:'||u.username||u.password)throw invalid();}catch{throw invalid();}}
 if(row.artistUrl&&!/^https:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/?$/.test(row.artistUrl))throw invalid();
 if(value.releaseYear!==undefined)row.releaseYear=value.releaseYear===0?0:number(value.releaseYear,1800,new Date().getFullYear()+1,{integer:true});
 if(value.bpm!==undefined)row.bpm=value.bpm===0?0:number(value.bpm,30,300);
 if(history){if(value.seconds!==undefined)row.seconds=number(value.seconds,0,14400);if(value.playedAt!==undefined)row.playedAt=number(value.playedAt,0,8640000000000000);for(const key of ['quickSkip','liked'])if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw invalid();row[key]=value[key];}}
 return row;
}
function list(value,max,history=false){if(!Array.isArray(value)||value.length>max)throw invalid();return value.map(row=>track(row,history));}
function validateWaveRequest(value){
 object(value,['version','likes','history','feedback','preferences','adventurous','blockedArtists','played24h','recent','current','prompt','cursor','anchor','omit','utcOffsetMinutes']);
 if(value.version!==1)throw invalid('Обнови приложение для этой версии волны.');
 const result={version:1,likes:list(value.likes??[],2000),history:list(value.history??[],2000,true),feedback:Object.create(null),preferences:{...DEFAULTS},adventurous:value.adventurous===undefined?.35:number(value.adventurous,0,1),blockedArtists:[],played24h:{},recent:list(value.recent??[],8),current:value.current?sourceURL(value.current):'',prompt:text(value.prompt??'',240),cursor:number(value.cursor??0,0,1000000,{integer:true}),anchor:value.anchor===undefined||value.anchor===null?null:track(value.anchor),omit:list(value.omit??[],40),utcOffsetMinutes:number(value.utcOffsetMinutes??0,-840,840,{integer:true})};
 if(value.preferences!==undefined){object(value.preferences,Object.keys(DEFAULTS).concat('adventurous'));try{Object.assign(result.preferences,validatePreferences(value.preferences));}catch{throw invalid();}}
 if(value.blockedArtists!==undefined){if(!Array.isArray(value.blockedArtists)||value.blockedArtists.length>100)throw invalid();result.blockedArtists=[...new Set(value.blockedArtists.map(name=>text(name,100,{empty:false})))];}
 if(value.feedback!==undefined){if(!value.feedback||typeof value.feedback!=='object'||Array.isArray(value.feedback)||Object.keys(value.feedback).length>2000)throw invalid();for(const[url,item]of Object.entries(value.feedback)){const key=sourceURL(url);object(item,['track','skips','loves','banned','lastSkippedAt']);const row=track(item.track);if(row.url!==key||item.banned!==undefined&&typeof item.banned!=='boolean')throw invalid();result.feedback[key]={track:row,skips:number(item.skips??0,0,20),loves:number(item.loves??0,0,10),banned:item.banned===true,lastSkippedAt:number(item.lastSkippedAt??0,0,8640000000000000)};}}
 if(value.played24h!==undefined){if(!value.played24h||typeof value.played24h!=='object'||Array.isArray(value.played24h)||Object.keys(value.played24h).length>2000)throw invalid();for(const[key,at]of Object.entries(value.played24h)){if(!/^[a-f0-9]{64}$/.test(key))throw invalid();result.played24h[key]=number(at,0,8640000000000000);}}
 if(result.prompt){try{result.request=parseRequest(result.prompt);}catch(error){throw invalid(error.message);}}else result.request=null;
 return result;
}
async function eachLimit(rows,limit,fn){const results=new Array(rows.length);let index=0;async function worker(){while(index<rows.length){const at=index++;try{results[at]={status:'fulfilled',value:await fn(rows[at])};}catch(reason){results[at]={status:'rejected',reason};}}}await Promise.all(Array.from({length:Math.min(limit,rows.length)},worker));return results;}
function throwIfAborted(signal){signal?.throwIfAborted();}
function abortable(promise,signal){if(!signal)return promise;throwIfAborted(signal);return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||Error('Aborted'));signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
class PublicWave {
 constructor({catalog,now=Date.now,random=Math.random,providerLimit=8,providerBudget=180}={}){if(!catalog?.provider||!catalog?.state)throw Error('Wave catalogue required');Object.assign(this,{catalog,provider:catalog.provider,state:catalog.state,now,random,providerLimit,providerBudget});this.relatedCache=new Map();this.metadataCache=new Map();this.providerActive=0;this.windowStart=0;this.windowCount=0;}
 async request(endpoint,params,signal){
  throwIfAborted(signal);const now=this.now();if(now-this.windowStart>=60000){this.windowStart=now;this.windowCount=0;}
  if(this.providerActive>=this.providerLimit||this.windowCount>=this.providerBudget)throw Object.assign(Error('Wave provider busy'),{status:503});
  this.providerActive++;this.windowCount++;
  const deadline=AbortSignal.timeout(5000),cancel=signal?AbortSignal.any([signal,deadline]):deadline;
  const pending=Promise.resolve().then(()=>this.provider.request(endpoint,params,{signal:cancel})).finally(()=>{this.providerActive--;});
  return abortable(pending,cancel);
 }
 remember(raw){const row=this.catalog.normalize(raw);if(!row||!/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/.test(row.url))return null;const saved=this.state.upsert(row);if(!saved)return null;const value={...publicTrack(saved),id:Number(saved.id)};if(this.metadataCache.size>=1000)this.metadataCache.delete(this.metadataCache.keys().next().value);this.metadataCache.set(String(row.id),{until:this.now()+20*60000,value});return value;}
 knownMetadata(input){const id=String(input.id||''),cached=this.metadataCache.get(id);if(cached?.until>this.now()&&cached.value.metadataVersion===1&&cached.value.url===input.url)return cached.value;const saved=this.state.get(id);return saved?.metadataVersion===1&&saved.url===input.url?saved:null;}
 async verify(input,signal){
  throwIfAborted(signal);const id=input.id?String(input.id):'',known=this.knownMetadata(input);
  if(known)return {...publicTrack(known),id:Number(known.id)};
  const saved=id?this.state.get(id):null,legacy=saved?.url===input.url;
  // Basic state is an identity, not genre/year evidence. Rehydrate that exact
  // previously verified ID/URL; a forged imported ID still resolves by URL.
  const raw=await this.request(legacy?'/tracks/'+id:'/resolve',legacy?{}:{url:input.url},signal);throwIfAborted(signal);const row=this.catalog.normalize(raw);if(!row||row.url!==input.url||legacy&&String(row.id)!==id)return null;return this.remember(raw);
 }
 async related(seed,signal){
  throwIfAborted(signal);const id=String(seed.id),cached=this.relatedCache.get(id);if(cached?.until>this.now())return cached.rows;
  const raw=await this.request('/tracks/'+id+'/related',{limit:40,linked_partitioning:1},signal);throwIfAborted(signal);
  const rows=(Array.isArray(raw)?raw:Array.isArray(raw?.collection)?raw.collection:[]).slice(0,100).map(value=>this.remember(value)).filter(Boolean);
  if(this.relatedCache.size>=256)this.relatedCache.delete(this.relatedCache.keys().next().value);this.relatedCache.set(id,{until:this.now()+20*60000,rows});return rows;
 }
 async search(query,offset,signal){const raw=await this.request('/search/tracks',{q:query.slice(0,140),limit:50,offset},signal);throwIfAborted(signal);return (Array.isArray(raw?.collection)?raw.collection:[]).slice(0,100).map(value=>this.remember(value)).filter(Boolean);}
 async recommend(input,{signal}={}){
  const data=validateWaveRequest(input),now=this.now(),deadline=AbortSignal.timeout(12000),cancel=signal?AbortSignal.any([signal,deadline]):deadline;
  throwIfAborted(cancel);const profile=tasteProfile(data.history,data.likes,data.feedback,now),settings=data.request?.settings||data.preferences,blocked=new Set(data.blockedArtists.map(norm)),played24h=prunePlayed(data.played24h,now),omit=new Set(data.omit.flatMap(fingerprints));
  // contextProfile uses local calendar fields. Shift both timestamps by the same
  // offset so server timezone does not change a listener's time-of-day mix.
  const shift=(new Date(now).getTimezoneOffset()-data.utcOffsetMinutes)*60000,contextTime=now+shift,history=data.history.map(row=>({...row,playedAt:row.playedAt===undefined?undefined:row.playedAt+shift}));
  const context=contextProfile(history,contextTime),rank=pool=>rankCandidates(pool,profile,{feedback:data.feedback,recent:data.recent,current:data.current,adventurous:data.adventurous,random:this.random,played24h,now,settings,context,blockedArtists:data.blockedArtists,omit,request:data.request});
  let seeds=[...profile.tracks.values()].filter(row=>row.weight>0&&!data.feedback[row.url]?.banned&&!blocked.has(norm(row.artist))).map(row=>({...row,priority:row.weight+this.random()*3})).sort((a,b)=>b.priority-a.priority);
  if(data.anchor)seeds=[{...data.anchor,weight:12},...seeds.filter(row=>norm(row.artist)===norm(data.anchor.artist)&&row.url!==data.anchor.url)].slice(0,2);
  if(!seeds.length&&data.current)seeds=[{url:data.current,id:null,title:'Текущий трек',artist:'',duration:0,weight:2}];
  const hint=searchHint(data.preferences);if(!seeds.length&&!hint&&!data.request)throw invalid('Включи любимый трек, добавь лайки или укажи жанр — волне нужна отправная точка.');
  const rotated=seeds.slice(data.cursor%Math.max(1,seeds.length)).concat(seeds.slice(0,data.cursor%Math.max(1,seeds.length))),selected=[],artists=new Set();
  for(const seed of rotated){if(selected.length>=4)break;if(!artists.has(norm(seed.artist))){selected.push(seed);artists.add(norm(seed.artist));}}
  for(const seed of rotated)if(selected.length<Math.min(4,seeds.length)&&!selected.some(row=>row.url===seed.url))selected.push(seed);
  const pool=[],attempts=[];let sourceSuccess=0;
  const collect=(results,source=false)=>{for(const result of results){attempts.push(result);if(result.status==='fulfilled'){if(source)sourceSuccess++;if(Array.isArray(result.value))pool.push(...result.value);else if(result.value)pool.push(result.value);}}};
  // Candidates must come from our verified catalogue/provider, never from a
  // client's exported title/ID pair. Taste input is used only for ranking.
  let unknown=0;
  const familiarInput=settings.character==='familiar'?rotated.slice(0,40).filter(seed=>this.knownMetadata(seed)||unknown++<8):selected;
  const verified=await eachLimit(familiarInput,4,async seed=>{const row=await this.verify(seed,cancel);return row?{...row,seedWeight:seed.weight||0}:null;});collect(verified);throwIfAborted(signal);
  if(!cancel.aborted&&data.request){collect(await eachLimit(data.request.queries,3,query=>this.search(query,(data.cursor%7)*50,cancel)),true);}
  else if(!cancel.aborted&&settings.character!=='familiar'){
   const good=verified.filter(row=>row.status==='fulfilled'&&row.value).map(row=>row.value);
   collect(await eachLimit(good,4,async seed=>(await this.related(seed,cancel)).map(row=>({...row,seedTitle:seed.title,seedWeight:seed.seedWeight}))),true);throwIfAborted(signal);
   if(!cancel.aborted&&rank(pool).length<8){const neighbours=rank(pool).filter(row=>!good.some(seed=>seed.url===row.url)).slice(0,2);collect(await eachLimit(neighbours,2,async seed=>(await this.related(seed,cancel)).map(row=>({...row,seedTitle:seed.title,seedWeight:1}))),true);}
   if(!cancel.aborted&&rank(pool).length<8){const query=hint||selected[data.cursor%Math.max(1,selected.length)]?.artist;if(query)collect(await eachLimit([query],1,value=>this.search(value,(data.cursor%7)*50,cancel)),true);}
  }
  throwIfAborted(signal);const tracks=rank(pool).slice(0,20);
  if(!tracks.length&&!sourceSuccess&&attempts.some(row=>row.status==='rejected'))throw Object.assign(Error('Wave source temporarily unavailable'),{status:503});
  return {version:1,tracks,nextCursor:(data.cursor+Math.max(1,selected.length))%1000001,context:contextLabel(contextTime),request:data.request?{text:data.request.raw,labels:data.request.labels,note:data.request.note}:null};
 }
}
module.exports={PublicWave,validateWaveRequest,MAX_BODY,MAX_RESPONSE};
