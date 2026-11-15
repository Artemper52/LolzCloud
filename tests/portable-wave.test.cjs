'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {PublicWave,validateWaveRequest,MAX_BODY}=require('../music/wave.cjs');
const {BotCatalog}=require('../telegram/catalog.cjs'),{BotState,MediaLinks}=require('../telegram/state.cjs'),{createMediaServer}=require('../telegram/http.cjs');
const desktopHistory=require('../source/integrations/wave-history.cjs'),browserHistory=require('../server/public/app/wave-history.js');
const raw=(id,patch={})=>({id,permalink_url:'https://soundcloud.com/artist/song-'+id,title:'Песня '+id,user:{username:'Артист '+id,permalink_url:'https://soundcloud.com/artist'},duration:90000,genre:'jazz',...patch});
const portable=value=>({id:value.id,url:value.permalink_url,title:value.title,artist:value.user.username,duration:value.duration/1000});
function fixture(t,{provider,implementation}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lc-wave-')),state=new BotState(path.join(directory,'state.json'),'lolzcloud-public-music-v1');
 t.after(()=>{clearTimeout(state.timer);fs.rmSync(directory,{recursive:true,force:true});});
 const catalog=new BotCatalog(state,{provider:provider||{async request(endpoint){if(endpoint==='/resolve')return raw(1);return {collection:Array.from({length:12},(_,i)=>raw(i+2))};}}}),wave=implementation||new PublicWave({catalog,random:()=>0}),links=new MediaLinks('https://lolzcloud.com','w'.repeat(64),{prefix:'/music'}),cache={state,prepare(){throw Error('Wave must never convert audio');}};
 const server=createMediaServer({links,catalog,cache,wave,prefix:'/music',botName:null});t.after(()=>{server.closeAllConnections();server.close();});
 return {directory,state,catalog,wave,server,links};
}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
const body=patch=>({version:1,likes:[portable(raw(1))],...patch});
const post=(base,value,headers={})=>fetch(base+'/music/wave',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
test('portable browser fingerprints match PC across Unicode, recording aliases and 24-hour boundaries',async()=>{
 const now=1794704400000,tracks=[portable(raw(1)),{id:'001',url:'https://www.soundcloud.com/artist/song-1/?utm_source=copy#x',artist:'Ａrтist — Ёж',title:'Песня (Official Audio) HD'},{permalink_url:'https://soundcloud.com/test/song',user:{username:'Test'},title:'Song lyrics VIDEO'},{id:null,url:'https://evil.test/test/song',title:'No artist'}];
 for(const row of tracks)assert.deepEqual(await browserHistory.fingerprints(row),desktopHistory.fingerprints(row));
 const first={artist:'Артист',title:'Песня (Official Audio)'},alias={artist:'Артист',title:'Песня (lyrics)',id:55,url:'https://soundcloud.com/other/reupload'},cache={};
 await browserHistory.markPlayed(first,cache,now);assert.equal(await browserHistory.playedRecently(alias,cache,now+1),true);assert.equal(desktopHistory.playedRecently(alias,cache,now+1),true);
 assert.equal(await browserHistory.playedRecently(alias,cache,now+desktopHistory.DAY),false);assert.deepEqual(browserHistory.prunePlayed({...cache,bad:now,['a'.repeat(64)]:now+2*desktopHistory.DAY},now),desktopHistory.prunePlayed({...cache,bad:now,['a'.repeat(64)]:now+2*desktopHistory.DAY},now));
});
test('wave request rejects unknown/private fields, invalid references and unbounded values',()=>{
 const invalid=[body({cookies:'private'}),body({likes:[{...portable(raw(1)),audioUrl:'https://private.test/a'}]}),body({likes:[{...portable(raw(1)),url:'http://127.0.0.1/music'}]}),body({likes:[{...portable(raw(1)),id:'01'}]}),body({history:[{...portable(raw(1)),seconds:'60'}]}),body({adventurous:2}),body({preferences:{bad:'x'}}),body({blockedArtists:Array(101).fill('Artist')}),body({prompt:'x'.repeat(241)}),body({utcOffsetMinutes:841}),body({feedback:{[portable(raw(1)).url]:{track:portable(raw(2)),skips:0}}}),body({played24h:{secret:1}}),body({cursor:1.1}),body({likes:Array(2001).fill(portable(raw(1)))})];
 for(const row of invalid)assert.throws(()=>validateWaveRequest(row),{status:400});
 const accepted=validateWaveRequest(body({preferences:{mood:'calm',genre:'jazz'},utcOffsetMinutes:-180}));assert.equal(accepted.preferences.character,'mixed');assert.equal(accepted.preferences.mood,'calm');assert.equal(accepted.utcOffsetMinutes,-180);
});
test('portable wave uses verified full playable recordings, shares PC bans and never trusts an imported ID/URL pair',async t=>{
 const requests=[],seed=raw(1),sameRecording=raw(3,{title:seed.title,user:seed.user}),blocked=raw(4,{user:{username:'Blocked'}}),preview=raw(5,{full_duration:240000,media:{transcodings:[{duration:90000,format:{protocol:'hls',mime_type:'audio/mpeg'}}]}}),protectedOnly=raw(6,{media:{transcodings:[{duration:90000,format:{protocol:'cbc-encrypted-hls',mime_type:'audio/mp4'}}]}}),good=raw(7);
 const f=fixture(t,{provider:{async request(endpoint,params){requests.push([endpoint,params]);if(endpoint==='/resolve'){assert.equal(params.url,seed.permalink_url);return seed;}return {collection:[sameRecording,blocked,preview,protectedOnly,good]};}}});
 const played={};desktopHistory.markPlayed(portable(seed),played,Date.now());
 const result=await f.wave.recommend(body({likes:[{...portable(seed),id:999,title:'Forged title'}],preferences:{character:'discover'},blockedArtists:['Blocked'],played24h:played}));
 assert.deepEqual(result.tracks.map(row=>row.id),[7]);assert.equal(result.tracks[0].title,good.title);assert.equal(f.state.get('999'),undefined);assert.equal(f.state.get('5'),undefined);assert.equal(f.state.get('6'),undefined);assert.ok(requests.some(([url])=>url==='/tracks/1/related'));assert.ok(!requests.some(([url])=>url.includes('/999')));
});
test('familiar mode verifies imported likes, preserves bans/day history, and does not replace an exhausted mix with discoveries',async t=>{
 let calls=0;const f=fixture(t,{provider:{async request(){calls++;throw Error('unavailable');}}});for(let i=1;i<=5;i++)f.state.upsert(f.catalog.normalize(raw(i)));
 const played={};desktopHistory.markPlayed(portable(raw(1)),played,Date.now());
 const request=body({likes:[1,2,3,4,5].map(id=>portable(raw(id))),preferences:{character:'familiar'},played24h:played,current:raw(2).permalink_url,blockedArtists:['Артист 3'],feedback:{[raw(4).permalink_url]:{track:portable(raw(4)),banned:true}}});
 const result=await f.wave.recommend(request);assert.deepEqual(result.tracks.map(row=>row.id),[5]);assert.equal(calls,0);
 assert.deepEqual((await f.wave.recommend({...request,omit:[portable(raw(5))]})).tracks,[]);assert.equal(calls,0);
});
test('natural requests reuse PC era/genre/negative filters and public searches with bounded offsets',async t=>{
 const requests=[],rows=[raw(10,{title:'Jazz 1958',release_year:1958}),raw(11,{title:'Jazz remix 2024',release_year:2024}),raw(12,{title:'Metal 1958',genre:'metal',release_year:1958})];
 const f=fixture(t,{provider:{async request(endpoint,params){requests.push([endpoint,params]);if(endpoint==='/resolve')return raw(1);assert.equal(endpoint,'/search/tracks');return {collection:rows};}}});
 const result=await f.wave.recommend(body({prompt:'джаз 1950-1959 без металла',cursor:1000000}));assert.deepEqual(result.tracks.map(row=>row.id),[10]);assert.ok(result.request.labels.includes('Джаз'));assert.match(result.tracks[0].reason,/1958/);assert.ok(requests.filter(([endpoint])=>endpoint==='/search/tracks').every(([,params])=>params.limit===50&&params.offset<=300));
});
test('catalogue failures differ from a successfully exhausted public wave',async t=>{
 let fail=true;const f=fixture(t,{provider:{async request(endpoint){if(fail)throw Error('private-upstream-key=secret');return endpoint==='/resolve'?raw(1):{collection:[]};}}});
 await assert.rejects(f.wave.recommend(body({current:raw(1).permalink_url})),{status:503});fail=false;assert.deepEqual((await f.wave.recommend(body({current:raw(1).permalink_url}))).tracks,[]);
});
test('wave context follows caller timezone instead of the server timezone',async t=>{
 const f=fixture(t);f.wave.now=()=>Date.UTC(2026,10,15,4,30);f.state.upsert(f.catalog.normalize(raw(1)));
 const night=await f.wave.recommend(body({preferences:{character:'familiar'},utcOffsetMinutes:0})),morning=await f.wave.recommend(body({preferences:{character:'familiar'},utcOffsetMinutes:-180}));assert.equal(night.context,'Ночной микс');assert.equal(morning.context,'Утренний микс');
});
test('aborting one wave leaves public metadata usable by another and does not persist personal feedback',async t=>{
 let release,entered;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});t.after(()=>release());
 const f=fixture(t,{provider:{async request(endpoint,params,{signal}){if(endpoint==='/resolve'){entered();await gate;signal.throwIfAborted();return raw(1);}return {collection:[raw(2)]};}}}),controller=new AbortController();
 const first=f.wave.recommend(body({feedback:{[raw(1).permalink_url]:{track:portable(raw(1)),loves:1}}}),{signal:controller.signal});await ready;controller.abort();release();await assert.rejects(first,{name:'AbortError'});
 const second=await f.wave.recommend(body({}));assert.ok(second.tracks.length);f.state.save();const persisted=fs.readFileSync(path.join(f.directory,'state.json'),'utf8');assert.ok(!persisted.includes('feedback'));assert.ok(!persisted.includes('played24h'));
});
test('HTTP wave issues existing signed music URLs with no conversion or session requirement',async t=>{
 const f=fixture(t),base=await listen(f.server),response=await post(base,body({}),{Origin:'https://lolzcloud.com'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
 const result=await response.json();assert.equal(result.version,1);assert.ok(result.tracks.length>0&&result.tracks.length<=20);assert.ok(Buffer.byteLength(JSON.stringify(result))<=256*1024);for(const row of result.tracks){assert.equal(row.audioUrl,f.links.audio(row.id));assert.ok(!('score'in row));}
});
test('HTTP wave rejects foreign origins, method/query/type/body abuse before contacting the recommender',async t=>{
 let calls=0;const f=fixture(t,{implementation:{async recommend(){calls++;throw Error('must not call');}}}),base=await listen(f.server);
 assert.equal((await fetch(base+'/music/wave')).status,405);assert.equal((await fetch(base+'/music/wave',{method:'HEAD'})).status,405);assert.equal((await post(base,body({}),{Origin:'https://evil.test'})).status,403);assert.equal((await post(base,body({}),{'Content-Type':'text/plain'})).status,415);assert.equal((await post(base,body({}),{'Content-Encoding':'gzip'})).status,415);
 assert.equal((await fetch(base+'/music/wave?x=1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);assert.equal((await post(base,{...body({}),cookies:'private'})).status,400);
 assert.equal((await fetch(base+'/music/wave',{method:'POST',headers:{'Content-Type':'application/json'},body:'not JSON'})).status,400);
 assert.equal((await fetch(base+'/music/wave',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(MAX_BODY+1)})).status,413);assert.equal(calls,0);
});
test('HTTP wave bounds chunked bodies too and returns a useful response instead of resetting the connection',async t=>{
 const f=fixture(t),base=await listen(f.server);const result=await new Promise((resolve,reject)=>{const request=http.request(base+'/music/wave',{method:'POST',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},res=>{let text='';res.setEncoding('utf8');res.on('data',s=>{text+=s;});res.on('end',()=>resolve({status:res.statusCode,text}));});request.on('error',reject);for(let i=0;i<17;i++)request.write(Buffer.alloc(65536,32));request.end();});assert.equal(result.status,413);assert.match(result.text,/1 МБ/);
});
test('HTTP wave bounds per-client requests and hides provider diagnostics',async t=>{
 const f=fixture(t,{implementation:{async recommend(){throw Error('private-upstream-key=secret');}}}),base=await listen(f.server);
 for(let i=0;i<20;i++){const response=await post(base,body({}));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret'));}const response=await post(base,body({}));assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>0);
});
test('HTTP wave limits active work globally and releases slots after a request finishes',async t=>{
 let release,entered,count=0;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});t.after(()=>release());const f=fixture(t,{implementation:{async recommend(){if(++count===8)entered();await gate;return {tracks:[],nextCursor:1,context:'Мой микс',request:null};}}}),base=await listen(f.server),pending=Array.from({length:8},()=>post(base,body({})));
 await ready;const busy=await post(base,body({}));assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'2');assert.equal(count,8);release();for(const response of await Promise.all(pending))assert.equal(response.status,200);assert.equal((await post(base,body({}))).status,200);
});
