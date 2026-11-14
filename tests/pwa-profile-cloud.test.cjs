'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../server/public/app/profile-cloud.js');
const worker=require('../server/public/app/profile-crypto-worker.js');
const {createServer}=require('../server/index.cjs'),{CloudStore}=require('../server/core.cjs');
const {decryptProfile}=require('../source/integrations/portable-profile.cjs');
const fixture=require('./fixtures/portable-profiles/crypto-v1.json'),password=fixture.vectors[0].password;
const crypt={supported:()=>true,encrypt:(profile,passphrase,options)=>worker.execute({operation:'encrypt',profile,passphrase},options?.onProgress),decrypt:(envelope,passphrase,options)=>worker.execute({operation:'decrypt',envelope,passphrase},options?.onProgress)};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function setup(t){
  const store=new CloudStore(),server=createServer({store});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin='http://127.0.0.1:'+server.address().port,a=store.login({id:1001,name:'Fixture owner'}),b=store.login({id:1002,name:'Second owner'}),requests=[];
  const f={store,server,origin,a,b,identity:a,owner:a.user.id,requests,override:null};
  f.fetcher=async(endpoint,options={})=>{requests.push({endpoint,method:options.method||'GET',body:options.body});if(f.override){const response=await f.override(endpoint,options);if(response)return response;}return fetch(origin+endpoint,{...options,headers:{...options.headers,Cookie:'__Host-lc_session='+f.identity.secret,Origin:'https://lolzcloud.com'}});};
  f.client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:crypt});
  f.direct=async(revision,envelope=fixture.vectors[0].envelope)=>{const response=await fetch(origin+'/api/profile',{method:'PUT',headers:{Authorization:'Bearer '+a.secret,'Content-Type':'application/json'},body:JSON.stringify({revision,envelope})});assert.equal(response.status,200);return response.json();};
  return f;
}
test('same-origin cloud create/read/validate interoperates with desktop and sends only encrypted envelope and revision',async t=>{
  const f=await setup(t),empty=await f.client.read('');assert.equal(empty.empty,true);assert.equal(empty.revision,0);
  const saved=await f.client.push(fixture.profile,password);assert.equal(saved.revision,1);const loaded=await f.client.read(password);assert.equal(loaded.empty,false);assert.equal(f.client.current(loaded),true);
  loaded.profile.wave.likes=[];const ready=await f.client.validate(loaded);assert.deepEqual(ready,fixture.profile,'Public preview changes cannot alter the internally verified profile');
  const write=f.requests.find(row=>row.method==='PUT'),body=JSON.parse(write.body);assert.deepEqual(Object.keys(body).sort(),['envelope','revision']);assert.ok(!write.body.includes(password));assert.ok(!write.body.includes('Fixture night'));const desktop=await decryptProfile(body.envelope,password);assert.equal(desktop.music.dsp.preampDb,-6);assert.equal(desktop.music.dsp.rate,1.75);assert.deepEqual(desktop.wave.likes,fixture.profile.wave.likes);
});
test('an existing cloud copy requires its real read proof and the current revision before replacement',async t=>{
  const f=await setup(t);await f.direct(0);
  await assert.rejects(f.client.push(fixture.profile,password),{code:'EXISTS'});await assert.rejects(f.client.push(fixture.profile,password,{overwrite:{ownerId:f.owner,revision:1}}),{code:'EXISTS'});
  const read=await f.client.read(password),saved=await f.client.push(fixture.profile,password,{overwrite:read});assert.equal(saved.revision,2);
  await assert.rejects(f.client.push(fixture.profile,password,{overwrite:read}),{code:'CONFLICT'});await assert.rejects(f.client.validate(read),{code:'CONFLICT'});assert.equal(f.requests.filter(row=>row.method==='PUT').length,1);
});
test('an edit on another device during encryption produces 409 without retrying or replacing that copy',async t=>{
  const f=await setup(t);await f.direct(0);const gate=deferred(),started=deferred();
  const client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:{...crypt,async encrypt(...args){started.resolve();await gate.promise;return crypt.encrypt(...args);}}}),read=await client.read(password),pending=client.push(fixture.profile,password,{overwrite:read});await started.promise;
  await f.direct(1,fixture.vectors[1].envelope);gate.resolve();await assert.rejects(pending,{code:'CONFLICT'});assert.equal(f.requests.filter(row=>row.method==='PUT').length,1);
  const response=await f.fetcher('/api/profile'),stored=await response.json();assert.deepEqual(stored.envelope,fixture.vectors[1].envelope);assert.equal(stored.revision,2);
});
test('account changes while deriving a key prevent any late cloud upload',async t=>{
  const f=await setup(t),gate=deferred(),started=deferred(),client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:{...crypt,async encrypt(...args){started.resolve();await gate.promise;return crypt.encrypt(...args);}}});
  const pending=client.push(fixture.profile,password);await started.promise;f.owner=f.b.user.id;f.identity=f.b;gate.resolve();await assert.rejects(pending,{code:'OWNER'});assert.equal(f.requests.filter(row=>row.method==='PUT').length,0);
});
test('a changed HttpOnly cookie is detected even when the visible account has not refreshed yet',async t=>{
  const f=await setup(t),gate=deferred(),started=deferred(),client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:{...crypt,async encrypt(...args){started.resolve();await gate.promise;return crypt.encrypt(...args);}}});
  const pending=client.push(fixture.profile,password);await started.promise;f.identity=f.b;gate.resolve();await assert.rejects(pending,{code:'AUTH'});assert.equal(f.requests.filter(row=>row.method==='PUT').length,0);
});
test('CSRF remains bound to the verified session if the cookie changes immediately before PUT',async t=>{
  const f=await setup(t);f.override=(endpoint,options)=>{if(endpoint==='/api/profile'&&options.method==='PUT')f.identity=f.b;};
  await assert.rejects(f.client.push(fixture.profile,password),{code:'AUTH'});f.owner=f.b.user.id;const empty=await f.client.read('');assert.equal(empty.revision,0);assert.equal(empty.empty,true);
});
test('cancel invalidates previous previews and busy work cannot apply or upload after it ends',async t=>{
  const f=await setup(t);await f.direct(0);const read=await f.client.read(password);f.client.cancel();assert.equal(f.client.current(read),false);await assert.rejects(f.client.validate(read),{code:'PREVIEW'});
  const gate=deferred(),started=deferred(),client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:{...crypt,async decrypt(...args){started.resolve();await gate.promise;return crypt.decrypt(...args);}}}),controller=new AbortController(),pending=client.read(password,{signal:controller.signal});await started.promise;
  await assert.rejects(client.read(password),{code:'BUSY'});controller.abort();gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal((await client.read(password)).revision,1);
});
test('read results cannot be applied after the cloud revision or account changes',async t=>{
  const f=await setup(t);await f.direct(0);const read=await f.client.read(password);await f.direct(1);await assert.rejects(f.client.validate(read),{code:'CONFLICT'});
  f.identity=f.b;f.owner=f.b.user.id;assert.equal(f.client.current(read),false);await assert.rejects(f.client.validate(read),{code:'PREVIEW'});
});
test('cookie A→profile B→session A is rejected using the profile response owner before decrypt or preview',async t=>{
  const f=await setup(t);await f.direct(0);const response=await fetch(f.origin+'/api/profile',{method:'PUT',headers:{Authorization:'Bearer '+f.b.secret,'Content-Type':'application/json'},body:JSON.stringify({revision:0,envelope:fixture.vectors[0].envelope,ownerId:f.a.user.id})});assert.equal(response.status,200);assert.equal((await response.json()).ownerId,f.b.user.id);
  const original=await f.client.read(password);let decrypts=0;const client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:{...crypt,decrypt(...args){decrypts++;return crypt.decrypt(...args);}}});
  f.override=(endpoint,options)=>endpoint==='/api/profile'&&options.method==='GET'?fetch(f.origin+endpoint,{...options,headers:{...options.headers,Cookie:'__Host-lc_session='+f.b.secret,Origin:'https://lolzcloud.com'}}):null;
  await assert.rejects(client.read(password),{code:'OWNER'});assert.equal(decrypts,0);await assert.rejects(f.client.validate(original),{code:'OWNER'});await assert.rejects(f.client.push(fixture.profile,password,{overwrite:original}),{code:'OWNER'});assert.equal(f.requests.filter(row=>row.method==='PUT').length,0);
});
test('unbounded or non-JSON responses are rejected without attempting decryption',async t=>{
  const f=await setup(t);let decrypts=0;const client=create({owner:()=>f.owner,fetcher:f.fetcher,crypto:{...crypt,decrypt(){decrypts++;throw Error('must not run');}}});
  f.override=endpoint=>endpoint==='/api/profile'?new Response('x'.repeat(1050001),{headers:{'Content-Type':'application/json'}}):null;await assert.rejects(client.read(password),{code:'SIZE'});
  f.override=endpoint=>endpoint==='/api/profile'?new Response('{}',{headers:{'Content-Type':'text/html'}}):null;await assert.rejects(client.read(password),{code:'FORMAT'});assert.equal(decrypts,0);
});
