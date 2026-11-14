'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {clean}=require('./state.cjs');
const escape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clock=s=>Math.floor(Math.max(0,Math.round(s))/60)+':'+String(Math.max(0,Math.round(s))%60).padStart(2,'0');
function audioButtons(track,username,{privateChat=false}={}) {
  return {inline_keyboard:[privateChat?
    [{text:'Поделиться песней',switch_inline_query:clean(track.artist+' '+track.title,140),style:'success'},{text:'Ещё у артиста',switch_inline_query_current_chat:clean(track.artist,100)}]:
    [{text:'Ещё у артиста',switch_inline_query_current_chat:clean(track.artist,100)},{text:'В личку',url:`https://t.me/${username}?start=track_${track.id}`}]]};
}
class BotPresentation {
  constructor(bot,{welcomeFile=path.join(__dirname,'assets/welcome.jpg')}={}) {this.bot=bot;this.welcomeFile=welcomeFile;this.sessions=new Map();this.assetHash=null;}
  menuButtons(){return {inline_keyboard:[[{text:'Найти музыку в чате',switch_inline_query:'',style:'success'}],[{text:'Слушали недавно',callback_data:'menu:recent'},{text:'Как пользоваться',callback_data:'menu:help'}]]};}
  async sendPhoto(chat,photo,caption,reply_markup) {
    const body={chat_id:chat,photo,caption,parse_mode:'HTML',reply_markup};
    if(photo!=='welcome')return this.bot.api.call('sendPhoto',body);
    this.assetHash ||= createHash('sha256').update(fs.readFileSync(this.welcomeFile)).digest('hex');
    const known=this.bot.state.asset?.('welcome',this.assetHash);
    if(known){try{return await this.bot.api.call('sendPhoto',{...body,photo:known});}catch(e){if(e.code!==400)throw e;}}
    const form=new FormData();for(const [k,v]of Object.entries({...body,photo:undefined})){if(v!==undefined)form.set(k,typeof v==='string'?v:JSON.stringify(v));}
    form.set('photo',await fs.openAsBlob(this.welcomeFile,{type:'image/jpeg'}),'LolzCloud.jpg');
    const sent=await this.bot.api.call('sendPhoto',form);const id=sent?.photo?.at(-1)?.file_id;
    if(id)this.bot.state.setAsset?.('welcome',this.assetHash,id);return sent;
  }
  async welcome(chat) {
    const text=`<b>Музыка, которой хочется поделиться.</b>\n\nВведите в любом чате:\n<code>@${escape(this.bot.username)} тёмный принц гной</code>\n\nИли напишите сюда исполнителя, песню или ссылку SoundCloud.`;
    return this.sendPhoto(chat,'welcome',text,this.menuButtons());
  }
  async help(chat) {
    return this.bot.api.call('sendMessage',{chat_id:chat,parse_mode:'HTML',text:`<b>Одна песня — любой чат</b>\n\n<b>1.</b> Напишите <code>@${escape(this.bot.username)}</code> и название песни.\n<b>2.</b> Выберите результат с обложкой.\n<b>3.</b> Бот подготовит и отправит аудио.\n\nВ личке: напишите название, листайте карточки и нажмите <b>Отправить аудио</b>.\n\nПовторные песни берутся из кэша.`,reply_markup:this.menuButtons()});
  }
  createSession(chat,query,found,{recent=false}={}) {
    const now=Date.now();for(const [id,s]of this.sessions)if(s.expires<=now)this.sessions.delete(id);
    if(this.sessions.size>=1000)this.sessions.delete(this.sessions.keys().next().value);
    const session={id:randomBytes(8).toString('hex'),chat,query:clean(query,140),tracks:found.tracks.map(t=>String(t.id)),next:found.next||'',index:0,recent,expires:now+20*60000,busy:false};
    this.sessions.set(session.id,session);return session;
  }
  card(session,index=session.index) {
    const t=this.bot.state.get(session.tracks[index]);if(!t)throw Error('Результат устарел. Повторите поиск.');
    const heading=session.recent?'СЛУШАЛИ НЕДАВНО':'НАЙДЕНО ДЛЯ ВАС';
    const count=`${index+1} / ${session.tracks.length}${session.next?'+':''}`;
    const caption=`<b>${escape(t.title)}</b>\n${escape(t.artist)}\n\n${clock(t.duration)}  ·  SoundCloud\n\n<blockquote>${heading} · ${count}</blockquote>`;
    const arrows=[];
    if(index>0)arrows.push({text:'‹ Назад',callback_data:`view:${session.id}:${index-1}`});
    arrows.push({text:'Отправить аудио',callback_data:this.bot.links.callback(t.id),style:'success'});
    if(index<session.tracks.length-1||session.next)arrows.push({text:'Далее ›',callback_data:`view:${session.id}:${index+1}`});
    const reply_markup={inline_keyboard:[arrows,[{text:'В другой чат',switch_inline_query:clean(t.artist+' '+t.title,140)},{text:'Открыть источник',url:t.url}]]};
    return {track:t,photo:t.cover||this.bot.links.origin+'/telegram/assets/welcome.jpg',caption,reply_markup};
  }
  async showSearch(chat,query,found,{recent=false}={}) {
    const session=this.createSession(chat,query,found,{recent});
    const card=this.card(session);
    try{return await this.sendPhoto(chat,card.photo,card.caption,card.reply_markup);}
    catch(error){
      if(error.code!==400)throw error;
      return this.sendPhoto(chat,'welcome',card.caption,card.reply_markup);
    }
  }
  async callback(query) {
    const isPrivate=query.message?.chat?.type==='private'&&query.message.chat.id===query.from.id;
    if(!isPrivate)return this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Откройте личку LolzCloud.'});
    if(query.data==='menu:help'){
      await this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id});return this.help(query.message.chat.id);
    }
    if(query.data==='menu:recent') {
      await this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id});
      const found=await this.bot.catalog.search('');
      if(!found.tracks.length)return this.bot.api.call('sendMessage',{chat_id:query.message.chat.id,text:'Здесь появятся песни, которые слушали в LolzCloud. Пока напишите название любимого трека.',reply_markup:this.menuButtons()});
      return this.showSearch(query.message.chat.id,'',found,{recent:true});
    }
    const match=String(query.data||'').match(/^view:([a-f0-9]{16}):(\d{1,3})$/),session=match&&this.sessions.get(match[1]);
    if(!session||session.chat!==query.from.id||session.expires<=Date.now())return this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Карточка устарела. Напишите название песни ещё раз.',show_alert:true});
    if(session.busy)return this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Обновляю карточку…'});
    const index=Number(match[2]);if(index<0||index>session.tracks.length)return this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id,text:'Повторите поиск.'});
    session.busy=true;
    try {
      await this.bot.api.call('answerCallbackQuery',{callback_query_id:query.id});
      if(index===session.tracks.length&&session.next) {
        const found=await this.bot.catalog.search(session.query,Number(session.next));
        for(const track of found.tracks)if(!session.tracks.includes(String(track.id)))session.tracks.push(String(track.id));
        session.next=found.next;
      }
      if(index>=session.tracks.length)return;
      const card=this.card(session,index),message={chat_id:query.message.chat.id,message_id:query.message.message_id};
      try {
        await this.bot.api.call('editMessageMedia',{...message,media:{type:'photo',media:card.photo,caption:card.caption,parse_mode:'HTML'},reply_markup:card.reply_markup});
      }catch(error){
        if(error.code!==400)throw error;
        if(!/not modified/i.test(error.message))await this.bot.api.call('editMessageMedia',{...message,media:{type:'photo',media:this.bot.links.origin+'/telegram/assets/welcome.jpg',caption:card.caption,parse_mode:'HTML'},reply_markup:card.reply_markup});
      }
      session.index=index;session.expires=Date.now()+20*60000;
    }catch{
      await this.bot.api.call('sendMessage',{chat_id:query.message.chat.id,text:'Не удалось обновить карточку. Попробуйте ещё раз или напишите название песни заново.'});
    }finally{session.busy=false;}
  }
}
module.exports={BotPresentation,audioButtons,escape,clock};
