'use strict';
const { SoundCloudDiscovery, normalizeTrack } = require('../source/integrations/discovery.cjs');
const { supportedTranscoding } = require('../source/integrations/audio-download.cjs');
const { clean } = require('./state.cjs');
class BotCatalog {
  constructor(state,{provider=new SoundCloudDiscovery(),maxDuration=1200}={}) { Object.assign(this,{state,provider,maxDuration});this.cache=new Map();this.pending=new Map(); }
  async track(id) {
    id=String(id);if(!/^[1-9]\d{0,15}$/.test(id))return null;
    const known=this.state.get(id);if(known)return known;
    const key='track:'+id;if(this.pending.has(key))return this.pending.get(key);
    const task=(async()=>{const raw=await this.provider.request('/tracks/'+id,{},{signal:AbortSignal.timeout(7000)}),row=this.normalize(raw);return row&&String(row.id)===id?this.state.upsert(row):null;})();
    this.pending.set(key,task);try{return await task;}finally{this.pending.delete(key);}
  }
  async search(query,offset=0) {
    query=clean(query,140);offset=Number(offset);
    if(!Number.isInteger(offset)||offset<0||offset>300||offset%20)throw Error('Некорректная страница поиска.');
    if(!query)return {tracks:this.state.popular(20),next:''};
    const key=query.toLowerCase().replace(/ё/g,'е')+'\n'+offset, known=this.cache.get(key);
    if(known?.until>Date.now())return known.value;
    if(this.pending.has(key))return this.pending.get(key);
    const task=(async()=>{
      const isLink=/^https?:\/\//i.test(query);let raw;
      if(isLink) {
        if(!/^https:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+\/?(?:\?[^\s]*)?$/.test(query))throw Error('Поддерживаются название песни, исполнитель или ссылка на трек SoundCloud.');
        const u=new URL(query);raw={collection:offset?[]:[await this.provider.request('/resolve',{url:'https://soundcloud.com'+u.pathname.replace(/\/$/,'')},{signal:AbortSignal.timeout(7000)})]};
      } else raw=await this.provider.request('/search/tracks',{q:query,limit:20,offset},{signal:AbortSignal.timeout(7000)});
      const seen=new Set(), tracks=[];
      for(const item of Array.isArray(raw.collection)?raw.collection:[]) {
        const row=this.normalize(item);if(!row||seen.has(row.id))continue;
        seen.add(row.id);const saved=this.state.upsert(row);if(saved)tracks.push(saved);
      }
      const value={tracks,next:!isLink&&raw.collection?.length>=20&&offset<300?String(offset+20):''};
      if(this.cache.size>=300)this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key,{until:Date.now()+5*60000,value});return value;
    })();this.pending.set(key,task);try{return await task;}finally{this.pending.delete(key);}
  }
  supported(raw,duration) { const formats=raw?.media?.transcodings;return !Array.isArray(formats)||formats.length===0||formats.some(row=>supportedTranscoding(row,duration)); }
  normalize(raw) { const row=normalizeTrack(raw);if(!row?.id||!row.title)return null;row.duration=Math.max(row.duration,Math.round((Number(raw.full_duration)||0)/1000));return row.duration>0&&row.duration<=this.maxDuration&&this.supported(raw,row.duration)?row:null; }
}
module.exports={BotCatalog};
