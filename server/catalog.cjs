'use strict';
const { fetchClientId } = require('./soundcloud-client.cjs');
const { mediaUrl } = require('./public/media-source.js');
class RoomCatalog {
  constructor(fetcher = fetch) { this.fetcher=fetcher; this.client=null; this.cache=new Map(); this.pending=new Map(); }
  async search(query) {
    query=String(query||'').trim().slice(0,120); if(query.length<2)return [];
    const key=query.toLowerCase(), cached=this.cache.get(key); if(cached?.until>Date.now())return cached.items;
    if(this.pending.has(key))return this.pending.get(key);
    const task=(async()=>{
      this.client ||= fetchClientId(this.fetcher).catch(error=>{this.client=null;throw error;});
      const url=new URL('https://api-v2.soundcloud.com/search/tracks');url.searchParams.set('q',query);url.searchParams.set('limit','20');url.searchParams.set('client_id',await this.client);
      const response=await this.fetcher(url.href,{signal:AbortSignal.timeout(12000),redirect:'error'});
      if(!response.ok){if(response.status===401)this.client=null;throw Error('Каталог музыки временно недоступен. Можно вставить ссылку на трек.');}
      const chunks=[];let size=0;
      for await(const chunk of response.body||[]){size+=chunk.length;if(size>2_000_000)throw Error('Каталог вернул слишком большой ответ.');chunks.push(Buffer.from(chunk));}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));const items=(Array.isArray(data.collection)?data.collection:[]).filter(row=>row.streamable!==false&&!['BLOCK','SNIP'].includes(row.policy)).map(row=>({url:mediaUrl(row.permalink_url),title:String(row.title||'').slice(0,180),artist:String(row.user?.username||'').slice(0,100),cover:/^https:\/\//.test(row.artwork_url||'')?row.artwork_url:'',duration:Math.max(0,Math.min(14400,Math.round((Number(row.duration)||0)/1000)))})).filter(row=>row.url&&row.title).slice(0,20);
      if(this.cache.size>300)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{items,until:Date.now()+60000});return items;
    })();this.pending.set(key,task);try{return await task;}finally{this.pending.delete(key);}
  }
}
module.exports={RoomCatalog};
