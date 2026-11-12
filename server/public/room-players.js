(() => {
  'use strict';
  let apiPromise;
  function youtubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!apiPromise) apiPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script'), timeout = setTimeout(() => { script.remove(); reject(new Error('YouTube долго загружается. Повтори подключение.')); },12000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(window.YT); };
      script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => { clearTimeout(timeout); reject(new Error('YouTube недоступен.')); }; document.head.append(script);
    }).catch(error => { apiPromise = null; throw error; });
    return apiPromise;
  }
  async function youtube(frame, track, callbacks) {
    const YT = await youtubeApi(), media = window.LolzCloudMedia;
    let player, destroyed = false;
    const adapter = {
      play: () => player?.playVideo(), pause: () => player?.pauseVideo(), seekTo: ms => player?.seekTo(ms/1000,true),
      getPosition: callback => callback((player?.getCurrentTime() || 0)*1000), isPaused: callback => callback(player?.getPlayerState() !== 1),
      setVolume: value => player?.setVolume(value),
      getCurrentSound: callback => { const data=player?.getVideoData() || {}; callback({title:data.title || track.title,duration:(player?.getDuration() || track.duration || 0)*1000,user:{username:data.author || track.artist},artwork_url:'https://i.ytimg.com/vi/'+media.youtubeId(track.url)+'/hqdefault.jpg'}); },
      destroy: () => { destroyed = true; player?.destroy(); },
    };
    player = new YT.Player(frame, { host:'https://www.youtube-nocookie.com', videoId:media.youtubeId(track.url), width:'100%', height:'100%', playerVars:{origin:location.origin,playsinline:1,autoplay:0}, events:{
      onReady: () => { if (!destroyed) callbacks.ready(); },
      onStateChange: event => { if(destroyed)return; if(event.data===0)callbacks.ended();else if([1,2].includes(event.data))callbacks.changed(event.data===1); },
      onError: () => { if(!destroyed)callbacks.error(); }, onAutoplayBlocked: () => { if(!destroyed)callbacks.blocked?.(); },
    } });
    return adapter;
  }
  function desktop(bridge, callbacks) {
    const state = () => bridge.state();
    const adapter = {
      play: () => bridge.media('play'), pause: () => {}, seekTo: () => {}, setVolume: () => {},
      getPosition: callback => { void state().then(value=>{const p=value.playback||{};callback(((p.position||0)+(p.playing?Math.max(0,Date.now()-value.sampledAt)/1000:0))*1000);}); },
      isPaused: callback => { void state().then(value=>callback(!value.playback?.playing)); },
      getCurrentSound: callback => { void state().then(value=>{const p=value.playback||{};callback({title:p.title, duration:(p.duration||0)*1000,user:{username:p.artist},artwork_url:p.cover});}); },
      destroy: () => {},
    };
    setTimeout(callbacks.ready,0); return adapter;
  }
  window.LolzCloudRoomPlayers = { youtube, desktop };
})();
