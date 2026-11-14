'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BotState,MediaLinks}=require('../telegram/state.cjs'),{BotCatalog}=require('../telegram/catalog.cjs'),{createMediaServer}=require('../telegram/http.cjs');
function fixture(t,{provider}={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lc-music-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const state=new BotState(path.join(directory,'music.json'),'lolzcloud-public-music-v1'),links=new MediaLinks('https://lolzcloud.com','m'.repeat(64),{prefix:'/music'}),catalog=new BotCatalog(state,{provider:provider||{async request(){return {collection:[{id:123,permalink_url:'https://soundcloud.com/test/song',title:'Песня',user:{username:'Артист'},duration:89000,artwork_url:'https://i1.sndcdn.com/cover-large.jpg'}]};}}});t.after(()=>clearTimeout(state.timer));const file=path.join(directory,'test.mp3'),bytes=Buffer.from('ID3'+'test-audio'.repeat(30));fs.writeFileSync(file,bytes);const cache={state,async prepare(id){return {file,track:state.get(id)};}};const server=createMediaServer({links,cache,catalog,prefix:'/music',botName:null,health:()=>({service:'lolzcloud-music',protocol:1})});t.after(()=>{server.closeAllConnections();server.close();});return {state,links,catalog,server,bytes,cache,file};}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
test('native music search returns playable signed MP3 alongside source metadata without requiring login',async t=>{const f=fixture(t),base=await listen(f.server),r=await fetch(base+'/music/search?q='+encodeURIComponent('Артист песня')+'&offset=0');assert.equal(r.status,200);const data=await r.json();assert.equal(data.tracks.length,1);const row=data.tracks[0];assert.equal(row.id,'123');assert.equal(row.duration,89);assert.equal(row.url,'https://soundcloud.com/test/song');assert.equal(row.audioUrl,f.links.audio('123'));const audio=await fetch(base+new URL(row.audioUrl).pathname);assert.equal(audio.headers.get('content-type'),'audio/mpeg');assert.deepEqual(Buffer.from(await audio.arrayBuffer()),f.bytes);});
test('native search rejects invalid pages and arbitrary source URLs before contacting providers',async t=>{let requests=0;const f=fixture(t,{provider:{async request(){requests++;throw Error('must not contact');}}}),base=await listen(f.server);for(const p of ['?q=x','?q=track&offset=1','?q=track&offset=999','?q=track&offset=-1'])assert.equal((await fetch(base+'/music/search'+p)).status,400);assert.equal(requests,0);const r=await fetch(base+'/music/search?q='+encodeURIComponent('http://127.0.0.1/private'));assert.equal(r.status,503);assert.equal(requests,0);});
test('native catalogue failures offer a JSON error and never expose private provider diagnostics',async t=>{const f=fixture(t,{provider:{async request(){throw Error('private-signed-media-details');}}}),base=await listen(f.server),r=await fetch(base+'/music/search?q=track');assert.equal(r.status,503);const data=await r.json();assert.match(data.error,/повтори/);assert.ok(!JSON.stringify(data).includes('private-signed'));});
test('music and Telegram signatures cannot be interchanged, and forged audio is hidden',async t=>{const f=fixture(t),base=await listen(f.server);await f.catalog.search('track');const telegram=new MediaLinks('https://lolzcloud.com','m'.repeat(64));assert.notEqual(f.links.signature('123'),telegram.signature('123'));assert.equal((await fetch(base+'/music/audio/123/'+telegram.signature('123')+'.mp3')).status,404);assert.equal((await fetch(base+'/telegram/audio/123/'+f.links.signature('123')+'.mp3')).status,404);});
test('music health is independent of Telegram and search is rate limited',async t=>{const f=fixture(t),base=await listen(f.server),health=await(await fetch(base+'/music/health')).json();assert.equal(health.service,'lolzcloud-music');assert.equal(health.protocol,1);assert.equal(health.bot,undefined);for(let i=0;i<120;i++)assert.equal((await fetch(base+'/music/search?q=track')).status,200);const blocked=await fetch(base+'/music/search?q=track');assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'60');});
test('a saved issued URL restores bounded-index metadata by the same track ID, without accepting a substituted track',async t=>{let requested='';const raw={id:123,permalink_url:'https://soundcloud.com/test/song',title:'Песня',user:{username:'Артист'},duration:89000};const f=fixture(t,{provider:{async request(endpoint){requested=endpoint;return raw;}}}),base=await listen(f.server),url=base+new URL(f.links.audio('123')).pathname;assert.equal((await fetch(url)).status,200);assert.equal(requested,'/tracks/123');assert.equal(f.state.get('123').title,'Песня');f.state.tracks.delete('123');raw.id=456;assert.equal((await fetch(url)).status,404);assert.equal(f.state.get('456'),undefined);});

