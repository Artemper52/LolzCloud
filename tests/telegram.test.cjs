'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {BotState,MediaLinks}=require('../telegram/state.cjs'),{BotCatalog}=require('../telegram/catalog.cjs'),{AudioCache}=require('../telegram/media.cjs'),{MusicBot}=require('../telegram/bot.cjs'),{TelegramApi}=require('../telegram/api.cjs'),{createMediaServer}=require('../telegram/http.cjs');
const song={id:'1930572542',url:'https://soundcloud.com/darkprinceee/gnoy',title:'гной',artist:'тёмный принц',duration:2,cover:''};
function dir(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'lc-telegram-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function state(t){const s=new BotState(path.join(dir(t),'state.json'),'9161396195');t.after(()=>{clearTimeout(s.timer);});s.upsert(song);return s;}
function fixture(t,overrides={}) {
 const s=state(t),calls=[],api={async call(method,body){calls.push({method,body});if(method==='sendAudio')return {audio:{file_id:'test_AudioFileId123456'}};return true;}};
 const cache={state:s,exists:()=>false,async prepare(id){return {track:s.get(id),file:path.join(dir(t),'unused.mp3')};}};
 const links=new MediaLinks('https://lolzcloud.com','x'.repeat(64)),catalog={async search(){return {tracks:[s.get(song.id)],next:'20'};}};
 return {s,calls,bot:new MusicBot({api,state:s,catalog,cache,links,...overrides}),api,cache,links,catalog};
}
test('Telegram state persists bot-scoped file IDs and refuses a different bot without replacing state',t=>{
 const s=state(t);s.file(song.id,'test_AudioFileId123456');s.offset=42;s.save();const bytes=fs.readFileSync(s.filename);const restored=new BotState(s.filename,'9161396195');
 assert.equal(restored.get(song.id).fileId,'test_AudioFileId123456');assert.equal(restored.offset,42);
 assert.throws(()=>new BotState(s.filename,'1000000'),/different Telegram bot/);assert.deepEqual(fs.readFileSync(s.filename),bytes);
});
test('signed audio URLs and callback tokens reject tampering, traversal and cross-purpose reuse',()=>{
 const l=new MediaLinks('https://lolzcloud.com','x'.repeat(64));assert.equal(l.callbackId(l.callback(song.id)),song.id);
 assert.equal(l.callbackId(l.callback(song.id).replace(song.id,'111')),null);assert.equal(l.valid('../x','0'.repeat(24)),false);
 assert.equal(l.valid(song.id,l.signature(song.id,'callback')),false);assert.throws(()=>new MediaLinks('http://localhost','x'.repeat(64)),/HTTPS/);
});
test('search coalesces concurrent queries, paginates and excludes blocked, preview and excessive duration tracks',async t=>{
 const s=state(t);let calls=0;
 const provider={async request(endpoint,params){calls++;assert.equal(params.offset,20);await new Promise(r=>setTimeout(r,5));return {collection:[{id:123,permalink_url:'https://soundcloud.com/artist/song',title:'Песня',duration:90000,streamable:true,user:{username:'Автор'}},{id:124,permalink_url:'https://soundcloud.com/artist/preview',title:'Preview',duration:30000,policy:'SNIP'},{id:125,permalink_url:'https://soundcloud.com/artist/long',title:'Long',duration:2000000}]};}};
 const c=new BotCatalog(s,{provider}),[a,b]=await Promise.all([c.search('Песня',20),c.search('песня',20)]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.tracks.length,1);assert.equal(a.tracks[0].duration,90);
 await assert.rejects(c.search('Песня',-1),/страница/);await assert.rejects(c.search('http://127.0.0.1/secrets'),/Поддерживаются/);
});
test('direct inline mode sends actual audio URLs without depending on chosen-result feedback',async t=>{
 const {bot,calls,links}=fixture(t);await bot.handle({inline_query:{id:'query1',query:'тёмный принц гной',offset:'',from:{id:10}}});
 const a=calls.find(x=>x.method==='answerInlineQuery').body;assert.equal(a.results[0].type,'audio');assert.equal(a.results[0].audio_url,links.audio(song.id));assert.equal(a.results[0].title,'гной');assert.equal(a.next_offset,'20');assert.equal(a.is_personal,false);
 assert.equal(calls.some(x=>x.method==='sendMessage'),false);
});
test('cached inline results reuse Telegram file_id rather than download or URL',async t=>{
 const {bot,s,calls}=fixture(t);const oldSearchRow=s.get(song.id);s.upsert({...song,title:'гной'});s.file(song.id,'test_AudioFileId123456');assert.equal(bot.result(oldSearchRow).audio_file_id,'test_AudioFileId123456');await bot.inline({id:'q',query:'гной',offset:'',from:{id:10}});
 const result=calls[0].body.results[0];assert.equal(result.audio_file_id,'test_AudioFileId123456');assert.equal(result.audio_url,undefined);
});
test('cover mode has real thumbnail, signed retry and replaces chosen result with audio',async t=>{
 const {bot,s,calls}=fixture(t,{inlineArticles:true});s.upsert({...song,cover:'https://i1.sndcdn.com/artworks-test-large.jpg'});
 const result=bot.result(s.get(song.id));assert.equal(result.type,'article');assert.match(result.thumbnail_url,/sndcdn/);assert.ok(bot.links.callbackId(result.reply_markup.inline_keyboard[0][0].callback_data));
 await bot.chosen({result_id:'load_'+song.id,inline_message_id:'inline1'});const edit=calls.find(x=>x.method==='editMessageMedia').body;
 assert.equal(edit.inline_message_id,'inline1');assert.equal(edit.media.type,'audio');assert.equal(edit.media.title,'гной');assert.equal(edit.reply_markup.inline_keyboard[0][0].text,'Ещё у артиста');
});
test('a failed cold inline download keeps a usable retry and source link',async t=>{
 const {bot,calls}=fixture(t,{inlineArticles:true});bot.cache.prepare=async()=>{throw Error('Источник недоступен');};
 await bot.inlineAudio(bot.state.get(song.id),'inline1');const e=calls.find(x=>x.method==='editMessageText').body;
 assert.match(e.text,/Источник недоступен/);assert.equal(e.reply_markup.inline_keyboard[1][0].url,song.url);
});
test('private search returns track choices and ignores ordinary group conversation',async t=>{
 const {bot,calls}=fixture(t);await bot.handle({message:{chat:{id:10,type:'private'},from:{id:10},text:'гной'}});
 assert.equal(calls[0].method,'sendPhoto');assert.match(calls[0].body.caption,/тёмный принц/);assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].text,'Отправить аудио');
 calls.length=0;await bot.handle({message:{chat:{id:-100,type:'supergroup'},from:{id:10},text:'private conversation'}});assert.equal(calls.length,0);
});
test('callback tampering and an unrelated group cannot trigger audio uploads',async t=>{
 const {bot,calls}=fixture(t);await bot.callback({id:'bad',data:'song:1:bad',from:{id:10}});
 await bot.callback({id:'group',data:bot.links.callback(song.id),from:{id:10},message:{chat:{id:-100,type:'supergroup'}}});
 assert.equal(calls.filter(x=>x.method==='answerCallbackQuery').length,2);assert.equal(calls.some(x=>x.method==='sendAudio'),false);
});
test('an invalid saved file_id falls back to uploading the prepared MP3 and replaces the cache entry',async t=>{
 const {bot,s,calls}=fixture(t);s.file(song.id,'test_InvalidAudioId123456');let first=true;
 bot.api.call=async(method,body)=>{calls.push({method,body});if(method==='sendAudio'&&first){first=false;const e=Error('expired');e.code=400;throw e;}return true;};
 let uploaded=0;bot.upload=async(track,chat)=>{uploaded++;assert.equal(chat,10);s.file(track.id,'test_ReplacementId123456');return {audio:{file_id:'test_ReplacementId123456'}};};
 await bot.privateAudio(s.get(song.id),10);assert.equal(uploaded,1);assert.equal(s.get(song.id).fileId,'test_ReplacementId123456');
});
test('concurrent cache-channel uploads share one Telegram file rather than duplicate messages',async t=>{
 const {bot,s}=fixture(t,{cacheChat:'-100123456'});let uploaded=0;
 bot.upload=async(track,chat)=>{assert.equal(chat,'-100123456');uploaded++;await new Promise(r=>setTimeout(r,5));s.file(track.id,'test_CachedId123456');return {audio:{file_id:'test_CachedId123456'}};};
 const ids=await Promise.all([bot.telegramFile(s.get(song.id)),bot.telegramFile(s.get(song.id))]);assert.equal(uploaded,1);assert.deepEqual(ids,['test_CachedId123456','test_CachedId123456']);
});
test('Telegram transport avoids redirects and hides credentials from network errors',async()=>{
 const token='1000000:'+'x'.repeat(35);let call;
 const api=new TelegramApi(token,async(url,options)=>{call={url,options};throw Error(url);});
 await assert.rejects(api.call('getMe'),e=>!e.message.includes(token)&&/network/.test(e.message));assert.equal(call.options.redirect,'error');
 const denied=new TelegramApi(token,async()=>({json:async()=>({ok:false,error_code:429,description:'Slow down',parameters:{retry_after:5}})}));
 await assert.rejects(denied.call('sendMessage'),e=>e.code===429&&e.retryAfter===5);
});
test('public audio HTTP supports HEAD and byte ranges, hides unsigned tracks, and returns real MP3 bytes',async t=>{
 const directory=dir(t),s=state(t),file=path.join(directory,'audio.mp3'),bytes=Buffer.from('ID3'+ 'example-audio'.repeat(20));fs.writeFileSync(file,bytes);
 let prepared=0;const links=new MediaLinks('https://lolzcloud.com','x'.repeat(64)),cache={state:s,async prepare(){prepared++;return {file,track:s.get(song.id)};}};
 const server=createMediaServer({links,cache});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port,url=base+new URL(links.audio(song.id)).pathname;
 assert.equal((await fetch(base+'/telegram/audio/'+song.id+'/'+'0'.repeat(24)+'.mp3')).status,404);assert.equal(prepared,0);
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'audio/mpeg');assert.equal(Number(head.headers.get('content-length')),bytes.length);
 const range=await fetch(url,{headers:{Range:'bytes=3-8'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(3,9));
 const suffix=await fetch(url,{headers:{Range:'bytes=-5'}});assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),bytes.subarray(-5));
 assert.equal((await fetch(url,{headers:{Range:'bytes=100000-'}})).status,416);
 assert.deepEqual(Buffer.from(await(await fetch(url)).arrayBuffer()),bytes);
});
test('real ffmpeg conversion deduplicates downloads, adds Unicode tags and serves the disk cache after restart',async t=>{
 const directory=dir(t),s=state(t),executable=require('ffmpeg-static'),wave=path.join(directory,'fixture.wav');
 execFileSync(executable,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-threads','1',wave],{windowsHide:true});
 let downloads=0;const source={async save(url,file){downloads++;await fsp.copyFile(wave,file);return {track:s.get(song.id),mp3:false};}};
 const opts={directory:path.join(directory,'cache'),state:s,source,executable,maxCacheBytes:10000000};const cache=new AudioCache(opts);t.after(()=>cache.close());
 const [a,b]=await Promise.all([cache.prepare(song.id),cache.prepare(song.id)]);assert.equal(downloads,1);assert.equal(a.file,b.file);assert.equal(fs.readFileSync(a.file).toString('ascii',0,3),'ID3');
 const metadata=execFileSync(executable,['-hide_banner','-i',a.file,'-f','ffmetadata','-'],{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.match(metadata,/title=гной/);assert.match(metadata,/artist=тёмный принц/);
 const restored=new AudioCache(opts);t.after(()=>restored.close());assert.equal((await restored.prepare(song.id)).cached,true);assert.equal(downloads,1);
 assert.deepEqual(fs.readdirSync(opts.directory),[song.id+'.mp3']);
});
test('failed audio preparation removes partial source files and can be retried',async t=>{
 const directory=dir(t),s=state(t);let tries=0;
 const cache=new AudioCache({directory,state:s,source:{async save(url,file){tries++;await fsp.writeFile(file,'partial');throw Error('No source');}},executable:'unused'});t.after(()=>cache.close());
 await assert.rejects(cache.prepare(song.id),/No source/);await assert.rejects(cache.prepare(song.id),/No source/);assert.equal(tries,2);assert.deepEqual(fs.readdirSync(directory),[]);
});
test('MP3 cover is embedded and an actual multipart upload stores the Telegram file identifier',async t=>{
 const directory=dir(t),s=state(t),executable=require('ffmpeg-static'),wave=path.join(directory,'fixture.wav'),cover=path.join(directory,'fixture.png');
 execFileSync(executable,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2',wave],{windowsHide:true});
 execFileSync(executable,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x55aa77:s=64x64','-frames:v','1','-threads','1',cover],{windowsHide:true});
 s.upsert({...song,cover:'https://i1.sndcdn.com/fixture.png'});
 const cache=new AudioCache({directory:path.join(directory,'cache'),state:s,executable,fetcher:async()=>new Response(fs.readFileSync(cover)),source:{async save(url,file){await fsp.copyFile(wave,file);return {track:s.get(song.id)};}}});t.after(()=>cache.close());
 const audio=await cache.prepare(song.id);
 const jpg=execFileSync(executable,['-hide_banner','-loglevel','error','-i',audio.file,'-map','0:v:0','-frames:v','1','-f','image2pipe','-vcodec','mjpeg','-threads','1','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 assert.deepEqual(jpg.subarray(0,3),Buffer.from([255,216,255]));
 let uploads=0;const api={async call(method,body){assert.equal(method,'sendAudio');assert.ok(body instanceof FormData);assert.equal(body.get('chat_id'),'10');assert.equal(body.get('title'),'гной');assert.equal(body.get('performer'),'тёмный принц');assert.deepEqual(Buffer.from(await body.get('audio').arrayBuffer()),fs.readFileSync(audio.file));uploads++;return {audio:{file_id:'test_MultipartFileId123456'}};}};
 const bot=new MusicBot({api,state:s,cache,links:new MediaLinks('https://lolzcloud.com','x'.repeat(64))});await bot.upload(s.get(song.id),10);assert.equal(uploads,1);assert.equal(s.get(song.id).fileId,'test_MultipartFileId123456');
});
test('welcome sends the real branded image once and reuses its persistent Telegram photo ID',async t=>{
 const {bot,s}=fixture(t);let uploaded=0,reused=0;
 bot.api.call=async(method,body)=>{assert.equal(method,'sendPhoto');if(body instanceof FormData){uploaded++;assert.ok(body.get('photo').size>1000);assert.match(body.get('caption'),/@lolzcloudbot/);const buttons=JSON.parse(body.get('reply_markup'));assert.equal(buttons.inline_keyboard[0][0].switch_inline_query,'');return {photo:[{file_id:'test_WelcomePhotoId123456'}]};}reused++;assert.equal(body.photo,'test_WelcomePhotoId123456');return true;};
 await bot.message({chat:{id:10,type:'private'},from:{id:10},text:'/start'});await bot.message({chat:{id:10,type:'private'},from:{id:10},text:'/start'});
 assert.equal(uploaded,1);assert.equal(reused,1);assert.equal(new BotState(s.filename,'9161396195').assets.welcome.fileId,'test_WelcomePhotoId123456');
});
test('carousel edits the same message, escapes track metadata and prevents another account from browsing it',async t=>{
 const {bot,s,calls}=fixture(t);s.upsert({...song,id:'123',url:'https://soundcloud.com/test/second',title:'<Second & song>',artist:'Artist <2>',cover:'https://i1.sndcdn.com/second.jpg'});
 const session=bot.presentation.createSession(10,'songs',{tracks:[s.get(song.id),s.get('123')],next:''});
 const data=`view:${session.id}:1`;
 await bot.callback({id:'nav',data,from:{id:10},message:{message_id:50,chat:{id:10,type:'private'}}});
 const edited=calls.find(x=>x.method==='editMessageMedia').body;assert.equal(edited.message_id,50);assert.equal(edited.chat_id,10);assert.match(edited.media.caption,/&lt;Second &amp; song&gt;/);assert.match(edited.media.caption,/2 \/ 2/);assert.equal(edited.media.media,'https://i1.sndcdn.com/second.jpg');
 calls.length=0;await bot.callback({id:'intruder',data,from:{id:11},message:{message_id:50,chat:{id:11,type:'private'}}});assert.equal(calls.some(x=>x.method==='editMessageMedia'),false);assert.equal(calls[0].body.show_alert,true);
});
test('carousel lazily fetches the next catalogue page and expiration gives an explicit retry path',async t=>{
 const {bot,s,calls}=fixture(t);s.upsert({...song,id:'123',url:'https://soundcloud.com/test/second',title:'Second'});
 const session=bot.presentation.createSession(10,'songs',{tracks:[s.get(song.id)],next:'20'});let fetched=0;
 bot.catalog.search=async(q,offset)=>{fetched++;assert.equal(q,'songs');assert.equal(offset,20);return {tracks:[s.get('123')],next:''};};
 await bot.callback({id:'nextpage',data:`view:${session.id}:1`,from:{id:10},message:{message_id:50,chat:{id:10,type:'private'}}});assert.equal(fetched,1);assert.match(calls.find(x=>x.method==='editMessageMedia').body.media.caption,/Second/);
 calls.length=0;session.expires=0;await bot.callback({id:'expired',data:`view:${session.id}:0`,from:{id:10},message:{message_id:50,chat:{id:10,type:'private'}}});assert.equal(calls[0].body.show_alert,true);assert.match(calls[0].body.text,/устарела/);
});
test('a missing album cover switches to the brand image instead of retaining the previous song artwork',async t=>{
 const {bot,s,calls}=fixture(t);const session=bot.presentation.createSession(10,'songs',{tracks:[s.get(song.id)],next:''});let failed=false;
 bot.api.call=async(method,body)=>{calls.push({method,body});if(method==='editMessageMedia'&&!failed){failed=true;const e=Error('Failed to fetch cover');e.code=400;throw e;}return true;};
 await bot.callback({id:'coverretry',data:`view:${session.id}:0`,from:{id:10},message:{message_id:50,chat:{id:10,type:'private'}}});
 const edits=calls.filter(x=>x.method==='editMessageMedia');assert.equal(edits.length,2);assert.equal(edits[1].body.media.media,'https://lolzcloud.com/telegram/assets/welcome.jpg');assert.equal(session.index,0);
});
test('chosen cached audio is already delivered and is never converted or fetched again',async t=>{
 const {bot,s,calls}=fixture(t,{inlineArticles:true});s.file(song.id,'test_CachedFileId123456');let prepared=0;bot.cache.prepare=async()=>{prepared++;throw Error('must not download');};
 await bot.chosen({result_id:'sc_'+song.id,inline_message_id:'delivered'});assert.equal(prepared,0);assert.equal(calls.length,0);
 await bot.inlineAudio(s.get(song.id),'placeholder');assert.equal(prepared,0);assert.equal(calls[0].body.media.media,'test_CachedFileId123456');
});
test('double tapping download sends one audio while another request is in flight',async t=>{
 const {bot,calls}=fixture(t);let release,started,sends=0;const waiting=new Promise(r=>release=r),began=new Promise(r=>started=r);
 bot.privateAudio=async()=>{sends++;started();await waiting;};const query={id:'first',data:bot.links.callback(song.id),from:{id:10},message:{chat:{id:10,type:'private'}}};
 const first=bot.callback(query);await began;await bot.callback({...query,id:'second'});assert.equal(sends,1);assert.match(calls.at(-1).body.text,/уже загружается/);release();await first;
});
test('brand image hash prevents reusing an obsolete Telegram welcome asset',t=>{
 const s=state(t);s.setAsset('welcome','a'.repeat(64),'test_PhotoId123456');assert.equal(s.asset('welcome','a'.repeat(64)),'test_PhotoId123456');assert.equal(s.asset('welcome','b'.repeat(64)),null);s.setAsset('welcome','b'.repeat(64),'test_NewPhotoId123456');assert.equal(new BotState(s.filename,'9161396195').asset('welcome','b'.repeat(64)),'test_NewPhotoId123456');
});
test('public welcome JPEG matches the actual branded asset and supports HEAD',async t=>{
 const {cache,links}=fixture(t);const server=createMediaServer({cache,links});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const url='http://127.0.0.1:'+server.address().port+'/telegram/assets/welcome.jpg';
 const r=await fetch(url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync(path.join(__dirname,'../telegram/assets/welcome.jpg')));const h=await fetch(url,{method:'HEAD'});assert.equal(h.status,200);assert.ok(Number(h.headers.get('content-length'))>1000);const icon=await fetch(url.replace('welcome.jpg','icon.png'));assert.equal(icon.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await icon.arrayBuffer()),fs.readFileSync(path.join(__dirname,'../telegram/assets/icon.png')));
});
