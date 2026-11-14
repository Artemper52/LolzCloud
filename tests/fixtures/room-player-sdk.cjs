'use strict';
const soundcloud = `(()=>{
  function Widget(frame){
    const events={},wait=Number(new URL(location.href).searchParams.get('lag'))||20;
    let position=0,at=performance.now(),playing=false,url=new URL(frame.src).searchParams.get('url')||'',revision=0;
    const current=()=>position+(playing?performance.now()-at:0),emit=name=>{for(const fn of events[name]||[])fn()};
    const finish=()=>{position=200000;at=performance.now();playing=false;emit('finish')};
    const widget={bind(name,fn){(events[name]||=[]).push(fn);if(name==='ready')setTimeout(fn,wait)},load(value,options){revision++;url=value;position=0;at=performance.now();playing=false;setTimeout(()=>{if(window.__failNextSoundCloud){window.__failNextSoundCloud=false;emit('error')}else options.callback?.()},wait)},play(){(window.__fixturePlayCalls||=[]).push(url);if(window.__blockSoundCloud)return;if(!playing){at=performance.now();playing=true;emit('play')}},pause(){position=current();at=performance.now();playing=false;emit('pause')},seekTo(value){const token=revision;setTimeout(()=>{if(token!==revision)return;position=value;at=performance.now();emit('seek');if(value>=200000)finish()},wait)},getPosition(callback){const value=current();setTimeout(()=>callback(value),wait)},isPaused(callback){const value=!playing;setTimeout(()=>callback(value),wait)},getCurrentSound(callback){setTimeout(()=>callback({title:'Synced test song',duration:200000,user:{username:'Test artist'}}),wait)},setVolume(value){window.__fixtureVolume=value},getDuration(callback){callback(200000)}};
    window.__fakeWidget=window.__fakePlayer={position:()=>current()/1000,playing:()=>playing,url:()=>url,finish,error:()=>emit('error'),seek:seconds=>{position=seconds*1000;at=performance.now()},nativeSeek:seconds=>{position=seconds*1000;at=performance.now();emit('seek')},drift:milliseconds=>{position=current()+milliseconds;at=performance.now()}};return widget;
  }
  Widget.Events={READY:'ready',PLAY:'play',PAUSE:'pause',SEEK:'seek',FINISH:'finish',ERROR:'error'};window.SC={Widget};
})();`;
const youtube = `(()=>{
  class Player{
    constructor(frame,options){this.frame=frame;this.options=options;this.position=0;this.at=performance.now();this.playing=false;this.dead=false;this.rate=1;
      window.__fakePlayer={position:()=>this.getCurrentTime(),playing:()=>this.playing,url:()=>('https://music.youtube.com/watch?v='+options.videoId),finish:()=>this.finish(),seek:seconds=>{this.position=seconds;this.at=performance.now()},drift:milliseconds=>{this.position=this.getCurrentTime()+milliseconds/1000;this.at=performance.now()},rate:()=>this.getPlaybackRate(),setRate:rate=>this.setPlaybackRate(rate)};
      setTimeout(()=>{if(!this.dead)options.events.onReady({target:this})},30);
    }
    getCurrentTime(){return this.position+(this.playing?(performance.now()-this.at)/1000*this.rate:0)}
    getPlayerState(){return this.playing?1:2}
    getDuration(){return 200}
    getVideoData(){return {title:'Synced YouTube song',author:'YouTube test artist'}}
    playVideo(){if(window.__blockYoutube){this.options.events.onAutoplayBlocked();return;}if(!this.playing){this.at=performance.now();this.playing=true;this.options.events.onStateChange({data:1})}}
    pauseVideo(){if(this.playing){this.position=this.getCurrentTime();this.at=performance.now();this.playing=false;this.options.events.onStateChange({data:2})}}
    seekTo(position){this.position=position;this.at=performance.now();if(position>=200)this.finish()}
    finish(){this.position=200;this.at=performance.now();this.playing=false;this.options.events.onStateChange({data:0})}
    getPlaybackRate(){return this.rate}
    setPlaybackRate(rate){this.position=this.getCurrentTime();this.at=performance.now();this.rate=rate;this.options.events.onPlaybackRateChange?.({data:rate,target:this})}
    setVolume(value){window.__fixtureVolume=value}
    destroy(){this.dead=true;this.pauseVideo();this.frame.remove()}
  }
  window.YT={Player};window.onYouTubeIframeAPIReady?.();
})();`;
module.exports={soundcloud,youtube};
