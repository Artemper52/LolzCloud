(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const bridgeCode=require('node:fs').readFileSync(require('node:path').join(__dirname,'../plugins/youtube-control.js'),'utf8');
  const surface = document.getElementById('youtube-surface'), status = document.getElementById('youtube-status');
  let view = null, active = false, requested = false, revision = 0, trackRevision = 0, openingTrack = false, ready = false, trackLoad = null, nativeCss = null, bridgeRetry = 0;
  const tools=document.createElement('div');tools.id='youtube-tools';
  for(const [caption,run]of [['Мини-плеер ↗',()=>ipcRenderer.invoke('features:action',{type:'mini'})],['Текст песни',()=>window.LolzCloudStudio.open('lyrics')]]){
    const button=document.createElement('button');button.type='button';button.textContent=caption;button.onclick=()=>Promise.resolve(run()).catch(()=>{});tools.append(button);
  }
  document.getElementById('youtube-search').append(tools);
  async function ensureBridge(){
    if(!view||!ready||new URL(view.getURL()).origin!=='https://music.youtube.com')return false;
    try{
      if(!await view.executeJavaScript('window.__lolzcloudYouTube?.version>=2'))await view.executeJavaScript(bridgeCode);
      return await view.executeJavaScript('window.__lolzcloudYouTube?.version>=2');
    }catch{return false;}
  }
  window.addEventListener('lolzcloud:state',async event=>{
    if(!active||!view||!ready)return;
    const state=event.detail,track=state.displayPlayback||state.playback,connected=state.features?.source==='youtube'&&!!track?.url&&!!track.title;
    try{
      if(connected&&nativeCss===null){nativeCss='pending';const key=await view.insertCSS('ytmusic-player-bar{visibility:hidden!important;pointer-events:none!important}');if(active)nativeCss=key;else{await view.removeInsertedCSS(key);nativeCss=null;}}
      else if(!connected&&nativeCss&&nativeCss!=='pending'){const key=nativeCss;nativeCss=null;await view.removeInsertedCSS(key);}
    }catch{nativeCss=null;}
    if(connected)status.textContent=[track.artist,track.title].filter(Boolean).join(' — ')+' · YouTube Music';
  });
  async function executeMedia(command, value) {
    if (!view) return false;
    try { return await view.executeJavaScript('window.__lolzcloudYouTube?.command(' + JSON.stringify(command) + ',' + JSON.stringify(value ?? null) + ')', true); } catch { return false; }
  }
  async function media(command,value) {
    if(command==='pause'){trackRevision++;openingTrack=false;return executeMedia(command,value);}
    const request=trackRevision;
    if(openingTrack&&trackLoad)await trackLoad;
    if(request!==trackRevision)return false;
    return executeMedia(command,value);
  }
  function mount() {
    if (view) return;
    view = document.createElement('webview'); view.id = 'youtube-webview';
    view.setAttribute('partition', 'persist:lolzcloud-youtube-music');
    view.src = 'https://music.youtube.com/';
    view.addEventListener('did-start-loading', () => { status.textContent = 'Подключаем YouTube Music…'; });
    view.addEventListener('did-stop-loading', () => { status.textContent = 'Включи песню · управление, мини-плеер и текст доступны в LolzCloud'; if (!active) void media('pause'); });
    view.addEventListener('did-start-navigation', event => {if(event.isMainFrame&&!event.isInPlace)ready=false;});
    view.addEventListener('dom-ready', async () => { ready=true;nativeCss=null;bridgeRetry=0;await ensureBridge();window.dispatchEvent(new Event('lolzcloud:provider-ready')); });
    view.addEventListener('did-fail-load', event => { if (event.isMainFrame !== false && event.errorCode !== -3) status.textContent = 'Не удалось загрузить YouTube Music. Проверь подключение и нажми ↻.'; });
    view.addEventListener('media-started-playing', () => { if (!active) void media('pause'); });
    surface.append(view);
  }
  async function open(background = false) {
    if (active) { if(!background){surface.hidden = false; document.getElementById('lc-studio')?.close(); window.lolzSelectNavigation('youtube'); view?.focus();} return; }
    const request = ++revision; requested = true;
    status.textContent = 'Переключаем источник…';
    await ipcRenderer.invoke('features:action', { type: 'wave-stop' }).catch(() => {});
    await ipcRenderer.invoke('features:action', { type: 'media', command: 'pause' }).catch(() => {});
    if (request !== revision) return;
    await ipcRenderer.invoke('features:action', { type: 'playback-source', source: 'youtube' }).catch(() => {});
    if (request !== revision) { if(!requested)void ipcRenderer.invoke('features:action', { type: 'playback-source', source: 'soundcloud' }).catch(()=>{}); return; }
    active = true; document.body.dataset.source = 'youtube'; surface.hidden = background;
    if(!background){document.getElementById('lc-studio')?.close(); window.lolzSelectNavigation('youtube');}
    status.textContent = 'Поиск и прослушивание · YouTube Music';
    mount(); if(ready)window.dispatchEvent(new Event('lolzcloud:provider-ready')); if(!background)view.focus();
  }
  function leave() {
    revision++; requested=false; trackRevision++; openingTrack=false;if (view) void media('pause');
    if (active) void ipcRenderer.invoke('features:action', { type: 'playback-source', source: 'soundcloud' }).catch(() => {});
    active = false; document.body.dataset.source = 'soundcloud'; surface.hidden = true;
    window.dispatchEvent(new Event('lolzcloud:provider-ready'));
    document.getElementById('open-mini').disabled = false;
  }
  window.LolzCloudYouTube = { get active() { return active; }, get view() { return view; }, open, leave, media };
  document.getElementById('youtube-search').onsubmit = event => {
    event.preventDefault(); const query = document.getElementById('youtube-query').value.trim();
    if (query) { mount(); void view.loadURL('https://music.youtube.com/search?q=' + encodeURIComponent(query)); }
  };
  window.addEventListener('lolzcloud:navigation', event => {
    surface.hidden = event.detail !== 'youtube';
    if (event.detail === 'browser' && active) leave();
  });
  async function openTrack(value, play) {
    const {mediaUrl}=require('./lib/js/media-source.js'),url = mediaUrl(typeof value === 'string' ? value : value?.url);
    if (!url) return;
    const request=++trackRevision;openingTrack=true;
    const valid=()=>active&&view&&request===trackRevision;
    try{
      await open(value?.background === true);
      if(!valid())return;
      if(mediaUrl(view.getURL())!==url)await view.loadURL(url).catch(()=>{});
      if(!valid())return;
      if(play)for(let i=0;i<40&&valid();i++){
        const track=await view.executeJavaScript('window.__lolzcloudYouTube?.snapshot()').catch(()=>null);
        if(!valid())return;
        if(track?.url===url&&track.duration>0){
          if(value?.resume)await executeMedia('seek',value.resume.position);
          if(!valid())return;
          if(await executeMedia(value?.resume?.playing===false?'pause':'play'))return;
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    }finally{if(request===trackRevision)openingTrack=false;}
  }
  function navigate(value,play){const task=openTrack(value,play);trackLoad=task;void task.catch(()=>{status.textContent='Не удалось открыть песню. Повтори после загрузки YouTube Music.';}).finally(()=>{if(trackLoad===task)trackLoad=null;});}
  ipcRenderer.on('lolzcloud:play-youtube', (_event,value) => navigate(value,true));
  ipcRenderer.on('lolzcloud:show-youtube', (_event,value) => navigate(value,false));
  let polling = false;
  setInterval(async () => {
    if (!active || !view || polling || openingTrack) return; polling = true;
    const request=revision,trackRequest=trackRevision,valid=()=>active&&request===revision&&trackRequest===trackRevision;
    try {
      const sample = await view.executeJavaScript('({playback:window.__lolzcloudYouTube?.snapshot(),audio:window.__lolzcloudGetAudioState?.()})');
      if (!valid()) return;
      const value=sample?.playback;
      if (value?.url && value.title) ipcRenderer.send('youtube:playback', value);
      else if(Date.now()-bridgeRetry>2000){bridgeRetry=Date.now();const connected=await ensureBridge();if(!valid())return;if(!connected)status.textContent=view.getURL().includes('consent.')?'Подтверди выбор cookies в YouTube Music, чтобы продолжить.':'Подключаем управление YouTube Music…';}
      const audio=sample?.audio;
      if (valid() && audio) ipcRenderer.send('features:audio', { ...audio, source: 'youtube' });
    } catch { /* Navigation is still loading. */ }
    finally { polling = false; }
  },250);
})();
