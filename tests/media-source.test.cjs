'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mediaUrl,provider,youtubeId}=require('../server/public/media-source.js');
const {normalizePlayback,validateSettings,DEFAULT_SETTINGS}=require('../source/integrations/lolzteam/status.cjs');
const {playback,CloudStore}=require('../server/core.cjs');
const {RoomEngine}=require('../server/room-engine.cjs');
const {PlayerServices}=require('../server/player-services.cjs');
const {RoomCatalog}=require('../server/catalog.cjs');
test('shared media URLs accept exact provider origins and canonicalize YouTube links',()=>{
  const expected='https://music.youtube.com/watch?v=p-LBiCtzXu0';
  for(const url of [expected+'&list=example','https://youtu.be/p-LBiCtzXu0?t=5','https://www.youtube.com/watch?v=p-LBiCtzXu0','https://www.youtube-nocookie.com/embed/p-LBiCtzXu0'])assert.equal(mediaUrl(url),expected);
  for(const url of ['http://music.youtube.com/watch?v=p-LBiCtzXu0','https://youtube.com.evil.com/watch?v=p-LBiCtzXu0','https://evil.com/watch?v=p-LBiCtzXu0','https://user:pass@music.youtube.com/watch?v=p-LBiCtzXu0','https://music.youtube.com:8443/watch?v=p-LBiCtzXu0','javascript:alert(1)','file:///track.mp3','https://youtu.be/short','https://soundcloud.com/artist/sets/collection'])assert.equal(mediaUrl(url),'');
  assert.equal(mediaUrl('https://www.soundcloud.com/artist/song?secret=discarded'),'https://soundcloud.com/artist/song');
  assert.equal(provider(expected),'youtube');assert.equal(youtubeId(expected),'p-LBiCtzXu0');
  assert.equal(normalizePlayback({title:'Song',url:expected}).url,expected);
  assert.deepEqual(validateSettings({excludedTracks:[expected]},DEFAULT_SETTINGS).excludedTracks,[expected]);
  assert.equal(playback({fresh:true,playback:{title:'Song',url:expected}}).url,expected);
});
test('room queue, permissions and authoritative state support mixed providers',()=>{
  const owner={id:1,name:'Owner'},listener={id:2,name:'Listener'},store=new CloudStore(),engine=new RoomEngine(store),services=new PlayerServices(store,engine),room=store.createRoom(owner);
  try{
    const control=engine.control(room.id,owner,{type:'claim',connection:'owner-device',force:true});
    engine.join(room.id,listener,{connection:'listener-device'});
    const url='https://music.youtube.com/watch?v=p-LBiCtzXu0';
    services.queue(room.id,listener,{type:'add',track:{url,title:'Song'}});
    const row=services.queueView(store.room(room.id),owner)[0];assert.equal(row.approved,false);
    assert.throws(()=>services.queue(room.id,listener,{type:'approve',id:row.id}),e=>e.status===403);
    services.queue(room.id,owner,{type:'approve',id:row.id});
    const next=services.queue(room.id,owner,{type:'next',connection:'owner-device',lease:control.lease});assert.equal(next.track.url,url);
    store.updateRoom(room.id,owner,{connection:'owner-device',lease:control.lease,sequence:1,fresh:true,playback:{url,title:'Song',duration:200,position:40,playing:true}});
    assert.equal(store.viewRoom(store.room(room.id),listener).playback.url,url);
    assert.throws(()=>store.updateRoom(room.id,listener,{fresh:true,playback:{url}}),e=>e.status===403||e.status===409);
  }finally{engine.dispose();}
});
test('room catalog coalesces searches, filters unavailable tracks and keeps bounded cache',async()=>{
  let queries=0;
  const catalog=new RoomCatalog(async url=>{
    if(url==='https://soundcloud.com/')return new Response('<script>var client_id="'+'a'.repeat(32)+'"</script>');
    queries++;const parsed=new URL(url);assert.equal(parsed.origin,'https://api-v2.soundcloud.com');assert.equal(parsed.searchParams.get('q'),'Test song');
    return Response.json({collection:[{permalink_url:'https://soundcloud.com/artist/song',title:'Song',duration:123000,user:{username:'Artist'}},{permalink_url:'https://soundcloud.com/artist/blocked',title:'Blocked',streamable:false},{permalink_url:'https://evil.com/track',title:'Unsafe'}]});
  });
  const [one,two]=await Promise.all([catalog.search('Test song'),catalog.search('Test song')]);assert.deepEqual(one,two);assert.equal(queries,1);assert.equal(one.length,1);assert.equal(one[0].duration,123);
  await catalog.search('TEST SONG');assert.equal(queries,1);assert.deepEqual(await catalog.search('x'),[]);
});
