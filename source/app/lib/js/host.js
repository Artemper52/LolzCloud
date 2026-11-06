(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const fs = require('node:fs'), path = require('node:path');
  const interFont = fs.readFileSync(path.join(__dirname, 'lib/assets/fonts/InterVariable.woff2')).toString('base64');
  const soundCloudFont = "@font-face{font-family:Inter;font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64," + interFont + ") format('woff2')}html,body,button,input,select,textarea{font-family:Inter,Arial,sans-serif!important}.soundTitle__title,.soundTitle__username,.soundList__item .soundTitle__title,.playbackSoundBadge__title{font-family:Inter,Arial,sans-serif!important;font-size:14px!important}";
  const { normalizePlayback, clock } = require('../integrations/lolzteam/status.cjs');
  const { soundcloudProfile } = require('../integrations/profiles.cjs');
  const { scUrl } = require('../integrations/music.cjs');
  const view = document.getElementById('webview'), el = id => document.getElementById(id);
  const footerBackground = new window.LolzCloudWaveView(el('player-gradient'), { ambient: true, fps: 24 });
  const headerBackground = new window.LolzCloudWaveView(el('titlebar-gradient'), { ambient: true, fps: 15 });
  const labels = { browser: 'SoundCloud', wave: 'Моя волна', share: 'Сейчас слушаю', library: 'Моя музыка', community: 'Подборки', lyrics: 'Текст песни', audio: 'Звук и эффекты', room: 'Комнаты', radar: 'Радар новинок', moments: 'Любимые моменты', versions: 'Другие версии', private: 'Приватность', keys: 'Горячие клавиши', settings: 'Настройки', sources: 'Источники текста' };
  let startupApplied = false, userNavigated = false;
  let downloadItem = null;
  window.showsongshowcase = () => window.LolzCloudStudio?.open('share');
  window.updatelyricshowcase = () => window.LolzCloudStudio?.open('lyrics');
  window.lolzSelectNavigation = name => {
    document.querySelectorAll('[data-view]').forEach(button => { const selected = button.dataset.view === (['private', 'keys', 'sources'].includes(name) ? 'settings' : name); button.classList.toggle('selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    el('page-title').textContent = labels[name] || 'LolzCloud'; document.body.dataset.view = name;
    window.dispatchEvent(new CustomEvent('lolzcloud:navigation', { detail: name }));
  };
  document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => {
    userNavigated = true;
    if (button.dataset.view === 'browser') { document.getElementById('lc-studio')?.close(); window.lolzSelectNavigation('browser'); }
    else window.LolzCloudStudio?.open(button.dataset.view);
  }; });
  async function media(command, value) { try { await ipcRenderer.invoke('features:action', { type: 'media', command, value }); } catch { /* The app is closing. */ } }
  for (const id of ['previous', 'next', 'playPause', 'like', 'repeat']) el('player-' + id).onclick = () => media(id);
  el('player-lyrics').onclick = () => window.LolzCloudStudio?.open('lyrics');
  el('player-track').onclick = () => window.LolzCloudStudio?.open('share');
  el('player-download').onclick = async () => {
    const active = downloadItem && ['queued', 'downloading', 'converting'].includes(downloadItem.status);
    window.LolzCloudStudio?.open('library'); if (active) return;
    try {
      const result = await ipcRenderer.invoke('features:action', downloadItem?.exists ? { type: 'download-reveal', id: downloadItem.id } : { type: 'download-current' });
      if (!result.ok) window.LolzCloudStudio?.notify(result.error, true);
    } catch { window.LolzCloudStudio?.notify('Не удалось начать скачивание.', true); }
  };
  el('open-account').onclick = () => window.lolzShowAccount?.();
  el('open-mini').onclick = () => ipcRenderer.invoke('features:action', { type: 'mini' }).catch(() => {});
  el('window-close').onclick = () => ipcRenderer.send('appReqCloseApp');
  el('window-minimize').onclick = () => ipcRenderer.send('appReqMinimizeApp');
  el('window-maximize').onclick = () => ipcRenderer.send('appReqToggleWindowMaximize');
  el('window-fullscreen').onclick = () => ipcRenderer.send('appReqToggleFullscreen');
  ipcRenderer.on('lolzcloud:window-state', (_event, maximized, fullscreen) => {
    const button = el('window-maximize');
    const label = maximized ? 'Восстановить размер окна' : 'Развернуть окно';
    button.title = label; button.setAttribute('aria-label', label);
    button.querySelector('use').setAttribute('href', maximized ? '#lc-icon-restore' : '#lc-icon-maximize');
    const full = el('window-fullscreen');
    full.title = fullscreen ? 'Выйти из полного экрана' : 'Полный экран';
    full.setAttribute('aria-label', full.title); full.setAttribute('aria-pressed', String(!!fullscreen));
  });
  el('titlebar').ondblclick = event => { if (!event.target.closest('button')) ipcRenderer.send('appReqToggleWindowMaximize'); };
  el('browser-back').onclick = () => { if (view.canGoBack()) view.goBack(); };
  el('browser-forward').onclick = () => { if (view.canGoForward()) view.goForward(); };
  el('browser-reload').onclick = () => view.reload();
  el('artist-pro').onclick = () => ipcRenderer.invoke('lolzteam:action', { type: 'open-artist-pro' }).catch(() => {});
  el('player-seek').oninput = () => { el('player-position').textContent = clock(Number(el('player-seek').value)); };
  el('player-seek').onchange = () => media('seek', Number(el('player-seek').value));
  let volumeFrame;
  el('player-volume').oninput = () => { el('player-volume-label').textContent = el('player-volume').value + '%'; if (volumeFrame) cancelAnimationFrame(volumeFrame); volumeFrame = requestAnimationFrame(() => media('volume', Number(el('player-volume').value) / 100)); };
  el('player-volume').onchange = () => ipcRenderer.invoke('features:action', { type: 'player', settings: { volume: Number(el('player-volume').value) / 100 } }).catch(() => {});
  function render(state) {
    window.LolzCloudVisuals.update({ ...state, playback: state.displayPlayback || state.playback });
    const track = state.displayPlayback || state.playback;
    document.querySelector('.shell-player').setAttribute('aria-busy', String(state.transitioning === true));
    downloadItem = state.features?.downloads?.items.find(item => item.url === track.url && item.status !== 'cancelled' && item.status !== 'error') || null;
    el('player-download').disabled = state.local || !track.title || state.fresh === false || state.transitioning;
    el('player-download').dataset.status = downloadItem?.status || '';
    el('player-download').title = downloadItem?.exists ? 'MP3 сохранён · показать файл' : downloadItem && ['queued', 'downloading', 'converting'].includes(downloadItem.status) ? 'Скачивание · открыть очередь' : 'Установить песню · сохранить MP3';
    footerBackground.setState(true, track.playing && state.fresh !== false); headerBackground.setState(true, track.playing && state.fresh !== false);
    const preferences = state.features?.preferences;
    if (preferences) {
      document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'full'; document.body.dataset.density = preferences.density;
      if (!startupApplied && window.LolzCloudStudio) { startupApplied = true; if (!userNavigated && preferences.startupView !== 'browser') window.LolzCloudStudio.open(preferences.startupView); }
    }
    el('player-title').textContent = track.title || 'Выбери свой ритм'; el('player-artist').textContent = track.artist || 'Твоя музыка в LolzCloud';
    el('player-play-icon').setAttribute('d', track.playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'm8 5 11 7-11 7z');
    el('player-playPause').setAttribute('aria-label', track.playing ? 'Пауза' : 'Продолжить');
    const canLike = !state.local && !!track.title && !!state.soundcloudProfile?.url && !state.transitioning;
    el('player-like').disabled = !canLike;
    el('player-like').setAttribute('aria-pressed', String(track.liked));
    el('player-like').setAttribute('aria-label', track.liked ? 'Убрать лайк' : 'Лайк');
    el('player-like').title = !canLike ? 'Войди в SoundCloud и включи трек' : track.liked ? 'Убрать из понравившихся' : 'Добавить в понравившиеся';
    const repeat = state.features?.transport?.repeat?.mode || track.repeat || 'off';
    el('player-repeat').disabled = !track.title || state.transitioning;
    el('player-repeat').dataset.mode = repeat;
    el('player-repeat').setAttribute('aria-pressed', String(repeat !== 'off'));
    el('player-repeat').setAttribute('aria-label', { off: 'Повтор выключен', all: 'Повтор очереди', one: 'Повтор трека' }[repeat]);
    el('player-repeat').title = { off: 'Повтор выключен · нажми для повтора очереди', all: 'Повтор очереди · нажми для повтора трека', one: 'Повтор трека · нажми, чтобы выключить' }[repeat];
    el('player-position').textContent = clock(track.position); el('player-duration').textContent = clock(track.duration);
    el('player-seek').max = track.duration || 1; el('player-seek').disabled = !track.duration;
    if (document.activeElement !== el('player-seek')) el('player-seek').value = track.position;
    const volume = state.features?.player?.volume ?? state.features?.audio?.volume ?? 1;
    if (document.activeElement !== el('player-volume')) el('player-volume').value = Math.round(volume * 100);
    el('player-volume-label').textContent = el('player-volume').value + '%';
    window.lolzArtwork(el('player-cover'), track.cover);
    el('account-name').textContent = state.user?.name || 'Твой профиль';
    el('account-description').textContent = state.storagePending ? 'Восстанавливаем привязку…' : 'Открыть профиль';
    el('account-avatar').textContent = (state.user?.name || 'L').slice(0, 1).toUpperCase();
    el('discord-indicator').classList.toggle('connected', !!state.discord?.connected);
    el('discord-indicator').title = state.discord?.connected ? 'Discord подключён' : 'Ожидаем Discord';
    window.LolzCloudRanges.update();
  }
  window.addEventListener('lolzcloud:state', event => render(event.detail));
  view.addEventListener('console-message', event => {
    try {
      const origin = new URL(view.getURL()); if (origin.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(origin.hostname)) return;
      if (event.message.startsWith('LolzCloudReceive|Playback|')) {
        const value = JSON.parse(event.message.slice('LolzCloudReceive|Playback|'.length)), track = normalizePlayback(value);
        track.upNext = Array.isArray(value.upNext) ? value.upNext.slice(0, 2).map(scUrl).filter(Boolean) : [];
        if (Object.hasOwn(value, 'account')) { const account = soundcloudProfile(value.account); if (account || value.account === null) track.account = account; }
        ipcRenderer.send('lolzteam:playback', track);
      } else if (event.message === 'LolzCloudReceive|WaveNext') void ipcRenderer.invoke('features:action', { type: 'wave-next' }).catch(() => {});
      else if (event.message.startsWith('LolzCloudReceive|WaveEnded|')) {
        const url = scUrl(JSON.parse(event.message.slice('LolzCloudReceive|WaveEnded|'.length)).url);
        if (url) void ipcRenderer.invoke('features:action', { type: 'wave-ended', url }).catch(() => {});
      }
    } catch { /* Ignore incomplete navigation snapshots. */ }
  });
  view.addEventListener('did-start-navigation', event => { if (event.isMainFrame && !event.isInPlace) el('browser-loading').classList.remove('is-ready'); });
  view.addEventListener('dom-ready', async () => {
    el('browser-loading').classList.add('is-ready');
    try { await view.insertCSS(soundCloudFont + fs.readFileSync(path.join(__dirname, '../themes/lolzcloud.css'), 'utf8')); } catch { /* A navigation may still be committing. */ }
    try { await view.executeJavaScript(fs.readFileSync(path.join(__dirname, '../plugins/promotions.js'), 'utf8')); } catch { /* A navigation may still be committing. */ }
  });
  view.addEventListener('did-stop-loading', () => {
    el('browser-loading').classList.add('is-ready');
    try { const url = new URL(view.getURL()); if (url.hostname === 'soundcloud.com') localStorage.setItem('lolzcloud:last-url', url.href); el('browser-back').disabled = !view.canGoBack(); el('browser-forward').disabled = !view.canGoForward(); } catch { /* Initial load. */ }
  });
  for (const [channel, command] of [['appReqMediaPlayPause', 'playPause'], ['appReqMediaNextTrack', 'next'], ['appReqMediaPreviousTrack', 'previous']]) ipcRenderer.on(channel, () => media(command));
  for (const channel of ['appReqCtrlR', 'appReqF5']) ipcRenderer.on(channel, () => view.reload());
  let initial = localStorage.getItem('lolzcloud:last-url') || 'https://soundcloud.com/discover';
  try { const url = new URL(initial); if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) initial = 'https://soundcloud.com/discover'; } catch { initial = 'https://soundcloud.com/discover'; }
  view.src = initial; window.lolzSelectNavigation('browser');
})();
