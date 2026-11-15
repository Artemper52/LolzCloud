'use strict';const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../server/public/app/audio-metadata.js'),F=require('./fixtures/pwa-audio-tags.cjs');
test('ID3v2.3 UTF16/BOM and v2.4 UTF8/BE carry real title/artist instead of filename guesses',()=>{
 for(const[version,encoding]of[[3,1],[4,3],[4,2],[3,0]]){const title=encoding===0?'Cafe':'Моя песня',artist=encoding===0?'Artist':'Исполнитель';const value=M.parse(F.tag([F.frame('TIT2',F.text(title,encoding),{version}),F.frame('TPE1',F.text(artist,encoding),{version})],{version}));assert.deepEqual(value,{title,artist});assert.ok(Object.isFrozen(value));}
});
test('v1 fills only missing values and never overrides a verified v2 title',()=>{
 const tail=F.v1('Legacy title','Legacy artist'),prefix=F.tag([F.frame('TIT2',F.text('New title'))]);assert.deepEqual(M.parse(prefix,tail),{title:'New title',artist:'Legacy artist'});
 assert.deepEqual(M.parse(Buffer.from([255,251,0,0]),tail),{title:'Legacy title',artist:'Legacy artist'});
 assert.deepEqual(M.parse(Buffer.from('RIFF1234WAVE'),tail),{});
});
test('ID3 extended headers and v2.3 global/v2.4 per-frame unsynchronisation are decoded in their own size domain',()=>{
 for(const version of[3,4])assert.deepEqual(M.parse(F.tag([F.frame('TIT2',F.text('Extended'),{version})],{version,extended:true})),{title:'Extended'});
 const payload=F.text('ÿà tone',0);assert.equal(M.parse(F.tag([F.frame('TIT2',payload,{version:3})],{version:3,flags:128})).title,'ÿà tone');
 assert.equal(M.parse(F.tag([F.frame('TIT2',Buffer.concat([F.sync(payload.length),F.unsync(payload)]),{flags:3})])).title,'ÿà tone');
 assert.equal(M.parse(F.tag([F.frame('TIT2',Buffer.concat([Buffer.from([7]),F.text('Grouped')]),{flags:64})])).title,'Grouped');
});
test('malformed sizes/encodings, compressed/encrypted frames and huge text fail closed without blocking valid later tags',()=>{
 for(const flags of[4,8,128])assert.deepEqual(M.parse(F.tag([F.frame('TIT2',F.text('Do not decode'),{flags})])),{});
 for(const payload of[Buffer.from([3,255]),Buffer.from([1,0,0,0]),Buffer.from([9,65]),F.text('a'.repeat(17000))])assert.deepEqual(M.parse(F.tag([F.frame('TIT2',payload)])),{});
 assert.deepEqual(M.parse(F.tag([F.frame('TIT2',Buffer.concat([F.sync(9999),F.text('Wrong declared data length')]),{flags:1})])),{});
 const broken=F.tag([F.frame('TIT2',F.text('Title'))]);broken[14]=127;assert.deepEqual(M.parse(broken),{});
 assert.deepEqual(M.parse(new Uint8Array(M.MAX_PREFIX+1)),{});
 const good=M.parse(F.tag([F.frame('TIT2',Buffer.from([3,255])),F.frame('TPE1',F.text('Actual artist'))]));assert.deepEqual(good,{artist:'Actual artist'});
});
test('text values remain inert, bounded and free of control characters without inventing an artist',()=>{
 const value=M.parse(F.tag([F.frame('TIT2',F.text('<b>Название</b>\n\u202e'+ 'a'.repeat(400)))]));assert.ok(value.title.startsWith('<b>Название</b> '));assert.equal(value.title.length,300);assert.equal(value.artist,undefined);assert.ok(!/[\p{Cc}\p{Cf}]/u.test(value.title));
});
test('FLAC Vorbis comments preserve UTF8 title/artist and skip malformed/truncated comments safely',()=>{
 const value=F.flac(['ALBUM=Other','TITLE=Флак песня','ARTIST=Флак исполнитель']);assert.deepEqual(M.parse(value),{title:'Флак песня',artist:'Флак исполнитель'});
 assert.deepEqual(M.parse(value.subarray(0,value.length-2)),{});assert.deepEqual(M.parse(F.flac(['TITLE=Only title'])),{title:'Only title'});
});
test('frame/comment counts bound tag parsing even when the declared tag is otherwise valid',()=>{
 const frames=Array.from({length:128},()=>F.frame('TXXX',F.text('ignore')));frames.push(F.frame('TIT2',F.text('Beyond budget')));assert.deepEqual(M.parse(F.tag(frames)),{});
 assert.deepEqual(M.parse(F.flac([...Array(128).fill('ALBUM=ignored'),'TITLE=Beyond budget'])),{});
});
test('read uses at most a256KiB prefix and128B tail and never asks the source for a full-file buffer',async()=>{
 const calls=[],header=F.tag([F.frame('TIT2',F.text('Title'))]),tail=F.v1('Old','Artist');const file={size:20_000_000,slice(start,end){calls.push([start,end]);return{async arrayBuffer(){const out=Buffer.alloc(end-start);(start===0?header:tail).copy(out);return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);}};}};
 assert.deepEqual(await M.read(file),{title:'Title',artist:'Artist'});assert.deepEqual(calls,[[0,M.MAX_PREFIX],[20_000_000-128,20_000_000]]);assert.equal(calls.reduce((sum,[first,last])=>sum+last-first,0),M.MAX_PREFIX+128);
});
test('aborted or failed metadata reads return an empty fallback and do not continue tail reads',async()=>{
 let release;const bytes=new Promise(resolve=>{release=resolve;}),calls=[],controller=new AbortController(),file={size:1_000_000,slice(start,end){calls.push([start,end]);return{arrayBuffer:()=>bytes};}};
 const task=M.read(file,{signal:controller.signal});controller.abort();assert.deepEqual(await task,{});release(F.tag([F.frame('TIT2',F.text('Late'))]).buffer);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
 assert.deepEqual(await M.read({size:1000,slice(){throw Error('Unavailable file');}}),{});
});
test('metadata deadline returns fallback and a late file read cannot start another read or commit late tags',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;}),calls=[],file={size:1_000_000,slice(start,end){calls.push([start,end]);return{arrayBuffer:()=>pending};}},started=Date.now();
 assert.deepEqual(await M.read(file),{});assert.ok(Date.now()-started>=M.TIMEOUT-50&&Date.now()-started<M.TIMEOUT+1500);release(F.tag([F.frame('TIT2',F.text('Late'))]).buffer);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
});
