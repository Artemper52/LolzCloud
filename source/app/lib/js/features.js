(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const fs = require('node:fs'), path = require('node:path');
  const { clock } = require('../integrations/lolzteam/status.cjs');
  const { scUrl } = require('../integrations/music.cjs');
  const { mediaUrl, provider, label: sourceLabel } = require('./lib/js/media-source.js');
  const activeView = () => window.LolzCloudYouTube?.active ? window.LolzCloudYouTube.view : document.getElementById('webview');
  const { lyricKey } = require('../integrations/lyrics.cjs');
  const { OPTIONS: waveOptions, DEFAULTS: waveDefaults } = require('../integrations/wave-preferences.cjs');
  const { parseRequest } = require('../integrations/wave-request.cjs');
  for (const name of ['features', 'lyrics', 'sound-lab', 'wave', 'shell-panels', 'shell-polish', 'studio-updates']) { if (document.querySelector('link[href="lib/css/' + name + '.css"]')) continue; const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'lib/css/' + name + '.css'; document.head.append(css); }
  document.body.insertAdjacentHTML('beforeend', fs.readFileSync(path.join(__dirname, 'lib/templates/features.html'), 'utf8'));
  const el = name => document.getElementById('lc-' + name), studio = el('studio'), view = document.getElementById('webview');
  let snapshot = null, feature = null, tab = 'share', lyricTrack = '', lyrics = null, lyricLoading = '';
  let dspApplied = '', soundDraft = null, keysDirty = false, lastLists = '', lastPresets = '', playRequest = 0, openingSoundCloud = 0, lyricsFont = 1, waveApplied = null, waveListSignature = '';
  let playerApplied = null;
  let repeatApplied = null, repeatApplying = false;
  let uiScale = 1;
  let guestReady = false;
  view.addEventListener('did-start-navigation', event => { if (event.isMainFrame && !event.isInPlace) guestReady = false; });
  let safetyApplied = '', safetyRevision = -1, latestSafety = null;
  let sourceSignature = '';
  let sourceIdentityKey = '';
  let sourceIdentityUrl = '';
  let lyricRequest = 0;
  let waveArtistSignature = '', waveBlockedSignature = '';
  let requestDraftTouched = false, requestSubmitting = false;
  let downloadSignature = '';
  const lyricView = new window.LolzCloudLyricsView(el('lyrics'), { onSeek: value => { if(feature?.capabilities?.seek !== false) return action('media', { command: 'seek', value }); }, onFollowChange: value => el('lyric-follow').setAttribute('aria-pressed', String(value)) });
  const waveView = new window.LolzCloudWaveView(el('wave-canvas'));
  const lyricBackground = new window.LolzCloudWaveView(el('lyric-gradient'), { ambient: true });
  const studioBackground = new window.LolzCloudWaveView(el('studio-gradient'), { ambient: true, fps: 20 });
  const pending = new Map();
  const queuedSettings = new Set(['dsp', 'protection', 'player', 'preferences', 'mini-settings', 'wave-settings', 'wave-balance', 'lyrics-settings', 'hotkeys', 'private']);
  const names = { playPause: 'Пуск / пауза', next: 'Следующий трек', previous: 'Предыдущий трек', volumeUp: 'Громче', volumeDown: 'Тише', studio: 'Открыть Студия LolzCloud', mini: 'Мини-плеер' };
  function text(tag, value, className = '') { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
  function message(value, error = false) { el('studio-message').textContent = value; studio.querySelector('.lc-studio-footer').classList.toggle('error', error); }
  async function action(type, args = {}) {
    if (type !== 'media' && pending.has(type)) {
      if (!queuedSettings.has(type)) return null;
      await pending.get(type);
      return action(type, args);
    }
    let complete;
    pending.set(type, new Promise(resolve => { complete = resolve; }));
    try {
      const result = await ipcRenderer.invoke('features:action', { type, ...args });
      if (result.state) feature = result.state;
      if (!result.ok) throw new Error(result.error);
      message(['copy-bbcode', 'card-copy', 'copy-collections', 'room-copy'].includes(type) ? 'Скопировано в буфер обмена' : type === 'media' ? '' : 'Готово');
      render(); return result.state;
    } catch (error) { message(error.message || 'Не удалось выполнить действие.', true); return null; }
    finally { pending.delete(type); complete(); }
  }
  function open(next = tab) {
    document.getElementById('lzt-dialog')?.close();
    document.getElementById('songshowcase')?.classList.add('fadesongshowcase');
    tab = next;
    studio.classList.toggle('is-lyrics', tab === 'lyrics');
    studio.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('selected', button.dataset.tab === tab));
    studio.querySelectorAll('[data-pane]').forEach(pane => { pane.hidden = pane.dataset.pane !== tab; });
    if (!studio.open) studio.show();
    document.body.classList.add('shell-studio-open'); window.lolzSelectNavigation?.(tab);
    const titles = { share: 'Сейчас слушаю', wave: 'Моя волна', library: 'Моя музыка', community: 'Подборки', lyrics: 'Текст песни', audio: 'Звук и эффекты', room: 'Комнаты', social: 'Профиль и друзья', radar: 'Радар новинок', moments: 'Любимые моменты', versions: 'Другие версии', private: 'Приватность', keys: 'Горячие клавиши', settings: 'Настройки', sources: 'Источники текста' };
    el('studio-title').textContent = titles[tab] || 'LolzCloud'; render();
    if (tab === 'lyrics') void loadLyrics();
  }
  function closePanel() {
    if (window.LolzCloudRooms?.active && tab !== 'room') open('room');
    else studio.close();
  }
  el('studio-launcher').onclick = () => open(); el('studio-close').onclick = closePanel;
  el('room-return').onclick = () => open('room');
  window.addEventListener('lolzcloud:room-session', () => render());
  window.LolzCloudStudio = { open, notify: message };
  studio.addEventListener('close', () => { document.body.classList.remove('shell-studio-open'); window.lolzSelectNavigation?.(window.LolzCloudYouTube?.active ? 'youtube' : 'browser'); waveView.setState(false, false); lyricBackground.setState(false, false); studioBackground.setState(false, false); });
  el('wave-launcher').onclick = () => open('wave');
  el('wave-start').onclick = () => feature?.wave.active ? action('media', { command: 'playPause' }) : action('wave-start');
  el('wave-stop').onclick = () => action('wave-stop');
  el('wave-next').onclick = () => action('wave-next');
  el('wave-love').onclick = () => action('wave-love', { url: snapshot?.playback.url });
  el('wave-ban').onclick = () => action('wave-ban', { url: snapshot?.playback.url });
  function waveBalanceLabel(value) {
    const mode = Number(value) >= 99 ? 'Только незнакомые треки' : Number(value) >= 65 ? 'Больше открытий' : Number(value) >= 25 ? 'Знакомое и новое' : 'Ближе к любимому';
    el('wave-balance-value').textContent = mode + ' · ' + Math.round(value) + '%';
    el('wave-balance').setAttribute('aria-valuetext', mode);
  }
  el('wave-balance').oninput = () => waveBalanceLabel(el('wave-balance').value);
  el('wave-balance').onchange = () => action('wave-balance', { value: Number(el('wave-balance').value) / 100 });
  el('wave-shake').onclick = () => action('wave-shake');
  el('wave-from-track').onclick = () => action('wave-from-track');
  el('wave-ban-artist').onclick = () => action('wave-ban-artist', { url: snapshot?.playback.url });
  function previewRequest() {
    const value = el('wave-request-input').value.trim(), preview = el('wave-request-preview');
    preview.hidden = !value; el('wave-request-labels').replaceChildren();
    if (!value) return;
    try {
      const request = parseRequest(value);
      for (const label of request.labels) el('wave-request-labels').append(text('span', label));
      el('wave-request-note').textContent = request.note;
    } catch (error) { el('wave-request-note').textContent = error.message; }
  }
  el('wave-request-input').oninput = () => { requestDraftTouched = true; previewRequest(); };
  for (const button of studio.querySelectorAll('[data-music-request]')) button.onclick = () => {
    requestDraftTouched = true; el('wave-request-input').value = button.dataset.musicRequest; previewRequest(); el('wave-request-input').focus();
  };
  el('wave-request-form').onsubmit = async event => {
    event.preventDefault(); if (requestSubmitting) return;
    requestSubmitting = true; el('wave-request-submit').disabled = true; el('wave-request-submit').textContent = 'Ищем музыку…';
    await action('wave-request', { text: el('wave-request-input').value });
    requestSubmitting = false; render();
  };
  el('wave-request-clear').onclick = async () => {
    await action('wave-request-clear'); requestDraftTouched = false; el('wave-request-input').value = ''; previewRequest();
  };
  el('wave-config-toggle').onclick = () => {
    const open = el('wave-config').hidden; el('wave-config').hidden = !open;
    el('wave-config-toggle').setAttribute('aria-expanded', String(open));
    if (open) el('wave-config').scrollIntoView({ block: 'nearest', behavior: feature?.preferences.reduceMotion ? 'auto' : 'smooth' });
  };
  for (const [key, rows] of Object.entries(waveOptions)) {
    for (const [value, label] of rows) { const option = document.createElement('option'); option.value = value; option.textContent = label; el('wave-' + key).append(option); }
    el('wave-' + key).onchange = () => action('wave-settings', { settings: { [key]: el('wave-' + key).value } });
  }
  el('wave-genre-form').onsubmit = event => { event.preventDefault(); void action('wave-settings', { settings: { genre: el('wave-genre').value.trim() } }); };
  el('wave-auto-context').onchange = () => action('wave-settings', { settings: { autoContext: el('wave-auto-context').checked } });
  for (const button of studio.querySelectorAll('[data-wave-scenario]')) button.onclick = async () => {
    const activity = button.dataset.waveScenario, mood = activity === 'workout' ? 'energetic' : 'calm';
    const changed = await action('wave-settings', { settings: { activity, mood } });
    if (changed && !changed.wave.active) await action('wave-start');
  };
  for (const [id, key] of [['pref-follow', 'autoFollow'], ['pref-motion', 'reduceMotion'], ['pref-density', 'density'], ['pref-startup', 'startupView'], ['pref-window', 'windowStyle']]) el(id).onchange = () => action('preferences', { settings: { [key]: el(id).type === 'checkbox' ? el(id).checked : el(id).value } });
  for (const [id, key] of [['pref-mini-lyrics', 'lyrics']]) el(id).onchange = () => action('mini-settings', { settings: { [key]: el(id).checked } });
  studio.querySelectorAll('[data-go]').forEach(button => { button.onclick = () => open(button.dataset.go); });
  studio.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => open(button.dataset.tab); });
  studio.addEventListener('click', event => { if (event.target === studio) closePanel(); });
  ipcRenderer.on('lolzcloud:studio', () => open());
  ipcRenderer.on('appReqEsc', () => {
    const focused = document.activeElement?.closest('dialog:modal');
    const modal = focused || [...document.querySelectorAll('dialog:modal')].at(-1);
    if (modal && modal !== studio) { modal.close(); return; }
    if (studio.open) closePanel();
  });
  window.showsongshowcase = () => open('share');
  window.updatelyricshowcase = () => open('lyrics');
  studio.querySelectorAll('[data-do]').forEach(button => {
    button.onclick = () => {
      const type = button.dataset.do;
      if (type === 'card-copy' || type === 'card-save') {
        el('share-card').scrollIntoView({ block: 'center', behavior: 'instant' });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = el('share-card').getBoundingClientRect();
          void action(type, { bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) } });
        }));
      } else void action(type);
    };
  });
  el('add-collection').onsubmit = async event => {
    event.preventDefault();
    const saved = await action('collection-add', { collection: { title: el('collection-title').value, url: el('collection-url').value, source: el('collection-source').value } });
    if (saved) { el('add-collection').reset(); lastLists = ''; render(); }
  };
  el('import-collections').onclick = async () => { if (await action('collection-import', { text: el('collection-json').value })) { lastLists = ''; render(); } };
  el('private-mode').onchange = () => action('private', { enabled: el('private-mode').checked });
  el('exclude-current').onclick = () => action('exclude-current');
  el('eq-enabled').onchange = () => action('dsp', { settings: { enabled: el('eq-enabled').checked } });
  el('eq-save').onclick = () => action('dsp', { settings: { saveAs: el('eq-name').value } });
  async function saveSound(settings) {
    await action('dsp', { settings: { ...settings, enabled: true } }); soundDraft = null; render();
  }
  const soundCaption = {
    speed: value => value < 95 ? 'Замедленно' : value > 105 ? 'Ускоренно' : 'Оригинальный',
    bass: value => value <= 0 ? 'Естественный' : value < 4 ? 'Мягкий' : value < 8 ? 'Плотный' : 'Мощный',
    reverb: value => !value ? 'Без эффекта' : value < 25 ? 'Комната' : value < 50 ? 'Объёмный' : 'Большой зал',
    echo: value => !value ? 'Без эффекта' : value < 25 ? 'Мягкое' : value < 50 ? 'Заметное' : 'Глубокое',
  };
  function controlPatch(name, value) {
    if (name === 'speed') return { rate: value / 100 };
    if (name === 'bass') { const gains = [...(soundDraft || feature.dsp).gains]; gains[0] = value; gains[1] = Math.round(value * .55); return { gains }; }
    return { [name]: value / 100 };
  }
  for (const name of ['speed', 'bass', 'reverb', 'echo']) {
    el(name).oninput = () => {
      if (!feature) return;
      const value = Number(el(name).value); el(name + '-caption').textContent = soundCaption[name](value);
      soundDraft = { ...(soundDraft || feature.dsp), ...controlPatch(name, value), preset: 'Свой', enabled: true };
      void applyDsp(soundDraft);
    };
    el(name).onchange = () => saveSound(controlPatch(name, Number(el(name).value)));
  }
  el('preserve-pitch').onchange = () => saveSound({ preservesPitch: el('preserve-pitch').checked });
  for (const key of ['limiter', 'ducking', 'scope', 'ceilingDb', 'duckDb', 'thresholdDb']) {
    const input = el('protect-' + key);
    if (input.type === 'range') input.oninput = () => { el(key + '-caption').textContent = input.value.replace('-', '−') + (key === 'duckDb' ? ' дБ' : ' dBFS'); };
    input.onchange = () => action('protection', { settings: { [key]: input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value } });
  }
  for (const [index, label] of ['Саб-бас', 'Бас', 'Середина', 'Детали', 'Воздух'].entries()) {
    const band = text('div', '', 'lc-band'); const caption = text('label', label); caption.htmlFor = 'lc-band-' + index;
    const input = document.createElement('input'); input.type = 'range'; input.min = '-12'; input.max = '12'; input.step = '1'; input.value = '0'; input.id = 'lc-band-' + index;
    const output = text('output', '0 дБ'); input.oninput = () => { output.textContent = input.value + ' дБ'; };
    input.onchange = () => saveSound({ gains: [...el('eq-sliders').querySelectorAll('input')].map(control => Number(control.value)) });
    band.append(caption, input, output); el('eq-sliders').append(band);
  }
  for (const [key, label] of Object.entries(names)) {
    const row = document.createElement('label'), input = document.createElement('input'); input.type = 'text'; input.dataset.key = key; input.autocomplete = 'off'; input.spellcheck = false;
    input.oninput = () => { keysDirty = true; };
    row.append(text('span', label), input); el('key-fields').append(row);
  }
  el('keys-form').onsubmit = async event => {
    event.preventDefault();
    const settings = Object.fromEntries([...el('key-fields').querySelectorAll('input')].map(input => [input.dataset.key, input.value.trim()]));
    if (await action('hotkeys', { settings })) keysDirty = false;
  };
  el('reload-lyrics').onclick = () => { lyricTrack = ''; void loadLyrics(true); };
  el('source-keys').onsubmit = async event => {
    event.preventDefault(); const keys = {};
    for (const key of ['spicy', 'musixmatch', 'spotifyId', 'spotifySecret']) if (el('source-' + key).value.trim()) keys[key] = el('source-' + key).value.trim();
    if (await action('lyrics-settings', { settings: { keys } })) { el('source-keys').reset(); lyricTrack = ''; sourceSignature = ''; render(); }
  };
  el('source-merge').onchange = () => action('lyrics-settings', { settings: { merge: el('source-merge').checked } });
  el('source-track').onsubmit = async event => { event.preventDefault(); if (await action('lyrics-spotify', { url: el('source-spotify-track').value.trim() })) { lyricTrack = ''; open('lyrics'); } };
  el('lyric-match').onsubmit = async event => { event.preventDefault(); if (await action('lyrics-match', { url: sourceIdentityUrl, title: el('lyric-match-title').value, artist: el('lyric-match-artist').value })) { lyricTrack = ''; open('lyrics'); } };
  el('lyric-match-reset').onclick = async () => { const track = snapshot?.displayPlayback || snapshot?.playback; if (await action('lyrics-match', { url: track?.url, reset: true })) { sourceIdentityKey = ''; lyricTrack = ''; open('lyrics'); } };
  studio.querySelectorAll('[data-provider-page]').forEach(button => { button.onclick = () => action('lyrics-provider-page', { id: button.dataset.providerPage }); });
  studio.querySelectorAll('[data-remove-key]').forEach(button => { button.onclick = () => action('lyrics-settings', { settings: { remove: [button.dataset.removeKey] } }); });
  el('source-remove-spotify').onclick = () => action('lyrics-settings', { settings: { remove: ['spotifyId', 'spotifySecret'] } });
  el('lyric-follow').onclick = () => lyricView.setFollow(true);
  const resizeInterface = value => action('preferences', { settings: { uiScale: Math.max(.85, Math.min(1.5, Math.round(value * 100) / 100)) } });
  el('pref-scale').oninput = () => { el('pref-scale-value').textContent = el('pref-scale').value + '%'; };
  el('pref-scale').onchange = () => resizeInterface(Number(el('pref-scale').value) / 100);
  el('pref-scale-reset').onclick = () => resizeInterface(1);
  ipcRenderer.on('lolzcloud:zoom', (_event, key) => resizeInterface(key === '0' ? 1 : uiScale + (key === '-' ? -.05 : .05)));
  function resizeLyrics(delta) {
    lyricsFont = Math.max(.7, Math.min(2, Math.round((lyricsFont + delta) * 10) / 10));
    lyricView.setFontScale(lyricsFont); lyricView.center();
    void action('preferences', { settings: { lyricsFontScale: lyricsFont } });
  }
  el('lyric-smaller').onclick = () => resizeLyrics(-.1);
  el('lyric-larger').onclick = () => resizeLyrics(.1);
  el('lyric-font-reset').onclick = () => resizeLyrics(1 - lyricsFont);
  el('lyrics').addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); resizeLyrics(event.deltaY < 0 ? .1 : -.1); } }, { passive: false });
  el('lyric-expand').onclick = () => { const expanded = studio.classList.toggle('is-lyrics-focus'); el('lyric-expand').setAttribute('aria-pressed', String(expanded)); requestAnimationFrame(() => lyricView.center()); };
  studio.querySelectorAll('[data-lyric-media]').forEach(button => { button.onclick = () => action('media', { command: button.dataset.lyricMedia }); });
  function row(title, subtitle, buttons = []) {
    const node = text('div', '', 'lc-list-row'), info = text('div', '', 'text');
    info.append(text('strong', title), text('small', subtitle)); node.append(info);
    for (const [caption, run] of buttons) { const button = text('button', caption); button.onclick = run; node.append(button); }
    return node;
  }
  function fillList(target, items, empty, make) {
    target.replaceChildren();
    if (!items.length) target.append(text('p', empty, 'lc-empty'));
    else items.forEach(item => target.append(make(item)));
  }
  function renderLists() {
    const signature = JSON.stringify([feature.history, feature.collections, feature.communityResults, snapshot.settings.excludedTracks]);
    if (signature === lastLists) return; lastLists = signature;
    const stats = feature.stats; el('stats').replaceChildren();
    for (const [value, caption] of [[Math.floor(stats.seconds / 60) + ' мин', 'Прослушано'], [String(stats.uniqueTracks), 'Разных треков'], [String(stats.plays), 'Прослушиваний']]) {
      const box = text('div', '', 'lc-stat'); box.append(text('strong', value), text('span', caption)); el('stats').append(box);
    }
    fillList(el('top-artists'), stats.topArtists, 'Статистика появится во время прослушивания.', item => row(item.name, Math.floor(item.seconds / 60) + ' мин'));
    fillList(el('top-tracks'), stats.topTracks, 'Пока нет прослушиваний.', item => row(item.title, item.artist + ' · ' + item.plays + ' раз', [['▶', () => action('play-url', { url: item.url })]]));
    fillList(el('history'), feature.history, 'Включи музыку — история начнёт заполняться.', item => row(item.title, [item.artist, new Date(item.playedAt).toLocaleString('ru-RU'), clock(item.seconds)].filter(Boolean).join(' · '), [['Слушать', () => action('play-url', { url: item.url })]]));
    fillList(el('collections'), feature.collections, 'Сохрани свою первую подборку или найди музыку на форуме.', item => row(item.title, item.url, [['▶', () => action('play-url', { url: item.url })], ...(item.source ? [['Тема ↗', () => action('open-forum', { url: item.source })]] : []), ['Убрать', async () => { await action('collection-remove', { id: item.id }); lastLists = ''; render(); }]]));
    fillList(el('community-results'), feature.communityResults || [], 'Нажми «Найти на Lolzteam», чтобы загрузить ссылки из тем.', item => row(item.title, item.url, [['▶', () => action('play-url', { url: item.url })], ['Сохранить', async () => { await action('collection-add', { collection: item }); lastLists = ''; render(); }], ['Тема ↗', () => action('open-forum', { url: item.source })]]));
    fillList(el('exclusions'), snapshot.settings.excludedTracks, 'Исключений пока нет.', url => row(url, 'Всегда приватно', [['Убрать', async () => {
      const excluded = snapshot.settings.excludedTracks.filter(item => item !== url);
      const result = await ipcRenderer.invoke('lolzteam:action', { type: 'configure', settings: { excludedTracks: excluded } });
      if (!result.ok) message(result.error, true);
    }]]));
  }
  async function applyDsp(config) {
    if (feature?.room?.hosting || feature?.source === 'room') config = { ...config, rate: 1 };
    const serialized = JSON.stringify(config);
    if (serialized === dspApplied) return;
    try { await activeView().executeJavaScript(`window.__lolzcloudSetAudioFX && window.__lolzcloudSetAudioFX(${serialized})`); dspApplied = serialized; }
    catch { dspApplied = ''; }
  }
  function render() {
    const inRoom = window.LolzCloudRooms?.active === true;
    el('room-return').hidden = !inRoom || tab === 'room';
    el('studio-close').setAttribute('aria-label', inRoom && tab !== 'room' ? 'Вернуться в комнату' : 'Закрыть панель');
    if (!snapshot || !feature) return;
    const track = snapshot.displayPlayback || snapshot.playback, hasTrack = snapshot.fresh && !!track.title;
    lyricBackground.setState(studio.open && tab === 'lyrics', hasTrack && track.playing);
    studioBackground.setState(studio.open, hasTrack && track.playing);
    const bpmCaption = window.LolzCloudVisuals.caption();
    for (const id of ['wave-tempo', 'lyric-tempo']) { el(id).textContent = bpmCaption; el(id).hidden = !bpmCaption; el(id).title = 'Темп движения фона' + (window.LolzCloudVisuals.tempo.source === 'analysis' ? ' · оценка по звучанию' : ' · данные трека'); }
    renderSources();
    lyricView.setAutoFollow(feature.preferences?.autoFollow !== false);
    if (feature.preferences) {
      uiScale = feature.preferences.uiScale || 1;
      const frame = require('electron').webFrame;
      if (Math.abs(frame.getZoomFactor() - uiScale) > .001) frame.setZoomFactor(uiScale);
      if (document.activeElement !== el('pref-scale')) el('pref-scale').value = Math.round(uiScale * 100);
      el('pref-scale-value').textContent = Math.round(uiScale * 100) + '%';
      lyricsFont = feature.preferences.lyricsFontScale || 1; lyricView.setFontScale(lyricsFont);
      el('lyric-font-reset').textContent = Math.round(lyricsFont * 100) + '%';
      el('lyric-smaller').disabled = lyricsFont <= .7; el('lyric-larger').disabled = lyricsFont >= 2;
      document.body.dataset.windowStyle = feature.preferences.windowStyle || 'mac';
      for (const [id, key] of [['pref-follow', 'autoFollow'], ['pref-motion', 'reduceMotion'], ['pref-density', 'density'], ['pref-startup', 'startupView'], ['pref-window', 'windowStyle']]) if (document.activeElement !== el(id)) { if (el(id).type === 'checkbox') el(id).checked = feature.preferences[key]; else el(id).value = feature.preferences[key]; }
      el('pref-mini-lyrics').checked = feature.mini.lyrics;
    }
    const wave = feature.wave;
    const downloads = feature.downloads;
    for (const button of studio.querySelectorAll('[data-do="download-current"]')) { button.disabled = !hasTrack || feature.capabilities?.download === false; if (feature.capabilities?.download === false) button.title = 'YouTube Music не предоставляет MP3 для сохранения'; }
    for (const button of studio.querySelectorAll('[data-do="open-current-track"]')) button.textContent = 'Открыть трек в ' + sourceLabel(track.url) + ' ↗';
    for (const button of studio.querySelectorAll('[data-do="open-current-track"]')) button.disabled = !hasTrack || !mediaUrl(track.url);
    if (downloads) {
      el('downloads-directory').textContent = downloads.directory;
      const signature = JSON.stringify(downloads.items.map(item => ({ ...item, percent: item.percent === null ? null : Math.floor(item.percent) })));
      if (signature !== downloadSignature) {
        downloadSignature = signature;
        const labels = { queued: 'В очереди', downloading: 'Скачиваем', converting: 'Готовим MP3', complete: 'MP3 сохранён', cancelled: 'Отменено', error: 'Не удалось скачать' };
        fillList(el('downloads-list'), downloads.items, 'Здесь появятся песни, которые ты сохранишь в MP3.', item => row(item.title || 'Песня SoundCloud', [item.artist, item.error || labels[item.status], ['downloading', 'converting'].includes(item.status) && item.percent !== null ? Math.floor(item.percent) + '%' : '', item.status === 'complete' && !item.exists ? 'Файл перемещён или удалён' : ''].filter(Boolean).join(' · '), item.status === 'complete' ? [['Показать файл ↗', () => action('download-reveal', { id: item.id })]] : ['queued', 'downloading', 'converting'].includes(item.status) ? [['Отменить', () => action('download-cancel', { id: item.id })]] : [['Повторить', () => action('download-retry', { id: item.id })]]));
      }
    }
    if (wave) {
      el('wave-request-submit').disabled = requestSubmitting;
      el('wave-request-submit').textContent = requestSubmitting ? 'Ищем музыку…' : 'Включить подборку ↗';
      el('wave-request-form').setAttribute('aria-busy', String(requestSubmitting));
      el('wave-request-clear').hidden = !wave.request;
      if (!requestDraftTouched) { el('wave-request-input').value = wave.request?.text || ''; previewRequest(); }
      const caption = wave.loading && !wave.active ? 'Собираем твою волну…' : wave.active ? track.playing ? 'Пауза' : 'Продолжить волну' : 'Включить волну';
      el('wave-start').setAttribute('aria-label', caption); el('wave-start').title = caption;
      el('wave-play-icon').setAttribute('d', wave.active && track.playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'm9 5 11 7-11 7z');
      el('wave-hero').classList.toggle('is-loading', wave.loading && !wave.active); el('wave-stop').hidden = !wave.active;
      el('wave-caption').textContent = wave.loading ? 'Собираем твою волну…' : wave.active ? wave.current?.artist || 'Играет твой персональный микс' : 'Твоя музыка. Твой ритм.';
      el('wave-start').disabled = wave.loading && !wave.active;
      el('wave-next').disabled = !wave.active || wave.waiting || wave.loading && !wave.queue.length;
      el('wave-shake').disabled = wave.loading;
      el('wave-from-track').disabled = !hasTrack || wave.loading;
      el('wave-ban-artist').disabled = !wave.canFeedback || !track.artist;
      el('wave-love').disabled = !wave.canFeedback; el('wave-ban').disabled = !wave.canFeedback;
      el('wave-love').setAttribute('aria-pressed', String(wave.reaction === 'love'));
      el('wave-love').title = wave.reaction === 'love' ? 'Убрать отметку «Нравится»' : 'Больше похожей музыки';
      el('wave-status').textContent = wave.error || (wave.waiting ? 'Открываем следующий трек…' : wave.refilling ? 'Заранее пополняем очередь. Музыка продолжается.' : wave.active ? 'Волна играет. Каждый выбор помогает ей узнать тебя.' : 'Включи волну — похожие треки будут подбираться автоматически.');
      el('wave-signal-count').textContent = [wave.likes + ' лайков', wave.learned + ' знакомых треков', 'быстрые пропуски учитываются'].join(' · ');
      el('wave-current-title').textContent = wave.current?.title || track.title || 'Твоя следующая любимая песня';
      el('wave-current-reason').textContent = wave.current?.reason || 'Начнём с твоих лайков и любимых исполнителей';
      el('wave-hero').classList.toggle('is-playing', wave.active && track.playing);
      waveView.setState(studio.open && tab === 'wave', hasTrack && track.playing);
      if (document.activeElement !== el('wave-balance')) { el('wave-balance').value = wave.adventurous * 100; waveBalanceLabel(el('wave-balance').value); }
      const settings = { ...waveDefaults, ...wave.preferences };
      if (settings.character !== 'mixed') el('wave-balance-value').textContent = settings.character === 'discover' ? 'Только незнакомые треки' : 'Любимые записи';
      el('wave-balance').disabled = settings.character !== 'mixed';
      el('wave-balance').title = settings.character === 'mixed' ? 'Баланс знакомого и нового' : 'Баланс доступен в режиме «Мой микс»';
      for (const key of Object.keys(waveOptions)) if (document.activeElement !== el('wave-' + key)) el('wave-' + key).value = settings[key];
      if (document.activeElement !== el('wave-genre')) el('wave-genre').value = settings.genre;
      el('wave-auto-context').checked = settings.autoContext;
      el('wave-context').textContent = settings.autoContext ? wave.context || 'Твой персональный микс' : 'Твой персональный микс';
      el('wave-description').textContent = wave.request ? wave.request.labels.join(' · ') : wave.anchor ? 'По мотивам «' + wave.anchor.title + '»' : [settings.activity !== 'any' && waveOptions.activity.find(row => row[0] === settings.activity)?.[1], settings.mood !== 'any' && waveOptions.mood.find(row => row[0] === settings.mood)?.[1], settings.character !== 'mixed' && waveOptions.character.find(row => row[0] === settings.character)?.[1], settings.genre].filter(Boolean).join(' · ') || 'Любимое рядом. Новое впереди.';
      el('wave-now').hidden = !wave.active || !hasTrack;
      el('wave-now-title').textContent = track.title || ''; el('wave-now-artist').textContent = track.artist || '';
      window.lolzArtwork(el('wave-now-cover'), wave.active && hasTrack ? track.cover : '');
      for (const button of studio.querySelectorAll('[data-wave-scenario]')) button.setAttribute('aria-pressed', String(button.dataset.waveScenario === settings.activity));
      const artists = wave.artists || [], artistSignature = JSON.stringify(artists);
      if (artistSignature !== waveArtistSignature) {
        waveArtistSignature = artistSignature; el('wave-artists').replaceChildren();
        if (artists.length) el('wave-artists').append(text('small', 'Волна по исполнителю'));
        for (const artist of artists) { const button = text('button', artist.name); button.title = 'Моя волна по исполнителю ' + artist.name; button.onclick = () => action('wave-artist', { name: artist.name }); el('wave-artists').append(button); }
      }
      const blocked = wave.blockedArtists || [], blockedSignature = JSON.stringify(blocked);
      el('wave-blocked').hidden = !blocked.length;
      if (blockedSignature !== waveBlockedSignature) {
        waveBlockedSignature = blockedSignature; el('wave-blocked-artists').replaceChildren();
        for (const name of blocked) { const button = text('button', name + ' ×'); button.title = 'Снова предлагать ' + name; button.onclick = () => action('wave-unblock-artist', { name }); el('wave-blocked-artists').append(button); }
      }
      el('wave-launcher').classList.toggle('is-playing', wave.active);
      const signature = JSON.stringify(wave.queue);
      if (signature !== waveListSignature) { waveListSignature = signature; fillList(el('wave-queue'), wave.queue, 'Здесь появятся треки, подобранные для тебя.', item => row(item.title, item.artist + ' · ' + item.reason, [['Слушать', () => action('wave-select', { url: item.url })]])); }
      if (guestReady && waveApplied !== wave.active) { const active = wave.active; view.executeJavaScript('window.__lolzcloudWaveActive = ' + JSON.stringify(active)).then(() => { waveApplied = active; }).catch(() => {}); }
    }
    el('card-title').textContent = hasTrack ? track.title : 'Включи любимый трек';
    el('card-source').textContent = sourceLabel(track.url).toUpperCase();
    el('card-artist').textContent = hasTrack ? track.artist : 'SoundCloud';
    el('card-time').textContent = clock(track.position) + ' / ' + clock(track.duration);
    window.lolzArtwork(el('card-cover'), hasTrack ? track.cover : '');
    el('card-progress').style.width = (track.duration ? Math.min(100, track.position / track.duration * 100) : 0) + '%';
    el('card-owner').textContent = [snapshot.user?.name, snapshot.soundcloudProfile?.name].filter(Boolean).join(' · ') || 'Твой профиль';
    el('card-link').textContent = snapshot.soundcloudProfile?.url?.replace('https://', '') || snapshot.profiles?.lolzteam?.url?.replace('https://', '') || 'Музыка объединяет';
    el('private-mode').checked = snapshot.settings.privateMode;
    el('private-status').textContent = snapshot.private ? 'Сейчас музыка скрыта в публичных статусах и не записывается в историю.' : 'Текущий трек виден в включённых трансляциях.';
    el('exclude-current').disabled = !hasTrack;
    el('room-url').value = feature.room.url;
    el('room-status').textContent = feature.room.error || (feature.room.connecting ? 'Подтверди подключение LolzCloud в открывшемся браузере' : feature.room.hosting ? 'Основной плеер ведёт комнату · гостей: ' + feature.room.viewers : feature.room.authenticated ? 'Ты вошёл как ' + feature.room.user.name : 'Войди через Lolzteam, чтобы открыть комнату');
    el('room-code').hidden = !feature.room.connecting; el('room-code').textContent = feature.room.connecting ? 'Код подключения: ' + feature.room.code : '';
    for (const button of studio.querySelectorAll('[data-do="room-login"]')) button.hidden = feature.room.authenticated || feature.room.connecting;
    for (const button of studio.querySelectorAll('[data-do="room-claim"]')) button.disabled = !feature.room.authenticated || feature.room.hosting;
    for (const button of studio.querySelectorAll('[data-do="room-stop"],[data-do="room-copy"]')) button.disabled = !feature.room.active;
    for (const button of studio.querySelectorAll('[data-do="room-logout"]')) button.hidden = !feature.room.authenticated;
    const people = feature.room.participants || [], signature = JSON.stringify(people);
    if (el('room-participants').dataset.signature !== signature) {
      el('room-participants').dataset.signature = signature; el('room-participants').replaceChildren();
      for (const person of people) {
        const card = text('div', '', 'lc-room-person'), avatar = text('span', person.name.slice(0, 1).toUpperCase(), 'lc-room-avatar'), info = text('div', '');
        info.append(text('strong', person.name), text('small', person.host ? person.online ? 'Ведущий' : 'Ведущий не в сети' : 'Слушает с нами')); card.append(avatar, info); el('room-participants').append(card);
      }
    }
    const presetSignature = JSON.stringify(feature.soundPresets);
    if (lastPresets !== presetSignature) {
      el('sound-presets').replaceChildren();
      for (const preset of feature.soundPresets || []) {
        const button = text('button', '', 'lc-sound-preset ' + preset.color); button.type = 'button'; button.dataset.preset = preset.name;
        const icon = text('span', preset.icon, 'lc-preset-icon'), caption = text('span', '', 'lc-preset-caption'); caption.append(text('strong', preset.label), text('small', preset.description));
        button.append(icon, caption); button.onclick = () => { soundDraft = null; void action('dsp', { settings: { preset: preset.name } }); }; el('sound-presets').append(button);
      }
      lastPresets = presetSignature;
    }
    el('eq-enabled').checked = feature.dsp.enabled;
    el('sound-presets').querySelectorAll('button').forEach(button => { const selected = button.dataset.preset === feature.dsp.preset; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    const sound = soundDraft || feature.dsp;
    for (const [name, value] of [['speed', sound.rate * 100], ['bass', Math.max(0, sound.gains[0])], ['reverb', sound.reverb * 100], ['echo', sound.echo * 100]]) {
      if (document.activeElement !== el(name)) el(name).value = value;
      el(name + '-caption').textContent = soundCaption[name](value);
    }
    const sharedSpeed = feature.room.hosting || feature.source === 'room';
    el('speed').disabled = sharedSpeed;
    el('speed').title = sharedSpeed ? 'В общей комнате используется скорость 1×' : 'Темп музыки';
    if (sharedSpeed) { el('speed').value = 100; el('speed-caption').textContent = 'В комнате · 1×'; }
    el('preserve-pitch').checked = sound.preservesPitch;
    feature.dsp.gains.forEach((gain, index) => { const input = document.getElementById('lc-band-' + index); if (document.activeElement !== input) { input.value = gain; input.nextElementSibling.textContent = gain + ' дБ'; } });
    el('audio-state').textContent = !feature.dsp.enabled ? 'Оригинальное звучание · эффекты выключены' : feature.audio.unavailable ? 'Темп меняется. Для этого потока пространственные эффекты недоступны.' : feature.audio.attached ? 'Твоё звучание активно · эффекты применяются сразу' : feature.audio.mediaCount ? 'Темп настроен · пространственные эффекты включатся с музыкой' : 'Настройки готовы. Если трек уже играл, нажми паузу и продолжи.';
    if (feature.protection) {
      const settings = feature.protection;
      for (const key of ['limiter', 'ducking', 'scope', 'ceilingDb', 'duckDb', 'thresholdDb']) {
        const input = el('protect-' + key);
        if (document.activeElement !== input) { if (input.type === 'checkbox') input.checked = settings[key]; else input.value = settings[key]; }
        if (input.type === 'range') el(key + '-caption').textContent = input.value.replace('-', '−') + (key === 'duckDb' ? ' дБ' : ' dBFS');
        input.disabled = key === 'ceilingDb' ? !settings.limiter : !['limiter', 'ducking'].includes(key) && !settings.ducking;
      }
      const limiter = !settings.limiter ? 'Ограничение пиков выключено' : !feature.audio.mediaCount ? 'Ограничитель готов к музыке' : !feature.audio.safety?.limiterAvailable ? 'Для этого потока ограничитель пока недоступен' : feature.audio.safety.reductionDb > .5 ? 'Пики приглушены на ' + feature.audio.safety.reductionDb.toFixed(1) + ' дБ' : 'Пики под контролем';
      const ducking = !settings.ducking ? 'Приглушение разговоров выключено' : feature.ducking?.active ? 'Музыка тише · ' + feature.ducking.sources.join(', ') : feature.ducking?.reason || (feature.ducking?.available ? 'Ждём звук из других приложений' : 'Подключаем звук Windows…');
      el('protection-state').textContent = limiter + ' · ' + ducking;
      void applySafety(feature.safetyConfig || { ...settings, duckGain: 1, revision: 0 });
    }
    if (!keysDirty) el('key-fields').querySelectorAll('input').forEach(input => { if (document.activeElement !== input) input.value = feature.hotkeys[input.dataset.key]; });
    el('key-errors').textContent = feature.hotkeyErrors.length ? 'Эти сочетания заняты: ' + feature.hotkeyErrors.join(', ') : 'Сочетания зарегистрированы.';
    if (studio.open && ['library', 'community', 'private'].includes(tab)) renderLists();
    if (studio.open && tab === 'lyrics') {
      el('lyric-title').textContent = track.title || 'Включи любимый трек'; el('lyric-artist').textContent = track.artist || 'SoundCloud';
      window.lolzArtwork(el('lyric-cover'), track.cover);
      if (feature.lyrics?.key === lyricKey(track)) setLyrics(feature.lyrics);
      if (lyricTrack !== lyricKey(track)) void loadLyrics();
      lyricView.setPlayback(track, snapshot.fresh);
    }
    window.LolzCloudRanges.update(studio);
    lyricView.setCanSeek(feature.capabilities?.seek!==false);
    if (!soundDraft) void applyDsp(feature.dsp);
    if (Number.isFinite(feature.player?.volume) && playerApplied !== feature.player.volume) { const volume = feature.player.volume; media('volume', volume).then(() => { playerApplied = volume; }); }
    if (guestReady && !snapshot.local && ['off', 'all', 'one'].includes(feature.player?.repeat) && repeatApplied !== feature.player.repeat && !repeatApplying) {
      const mode = feature.player.repeat; repeatApplying = true;
      media('repeat', mode).then(applied => { if (applied) repeatApplied = mode; }).finally(() => { repeatApplying = false; });
    }
  }
  function setLyrics(data) {
    lyrics = data; lyricView.setData(data);
    const searching = data.attempts?.find(attempt => attempt.status === 'searching');
    const caption = data.lines?.some(line => line.words?.length) ? 'Пословно · ' + data.source : data.lines?.length ? 'По строкам · ' + data.source : data.versionMismatch ? 'Длительность версии отличается · текст без синхронизации' : data.plain ? 'Текст без тайм-кодов · ' + data.source : data.instrumental ? 'Инструментальная композиция' : data.attempts?.length ? 'Текст не найден · проверь название в источниках' : 'Слова твоей музыки';
    el('lyric-status').textContent = data.loading ? (data.found ? caption + ' · ищем тайминги…' : 'Ищем слова' + (searching ? ' · ' + searching.name : '…')) : caption;
    el('lyric-follow').disabled = !data.lines?.length || feature?.preferences?.autoFollow === false;
  }
  function renderSources() {
    const settings = feature?.lyricSettings; if (!settings) return;
    const track = snapshot?.displayPlayback || snapshot?.playback, identity = feature?.lyrics?.identity;
    el('lyric-identity').textContent = identity?.title ? 'Ищем: ' + identity.artist + ' — ' + identity.title : 'Текущая запись: ' + (track?.artist || '') + ' — ' + (track?.title || 'Включи трек');
    const identityKey = [track?.url, identity?.artist, identity?.title].join('\n');
    if (sourceIdentityKey !== identityKey && !el('lyric-match').contains(document.activeElement)) { sourceIdentityKey = identityKey; sourceIdentityUrl = track?.url || ''; el('lyric-match-title').value = identity?.title || track?.title || ''; el('lyric-match-artist').value = identity?.artist || track?.artist || ''; }
    const shared = feature.room?.authenticated === true;
    el('shared-spicy-status').textContent = shared ? 'Spicy Lyrics подключён через LolzCloud. Общий ключ хранится на сервере.' : feature.room?.connecting ? 'Подтверди подключение в открытой вкладке браузера.' : 'Войди через Lolzteam на lolzcloud.com — личный ключ не нужен.';
    el('shared-spicy-login').hidden = shared || feature.room?.connecting;
    const attempts = feature.lyrics?.attempts || [], signature = JSON.stringify([settings, attempts, shared]);
    if (signature === sourceSignature) return; sourceSignature = signature;
    const labels = { 'needs-key': 'Нужен ключ', 'needs-match': 'Нужна запись Spotify', searching: 'Ищем…', disabled: 'Выключен', word: 'Пословные метки', line: 'Тайм-коды строк', plain: 'Обычный текст', miss: 'Совпадений нет', access: 'Проверь доступ ключа', limited: 'Лимит · попробуем позже', unavailable: 'Временно недоступен', invalid: 'Неподдерживаемый ответ', version: 'Другая версия трека', instrumental: 'Инструментальная' };
    el('lyric-providers').replaceChildren();
    settings.order.forEach((id, index) => {
      const provider = settings.providers.find(value => value.id === id), attempt = attempts.find(value => value.id === id), row = text('div', '', 'lc-provider');
      const label = text('label', ''), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !settings.disabled.includes(id); checkbox.setAttribute('aria-label', 'Искать в ' + provider.name);
      checkbox.onchange = () => action('lyrics-settings', { settings: { disabled: checkbox.checked ? settings.disabled.filter(value => value !== id) : [...settings.disabled, id] } });
      const caption = text('span', ''); caption.append(text('strong', provider.name), text('small', labels[attempt?.status] || (provider.id === 'spicy' && shared ? 'Общий источник LolzCloud' : provider.key && !settings.configured[provider.key] ? 'Нужен ключ' : 'Готов к поиску'))); label.append(checkbox, caption); row.append(label);
      for (const [direction, arrow] of [[-1, '↑'], [1, '↓']]) {
        const button = text('button', arrow); button.type = 'button'; button.disabled = index + direction < 0 || index + direction >= settings.order.length; button.setAttribute('aria-label', provider.name + (direction < 0 ? ' раньше' : ' позже'));
        button.onclick = () => { const order = [...settings.order]; [order[index], order[index + direction]] = [order[index + direction], order[index]]; void action('lyrics-settings', { settings: { order } }); }; row.append(button);
      }
      el('lyric-providers').append(row);
    });
    el('source-merge').checked = settings.merge;
    for (const key of ['spicy', 'musixmatch', 'spotifyId', 'spotifySecret']) el('source-' + key).placeholder = settings.configured[key] ? 'Сохранён · введи новый, чтобы заменить' : key === 'spicy' ? 'Клиентский ключ sl_pk_…' : key === 'musixmatch' ? 'Ключ разработчика' : '';
    el('source-settings-status').textContent = settings.error || 'Ключи зашифрованы средствами Windows и не передаются в SoundCloud.';
  }
  async function loadLyrics(force = false) {
    if (!(snapshot?.displayPlayback || snapshot?.playback)?.title) return;
    const key = lyricKey(snapshot.displayPlayback || snapshot.playback);
    if (!force && (lyricLoading === key || key === lyricTrack && lyrics)) return;
    lyricLoading = key; lyricTrack = key;
    const request = ++lyricRequest;
    if (lyrics?.key !== key) setLyrics({ key, revision: -1, loading: true, lines: [], plain: '' });
    try {
      const response = await ipcRenderer.invoke('features:action', { type: 'lyrics', force });
      if (request === lyricRequest) lyricLoading = '';
      const result = response.state;
      if (request !== lyricRequest || !response.ok || !result || result.lyricTrack !== lyricKey(snapshot.displayPlayback || snapshot.playback)) return;
      setLyrics(result.lyrics); lyricView.setPlayback(snapshot.displayPlayback || snapshot.playback, snapshot.fresh);
    } catch { if (request === lyricRequest) lyricLoading = ''; }
  }
  window.addEventListener('lolzcloud:state', event => { snapshot = event.detail; if (snapshot.features) feature = snapshot.features; render(); });
  async function media(command, value) {
    if(command==='playPause'&&openingSoundCloud)command='pause';
    if(['pause','next','previous'].includes(command))cancelPendingPlayback();
    if (window.LolzCloudYouTube?.active) return window.LolzCloudYouTube.media(command, value);
    const data = JSON.stringify([command, value]);
    try {
      const result = await view.executeJavaScript(`(async()=>{if(typeof window.__lolzcloudMediaCommand!=='function')return false;const result=await window.__lolzcloudMediaCommand(...${data});return result!==false&&result?.applied!==false;})()`, true);
      if (result === false) message('Плеер SoundCloud ещё не готов. Подожди загрузки трека и повтори.', true);
      return result;
    } catch { message('Не удалось передать команду в SoundCloud. Повтори после загрузки трека.', true); return false; }
  }
  function cancelPendingPlayback(){playRequest++;openingSoundCloud=0;}
  ipcRenderer.on('lolzcloud:pause-soundcloud',cancelPendingPlayback);
  window.addEventListener('lolzcloud:provider-ready', () => { if(window.LolzCloudYouTube?.active)cancelPendingPlayback();guestReady = true; dspApplied = ''; safetyApplied = ''; repeatApplied = null; playerApplied = null; if (feature) { void applyDsp(feature.dsp); if (latestSafety) void applySafety(latestSafety); } });
  ipcRenderer.on('lolzcloud:media', (_, data) => media(data.command, data.value));
  ipcRenderer.on('lolzcloud:dsp', (_, config) => { dspApplied = ''; void applyDsp(config); });
  async function applySafety(config) {
    const revision = Number.isFinite(config?.revision) ? config.revision : 0;
    if (revision < safetyRevision) return;
    safetyRevision = revision; latestSafety = config;
    if (!guestReady) return;
    const signature = JSON.stringify(config); if (signature === safetyApplied) return;
    try { await activeView()?.executeJavaScript('window.__lolzcloudSetAudioSafety && window.__lolzcloudSetAudioSafety(' + signature + ')');if(latestSafety===config)safetyApplied=signature; } catch { /* Provider is still attaching or navigating. */ }
  }
  ipcRenderer.on('lolzcloud:safety', (_, config) => { void applySafety(config); });
  ipcRenderer.on('lolzcloud:play-url', async (_, value) => {
    window.LolzCloudYouTube?.leave();
    const url = scUrl(typeof value === 'string' ? value : value?.url); if (!url) return;
    const id = ++playRequest;openingSoundCloud=id;
    document.getElementById('lzt-dialog')?.close();
    try {
      await view.loadURL(url);
      for (let attempt = 0; attempt < 30 && id === playRequest; attempt++) {
        const started = await view.executeJavaScript(`window.__lolzcloudPlayback?.play(${JSON.stringify(url)}) === 'playing'`, true).catch(() => false);
        if(id!==playRequest)return;
        if (started) {if(value?.resume){await media('seek',value.resume.position);if(id===playRequest&&!value.resume.playing)await media('pause');}return;}
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch { if (id === playRequest) message('Не удалось открыть трек SoundCloud.', true); }
    finally{if(openingSoundCloud===id)openingSoundCloud=0;}
  });
  view.addEventListener('dom-ready', async () => {
    guestReady = true;
    dspApplied = '';
    safetyApplied = '';
    waveApplied = null;
    playerApplied = null;
    repeatApplied = null;
    const code = fs.readFileSync(path.join(__dirname, '../plugins/sound-effects.js'), 'utf8');
    await view.executeJavaScript(code).catch(() => {});
    if (feature) await applyDsp(feature.dsp);
    if (latestSafety) await applySafety(latestSafety);
  });
  setInterval(async () => {
    try {
      const status = await view.executeJavaScript('window.__lolzcloudGetAudioState ? window.__lolzcloudGetAudioState() : {attached:0,unavailable:false,mediaCount:0,rate:1,volume:1}');
      if (!window.LolzCloudYouTube?.active) ipcRenderer.send('features:audio', { ...status, source: 'soundcloud' });
    } catch { /* SoundCloud is navigating. */ }
  }, 250);
  ipcRenderer.invoke('lolzteam:action', { type: 'state' }).then(result => { if (result.ok) { snapshot = result.state; feature = snapshot.features; render(); } });
})();
