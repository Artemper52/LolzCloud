'use strict';
const fs=require('node:fs'),{clean}=require('./state.cjs');
const {BotPresentation,audioButtons}=require('./presentation.cjs');
function clock(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function friendly(error) {
  const message=String(error?.message||'');
  if(/SoundCloud/.test(message))return 'SoundCloud сейчас не отдал полную запись. Попробуйте повторить или выбрать другую версию трека.';
  if(error?.code===429)return 'Telegram попросил сделать паузу. Повторите через несколько секунд.';
  if(/Telegram/.test(message))return 'Не удалось отправить аудио в Telegram. Попробуйте ещё раз.';
  if(/^[А-ЯЁа-яё]/u.test(message))return clean(message,240);
  return 'Не удалось загрузить песню. Попробуйте ещё раз.';
}
class MusicBot {
  constructor({api,state,catalog,cache,links,username='lolzcloudbot',cacheChat='',inlineArticles=false}) {
    Object.assign(this,{api,state,catalog,cache,links,username,cacheChat,inlineArticles});this.uploads=new Map();this.limits=new Map();this.downloadLocks=new Set();this.inflight=new Set();this.lastPoll=0;this.lastError='';this.presentation=new BotPresentation(this);
  }
  allow(user,kind,max,period) {
    const key=kind+':'+user,now=Date.now();let row=this.limits.get(key);
    if(!row||now-row.start>=period){row={start:now,count:0};this.limits.set(key,row);}
    if(this.limits.size>5000)for(const [k,v]of this.limits)if(now-v.start>60000)this.limits.delete(k);
    return ++row.count<=max;
  }
  button(query='') {return {inline_keyboard:[[{text:'Найти музыку в другом чате',switch_inline_query:query}]]};}
  async inline(query) {
    if(!this.allow(query.from.id,'inline',45,60000))return this.api.call('answerInlineQuery',{inline_query_id:query.id,results:[],cache_time:1,is_personal:true,button:{text:'Слишком много запросов — сделайте паузу',start_parameter:'help'}});
    let offset=0;if(query.offset){if(!/^(?:20|40|60|80|100|120|140|160|180|200|220|240|260|280|300)$/.test(query.offset))throw Error('Некорректная страница поиска.');offset=Number(query.offset);}
    const found=await this.catalog.search(query.query,offset);
    let tracks=found.tracks;
    if(!String(query.query).trim()&&!tracks.length)tracks=[...this.state.tracks.values()].filter(t=>this.cache.exists(t.id)).slice(-20).reverse();
    const results=tracks.map(t=>this.result(t));
    return this.api.call('answerInlineQuery',{inline_query_id:query.id,results,cache_time:results.length?15:3,is_personal:false,next_offset:found.next,button:{text:results.length?'LolzCloud · музыка в личке':'Напишите исполнителя или название песни',start_parameter:'help'}});
  }
  result(track) {
    track=this.state.get(track.id)||track;
    const id='sc_'+track.id;
    if(track.fileId)return {type:'audio',id,audio_file_id:track.fileId,reply_markup:audioButtons(track,this.username)};
    if(this.inlineArticles)return {type:'article',id:'load_'+track.id,title:track.title,description:clock(track.duration)+' · '+track.artist,thumbnail_url:track.cover||this.links.origin+'/telegram/assets/icon.png',thumbnail_width:100,thumbnail_height:100,input_message_content:{message_text:`♫ ${track.artist} — ${track.title}\nГотовлю аудио…`,link_preview_options:{is_disabled:true}},reply_markup:{inline_keyboard:[[{text:'Загрузить аудио',callback_data:this.links.callback(track.id),style:'success'}]]}};
    return {type:'audio',id,audio_url:this.links.audio(track.id),title:track.title,performer:track.artist,audio_duration:track.duration,reply_markup:audioButtons(track,this.username)};
  }
  async upload(track,chat,extra={}) {
    const audio=await this.cache.prepare(track.id),form=new FormData();
    form.set('chat_id',String(chat));form.set('title',audio.track.title);form.set('performer',audio.track.artist);form.set('duration',String(audio.track.duration));
    for(const [key,value]of Object.entries(extra))form.set(key,typeof value==='string'?value:JSON.stringify(value));
    form.set('audio',await fs.openAsBlob(audio.file,{type:'audio/mpeg'}),`LolzCloud-${track.id}.mp3`);
    const sent=await this.api.call('sendAudio',form,{timeout:90000});
    if(sent.audio?.file_id)this.state.file(track.id,sent.audio.file_id);
    return sent;
  }
  async telegramFile(track) {
    track=this.state.get(track.id)||track;
    if(track.fileId)return track.fileId;
    if(!this.cacheChat)return null;
    if(this.uploads.has(track.id))return this.uploads.get(track.id);
    const task=this.upload(track,this.cacheChat,{disable_notification:true}).then(m=>m.audio?.file_id||null);
    this.uploads.set(track.id,task);try{return await task;}finally{this.uploads.delete(track.id);}
  }
  async chosen(result) {
    const m=String(result.result_id||'').match(/^(sc|load)_([1-9]\d{0,15})$/),track=m&&this.state.get(m[2]);if(!track)return;
    this.state.chosen(track.id);
    // In direct-audio mode Telegram retrieves the signed MP3 URL itself; feedback
    // is optional. Article mode can replace the temporary text automatically.
    if(m[1]==='load'&&result.inline_message_id)await this.inlineAudio(track,result.inline_message_id);
    else if(this.cacheChat&&!track.fileId)await this.telegramFile(track);
  }
  async inlineAudio(track,inlineId) {
    track=this.state.get(track.id)||track;
    try {
      if(!track.fileId)await this.cache.prepare(track.id);
      let media=await this.telegramFile(track)||this.links.audio(track.id);
      try {await this.api.call('editMessageMedia',{inline_message_id:inlineId,media:{type:'audio',media,title:track.title,performer:track.artist,duration:track.duration},reply_markup:audioButtons(track,this.username)},{timeout:60000});}
      catch(error) {
        if(error.code===400&&/not modified/i.test(error.message))return;
        if(!track.fileId||error.code!==400)throw error;
        this.state.file(track.id,null);media=this.links.audio(track.id);
        await this.cache.prepare(track.id);
        await this.api.call('editMessageMedia',{inline_message_id:inlineId,media:{type:'audio',media,title:track.title,performer:track.artist,duration:track.duration},reply_markup:audioButtons(track,this.username)},{timeout:60000});
      }
    } catch(error) {
      await this.api.call('editMessageText',{inline_message_id:inlineId,text:`♫ ${track.artist} — ${track.title}\n${friendly(error)}`,reply_markup:{inline_keyboard:[[{text:'Повторить загрузку',callback_data:this.links.callback(track.id)}],[{text:'Открыть источник',url:track.url}]]}});
    }
  }
  async privateAudio(track,chat) {
    if(track.fileId) {
      try{return await this.api.call('sendAudio',{chat_id:chat,audio:track.fileId,reply_markup:audioButtons(track,this.username,{privateChat:true})});}
      catch(error){if(error.code!==400)throw error;this.state.file(track.id,null);}
    }
    await this.api.call('sendChatAction',{chat_id:chat,action:'upload_voice'}).catch(()=>{});
    const sent=await this.upload(track,chat,{reply_markup:audioButtons(track,this.username,{privateChat:true})});this.state.chosen(track.id);return sent;
  }
  async callback(query) {
    if(/^(?:menu:|view:)/.test(query.data||'')) {
      if(!this.allow(query.from.id,'browse',30,60000))return this.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Слишком быстро. Попробуйте через несколько секунд.'});
      return this.presentation.callback(query);
    }
    const id=this.links.callbackId(query.data),track=id&&this.state.get(id);
    if(!track)return this.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Результат устарел. Повторите поиск.',show_alert:true});
    if(!this.allow(query.from.id,'download',8,60000))return this.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Дождитесь загрузки и попробуйте через минуту.',show_alert:true});
    if(!query.inline_message_id&&(query.message?.chat?.type!=='private'||query.message.chat.id!==query.from.id))return this.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Откройте поиск в личке бота.'});
    const lock=`${query.from.id}:${track.id}:${query.inline_message_id||query.message.chat.id}`;
    if(this.downloadLocks.has(lock))return this.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Аудио уже загружается…'});
    this.downloadLocks.add(lock);
    try {
      await this.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Готовлю аудио…'}).catch(()=>{});
      if(query.inline_message_id)return await this.inlineAudio(track,query.inline_message_id);
      try{await this.privateAudio(track,query.message.chat.id);}catch(error){await this.api.call('sendMessage',{chat_id:query.message.chat.id,text:friendly(error)});}
    }finally{this.downloadLocks.delete(lock);}
  }
  async message(message) {
    if(message.chat?.type!=='private'||message.from?.is_bot||typeof message.text!=='string')return;
    const chat=message.chat.id,text=message.text.trim();if(!this.allow(chat,'message',15,60000))return;
    if(/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
      const id=text.match(/^\/start\s+track_([1-9]\d{0,15})$/)?.[1];if(id&&this.state.get(id)){try{return await this.privateAudio(this.state.get(id),chat);}catch(error){return this.api.call('sendMessage',{chat_id:chat,text:friendly(error)});}}
      return this.presentation.welcome(chat);
    }
    if(/^\/help(?:@\w+)?(?:\s|$)/i.test(text))return this.presentation.help(chat);
    if(/^\/privacy(?:@\w+)?$/i.test(text))return this.api.call('sendMessage',{chat_id:chat,text:'Бот получает только отправленные ему сообщения и inline-запросы, а не переписку чата. Тексты запросов и история личной переписки не сохраняются. Общий кэш хранит сведения о песнях, MP3 и Telegram file_id. Аудио и ссылки на него доступны получателям. /help — как пользоваться.'});
    if(/^\/settings(?:@\w+)?$/i.test(text))return this.api.call('sendMessage',{chat_id:chat,text:'Поиск: SoundCloud. Качество: MP3 128 кбит/с. Кэш общий для всех пользователей. История личных запросов не сохраняется.',reply_markup:this.button()});
    const q=text.replace(/^\/search(?:@\w+)?\s*/i,'');
    if(text.startsWith('/')&&q===text)return this.api.call('sendMessage',{chat_id:chat,text:'Напишите название песни или исполнителя. /help — помощь.'});
    if(q.length<2)return this.api.call('sendMessage',{chat_id:chat,text:'Введите хотя бы два символа: исполнитель, песня или ссылка SoundCloud.'});
    try {
      const found=await this.catalog.search(q);
      if(!found.tracks.length)return this.api.call('sendMessage',{chat_id:chat,text:'Ничего не нашёл. Попробуйте исполнителя и название без лишних слов или ссылку SoundCloud.'});
      return await this.presentation.showSearch(chat,q,found);
    }catch(error){return this.api.call('sendMessage',{chat_id:chat,text:friendly(error)});}
  }
  async handle(update) {
    try {
      if(update.inline_query)return await this.inline(update.inline_query);
      if(update.chosen_inline_result)return await this.chosen(update.chosen_inline_result);
      if(update.callback_query)return await this.callback(update.callback_query);
      if(update.message)return await this.message(update.message);
    }catch(error){
      this.lastError=error.code?'telegram_'+error.code:'source_or_cache';
      process.stderr.write(`Bot update failed (${this.lastError})\n`);
      if(update.inline_query)await this.api.call('answerInlineQuery',{inline_query_id:update.inline_query.id,results:[],cache_time:2,is_personal:true,button:{text:'Поиск временно недоступен — попробуйте в личке',start_parameter:'help'}}).catch(()=>{});
    }
  }
  async run(signal) {
    while(!signal.aborted) {
      try {
        const updates=await this.api.call('getUpdates',{offset:this.state.offset,timeout:25,limit:50,allowed_updates:['message','inline_query','chosen_inline_result','callback_query']},{timeout:35000,signal});
        this.lastPoll=Date.now();this.lastError='';
        for(const update of updates) {
          if(!Number.isSafeInteger(update.update_id)||update.update_id<this.state.offset)continue;
          while(this.inflight.size>=100)await Promise.race(this.inflight);
          const task=this.handle(update).finally(()=>this.inflight.delete(task));this.inflight.add(task);
          this.state.offset=update.update_id+1;this.state.changed();
        }
      }catch(error){
        if(signal.aborted)break;
        if(error.code===401||error.code===409)throw Error(error.code===401?'Telegram rejected bot credentials':'Another bot poller or webhook is active');
        this.lastError='telegram_connection';process.stderr.write('Telegram poll retry\n');
        await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,Math.max(1000,(error.retryAfter||3)*1000));signal.addEventListener('abort',finish,{once:true});});
      }
    }
    await Promise.allSettled([...this.inflight]);this.state.save();
  }
}
module.exports={MusicBot,clock,friendly};
