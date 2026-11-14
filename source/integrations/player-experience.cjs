'use strict';
const fs = require('node:fs'), path = require('node:path');
const { PlayerTools, trackUrl, localUrl, text } = require('./player-tools.cjs');
const { LocalLibrary } = require('./local-library.cjs');
const { ReleaseRadar } = require('./release-radar.cjs');
const { exportProfile, normalizeProfile, encryptProfile, decryptProfile, MAX_BYTES } = require('./portable-profile.cjs');
const { scUrl } = require('./music.cjs');
const { mediaUrl } = require('../app/lib/js/media-source.js');
const { prunePlayed } = require('./wave-history.cjs');
const { writeJson } = require('./durable-json.cjs');
function createPlayerExperience({ app, service, music, wave, lyrics, room, discovery, downloads, media, play, getWindow, notify, dialog, clipboard }) {
  const directory = app.getPath('userData'), tools = new PlayerTools(path.join(directory, 'player-tools.json')), library = new LocalLibrary(path.join(directory, 'local-library.json'), downloads.directory), radar = new ReleaseRadar(path.join(directory, 'release-radar.json'), discovery), send = (channel, value) => getWindow()?.webContents.send(channel, value);
  let local = null, pendingSeek = null, versions = { source: null, candidates: [], loading: false, error: '' }, lookupRevision = 0, remote = null, remoteBusy = false, remotePollAt = 0, profileBusy = false, cloudRevision = null, lastError = '', roomNextBusy = false, roomAdvanceKey = '';
  wave.isDuplicate = (track, cache, now) => tools.duplicate(track, cache, now);
  let localStartedAt = 0, localOrigin = '', localGeneration = 0;
  const current = () => local ? { ...local } : service.displayPlayback();
  const snapshot = (base = service.getState()) => local ? { ...base, local: true, private: true, fresh: true, transitioning: false, playback: { ...local }, displayPlayback: { ...local } } : base;
  const state = () => ({ ...tools.state(), library: library.state(), radar: radar.state(), versions: structuredClone(versions), remote: remote ? { url: remote.url, qr: remote.qr, name: remote.name, error: remote.error || '' } : null, cloudRevision, profileBusy, error: lastError });
  function localPlay(id, queue, position = 0) {
    const row = library.play(id, queue); wave.stop(); localStartedAt = Date.now(); localOrigin = service.playback.url; const token = ++localGeneration;
    send('lolzcloud:pause-soundcloud'); local = { ...row, source: undefined, path: undefined, token, playing: false, position, rate: 1, repeat: library.repeat, liked: false, ended: false };
    service.localPlaybackActive = true; send('lolzcloud:local-play', { ...row, path: undefined, token, position, volume: music.data.player.volume ?? 1, normalization: tools.data.normalization, cachedGain: tools.data.gains[row.url]?.gainDb }); notify();
  }
  function stopLocal() { if (local) { local = null; service.localPlaybackActive = false; send('lolzcloud:local-stop'); notify(); } }
  function localMedia(command, value) {
    if (!local) return false;
    if (command === 'next' || command === 'previous') { const row = library.step(command === 'previous' ? -1 : 1); if (row) localPlay(row.id, library.queue); else send('lolzcloud:local-media', { command: 'pause' }); }
    else if (command === 'repeat') { library.repeat = ['off', 'one', 'all'].includes(value) ? value : ({ off: 'one', one: 'all', all: 'off' })[library.repeat]; local.repeat = library.repeat; notify(); }
    else if (command === 'like') throw new Error('Лайки SoundCloud доступны для сетевых треков.');
    else send('lolzcloud:local-media', { command, value });
    return true;
  }
  function localState(value) {
    if (!local || value?.id !== library.current || value.token !== local.token) return;
    if (Number.isFinite(value.duration)) { library.duration(value.id, value.duration); local.duration = Math.max(0, Math.min(14400, value.duration)); }
    local.position = Math.max(0, Math.min(local.duration || 14400, Number(value.position) || 0)); local.playing = value.playing === true; local.ended = value.ended === true;
    if (value.error) lastError = 'Не удалось воспроизвести этот аудиофайл.';
    if (local.ended) { const row = library.step(1, true); if (row) localPlay(row.id, library.queue); }
    notify();
  }
  function portable() { return exportProfile(music, wave, tools); }
  function restore(raw) {
    const value = normalizeProfile(raw), previous = { music: structuredClone(music.data), wave: structuredClone(wave.data), tools: tools.state() };
    const backup = path.join(directory, 'profile-backups', 'before-restore-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'); writeJson(backup, portable());
    try {
      wave.stop(); Object.assign(music.data, value.music); music.dirty = true;
      wave.data = { ...wave.data, ...value.wave, played24h: prunePlayed({ ...value.wave.played24h, ...wave.data.played24h }, Date.now()) };
      tools.data = { ...value.tools, gains: previous.tools.gains, bookmarks: [...previous.tools.bookmarks.filter(row => localUrl(row.url)), ...value.tools.bookmarks] };
      music.save(true); wave.save(); tools.save(); send('lolzcloud:dsp', music.data.dsp); sendNormalization(); notify();
    } catch (error) { music.data = previous.music; music.dirty = true; wave.data = previous.wave; tools.data = previous.tools; try { music.save(true); wave.save(); tools.save(); } catch { /* The before-restore backup remains available. */ } throw error; }
    return { backup };
  }
  function sendNormalization() { send('lolzcloud:normalization', { enabled: tools.data.normalization, url: current().url, gainDb: tools.data.gains[current().url]?.gainDb }); }
  async function lookup(track) {
    const url = scUrl(track?.url); if (!url) throw new Error('Включи трек SoundCloud для поиска версий.');
    const revision = ++lookupRevision; versions = { source: { ...track }, candidates: [], loading: true, error: '' }; notify();
    const query = (track.title || '').replace(/\b(?:slowed|sped[ -]?up|speed[ -]?up|reverb|nightcore|original|remix)\b/gi, ' ').replace(/[()[\]]/g, ' ').trim();
    try { const candidates = await discovery.search(query || track.title); if (revision === lookupRevision) versions = { source: { ...track }, candidates: candidates.filter(row => row.url !== url).slice(0, 30), loading: false, error: '' }; }
    catch (error) { if (revision === lookupRevision) versions = { source: { ...track }, candidates: [], loading: false, error: error.message }; }
    notify();
  }
  async function roomNext(action = {}) {
    const active = room.room, source = current(), lease = room.lease;
    if (roomNextBusy || !active || !room.getState().hosting) return;
    if (action.expectedUrl && action.expectedUrl !== source.url
      || Number.isSafeInteger(action.expectedEpoch) && action.expectedEpoch !== active.epoch
      || action.expectedController && action.expectedController !== active.controller?.connection) return;
    const key = [active.id, active.epoch, lease, source.url].join('|');
    if (action.automatic && (active.settings?.autoNext === false || roomAdvanceKey === key)) return;
    // A manual Next may retry a failed request; repeated end events may not pop two songs.
    if (action.automatic) roomAdvanceKey = key;
    roomNextBusy = true;
    try {
      const result = await room.queueAction({ type: 'next' });
      if (room.room?.id !== active.id || room.lease !== lease || room.room?.epoch !== active.epoch || current().url !== source.url) return;
      if (result.track) { stopLocal(); await play(result.track.url, result.track); }
    } finally { roomNextBusy = false; }
  }
  async function act(action) {
    lastError = '';
    switch (action?.type) {
      case 'state': library.scan(); break;
      case 'search': { const query = text(action.query, 120).toLocaleLowerCase(); const rows = [...library.state().tracks.map(row => ({ ...row, kind: 'local' })), ...tools.data.bookmarks.map(row => ({ ...row, kind: 'bookmark' })), ...music.data.collections.map(row => ({ ...row, kind: 'collection' })), ...music.data.history.map(row => ({ ...row, kind: 'track' }))]; const seen = new Set(); return { results: rows.filter(row => { const key = row.kind + ':' + (row.id || row.url); if (seen.has(key)) return false; seen.add(key); return !query || [row.title, row.artist, row.note].join(' ').toLocaleLowerCase().includes(query); }).slice(0, 60) }; }
      case 'bookmark-add': { const track = current(); if (!track.title || !trackUrl(track.url)) throw new Error('Сначала включи трек.'); if (action.url !== track.url) throw new Error('Трек сменился. Открой закладку заново.'); tools.addBookmark({ ...track, position: Number(action.position), note: action.note }); break; }
      case 'bookmark-remove': tools.removeBookmark(action.id); break;
      case 'bookmark-play': { const row = tools.data.bookmarks.find(row => row.id === action.id); if (!row) throw new Error('Закладка не найдена.'); if (localUrl(row.url)) localPlay(row.url.split('://')[1], null, row.position); else { stopLocal(); if (service.playback.url === row.url && service.isFresh()) await media('seek', row.position); else { pendingSeek = { url: row.url, position: row.position, until: Date.now() + 20000 }; await play(row.url, row); } } break; }
      case 'local-import': { const selected = await dialog.showOpenDialog(getWindow(), { title: 'Добавить музыку с компьютера', filters: [{ name: 'Музыка', extensions: ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus'] }], properties: ['openFile', 'multiSelections'] }); if (!selected.canceled) library.import(selected.filePaths); break; }
      case 'local-files': library.import(action.files); break;
      case 'local-scan': library.scan(true); break;
      case 'local-play': localPlay(action.id, action.queue); break;
      case 'local-stop': stopLocal(); break;
      case 'local-remove': if (library.current === action.id) stopLocal(); library.remove(action.id); break;
      case 'versions': await lookup(current()); break;
      case 'versions-confirm': if (versions.source?.url !== action.source || !versions.candidates.some(row => row.url === action.url)) throw new Error('Результаты поиска сменились. Повтори поиск.'); tools.group(action.source, action.url); break;
      case 'versions-ungroup': tools.ungroup(action.url); break;
      case 'play-url': stopLocal(); await play(mediaUrl(action.url) || scUrl(action.url)); break;
      case 'radar-follow': { let url = action.url; if (!url && scUrl(current().url)) { const value = await discovery.resolve(current().url); url = value.user?.permalink_url; } await radar.follow(url); await radar.refresh(); break; }
      case 'radar-unfollow': radar.unfollow(action.url); break;
      case 'radar-refresh': await radar.refresh(); break;
      case 'radar-heard': radar.heard(action.url); break;
      case 'radar-restore': radar.restoreHeard(); break;
      case 'normalization': tools.data.normalization = action.enabled === true; tools.save(); sendNormalization(); break;
      case 'gain': if (action.url === current().url && tools.data.normalization) tools.gain(action.url, action.gainDb); break;
      case 'lyrics-save': { const track = current(); if (track.url !== action.url || [track.artist || '', track.title || '', track.duration || 0].join('\n') !== action.key) throw new Error('Трек сменился. Открой редактор заново.'); lyrics.importLrc(track, action.lrc); break; }
      case 'profile-export': { const selected = await dialog.showSaveDialog(getWindow(), { title: 'Сохранить переносимый профиль', defaultPath: path.join(app.getPath('downloads'), 'LolzCloud-profile.json'), filters: [{ name: 'Профиль LolzCloud', extensions: ['json'] }] }); if (!selected.canceled && selected.filePath) writeJson(selected.filePath, portable()); break; }
      case 'profile-import': { const selected = await dialog.showOpenDialog(getWindow(), { title: 'Восстановить настройки и вкусы', filters: [{ name: 'Профиль LolzCloud', extensions: ['json'] }], properties: ['openFile'] }); if (selected.canceled || !selected.filePaths[0]) break; const filename = selected.filePaths[0]; if (fs.statSync(filename).size > MAX_BYTES) throw new Error('Профиль слишком большой.'); const value = normalizeProfile(JSON.parse(fs.readFileSync(filename, 'utf8'))); const choice = await dialog.showMessageBox(getWindow(), { type: 'question', message: 'Заменить настройки, подборки и вкусы волны?', detail: 'Текущие данные будут сохранены в резервную копию. Входы в сервисы сохранятся.', buttons: ['Восстановить', 'Отмена'], defaultId: 1, cancelId: 1 }); if (choice.response === 0) return restore(value); break; }
      case 'profile-push': case 'profile-pull': {
        if (profileBusy) throw new Error('Перенос профиля уже выполняется.'); profileBusy = true;
        try { const server = await room.request('/api/profile'); if (action.type === 'profile-push') { if (cloudRevision === null && server.revision > 0) throw new Error('На сервере уже есть копия. Сначала загрузи её, чтобы не затереть изменения другого устройства.'); const result = await room.request('/api/profile', { method: 'PUT', body: { revision: cloudRevision ?? 0, envelope: await encryptProfile(portable(), action.passphrase) } }); cloudRevision = result.revision; } else { if (!server.envelope) throw new Error('Облачной копии пока нет.'); const value = await decryptProfile(server.envelope, action.passphrase); const choice = await dialog.showMessageBox(getWindow(), { type: 'question', message: 'Восстановить облачную копию профиля?', buttons: ['Восстановить', 'Отмена'], defaultId: 1, cancelId: 1 }); if (choice.response === 0) { restore(value); cloudRevision = server.revision; } } } finally { profileBusy = false; } break;
      }
      case 'remote-start': { if (remote) break; const value = await room.request('/api/remotes', { method: 'POST', body: { name: 'LolzCloud · ' + (process.platform === 'win32' ? 'Windows' : 'Linux') } }); if (!/^[a-f0-9]{32}$/.test(value.id) || value.url !== room.origin + '/remote/' + value.id) throw new Error('Сервер вернул неверную ссылку пульта.'); remote = { ...value, ack: 0, qr: await require('qrcode').toDataURL(value.url, { width: 220, margin: 2, errorCorrectionLevel: 'M' }) }; break; }
      case 'remote-copy': if (!remote) throw new Error('Сначала включи пульт.'); clipboard.writeText(remote.url); break;
      case 'remote-stop': { const old = remote; remote = null; if (old) await room.request('/api/remotes/' + old.id, { method: 'DELETE' }); break; }
      case 'room-queue': await room.queueAction(action.action); break;
      case 'room-next': await roomNext(action); break;
      case 'room-play-queue': {
        if (roomNextBusy) throw new Error('Предыдущая песня ещё открывается.');
        roomNextBusy = true;
        try { await room.playQueued(action.id, async track => { stopLocal(); await play(track.url, track); }); }
        finally { roomNextBusy = false; }
        break;
      }
      default: throw new Error('Неизвестное действие плеера.');
    }
    notify(); return null;
  }
  let lastNormalizationUrl = '', previous = null;
  function observe() {
    library.scan(); const source = snapshot(), track = source.playback;
    if (track.url !== lastNormalizationUrl) { lastNormalizationUrl = track.url; sendNormalization(); }
    if (pendingSeek) { if (Date.now() > pendingSeek.until) { pendingSeek = null; lastError = 'Не удалось открыть трек закладки. Можно повторить.'; } else if (source.fresh && track.url === pendingSeek.url && track.duration > 0) { const value = pendingSeek; pendingSeek = null; void media('seek', Math.min(track.duration, value.position)); } }
    if (track.playing && track.position >= Math.min(30, track.duration * .5) && radar.data.tracks.some(row => row.url === track.url) && !radar.data.heard.includes(track.url)) radar.heard(track.url);
    if (track.url && (previous?.url !== track.url || track.position < track.duration - 2 && previous?.position >= previous?.duration - 2)) roomAdvanceKey = '';
    if (!local && previous?.url === track.url && previous.playing && !track.playing && track.position >= track.duration - .5 && track.duration > 1 && room.getState().hosting && room.getState().settings?.autoNext !== false && room.getState().queue?.some(row => row.approved)) void roomNext({ automatic: true, expectedUrl: track.url }).catch(error => { lastError = error.message; });
    previous = { ...track };
    if (remote && !remoteBusy && Date.now() >= remotePollAt) { const target = remote; remoteBusy = true; remotePollAt = Date.now() + 1800; void (async () => { try { const result = await room.request('/api/remotes/' + target.id + '/state', { method: 'PUT', body: { fresh: source.fresh === true, private: source.private === true, playback: source.private ? null : source.playback, volume: music.data.player.volume ?? 1, ack: target.ack } }); if (remote !== target) return; for (const command of result.commands || []) { if (command.id <= target.ack) continue; if (Number.isSafeInteger(command.id) && command.id === target.ack + 1) { if (command.command === 'volume') music.configurePlayer({ volume: command.value }); await media(command.command, command.value); target.ack = command.id; } } target.error = ''; } catch (error) { target.error = error.message; } finally { remoteBusy = false; notify(); } })(); }
  }
  return { state, snapshot, current, act, observe, localMedia, localState, stopLocal, acceptSoundCloud(value) { if (local && value?.playing && (value.url !== localOrigin || Date.now() - localStartedAt > 1500)) stopLocal(); }, tools, async shutdown() { if (remote) { const target = remote; remote = null; await room.request('/api/remotes/' + target.id, { method: 'DELETE' }).catch(() => {}); } } };
}
module.exports = { createPlayerExperience };
