'use strict';
const fs=require('node:fs'), fsp=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {SoundCloudAudioSource}=require('../source/integrations/audio-download.cjs');
const {clean}=require('./state.cjs');
async function coverBytes(url,fetcher,signal) {
  if(!/^https:\/\/(?:[^./]+\.)?sndcdn\.com\//.test(url||''))return null;
  const r=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(6000)]),redirect:'error'});
  if(!r.ok||Number(r.headers.get('content-length'))>1000000){await r.body?.cancel();return null;}
  const chunks=[];let size=0;for await(const b of r.body||[]){size+=b.length;if(size>1000000)throw Error('Cover is too large');chunks.push(Buffer.from(b));}
  const b=Buffer.concat(chunks);return b.subarray(0,3).equals(Buffer.from([255,216,255]))||b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?b:null;
}
function convert(executable,args,signal) {
  return new Promise((resolve,reject)=>{
    const p=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let micros=0,timer;
    const abort=()=>{p.kill();timer=setTimeout(()=>p.kill('SIGKILL'),1500);timer.unref?.();};
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    p.stdout.on('data',chunk=>{for(const m of chunk.toString().matchAll(/out_time_us=(\d+)/g))micros=Math.max(micros,Number(m[1]));});
    p.stderr.on('data',()=>{});
    const end=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
    p.once('error',()=>{end();reject(Error('Не удалось запустить конвертер аудио.'));});
    p.once('close',code=>{end();if(code===0&&!signal.aborted)resolve(micros/1000000);else reject(Error('Не удалось подготовить MP3. Попробуйте другой трек или повторите загрузку.'));});
  });
}
class AudioCache {
  constructor({directory,state,provider,executable='/usr/bin/ffmpeg',fetcher=fetch,source,maxBytes=20000000,maxCacheBytes=2*1024**3,maxDuration=1200,prepareTimeoutMs=110000}) {
    Object.assign(this,{directory:path.resolve(directory),state,executable,fetcher,maxBytes,maxCacheBytes,maxDuration,prepareTimeoutMs});
    this.source=source||new SoundCloudAudioSource(provider,fetcher);this.pending=new Map();this.active=0;this.waiters=[];this.closed=false;this.controllers=new Set();this.readers=new Map();this.files=Promise.resolve();
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    for(const name of fs.readdirSync(this.directory))if(/^\d+\.[a-f0-9-]{36}\.(?:source|cover|thumb\.jpg|mp3\.part)$/.test(name))fs.rmSync(path.join(this.directory,name),{force:true});
  }
  filename(id) {if(!/^[1-9]\d{0,15}$/.test(String(id)))throw Error('Некорректный трек.');return path.join(this.directory,id+'.mp3');}
  exists(id) {try{return fs.statSync(this.filename(id)).size>128;}catch{return false;}}
  async enter(signal) {
    signal.throwIfAborted();
    if(this.active<2){this.active++;return;}
    if(this.waiters.length>=20)throw Error('Сейчас много загрузок. Попробуйте через несколько секунд.');
    await new Promise((resolve,reject)=>{
      const row={resolve:()=>{signal.removeEventListener('abort',abort);resolve();},reject};
      const abort=()=>{const i=this.waiters.indexOf(row);if(i>=0)this.waiters.splice(i,1);reject(signal.reason);};
      this.waiters.push(row);signal.addEventListener('abort',abort,{once:true});
    });
  }
  leave() {const next=this.waiters.shift();if(next)next.resolve();else this.active--;}
  withFiles(work) {const result=this.files.then(work);this.files=result.catch(()=>{});return result;}
  async open(id) {
    id=String(id);
    return this.withFiles(async()=>{
      const handle=await fsp.open(this.filename(id),'r');let released=false;
      this.readers.set(id,(this.readers.get(id)||0)+1);
      const release=()=>{if(released)return;released=true;const count=this.readers.get(id)||0;if(count<=1)this.readers.delete(id);else this.readers.set(id,count-1);};
      try {const stat=await handle.stat();if(stat.size<=128)throw Error('Аудиофайл ещё не готов.');await fsp.utimes(this.filename(id),new Date(),new Date()).catch(()=>{});return {handle,stat,release};}
      catch(error){release();await handle.close();throw error;}
    });
  }
  async prepare(id) {
    const track=this.state.get(id);if(!track||!track.duration||track.duration>this.maxDuration)throw Error('Трек недоступен или слишком длинный. Выберите другой результат.');
    const file=this.filename(id);
    if(this.exists(id)){fsp.utimes(file,new Date(),new Date()).catch(()=>{});return {file,track,cached:true};}
    if(this.pending.has(String(id)))return this.pending.get(String(id));
    if(this.closed)throw Error('Сервис перезапускается. Повторите загрузку.');
    const control=new AbortController(),timer=setTimeout(()=>control.abort(Error('Подготовка заняла слишком много времени. Повторите попытку.')),this.prepareTimeoutMs);this.controllers.add(control);
    const task=(async()=>{let entered=false;try{await this.enter(control.signal);entered=true;control.signal.throwIfAborted();return await this.download(track,file,control.signal);}finally{if(entered)this.leave();clearTimeout(timer);this.controllers.delete(control);}})();
    this.pending.set(String(id),task);try{return await task;}finally{this.pending.delete(String(id));}
  }
  async download(track,file,signal) {
    const base=path.join(this.directory,track.id+'.'+randomUUID()),input=base+'.source',rawCover=base+'.cover',thumb=base+'.thumb.jpg',output=base+'.mp3.part';
    try {
      const audio=await this.source.save(track.url,input,{signal,onProgress:p=>{if(p.bytes>80000000)throw Error('Исходная запись слишком большая.');}});
      if(audio.track.duration>this.maxDuration)throw Error('Трек слишком длинный.');
      let hasCover=false;
      try {
        const bytes=await coverBytes(audio.track.cover||track.cover,this.fetcher,signal);
        if(bytes){await fsp.writeFile(rawCover,bytes);await convert(this.executable,['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',rawCover,'-vf','scale=320:320:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1',thumb],signal);hasCover=(await fsp.stat(thumb)).size<200000;}
      }catch{signal.throwIfAborted();}
      const args=['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input];
      if(hasCover)args.push('-i',thumb);
      args.push('-map','0:a:0');if(hasCover)args.push('-map','1:v:0','-c:v','copy','-disposition:v','attached_pic');else args.push('-vn');
      args.push('-sn','-dn','-map_metadata','-1','-c:a','libmp3lame','-b:a','128k','-ar','44100','-threads','1','-metadata','title='+clean(audio.track.title),'-metadata','artist='+clean(audio.track.artist,100),'-id3v2_version','3','-progress','pipe:1','-f','mp3',output);
      const seconds=await convert(this.executable,args,signal);
      if(track.duration>20&&seconds<track.duration*.8)throw Error('Источник отдал только отрывок. Неполная запись не отправлена.');
      const stat=await fsp.stat(output);if(stat.size<128||stat.size>this.maxBytes)throw Error('Аудио превышает ограничение размера Telegram. Выберите более короткий трек.');
      await this.withFiles(async()=>{signal.throwIfAborted();await this.pruneFiles(stat.size,new Set([String(track.id)]));signal.throwIfAborted();await fsp.rename(output,file);});
      return {file,track:this.state.upsert({...track,...audio.track,id:track.id}),cached:false};
    } finally {
      await Promise.all([input,rawCover,thumb,output].map(p=>fsp.rm(p,{force:true}).catch(()=>{})));
    }
  }
  prune(incoming=0,protectedIds=new Set()) {return this.withFiles(()=>this.pruneFiles(incoming,protectedIds));}
  async pruneFiles(incoming=0,protectedIds=new Set()) {
    const rows=[];for(const name of await fsp.readdir(this.directory)){const m=name.match(/^([1-9]\d{0,15})\.mp3$/);if(!m)continue;const stat=await fsp.stat(path.join(this.directory,name));rows.push({name,id:m[1],size:stat.size,time:stat.mtimeMs});}
    let total=rows.reduce((n,r)=>n+r.size,0)+incoming;
    for(const row of rows.sort((a,b)=>a.time-b.time)) {
      if(total<=this.maxCacheBytes)break;
      if(protectedIds.has(row.id)||this.pending.has(row.id)||this.readers.has(row.id)||Date.now()-row.time<180000)continue;
      await fsp.rm(path.join(this.directory,row.name),{force:true});total-=row.size;
    }
    if(total>this.maxCacheBytes)throw Error('Кэш временно заполнен. Повторите загрузку чуть позже.');
  }
  close() {this.closed=true;for(const c of this.controllers)c.abort(Error('Сервис перезапускается. Повторите загрузку.'));}
}
module.exports={AudioCache,coverBytes,convert};
