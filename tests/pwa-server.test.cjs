'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../server/index.cjs'),{CloudStore,safeNext}=require('../server/core.cjs');
async function fixture(t){const store=new CloudStore(),server=createServer({store,clientId:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});return{store,server,origin:'http://127.0.0.1:'+server.address().port};}
test('installed app exposes only its public shell, install manifest and scoped service worker',async t=>{
  const{origin}=await fixture(t),page=await fetch(origin+'/app/');assert.equal(page.status,200);const csp=page.headers.get('content-security-policy');assert.match(csp,/script-src 'self'/);assert.match(csp,/worker-src 'self'/);assert.match(csp,/connect-src 'self' https:\/\/lrclib.net/);assert.match(csp,/frame-ancestors 'none'/);assert.match(await page.text(),/manifest\.webmanifest/);
  const alias=await fetch(origin+'/app',{redirect:'manual'});assert.equal(alias.status,303);assert.equal(alias.headers.get('location'),'/app/');
  const manifest=await(await fetch(origin+'/app/manifest.webmanifest')).json();assert.equal(manifest.scope,'/app/');assert.equal(manifest.start_url,'/app/');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons){const response=await fetch(origin+icon.src);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));}
  const worker=await fetch(origin+'/app/sw.js');assert.equal(worker.status,200);assert.equal(worker.headers.get('service-worker-allowed'),'/app/');assert.equal(worker.headers.get('cache-control'),'no-store');
  for(const pathname of ['/app/credentials.env','/app/../package.json','/app/%2e%2e/package.json','/app/hidden.json','/app/.env'])assert.notEqual((await fetch(origin+pathname)).status,200);
  assert.equal((await fetch(origin+'/api/social/me')).status,401);
});
test('embedded room/profile retains same-origin framing and strict API authentication',async t=>{
  const{origin,store}=await fixture(t),owner=store.login({id:901,name:'Fixture user'}),room=store.createRoom(owner.user),headers={Authorization:'Bearer '+owner.secret};
  for(const pathname of ['/rooms','/room/'+room.id,'/social']){const response=await fetch(origin+pathname,{headers});assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.match(response.headers.get('content-security-policy'),/object-src 'none'/);}
  const callback=await fetch(origin+'/auth/lolz/callback');assert.match(callback.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(origin+'/api/rooms/'+room.id)).status,401);
});
test('account return to the installed app is exact and cannot become an open redirect',()=>{
  assert.equal(safeNext('/app/'),'/app/');assert.equal(safeNext('/app'),'/app');
  for(const value of ['/app/?next=https://example.com','//evil.test/app/','https://evil.test/app/','/app/../../other','/app/#external'])assert.equal(safeNext(value),'/rooms');
});
