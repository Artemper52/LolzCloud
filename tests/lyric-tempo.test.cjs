'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../source/app/lib/js/lyric-tempo.js'),{parseLrc}=require('../source/integrations/lyric-formats.cjs'),{LyricsEngine}=require('../source/integrations/lyric-providers.cjs'),{LyricsLibrary}=require('../source/integrations/lyrics.cjs');
const row=(duration=100,more={})=>({id:10,trackName:'Original song',artistName:'Singer',duration,syncedLyrics:'[00:10.00]<00:10.00>One <00:12.00>line\n[00:50.00]Another original line',plainLyrics:'One line\nAnother original line',...more});
const track=(title='Original song (speed up)',duration=80)=>({title,artist:'Singer',duration,url:'https://soundcloud.com/fixture/tempo-song'});
const pick=(rows,target)=>T.selectRecord(rows,target,{parseLines:parseLrc});
test('tempo qualifiers are removed without discarding recording versions or real song titles',()=>{
 for(const suffix of ['(speed up)','[sped-up]','speedup','(nightcore)','(ускоренная версия)','(спид ап)']){const v=T.detectVariant('Original song '+suffix);assert.equal(v.title,'Original song',suffix);assert.equal(v.kind,'faster',suffix);}
 for(const suffix of ['(slowed + reverb)','(slowed & reverb)','[slowed down]','(замедленная версия)','(слоуд)']){const v=T.detectVariant('Original song '+suffix);assert.equal(v.title,'Original song',suffix);assert.equal(v.kind,'slower',suffix);}
 assert.equal(T.detectVariant('Original song (remix speed up)').title,'Original song (remix)');
 for(const name of ['Speed Up','Slowed','Speed up the night','Original song (cover)','Original song (live)','Original song (Nightcoreland remix)'])assert.equal(T.detectVariant(name).marked,false,name);
});
test('speedup and slowed retime existing line and word timestamps exactly once',()=>{
 const original=row(),before=JSON.stringify(original),fast=pick([original],track());assert.equal(fast.adapted,true);assert.equal(fast.tempo.rate,1.25);assert.equal(fast.lines[0].time,8);assert.equal(fast.lines[0].words[1].time,9.6);assert.equal(fast.lines[1].time,40);assert.equal(JSON.stringify(original),before);
 const slow=pick([original],track('Original song (slowed)',125));assert.equal(slow.tempo.rate,.8);assert.equal(slow.lines[0].time,12.5);assert.equal(slow.lines[1].time,62.5);
 assert.equal(T.adaptTimings(fast,{rate:1.25,referenceDuration:100,sourceDuration:80}),null,'An adapted result may not be scaled twice');
 const ended=T.adaptTimings({lines:[{time:10,end:15,text:'One line',words:[{time:10,end:15,text:'One line'}]}]},{rate:1.25,referenceDuration:100,sourceDuration:80});assert.equal(ended.lines[0].end,12);assert.equal(ended.lines[0].words[0].end,12);
});
test('an existing synced modified recording wins and is not retimed a second time',()=>{
 const exact=row(80,{id:11,trackName:'Original song (sped up)',syncedLyrics:'[00:07.00]Exact version line'}),result=pick([row(),exact],track());assert.equal(result.recordId,11);assert.equal(result.adapted,false);assert.equal(result.lines[0].time,7);
});
test('ambiguity, changed arrangements, implausible direction and excerpts stay unsynchronized',()=>{
 for(const [rows,target]of [
  [[row(),row(120,{id:12,syncedLyrics:'',plainLyrics:'Second original arrangement'})],track()],
  [[row()],track('Original song (slowed)',80)],[[row()],track('Original song (speed up)',125)],
  [[row()],track('Original song (speed up preview)',40)],[[row()],track('Original song (speed up)',15)],
  [[row()],track('Original song (speed up slowed)',80)],
  [[row()],track('Original song (speed up без вступления)',80)],
  [[row()],track('Original song (speed up intro cut)',80)],
 ]){const result=pick(rows,target);if(!result){assert.equal(T.detectVariant(target.title).unsafe,true);continue;}assert.equal(result.lines.length,0);assert.equal(result.versionMismatch,true);assert.equal(result.adapted,false);}
 const trimmed=pick([row()],{...track('Original song',80),variantTitle:'Original song (speed up intro cut)'});assert.equal(trimmed.lines.length,0);assert.equal(trimmed.versionMismatch,true);
 assert.equal(pick([row()],track('Original song (remix speed up)')),null);
 assert.equal(pick([row(100,{artistName:'Another singer'})],track()),null);
 assert.equal(pick([row(100,{artistName:'Singer, Guest A'})],{...track(),artist:'Singer, Guest B'}),null);
});
test('an explicit speed factor narrows reference recordings only when duration agrees',()=>{
 const result=pick([row(),row(120,{id:12})],track('Original song (speed up 1.25x)',80));assert.equal(result.tempo.rate,1.25);assert.equal(result.recordId,10);
 const mismatch=pick([row()],track('Original song (speed up 1.5x)',80));assert.equal(mismatch.lines.length,0);assert.equal(mismatch.versionMismatch,true);
 assert.equal(T.detectVariant('Original song (slowed 1.25x)').kind,'mixed');
});
test('strong distinct catalogue consensus can resolve polluted copied-duration rows without another request',()=>{
 const original=Array.from({length:5},(_,i)=>row(111,{id:20+i})),copies=[98,125,175,180,102,146].map((seconds,i)=>row(seconds,{id:50+i}));
 const result=pick([...original,...copies],track(undefined,98));assert.equal(result.adapted,true);assert.equal(result.tempo.referenceDuration,111);assert.equal(result.tempo.rate,111/98);assert.equal(result.tempo.referenceEvidence,'catalog-consensus');
 const duplicate=pick([...Array.from({length:10},()=>row(111,{id:20})),row(125,{id:30})],track(undefined,98));assert.equal(duplicate.lines.length,0,'Repeating one ID must not manufacture independent votes');
 const divided=pick([...original,...Array.from({length:3},(_,i)=>row(125,{id:60+i}))],track(undefined,98));assert.equal(divided.lines.length,0,'Competing substantial reference durations remain ambiguous');
 const conflicting=pick([row(111,{id:1}),row(111,{id:2}),row(111,{id:3}),row(125,{id:1}),row(125,{id:4})],track(undefined,98));assert.equal(conflicting.lines.length,0,'A conflicting duplicate ID cannot establish a reference-duration consensus');
});
test('the canonical lyric query is cached across speed variants and never includes playback rate',async()=>{
 const calls=[],engine=new LyricsEngine({fetcher:async url=>{calls.push(url);const u=new URL(url);assert.equal(u.pathname,'/api/search');assert.equal(u.searchParams.get('track_name'),'Original song');assert.equal(u.searchParams.get('artist_name'),'Singer');assert.equal(u.searchParams.has('duration'),false);return new Response(JSON.stringify([row()]));}});
 const fast=await engine.search({...track(),rate:1.75}),slow=await engine.search({...track('Original song (slowed)',125),rate:.5});assert.equal(fast.lines[1].time,40);assert.equal(slow.lines[1].time,62.5);assert.equal(calls.length,1);assert.equal(fast.tempo.estimated,true);
});
test('parallel versions share one canonical request and cancellation releases only its own subscriber',async()=>{
 let calls=0,release;const engine=new LyricsEngine({fetcher:async()=>{calls++;return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify([row()])));});}}),a=new AbortController(),b=new AbortController();
 const first=engine.search(track(),{signal:a.signal}),second=engine.search(track('Original song (slowed)',125),{signal:b.signal});await Promise.resolve();a.abort();release();await assert.rejects(first);const result=await second;assert.equal(result.lines[1].time,62.5);assert.equal(calls,1);assert.equal(engine.tempoPending.size,0);
});
test('unknown duration can show cached words then gain timings without a second HTTP request',async()=>{
 let calls=0;const engine=new LyricsEngine({fetcher:async()=>{calls++;return new Response(JSON.stringify([row()]));}}),library=new LyricsLibrary((t,o)=>engine.search(t,o));
 const unknown=await library.load(track(undefined,0));assert.equal(unknown.lines.length,0);assert.ok(unknown.plain);
 const known=await library.load(track());assert.equal(known.lines[1].time,40);assert.equal(calls,1);
});

test('canonical searches respect a provider rate limit across other speed variants and tracks',async()=>{
 let calls=0,now=1000;const engine=new LyricsEngine({now:()=>now,fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});}});
 await assert.rejects(engine.canonicalTempoRows(track()),error=>error.code==='limited');
 await assert.rejects(engine.canonicalTempoRows(track('Another song (slowed)',125)),error=>error.code==='limited');assert.equal(calls,1);
 now+=120001;await assert.rejects(engine.canonicalTempoRows(track()),error=>error.code==='limited');assert.equal(calls,2);
});
