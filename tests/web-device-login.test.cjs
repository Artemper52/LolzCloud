'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CloudStore}=require('../server/core.cjs'),{createServer}=require('../server/index.cjs');
async function fixture(t){let now=Date.now();const origin='https://lolzcloud.com',store=new CloudStore({origin,now:()=>now}),server=createServer({store,origin,clientId:''});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;const pair=store.beginDevice();store.approveDevice(pair.code,{id:1001,name:'Fixture listener'});const grant=store.pollDevice(pair.deviceCode);const commit=(headers={},body={})=>fetch(base+'/api/desktop/session',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+grant.token,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return{store,base,grant,commit,advance:ms=>{now+=ms;}};}
test('a verified device grant commits a host-only HttpOnly session in the web app cookie jar',async t=>{
 const f=await fixture(t),response=await f.commit();assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');assert.match(cookie,/^__Host-lc_session=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);assert.ok(!/Domain=/i.test(cookie));
 const account=await response.json();assert.equal(account.authenticated,true);assert.equal(account.user.id,1001);assert.match(account.csrf,/^[\w-]{43}$/);assert.ok(!JSON.stringify(account).includes(f.grant.token));
 const checked=await(await fetch(f.base+'/api/session',{headers:{Cookie:cookie.split(';')[0]}})).json();assert.equal(checked.authenticated,true);assert.equal(checked.user.id,1001);assert.equal(checked.csrf,account.csrf);
});
test('cookie commit rejects missing/foreign Origin, unauthenticated tokens and cookie-only requests',async t=>{
 const f=await fixture(t);for(const headers of [{Origin:''},{Origin:'https://attacker.test'},{Authorization:'Bearer '+'a'.repeat(43)},{Authorization:'',Cookie:'__Host-lc_session='+f.grant.token}]){const response=await f.commit(headers);assert.ok([401,403].includes(response.status));assert.equal(response.headers.get('set-cookie'),null);}
 f.advance(8*86400000);const expired=await f.commit();assert.equal(expired.status,401);assert.equal(expired.headers.get('set-cookie'),null);
});
test('device session cannot be supplied through request body, redirect or URL parameters',async t=>{
 const f=await fixture(t);for(const body of [[],null,{token:'forged'},{user:{id:1}},{next:'https://attacker.test'}]){const response=await f.commit({},body);assert.equal(response.status,400);assert.equal(response.headers.get('set-cookie'),null);}
 const type=await f.commit({'Content-Type':'text/plain'});assert.equal(type.status,415);assert.equal(type.headers.get('set-cookie'),null);
 const unauth=await fetch(f.base+'/api/desktop/session?token='+f.grant.token,{method:'POST',headers:{Origin:'https://lolzcloud.com','Content-Type':'application/json'},body:'{}'});assert.equal(unauth.status,401);
});
test('explicit grant replaces only the current app cookie and retains other valid sessions',async t=>{
 const f=await fixture(t),previous=f.store.login({id:1002,name:'Another fixture user'});const response=await f.commit({Cookie:'__Host-lc_session='+previous.secret});assert.equal(response.status,200);assert.equal((await response.json()).user.id,1001);assert.equal(f.store.session(previous.secret).user.id,1002);
});
