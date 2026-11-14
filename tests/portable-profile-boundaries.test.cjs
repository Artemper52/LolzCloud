'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeProfile,encryptProfile,decryptProfile,MAX_BYTES}=require('../source/integrations/portable-profile.cjs');
function sparse(count){return{format:'lolzcloud-profile',version:1,wave:{likes:Array.from({length:count},(_,i)=>({url:'https://soundcloud.com/fixture/t'+i,title:'x'.repeat(60)}))},tools:{bookmarks:Array.from({length:count},(_,i)=>({url:'https://soundcloud.com/fixture/t'+i,position:i}))}};}
test('profile limits apply after defaults and IDs expand a sparse input, before export or encryption',async()=>{
  const input=sparse(2000);assert.ok(Buffer.byteLength(JSON.stringify(input))<MAX_BYTES);assert.throws(()=>normalizeProfile(input),/После проверки профиль больше/);await assert.rejects(encryptProfile(input,'public fixture password'),/После проверки профиль больше/);
  const accepted=normalizeProfile(sparse(500));assert.ok(Buffer.byteLength(JSON.stringify(accepted))<=MAX_BYTES);assert.doesNotThrow(()=>normalizeProfile(accepted));const restored=await decryptProfile(await encryptProfile(accepted,'public fixture password'),'public fixture password');assert.equal(restored.wave.likes.length,500);assert.equal(restored.tools.bookmarks.length,500);
});
