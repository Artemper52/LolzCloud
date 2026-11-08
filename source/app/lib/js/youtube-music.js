(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const surface = document.getElementById('youtube-surface'), status = document.getElementById('youtube-status');
  let view = null, active = false, revision = 0;
  async function media(command, value) {
    if (!view) return false;
    return view.executeJavaScript(`(() => {
      const media = document.querySelector('video,audio'), command = ${JSON.stringify(command)}, value = ${JSON.stringify(value ?? null)};
      if (!media) return false;
      if (command === 'pause') media.pause();
      else if (command === 'play') return media.play().then(() => true);
      else if (command === 'playPause') { if (media.paused) return media.play().then(() => true); else media.pause(); }
      else if (command === 'seek') media.currentTime = Math.max(0, Math.min(media.duration || Infinity, value));
      else if (command === 'volume') media.volume = Math.max(0, Math.min(1, value));
      else if (command === 'next' || command === 'previous') { const button = document.querySelector(command === 'next' ? 'ytmusic-player-bar .next-button' : 'ytmusic-player-bar .previous-button'); if (!button) return false; button.click(); }
      else return false;
      return true;
    })()`, true).catch(() => false);
  }
  function mount() {
    if (view) return;
    view = document.createElement('webview'); view.id = 'youtube-webview';
    view.setAttribute('partition', 'persist:lolzcloud-youtube-music');
    view.src = 'https://music.youtube.com/'; surface.append(view);
    view.addEventListener('did-start-loading', () => { status.textContent = 'Подключаем YouTube Music…'; });
    view.addEventListener('did-stop-loading', () => { status.textContent = 'Поиск и прослушивание · YouTube Music'; if (!active) void media('pause'); });
    view.addEventListener('did-fail-load', event => { if (event.isMainFrame !== false && event.errorCode !== -3) status.textContent = 'Не удалось загрузить YouTube Music. Проверь подключение и нажми ↻.'; });
    view.addEventListener('media-started-playing', () => { if (!active) void media('pause'); });
  }
  async function open() {
    if (active) { view?.focus(); return; }
    const request = ++revision;
    status.textContent = 'Переключаем источник…';
    await ipcRenderer.invoke('features:action', { type: 'wave-stop' }).catch(() => {});
    await ipcRenderer.invoke('features:action', { type: 'media', command: 'pause' }).catch(() => {});
    if (request !== revision) return;
    await ipcRenderer.invoke('features:action', { type: 'playback-source', source: 'youtube' }).catch(() => {});
    if (request !== revision) { void ipcRenderer.invoke('features:action', { type: 'playback-source', source: 'soundcloud' }); return; }
    active = true; document.body.dataset.source = 'youtube'; surface.hidden = false;
    document.getElementById('lc-studio')?.close(); window.lolzSelectNavigation('youtube');
    document.getElementById('open-mini').disabled = true;
    mount(); view.focus();
  }
  function leave() {
    revision++; if (view) void media('pause');
    if (active) void ipcRenderer.invoke('features:action', { type: 'playback-source', source: 'soundcloud' }).catch(() => {});
    active = false; document.body.dataset.source = 'soundcloud'; surface.hidden = true;
    document.getElementById('open-mini').disabled = false;
  }
  window.LolzCloudYouTube = { get active() { return active; }, get view() { return view; }, open, leave, media };
  document.getElementById('youtube-search').onsubmit = event => {
    event.preventDefault(); const query = document.getElementById('youtube-query').value.trim();
    if (query) { mount(); void view.loadURL('https://music.youtube.com/search?q=' + encodeURIComponent(query)); }
  };
  window.addEventListener('lolzcloud:navigation', event => { if (event.detail !== 'youtube') leave(); });
})();
