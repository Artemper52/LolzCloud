'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHmac, timingSafeEqual } = require('node:crypto');
const validId = value => /^[1-9]\d{0,15}$/.test(String(value || ''));
function clean(value, max = 180) { return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function publicTrack(value) {
  if (!validId(value?.id) || !/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/.test(value?.url || '') || !clean(value.title)) return null;
  return { id: String(value.id), url: value.url, title: clean(value.title), artist: clean(value.artist, 100), duration: Math.max(0, Math.round(Number(value.duration) || 0)), cover: /^https:\/\/(?:[^./]+\.)?sndcdn\.com\//.test(value.cover || '') ? value.cover.slice(0, 2048) : '' };
}
class BotState {
  constructor(filename, botId) {
    this.filename = filename; this.botId = String(botId); this.offset = 0; this.tracks = new Map(); this.assets = {}; this.timer = null;
    if (fs.existsSync(filename)) {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (data.botId !== this.botId) throw Error('Bot state belongs to a different Telegram bot');
      this.offset = Number.isSafeInteger(data.offset) ? data.offset : 0;
      for(const [key,value]of Object.entries(data.assets||{}))if(/^[a-z-]{1,30}$/.test(key)&&/^[a-f0-9]{64}$/.test(value?.hash||'')&&/^[\w-]{10,512}$/.test(value?.fileId||''))this.assets[key]={hash:value.hash,fileId:value.fileId};
      for (const value of (data.tracks || []).slice(-10000)) {
        const row = publicTrack(value); if (!row) continue;
        this.tracks.set(row.id, { ...row, hits: Math.max(0, Number(value.hits) || 0), seen: Number(value.seen) || 0, ...(typeof value.fileId === 'string' && /^[\w-]{10,512}$/.test(value.fileId) ? { fileId: value.fileId } : {}) });
      }
    }
  }
  upsert(value) {
    const track = publicTrack(value); if (!track) return null;
    const old = this.tracks.get(track.id);
    const row = { ...old, ...track, seen: Date.now(), hits: old?.hits || 0 };
    this.tracks.set(row.id, row);
    if (this.tracks.size > 10000) {
      const expired = [...this.tracks.values()].filter(x => !x.fileId).sort((a,b) => a.seen-b.seen).slice(0, 500);
      for (const x of expired) this.tracks.delete(x.id);
      if (this.tracks.size > 10000) this.tracks.delete(this.tracks.keys().next().value);
    }
    this.changed(); return row;
  }
  get(id) { return this.tracks.get(String(id)); }
  popular(limit = 20) { return [...this.tracks.values()].filter(x => x.fileId || x.hits).sort((a,b) => b.hits-a.hits || b.seen-a.seen).slice(0,limit); }
  file(id, fileId) { const row=this.get(id); if (!row) return; if (fileId) row.fileId=fileId; else delete row.fileId; this.save(); }
  chosen(id) { const row=this.get(id); if (row) { row.hits++; row.seen=Date.now(); this.changed(); } }
  asset(key,hash) {return this.assets[key]?.hash===hash?this.assets[key].fileId:null;}
  setAsset(key,hash,fileId) {if(!/^[a-z-]{1,30}$/.test(key)||!/^[a-f0-9]{64}$/.test(hash)||!/^[\w-]{10,512}$/.test(fileId))return;this.assets[key]={hash,fileId};this.save();}
  changed() { if (!this.timer) { this.timer=setTimeout(()=>{this.timer=null;try{this.save();}catch{process.stderr.write('Bot state could not be saved\n');}},300);this.timer.unref?.(); } }
  save() {
    clearTimeout(this.timer); this.timer=null;
    fs.mkdirSync(path.dirname(this.filename), {recursive:true,mode:0o700});
    fs.writeFileSync(this.filename+'.tmp',JSON.stringify({version:1,botId:this.botId,offset:this.offset,assets:this.assets,tracks:[...this.tracks.values()]}),{mode:0o600});
    fs.renameSync(this.filename+'.tmp',this.filename);
  }
}
class MediaLinks {
  constructor(origin, secret, { prefix = '/telegram' } = {}) {
    const url=new URL(origin); if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw Error('Use a public HTTPS origin');
    if(typeof secret!=='string' || secret.length<32)throw Error('Media signing secret must have at least 32 characters');
    if(!['/telegram','/music'].includes(prefix))throw Error('Invalid media route');
    this.origin=url.origin;this.secret=secret;this.prefix=prefix;
  }
  signature(id, kind='audio') { return createHmac('sha256',this.secret).update((this.prefix==='/music'?'music:':'')+kind+':'+String(id)).digest('hex').slice(0,24); }
  valid(id,sig,kind='audio') { if(!validId(id)||!/^[a-f0-9]{24}$/.test(sig||''))return false;return timingSafeEqual(Buffer.from(sig),Buffer.from(this.signature(id,kind))); }
  audio(id) { return `${this.origin}${this.prefix}/audio/${id}/${this.signature(id)}.mp3`; }
  callback(id) { return `song:${id}:${this.signature(id,'callback')}`; }
  callbackId(value) { const m=String(value||'').match(/^song:([1-9]\d{0,15}):([a-f0-9]{24})$/);return m&&this.valid(m[1],m[2],'callback')?m[1]:null; }
}
module.exports={BotState,MediaLinks,publicTrack,clean,validId};
