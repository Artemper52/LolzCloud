'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {AudioCache}=require('../telegram/media.cjs');
const {MediaLinks}=require('../telegram/state.cjs');
const {createMediaServer}=require('../telegram/http.cjs');
function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lc-cache-reliability-'));
  const rows=new Map(['1','2','3'].map(id=>[id,{id,url:'https://soundcloud.com/test/'+id,title:'Fixture '+id,artist:'Test',duration:2,cover:''}]));
  const state={get:id=>rows.get(String(id)),upsert:row=>(rows.set(String(row.id),row),row)};
  const cache=new AudioCache({directory,state,source:{save:()=>{throw Error('Unexpected upstream');}},...options});
  t.after(async()=>{cache.close();await cache.files;fs.rmSync(directory,{recursive:true,force:true});});
  return {cache,directory,rows};
}
test('queued preparation has its own total deadline and leaves no abandoned waiter',async t=>{
  let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
  const {cache}=fixture(t,{prepareTimeoutMs:40,source:{async save(url,file,{signal}){calls++;await gate;signal.throwIfAborted();}}});
  const a=cache.prepare('1').catch(error=>error),b=cache.prepare('2').catch(error=>error);
  try {
    await new Promise(setImmediate);const started=Date.now();
    await assert.rejects(Promise.race([cache.prepare('3'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Test deadline exceeded')),400))]),/слишком много времени/);
    assert.ok(Date.now()-started<300);assert.equal(calls,2);assert.equal(cache.waiters.length,0);
  } finally {release();await Promise.all([a,b]);}
  assert.equal(cache.active,0);assert.equal(cache.pending.size,0);assert.equal(cache.controllers.size,0);
});
test('service shutdown rejects queued work immediately and drains worker accounting',async t=>{
  let calls=0;const {cache}=fixture(t,{source:{save:async(url,file,{signal})=>{calls++;await new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}}});
  const work=['1','2','3'].map(id=>cache.prepare(id));await new Promise(setImmediate);assert.equal(cache.active,2);assert.equal(cache.waiters.length,1);
  cache.close();const settled=await Promise.allSettled(work);assert.ok(settled.every(row=>row.status==='rejected'));assert.equal(calls,2);assert.equal(cache.active,0);assert.equal(cache.waiters.length,0);assert.equal(cache.pending.size,0);
});
test('an open cached audio file stays readable during eviction and refreshes its access time',async t=>{
  const {cache}=fixture(t,{maxCacheBytes:300}),file=cache.filename('1');fs.writeFileSync(file,Buffer.alloc(200,7));const old=new Date(Date.now()-600000);fs.utimesSync(file,old,old);
  const opened=await cache.open('1');assert.ok(fs.statSync(file).mtimeMs>Date.now()-5000);
  // Age the fixture while its real descriptor is held, so the reader lease is
  // the only protection rather than the separate recently-used grace period.
  fs.utimesSync(file,old,old);
  try {await assert.rejects(cache.prune(200),/Кэш временно заполнен/);assert.ok(fs.existsSync(file));const bytes=Buffer.alloc(5);await opened.handle.read(bytes,0,5,0);assert.deepEqual(bytes,Buffer.alloc(5,7));}
  finally {await opened.handle.close();opened.release();opened.release();}
  assert.equal(cache.readers.size,0);await cache.prune(200);assert.equal(fs.existsSync(file),false);
});
test('simultaneous real MP3 conversions cannot publish beyond the cache quota',async t=>{
  const executable=require('ffmpeg-static');let wave;
  const {cache,directory,rows}=fixture(t,{executable,maxCacheBytes:50000,source:{async save(url,file){await fsp.copyFile(wave,file);return {track:rows.get(url.split('/').pop())};}}});
  wave=path.join(directory,'fixture.wav');execFileSync(executable,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-threads','1',wave],{windowsHide:true});
  const result=await Promise.allSettled([cache.prepare('1'),cache.prepare('2')]);assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.match(result.find(row=>row.status==='rejected').reason.message,/Кэш временно заполнен/);
  const files=fs.readdirSync(directory).filter(name=>/^\d+\.mp3$/.test(name));assert.equal(files.length,1);assert.ok(files.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0)<=50000);assert.equal(cache.active,0);
});
test('HTTP HEAD, invalid range and disconnected stream release real cache file leases',async t=>{
  const {cache}=fixture(t),file=cache.filename('1');fs.writeFileSync(file,Buffer.concat([Buffer.from('ID3'),Buffer.alloc(1024*1024,3)]));
  const links=new MediaLinks('https://lolzcloud.com','x'.repeat(64),{prefix:'/music'}),server=createMediaServer({cache,links,prefix:'/music'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+server.address().port+new URL(links.audio('1')).pathname;
  const released=async()=>{for(let i=0;i<20&&cache.readers.size;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(cache.readers.size,0);};
  assert.equal((await fetch(url,{method:'HEAD'})).status,200);await released();
  assert.equal((await fetch(url,{headers:{Range:'bytes=99999999-'}})).status,416);await released();
  const response=await fetch(url);await response.body.cancel();for(let i=0;i<20&&cache.readers.size;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(cache.readers.size,0);
});
