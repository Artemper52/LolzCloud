'use strict';
const path=require('node:path');
const {TelegramApi}=require('./api.cjs'),{BotState,MediaLinks}=require('./state.cjs'),{BotCatalog}=require('./catalog.cjs'),{AudioCache}=require('./media.cjs'),{MusicBot}=require('./bot.cjs'),{createMediaServer}=require('./http.cjs');
async function start(env=process.env) {
  const token=env.TELEGRAM_BOT_TOKEN||'',botId=token.split(':')[0],directory=env.TELEGRAM_STATE||'/var/lib/lolzcloud-telegram';
  const api=new TelegramApi(token),state=new BotState(path.join(directory,'telegram-state.json'),botId),links=new MediaLinks(env.TELEGRAM_PUBLIC_ORIGIN||'https://lolzcloud.com',env.TELEGRAM_MEDIA_SECRET);
  const me=await api.call('getMe');if(!me.supports_inline_queries)throw Error('Enable inline mode in BotFather before starting');
  const hook=await api.call('getWebhookInfo');if(hook.url)throw Error('An existing Telegram webhook is configured; it was not changed');
  const cacheChat=env.TELEGRAM_CACHE_CHAT||'';
  if(cacheChat) {
    const chat=await api.call('getChat',{chat_id:cacheChat});if(chat.type!=='channel')throw Error('Audio cache must use a dedicated channel');
    const member=await api.call('getChatMember',{chat_id:cacheChat,user_id:me.id});
    if(member.status!=='administrator'||member.can_post_messages!==true)throw Error('Bot needs permission to post in its cache channel');
  }
  const inlineArticles=env.TELEGRAM_INLINE_ARTICLES==='1',largeUploads=!!cacheChat&&inlineArticles;
  const maxDuration=largeUploads?3600:1200,catalog=new BotCatalog(state,{maxDuration});
  const cache=new AudioCache({directory:path.join(directory,'audio'),state,provider:catalog.provider,executable:env.TELEGRAM_FFMPEG||'/usr/bin/ffmpeg',maxBytes:largeUploads?48000000:20000000,maxDuration,maxCacheBytes:Number(env.TELEGRAM_CACHE_BYTES)||2*1024**3});
  await cache.prune();
  const bot=new MusicBot({api,state,catalog,cache,links,username:me.username,cacheChat,inlineArticles});
  const server=createMediaServer({links,cache,botName:me.username,health:()=>({pollAgeSeconds:bot.lastPoll?Math.floor((Date.now()-bot.lastPoll)/1000):null,activeDownloads:cache.active,cacheTracks:[...state.tracks.values()].filter(t=>t.fileId).length,inlineMode:bot.inlineArticles?'covers-with-feedback':'direct-audio',cacheChannelConfigured:!!cacheChat})});
  const port=Number(env.TELEGRAM_PORT)||4388;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const stop=new AbortController();let stopping=false;
  const shutdown=()=>{if(stopping)return;stopping=true;stop.abort();cache.close();server.close();setTimeout(()=>{server.closeAllConnections();},1500).unref();};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  console.log('LolzCloud Telegram bot started: @'+me.username);
  try{await bot.run(stop.signal);}finally{shutdown();state.save();process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);}
}
if(require.main===module)start().catch(error=>{console.error(String(error.message||'Bot startup failed').replace(/\b\d{6,}:[\w-]+/g,'[token]'));process.exitCode=1;});
module.exports={start};
