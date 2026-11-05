'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, ipcMain, globalShortcut, clipboard, ClipboardItem, dialog, shell, screen, safeStorage, session } = require('electron');
const { copyCard } = require('./clipboard.cjs');
const { RepeatIntent } = require('./repeat-intent.cjs');
const { MusicFeatures, shareText, scUrl } = require('./music.cjs');
const { ListeningRoom } = require('./room.cjs');
const { ROOM_PARTITION, ROOM_COOKIE, roomUrl, roomCard } = require('./room-view.cjs');
const { LyricsLibrary } = require('./lyrics.cjs');
const { LyricPrefetcher } = require('./lyric-prefetch.cjs');
const { LyricSettings } = require('./lyric-settings.cjs');
const { LyricsEngine } = require('./lyric-providers.cjs');
const { SoundCloudDiscovery } = require('./discovery.cjs');
const { PersonalWave } = require('./wave.cjs');
const { MiniPlayerWindow } = require('./mini-window.cjs');
const { TrackVisuals } = require('./track-visuals.cjs');
const { AudioDucker } = require('./audio-ducker.cjs');
const { Downloads } = require('./downloads.cjs');
const { SoundCloudAudioSource } = require('./audio-download.cjs');
const { createPlayerExperience } = require('./player-experience.cjs');
const { PlaybackHistory } = require('./playback-history.cjs');

