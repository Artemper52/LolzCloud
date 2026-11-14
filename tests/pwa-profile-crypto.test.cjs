'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),nodeCrypto=require('node:crypto');
const KDF=require('../server/public/app/vendor-scrypt-3.0.1.js');
const worker=require('../server/public/app/profile-crypto-worker.js');
const desktop=require('../source/integrations/portable-profile.cjs');
const fixture=require('./fixtures/portable-profiles/crypto-v1.json');
const semantic=value=>{const copy=structuredClone(value);delete copy.exportedAt;return JSON.parse(JSON.stringify(copy));};

test('browser scrypt and AES-GCM decrypt all independently generated Node raw-UTF8 vectors',async()=>{
  for(const row of fixture.vectors){const password=new TextEncoder().encode(row.password),salt=Buffer.from(row.envelope.salt,'base64');assert.equal(Buffer.from(password).toString('hex'),row.passwordUtf8Hex);const key=await KDF.scrypt(password,salt,16384,8,1,32);assert.equal(Buffer.from(key).toString('hex'),row.scryptHex,row.name);key.fill(0);const plain=await worker.execute({operation:'decrypt',passphrase:row.password,envelope:row.envelope});assert.deepEqual(plain,fixture.profile,row.name);}
});
test('browser encrypt → desktop decrypt and desktop encrypt → browser decrypt retain the complete v1 profile',async()=>{
  const password=fixture.vectors[1].password,original=semantic(desktop.normalizeProfile(fixture.profile));
  const fromBrowser=await worker.execute({operation:'encrypt',passphrase:password,profile:fixture.profile});assert.deepEqual(semantic(await desktop.decryptProfile(fromBrowser,password)),original);
  const fromDesktop=await desktop.encryptProfile(fixture.profile,password);assert.deepEqual(semantic(await worker.execute({operation:'decrypt',passphrase:password,envelope:fromDesktop})),original);
  assert.equal(original.music.dsp.preampDb,-6);assert.equal(original.music.dsp.rate,1.75);assert.equal(original.music.collections[0].id,fixture.profile.music.collections[0].id);
});
test('encryption never normalizes password bytes and rejects wrong passwords or changed tags',async()=>{
  const row=fixture.vectors[1],different=row.password.normalize('NFC');assert.notEqual(different,row.password);
  for(const passphrase of[different,'definitely wrong password'])await assert.rejects(worker.execute({operation:'decrypt',passphrase,envelope:row.envelope}),error=>error.code==='DECRYPT');
  const tag=Buffer.from(row.envelope.tag,'base64');tag[4]^=1;await assert.rejects(worker.execute({operation:'decrypt',passphrase:row.password,envelope:{...row.envelope,tag:tag.toString('base64')}}),error=>error.code==='DECRYPT');
});
test('malformed or oversized envelopes and profiles are rejected before key derivation',async()=>{
  const envelope=fixture.vectors[0].envelope,passphrase=fixture.vectors[0].password;
  for(const changed of[{version:true},{salt:envelope.salt+'\n'},{iv:Buffer.alloc(11).toString('base64')},{tag:Buffer.alloc(15).toString('base64')},{salt:envelope.salt.slice(0,-3)+'B=='},{unexpected:'ignored?'},{ciphertext:'A'.repeat(1000004)}])await assert.rejects(worker.execute({operation:'decrypt',passphrase,envelope:{...envelope,...changed}}),error=>error.code==='FORMAT');
  await assert.rejects(worker.execute({operation:'encrypt',passphrase,profile:{format:'lolzcloud-profile',version:1,note:'я'.repeat(375000)}}),error=>error.code==='SIZE');
  await assert.rejects(worker.execute({operation:'encrypt',passphrase,profile:{format:'lolzcloud-profile',version:true}}),error=>error.code==='FORMAT');
  for(const invalid of['short','x'.repeat(257),null])await assert.rejects(worker.execute({operation:'encrypt',passphrase:invalid,profile:fixture.profile}),error=>error.code==='PASSWORD_LENGTH');
});
test('both crypto implementations use independent random salts and nonces for the same profile',async()=>{
  const passphrase=fixture.vectors[0].password,a=await worker.execute({operation:'encrypt',passphrase,profile:fixture.profile}),b=await worker.execute({operation:'encrypt',passphrase,profile:fixture.profile});assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);assert.deepEqual(await worker.execute({operation:'decrypt',passphrase,envelope:a}),fixture.profile);
  // Check platform AES-GCM directly as a third path, without either profile decryptor.
  const key=nodeCrypto.scryptSync(passphrase,Buffer.from(b.salt,'base64'),32),decipher=nodeCrypto.createDecipheriv('aes-256-gcm',key,Buffer.from(b.iv,'base64'));decipher.setAuthTag(Buffer.from(b.tag,'base64'));const plain=Buffer.concat([decipher.update(Buffer.from(b.ciphertext,'base64')),decipher.final()]);key.fill(0);assert.deepEqual(JSON.parse(plain),fixture.profile);
});
