'use strict';
const path=require('node:path');
const {BotState,MediaLinks}=require('../telegram/state.cjs'),{BotCatalog}=require('../telegram/catalog.cjs'),{AudioCache}=require('../telegram/media.cjs'),{createMediaServer}=require('../telegram/http.cjs');
async function start(env=process.env){
  const directory=env.LOLZCLOUD_MUSIC_STATE||'/var/lib/lolzcloud-music';
  const state=new BotState(path.join(directory,'music-state.json'),'lolzcloud-public-music-v1'),links=new MediaLinks('https://lolzcloud.com',env.LOLZCLOUD_MUSIC_SECRET,{prefix:'/music'}),catalog=new BotCatalog(state);
  const cache=new AudioCache({directory:path.join(directory,'audio'),state,provider:catalog.provider,executable:env.LOLZCLOUD_MUSIC_FFMPEG||'/usr/bin/ffmpeg'});await cache.prune();
  const server=createMediaServer({links,cache,catalog,prefix:'/music',botName:null,health:()=>({service:'lolzcloud-music',protocol:1,activeDownloads:cache.active})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.LOLZCLOUD_MUSIC_PORT)||4389,'127.0.0.1',resolve);});
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;cache.close();state.save();server.close();setTimeout(()=>server.closeAllConnections(),1500).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  console.log('LolzCloud native music catalogue ready');return {server,cache,state,stop};
}
if(require.main===module)start().catch(()=>{console.error('Music service startup failed');process.exitCode=1;});
module.exports={start};