function createStudio({ app, service, getWindow, trusted, onStateChange = () => {} }) {
  const music = new MusicFeatures(path.join(app.getPath('userData'), 'music-library.json'));
  const repeat = new RepeatIntent();
  const playbackHistory = new PlaybackHistory();
  const room = new ListeningRoom(() => service.getState(), { filename: path.join(app.getPath('userData'), 'cloud-session.json'), safeStorage, openExternal: url => shell.openExternal(url), onControlLost: () => getWindow()?.webContents.send('lolzcloud:media', { command: 'pause' }) });
  const shortcuts = new Set(); let hotkeyErrors = [], mini = null, audio = { attached: 0, unavailable: false };
  const ducker = new AudioDucker({ directory: path.join(app.getPath('userData'), 'runtime', 'audio'), settings: music.data.protection, onChange: config => { const host = getWindow(); if (host && !host.isDestroyed() && !host.webContents.isDestroyed()) host.webContents.send('lolzcloud:safety', config); } });
  const miniController = new MiniPlayerWindow({ BrowserWindow, screen, app, filename: path.join(app.getPath('userData'), 'mini-window.json'), html: path.resolve(__dirname, '../app/mini.html'), onClosed: () => { mini = null; } });
  const lyricSettings = new LyricSettings(path.join(app.getPath('userData'), 'lyric-sources.json'), safeStorage);
  const lyricEngine = new LyricsEngine({ settings: lyricSettings, shared: { available: () => room.getState().authenticated, get: (id, signal) => room.getSpicy(id, signal) } });
  let communityResults = []; const lyrics = new LyricsLibrary((track, options) => track.url?.startsWith('lolzcloud-local:') ? Promise.resolve({ found: false, lines: [], plain: '', source: 'Локальная музыка' }) : lyricEngine.search(track, options), path.join(app.getPath('userData'), 'lyric-timing.json'));
  const discovery = new SoundCloudDiscovery(), visuals = new TrackVisuals(discovery);
  const downloads = new Downloads({ directory: path.join(app.getPath('downloads'), 'LolzCloud'), runtime: path.join(app.getPath('userData'), 'runtime', 'downloads'), filename: path.join(app.getPath('userData'), 'downloads.json'), source: new SoundCloudAudioSource(discovery, fetch, { session: session.defaultSession }) });
  const prefetch = new LyricPrefetcher(lyrics, discovery);
  let cloudAuthenticated = room.getState().authenticated;
  const wave = new PersonalWave({ filename: path.join(app.getPath('userData'), 'wave-library.json'), provider: discovery, getSnapshot: () => service.getState(), getHistory: () => music.data.history, play: (url, track) => { playbackHistory.request({ url }); service.beginPlayback({ ...track, url }); if (!service.isPrivate()) void lyrics.load(track); onStateChange(); getWindow()?.webContents.send('lolzcloud:play-url', { url, track }); } });
  const experience = createPlayerExperience({ app, service, music, wave, lyrics, room, discovery, downloads, media, getWindow, notify: onStateChange, dialog, clipboard, play: async (url, track) => { if (!scUrl(url)) throw new Error('Нужна ссылка SoundCloud.'); wave.stop(); playbackHistory.request({ url }); if (track?.title) service.beginPlayback({ ...track, url }); getWindow()?.webContents.send('lolzcloud:play-url', { url, track }); } });
  const shownTrack = () => experience.current();
  async function roomAction(action) {
    if (!room.getState().authenticated) throw new Error('Сначала войди через Lolzteam.');
    if (action?.type === 'list') {
      const result = await room.request('/api/rooms');
      return result.rooms.map(value => roomCard(value, room.origin)).filter(Boolean);
    }
    const value = action?.type === 'create'
      ? await room.request('/api/rooms', { method: 'POST', body: {} })
      : null;
    const url = roomUrl(value?.url || action?.url, room.origin);
    if (!url) throw new Error('Нужна ссылка на комнату LolzCloud.');
    if (action.type === 'copy') { await clipboard.writeText(url); return null; }
    const endpoint = '/api/rooms/' + url.split('/').at(-2);
    if (action.type === 'close') {
      if (url === room.getState().url) await room.stop();
      else await room.request(endpoint, { method: 'DELETE' });
      return null;
    }
    if (action.type !== 'open' && action.type !== 'create') throw new Error('Неизвестное действие комнаты.');
    if (!value) await room.request(endpoint);
    if (room.lease) await room.release();
    await media('pause');
    await session.fromPartition(ROOM_PARTITION).cookies.set({
      url: room.origin, name: ROOM_COOKIE, value: room.token, path: '/', secure: true, httpOnly: true,
      sameSite: 'lax', expirationDate: room.expires / 1000,
    });
    return url;
  }
  async function openCredit(url) {
    if (typeof url !== 'string' || !/^https:\/\//.test(url) || !lyrics.state(shownTrack()).credits?.some(credit => credit.url === url)) return;
    await shell.openExternal(url);
  }
  async function media(command, value) {
    if (command === 'volumeUp' || command === 'volumeDown') {
      const current = music.data.player.volume ?? audio.volume ?? 1;
      value = Math.max(0, Math.min(1, Math.round((current + (command === 'volumeUp' ? .05 : -.05)) * 100) / 100));
      music.configurePlayer({ volume: value });
      command = 'volume';
    }
    if (command === 'seek') wave.seeking();
    if (experience.localMedia(command, value)) return;
    if (command === 'previous' || command === 'next') {
      const track = playbackHistory.step(command === 'previous' ? -1 : 1);
      if (track) {
        if (wave.active) wave.replay(track);
        else { service.beginPlayback(track); getWindow()?.webContents.send('lolzcloud:play-url', { url: track.url, track }); }
        onStateChange(); return;
      }
    }
    if (command === 'next' && wave.active) { await wave.next('skip'); return; }
    if (command === 'repeat') value = repeat.choose(service.playback, value);
    getWindow()?.webContents.send('lolzcloud:media', { command, value });
  }
  function sizeMini() {
    miniController.resize(music.data.mini.lyrics);
  }
  function openMini(withLyrics) {
    if (typeof withLyrics === 'boolean') music.configureMini({ lyrics: withLyrics });
    mini = miniController.open(music.data.mini.lyrics);
  }
  function registerKeys() {
    for (const key of shortcuts) globalShortcut.unregister(key);
    shortcuts.clear(); hotkeyErrors = [];
    for (const [action, key] of Object.entries(music.data.hotkeys)) {
      if (!key) continue;
      const handler = action === 'mini' ? openMini : action === 'studio' ? () => { getWindow()?.show(); getWindow()?.webContents.send('lolzcloud:studio'); } : () => { void media(action).catch(() => {}); };
      try { if (globalShortcut.register(key, handler)) shortcuts.add(key); else hotkeyErrors.push(key); }
      catch { hotkeyErrors.push(key); }
    }
  }
  function getState() { return { ...music.getState(), transport: { repeat: repeat.read(service.playback) }, downloads: downloads.state(), ducking: ducker.state(), safetyConfig: ducker.config(), lyricCache: { ready: [...lyrics.cache.values()].filter(result => !result.loading).length, warming: lyrics.background.size }, miniWindow: miniController.state(), visuals: visuals.state(service.getState(), audio), room: room.getState(), hotkeyErrors, audio: { ...audio }, communityResults, lyrics: lyrics.state(shownTrack()), lyricSettings: lyricSettings.state(), wave: wave.state() }; }
  async function act(action) {
    if (/^wave-/.test(action?.type || '') || action?.type === 'play-url') experience.stopLocal();
    switch (action?.type) {
      case 'state': break;
      case 'wave-start': await wave.start(); break;
      case 'wave-request': await wave.start({ prompt: action.text }); break;
      case 'wave-request-clear': wave.clearRequest(); break;
      case 'wave-stop': wave.stop(); break;
      case 'wave-refresh': case 'wave-shake': await wave.shake(); break;
      case 'wave-settings': wave.configure(action.settings); break;
      case 'wave-reset': wave.reset(); break;
      case 'wave-from-track': await wave.start({ fromCurrent: true }); break;
      case 'wave-artist': await wave.start({ artist: action.name }); break;
      case 'wave-ban-artist': await wave.banArtist(action.url); break;
      case 'wave-unblock-artist': wave.unblockArtist(action.name); break;
      case 'wave-likes': await wave.syncLikes(); break;
      case 'wave-next': if (wave.active) await wave.next('skip'); break;
      case 'wave-ended': await wave.complete(action.url || service.playback.url); break;
      case 'wave-love': await wave.react('love', action.url); break;
      case 'wave-ban': await wave.react('ban', action.url); break;
      case 'wave-balance': wave.configure(Number(action.value)); break;
      case 'wave-select': await wave.select(scUrl(action.url)); break;
      case 'download-current': {
        const snapshot = service.getState(); if (!snapshot.fresh) throw new Error('Сначала выбери трек SoundCloud.');
        if (action.url && action.url !== snapshot.playback.url) throw new Error('Трек уже сменился. Нажми скачать ещё раз.');
        downloads.enqueue(snapshot.playback); break;
      }
      case 'downloads-folder': fs.mkdirSync(downloads.directory, { recursive: true }); { const error = await shell.openPath(downloads.directory); if (error) throw new Error('Не удалось открыть папку загрузок.'); } break;
      case 'download-reveal': shell.showItemInFolder(downloads.file(action.id)); break;
      case 'download-cancel': downloads.cancel(action.id); break;
      case 'download-retry': downloads.retry(action.id); break;
      case 'copy-bbcode': await clipboard.writeText(shareText(service.getState())); break;
      case 'copy-collections': await clipboard.writeText(JSON.stringify(music.data.collections.map(({ title, url, source }) => ({ title, url, source })), null, 2)); break;
      case 'collection-add': music.addCollection(action.collection); break;
      case 'collection-remove': music.removeCollection(action.id); break;
      case 'collection-import': music.importCollections(action.text); break;
      case 'community-search':
        if (!service.token) throw new Error('Сначала привяжи Lolzteam.');
        communityResults = await service.api.searchMusic(service.token);
        break;
      case 'open-forum':
        if (!require('./music.cjs').forumUrl(action.url)) throw new Error('Нужна ссылка на тему Lolzteam.');
        await shell.openExternal(action.url); break;
      case 'play-url': {
        const url = scUrl(action.url); if (!url) throw new Error('Нужна ссылка SoundCloud.');
        wave.stop();
        playbackHistory.request({ url });
        getWindow()?.webContents.send('lolzcloud:play-url', url); break;
      }
      case 'media':
        if (!['playPause', 'next', 'previous', 'volumeUp', 'volumeDown', 'volume', 'play', 'pause', 'seek', 'like', 'repeat'].includes(action.command)) throw new Error('Неизвестная команда.');
        await media(action.command, action.command === 'repeat' ? action.mode : Math.min(604800, Math.max(0, Number(action.value) || 0))); break;
      case 'dsp': music.configureDsp(action.settings); getWindow()?.webContents.send('lolzcloud:dsp', music.data.dsp); break;
      case 'protection': music.configureProtection(action.settings); ducker.configure(music.data.protection); break;
      case 'player': music.configurePlayer(action.settings); await media('volume', music.data.player.volume); break;
      case 'preferences': music.configurePreferences(action.settings); break;
      case 'mini-settings': music.configureMini(action.settings); if (mini && !mini.isDestroyed()) sizeMini(); break;
      case 'sound-reset': music.configureDsp({ preset: 'Original' }); getWindow()?.webContents.send('lolzcloud:dsp', music.data.dsp); break;
      case 'hotkeys': music.setHotkeys(action.settings); registerKeys(); break;
      case 'mini': openMini(); break;
      case 'mini-lyrics': openMini(true); void lyrics.load(service.playback); break;
      case 'private': await service.configure({ privateMode: action.enabled === true }); break;
      case 'exclude-current': {
        const url = scUrl(service.playback.url); if (!url) throw new Error('Сначала включи трек.');
        const excluded = new Set(service.settings.excludedTracks); if (action.remove) excluded.delete(url); else excluded.add(url);
        await service.configure({ excludedTracks: [...excluded] }); break;
      }
      case 'lyrics': {
        const result = await lyrics.load(shownTrack(), action.force === true);
        return { ...getState(), lyrics: result, lyricTrack: result.key };
      }
      case 'lyrics-settings': lyricSettings.configure(action.settings); lyricEngine.cooldowns.clear(); lyricEngine.spotifyToken = null; lyrics.invalidate(); void lyrics.load(service.playback); break;
      case 'lyrics-spotify': lyrics.setSpotify(service.playback, action.url); void lyrics.load(service.playback); break;
      case 'lyrics-match': {
        const track = shownTrack(); if (track.url !== action.url) throw new Error('Трек сменился. Проверь название ещё раз.');
        lyrics.setIdentity(track, action.reset ? null : { title: action.title, artist: action.artist }); void lyrics.load(track); break;
      }
      case 'lyrics-provider-page': {
        const provider = lyricSettings.state().providers.find(value => value.id === action.id);
        if (!provider) throw new Error('Неизвестный источник.');
        await shell.openExternal(provider.url); break;
      }
      case 'lyrics-import': {
        const track = { ...shownTrack() };
        const selected = await dialog.showOpenDialog(getWindow(), { title: 'Текст с тайм-кодами для текущего трека', filters: [{ name: 'LRC', extensions: ['lrc'] }], properties: ['openFile'] });
        if (!selected.canceled && selected.filePaths[0]) {
          if (fs.statSync(selected.filePaths[0]).size > 100_000) throw new Error('LRC-файл слишком большой.');
          lyrics.importLrc(track, fs.readFileSync(selected.filePaths[0], 'utf8'));
        }
        break;
      }
      case 'room-start': await room.start(); break;
      case 'room-claim': if (!room.room) await room.start(); else await room.claim(); break;
      case 'room-login': await room.login(); break;
      case 'room-logout':
        await room.logout();
        await session.fromPartition(ROOM_PARTITION).cookies.remove(room.origin, ROOM_COOKIE);
        break;
      case 'room-stop': await room.stop(); break;
      case 'room-copy': if (!room.getState().url) throw new Error('Сначала создай комнату.'); await clipboard.writeText(room.getState().url); break;
      case 'card-copy': case 'card-save': {
        const bounds = action.bounds; const size = getWindow().getContentBounds();
        if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(bounds[key])) || bounds.x < 0 || bounds.y < 0 || bounds.width < 50 || bounds.height < 50 || bounds.x + bounds.width > size.width + 1 || bounds.y + bounds.height > size.height + 1) throw new Error('Карточка должна быть полностью видна.');
        const image = await getWindow().webContents.capturePage(bounds);
        if (action.type === 'card-copy') await copyCard(image, { clipboard, ClipboardItem });
        else {
          const selected = await dialog.showSaveDialog(getWindow(), { title: 'Сохранить карточку трека', defaultPath: path.join(app.getPath('pictures'), 'Сейчас слушаю.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
          if (!selected.canceled && selected.filePath) fs.writeFileSync(selected.filePath, image.toPNG());
        }
        break;
      }
      default: throw new Error('Неизвестное действие студии.');
    }
    return getState();
  }
  ipcMain.handle('features:action', async (event, action) => {
    if (!trusted(event)) return { ok: false, error: 'Недоверенное окно.' };
    try { return { ok: true, state: await act(action) }; } catch (error) { return { ok: false, error: error.message, state: getState() }; }
  });
  ipcMain.handle('rooms:action', async (event, action) => {
    if (!trusted(event)) return { ok: false, error: 'Недоверенное окно.' };
    try { return { ok: true, result: await roomAction(action) }; }
    catch (error) { return { ok: false, error: error.message }; }
    finally { if (action?.type !== 'list' || !room.getState().authenticated) onStateChange(); }
  });
  ipcMain.handle('player-tools:action', async (event, action) => {
    if (!trusted(event)) return { ok: false, error: 'Недоверенное окно.' };
    try { const result = await experience.act(action); return { ok: true, state: experience.state(), result }; }
    catch (error) { return { ok: false, error: error.message || 'Не удалось выполнить действие.', state: experience.state() }; }
  });
  ipcMain.on('player-tools:local-state', (event, value) => { if (trusted(event)) experience.localState(value); });
  let lastGainSave = 0;
  ipcMain.on('player-tools:gain', (event, value) => { if (trusted(event) && Date.now() - lastGainSave > 15000 && value?.url === shownTrack().url && Number.isFinite(value.gainDb)) { lastGainSave = Date.now(); void experience.act({ type: 'gain', url: value.url, gainDb: value.gainDb }).catch(() => {}); } });
  ipcMain.on('features:audio', (event, status) => {
    if (trusted(event)) audio = { attached: Number(status?.attached) || 0, unavailable: status?.unavailable === true, reason: String(status?.reason || '').slice(0, 40), mediaCount: Number(status?.mediaCount) || 0, rate: Number(status?.rate) || 1, volume: Math.max(0, Math.min(1, Number(status?.volume) || 0)), ui: { nativePlayersVisible: Math.max(0, Number(status?.ui?.nativePlayersVisible) || 0), likeAvailable: status?.ui?.likeAvailable === true, repeatAvailable: status?.ui?.repeatAvailable === true, hiddenPromotions: Math.max(0, Number(status?.ui?.hiddenPromotions) || 0) } };
    if (trusted(event)) audio = { ...audio, sampledAt: Math.min(Date.now(), Math.max(Date.now() - 10_000, Number(status?.sampledAt) || 0)), tempo: { url: scUrl(status?.tempo?.url), available: status?.tempo?.available === true, method: status?.tempo?.method === 'worklet' ? 'worklet' : 'analyser', onsets: Math.max(0, Math.min(100, Number(status?.tempo?.onsets) || 0)), samples: Math.max(0, Math.min(1000, Number(status?.tempo?.samples) || 0)), bpm: Math.max(0, Math.min(300, Number(status?.tempo?.bpm) || 0)), confidence: Math.max(0, Math.min(1, Number(status?.tempo?.confidence) || 0)), beatAge: Number.isFinite(status?.tempo?.beatAge) ? Math.max(0, Math.min(60, status.tempo.beatAge)) : null } };
    if (trusted(event)) audio.safety = { limiterAvailable: status?.safety?.limiterAvailable === true, peakDb: Math.max(-96, Math.min(24, Number.isFinite(status?.safety?.peakDb) ? status.safety.peakDb : -96)), reductionDb: Math.max(0, Math.min(60, Number(status?.safety?.reductionDb) || 0)), duckGain: Math.max(0, Math.min(1, Number.isFinite(status?.safety?.duckGain) ? status.safety.duckGain : 1)) };
  });
  ipcMain.handle('mini:action', async (event, action) => {
    if (!mini || mini.isDestroyed() || event.sender !== mini.webContents || event.senderFrame !== event.sender.mainFrame) return null;
    const type = typeof action === 'string' ? action : action?.type;
    if (type === 'close') { mini.close(); return null; }
    else if (type === 'open') { getWindow()?.show(); getWindow()?.webContents.send('lolzcloud:studio'); }
    else if (type === 'toggle-lyrics') { music.configureMini({ lyrics: !music.data.mini.lyrics }); sizeMini(); }
    else if (type === 'set-lyrics' && typeof action.enabled === 'boolean') { music.configureMini({ lyrics: action.enabled }); sizeMini(); }
    else if (type === 'font') music.configureMini({ fontScale: Number(action.value) });
    else if (type === 'reload-lyrics') void lyrics.load(shownTrack(), true);
    else if (type === 'credit') await openCredit(action.url);
    else if (type === 'download-current') await act({ type, url: action.url });
    else if (type === 'download-reveal') shell.showItemInFolder(downloads.file(action.id));
    else if (type === 'volume') { const volume = Math.max(0, Math.min(1, Number(action.value) || 0)); if (action.commit) music.configurePlayer({ volume }); await media('volume', volume); }
    else if (type === 'seek') await media('seek', Math.min(shownTrack().duration || 604800, Math.max(0, Number(action.value) || 0)));
    else if (type === 'wave-love' || type === 'wave-ban') await wave.react(type === 'wave-love' ? 'love' : 'ban', action.url);
    else if (['like', 'repeat'].includes(type)) { if (!action.url || action.url === shownTrack().url) await media(type, type === 'repeat' ? action.mode : undefined); }
    else if (['playPause', 'previous', 'next', 'volumeUp', 'volumeDown'].includes(type)) await media(type);
    if (music.data.mini.lyrics) void lyrics.load(shownTrack());
    return { ...experience.snapshot(), transport: experience.snapshot().local ? { repeat: { mode: experience.current().repeat } } : { repeat: repeat.read(service.playback) }, downloads: downloads.state(), wave: wave.state(), visuals: visuals.state(service.getState(), audio), mini: { ...music.data.mini }, preferences: { ...music.data.preferences }, volume: music.data.player.volume ?? audio.volume ?? 1, lyrics: music.data.mini.lyrics ? lyrics.state(shownTrack()) : null };
  });
  registerKeys();
  ducker.start();
  if (miniController.saved.open) openMini();
  return {
    getState: () => ({ ...getState(), tools: experience.state(), ...(experience.snapshot().local ? { transport: { repeat: { mode: experience.current().repeat } } } : {}) }), snapshot: base => experience.snapshot(base), acceptSoundCloud(playback) { if (!playbackHistory.observe(playback)) return false; experience.acceptSoundCloud(playback); room.observePlayback(playback); return true; }, act, openMini, setUpcoming: urls => prefetch.setUpcoming(urls),
    observe() {
      experience.observe();
      const snapshot = service.getState();
      if (lyricSettings.retry()) { lyricEngine.cooldowns.clear(); lyrics.invalidate(); if (!snapshot.private) void lyrics.load(service.playback); }
      const connected = room.getState().authenticated;
      if (connected !== cloudAuthenticated) { cloudAuthenticated = connected; lyricEngine.cooldowns.clear(); lyrics.invalidate(); if (!snapshot.private) void lyrics.load(service.playback); }
      music.observe(wave.active && wave.waitingUntil && snapshot.playback.url !== wave.current?.url ? { ...snapshot, fresh: false } : snapshot);
      wave.observe(snapshot); visuals.observe(snapshot);
      if (!(wave.active && wave.waitingUntil && snapshot.playback.url !== wave.current?.url)) prefetch.observe(snapshot, wave.active ? wave.queue : null);
    },
    async shutdown() {
      await experience.shutdown();
      wave.dispose();
      await downloads.dispose();
      ducker.dispose();
      prefetch.stop();
      lyrics.invalidate();
      for (const key of shortcuts) globalShortcut.unregister(key);
      miniController.dispose();
      music.save(true); await room.dispose();
    },
  };
}
module.exports = { createStudio };