test('cold native preparation responds immediately and concurrent polls share one conversion',async t=>{
  const f=fixture(t),base=await listen(f.server);await f.catalog.search('track');let ready=false,calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  f.cache.exists=()=>ready;f.cache.filename=()=>f.file;f.cache.prepare=async()=>{calls++;await gate;ready=true;return {file:f.file};};
  const address=base+'/music/prepare/123/'+f.links.signature('123'),first=await fetch(address);
  assert.equal(first.status,202);assert.equal(first.headers.get('cache-control'),'no-store');assert.deepEqual(await first.json(),{state:'preparing',retryAfterMs:1000});
  for(const response of await Promise.all(Array.from({length:5},()=>fetch(address))))assert.equal(response.status,202);
  assert.equal(calls,1);release();await new Promise(setImmediate);
  const finished=await fetch(address);assert.equal(finished.status,200);assert.deepEqual(await finished.json(),{state:'ready',audioUrl:f.links.audio('123')});
});

test('preparation failures are briefly shared, safe and distinct from an unavailable local file',async t=>{
  const f=fixture(t),base=await listen(f.server);await f.catalog.search('track');let calls=0;
  f.cache.prepare=async()=>{calls++;throw Error('SoundCloud не предоставил полный поддерживаемый поток private-signed-url=secret');};
  const address=base+'/music/prepare/123/'+f.links.signature('123');assert.equal((await fetch(address)).status,202);await new Promise(setImmediate);
  const failed=await fetch(address);assert.equal(failed.status,503);assert.equal(failed.headers.get('retry-after'),'15');const body=await failed.json();assert.match(body.error,/другую запись/);assert.ok(!JSON.stringify(body).includes('secret'));
  assert.equal((await fetch(address)).status,503);assert.equal(calls,1);
});

test('issued cached audio remains playable without catalog metadata or an available upstream',async t=>{
  let calls=0;const f=fixture(t,{provider:{async request(){calls++;throw Error('upstream offline');}}}),base=await listen(f.server);
  f.cache.exists=()=>true;f.cache.filename=()=>f.file;f.cache.prepare=()=>{throw Error('Must use already verified cached bytes');};
  const prepared=await fetch(base+'/music/prepare/123/'+f.links.signature('123'));assert.equal(prepared.status,200);
  const audio=await fetch(base+new URL(f.links.audio('123')).pathname);assert.equal(audio.status,200);assert.deepEqual(Buffer.from(await audio.arrayBuffer()),f.bytes);assert.equal(calls,0);
});

test('preparation only accepts an issued music signature and bounds unfinished jobs',async t=>{
  const f=fixture(t),base=await listen(f.server);f.cache.prepare=()=>new Promise(()=>{});
  assert.equal((await fetch(base+'/music/prepare/123/'+'0'.repeat(24))).status,404);
  assert.equal((await fetch(base+'/music/prepare/123/'+f.links.signature('123')+'?force=1')).status,404);
  for(let id=1;id<=128;id++){f.state.upsert({id:String(id),url:'https://soundcloud.com/test/song',title:'Song',artist:'Artist',duration:89});assert.equal((await fetch(base+'/music/prepare/'+id+'/'+f.links.signature(String(id)))).status,202);}
  assert.equal((await fetch(base+'/music/prepare/129/'+f.links.signature('129'))).status,503);
});

test('public search excludes protected-only streams and full-duration previews instead of offering broken audio',async t=>{
  const original={id:123,permalink_url:'https://soundcloud.com/test/song',title:'Песня',user:{username:'Артист'},duration:89000};
  const format=protocol=>({url:'https://api-v2.soundcloud.com/media/test',duration:89000,format:{protocol,mime_type:'audio/mp4'}});
  const protectedTrack={...original,media:{transcodings:[format('cbc-encrypted-hls'),format('ctr-encrypted-hls')]}},preview={...original,id:124,full_duration:240000,media:{transcodings:[format('hls')]}},supported={...original,id:125,media:{transcodings:[format('hls')]}};
  const f=fixture(t,{provider:{async request(endpoint){return endpoint.startsWith('/tracks/')?protectedTrack:{collection:[protectedTrack,preview,supported]};}}}),base=await listen(f.server);
  const result=await(await fetch(base+'/music/search?q=track')).json();assert.deepEqual(result.tracks.map(t=>t.id),['125']);assert.equal(await f.catalog.track('123'),null);
});
