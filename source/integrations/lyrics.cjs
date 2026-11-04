'use strict';
const { getLyrics } = require('./music.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { parseLrc } = require('./lyric-source.cjs');
const { writeJson } = require('./durable-json.cjs');
const lyricKey = track => [track?.artist || '', track?.title || '', track?.duration || 0].join('\n');
class LyricsLibrary {
  constructor(fetcher = getLyrics, filename = null, now = Date.now) {
    this.now = now;
    this.fetcher = fetcher; this.filename = filename; this.cache = new Map(); this.pending = new Map(); this.overrides = new Map(); this.revision = 0; this.controllers = new Map(); this.matches = new Map(); this.tracks = new Map(); this.background = new Set();
    this.identities = new Map(); this.matchesFilename = filename ? path.join(path.dirname(filename), 'lyric-matches.json') : null;
    if (this.matchesFilename) { try { const saved = JSON.parse(fs.readFileSync(this.matchesFilename, 'utf8')); for (const [url, value] of Object.entries(saved.tracks || {}).slice(-200)) if (/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/.test(url) && typeof value.title === 'string' && value.title.length <= 180 && typeof value.artist === 'string' && value.artist.length <= 100) this.identities.set(url, { title: value.title, artist: value.artist }); } catch { /* No manual track matches yet. */ } }
    if (filename) { try { for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(filename, 'utf8')))) if (Array.isArray(value.lines) && value.lines.every(row => Number.isFinite(row.time) && row.time >= 0 && typeof row.text === 'string')) this.overrides.set(key, { ...value, key, revision: ++this.revision, loading: false, source: 'Локальный LRC' }); } catch { /* No personal timings yet. */ } }
  }
  state(track) {
    const key = lyricKey(track);
    const reusable = this.nearby(track);
    const cached = this.cache.get(this.cacheKey(track)) || (reusable ? this.cache.get(reusable) : null);
    return this.overrides.get(key) || (cached ? { ...cached, key } : null) || { key, revision: 0, loading: false, found: false, lines: [], plain: '', error: '', instrumental: false };
  }
  cacheKey(track) { return lyricKey(track) + (this.identities.has(track?.url) ? '\n' + track.url : ''); }
  nearby(track) {
    if (!track?.url) return null;
    for (const [key, previous] of this.tracks) if (this.cache.has(key) && previous.url === track.url && previous.title === track.title && previous.artist === track.artist && Math.abs((previous.duration || 0) - (track.duration || 0)) <= 1) return key;
    return null;
  }
  abort(key) { this.controllers.get(key)?.abort(); this.controllers.delete(key); this.pending.delete(key); this.cache.delete(key); this.tracks.delete(key); this.background.delete(key); }
  warm(tracks) {
    const upcoming = tracks.filter(track => track?.title && track.artist && track.url).slice(0, 2), urls = new Set(upcoming.map(track => track.url));
    for (const key of this.background) if (!urls.has(this.tracks.get(key)?.url)) this.abort(key);
    for (const track of upcoming) if (this.background.size < 2) void this.load(track, false, true);
  }
  load(track, force = false, background = false) {
    const requestedKey = lyricKey(track), key = !force && !this.overrides.has(requestedKey) ? this.nearby(track) || this.cacheKey(track) : this.cacheKey(track);
    const present = result => key === requestedKey ? result : { ...result, key: requestedKey };
    if (!background) {
      for (const [other] of this.controllers) if (other !== key && !this.background.has(other)) this.abort(other);
      this.background.delete(key);
    }
    if (this.overrides.has(requestedKey)) return Promise.resolve(this.overrides.get(requestedKey));
    if (force && this.pending.has(key)) this.abort(key);
    if (this.pending.has(key)) return key === requestedKey ? this.pending.get(key) : this.pending.get(key).then(present);
    if (!force && this.cache.has(key)) { const cached = this.cache.get(key); if (!cached.retryAt || this.now() < cached.retryAt) return Promise.resolve(present(cached)); this.cache.delete(key); }
    if (!track?.title) return Promise.resolve(this.state(track));
    if (background && this.background.size >= 2) return Promise.resolve(this.state(track));
    this.tracks.set(key, { ...track }); if (background) this.background.add(key);
    this.cache.set(key, { ...this.state(track), loading: true, error: '', revision: ++this.revision });
    const controller = new AbortController(); this.controllers.set(key, controller);
    const promise = Promise.resolve().then(() => this.fetcher({ ...track, ...this.identities.get(track.url), spotifyId: this.matches.get(requestedKey) || track.spotifyId }, { signal: controller.signal, onProgress: result => {
      if (!controller.signal.aborted) this.cache.set(key, { ...result, key, loading: true, error: '', revision: ++this.revision });
    } })).then(result => this.overrides.get(requestedKey) || ({ ...result, key, loading: false, error: '', revision: ++this.revision }),
      () => ({ ...this.state(track), key, loading: false, error: controller.signal.aborted ? '' : 'Не удалось загрузить текст. Попробуй обновить.', revision: ++this.revision }));
    this.pending.set(key, promise);
    promise.then(result => {
      if (this.controllers.get(key) !== controller) return;
      this.controllers.delete(key); this.pending.delete(key); this.background.delete(key);
      if (controller.signal.aborted) this.cache.delete(key); else this.cache.set(key, { ...result, retryAt: result.found || result.lines?.length || result.plain ? 0 : this.now() + 60000 });
      if (this.cache.size > 50) { const oldest = [...this.cache.keys()].find(value => value !== key && !this.pending.has(value)); if (oldest) { this.cache.delete(oldest); this.tracks.delete(oldest); } }
    });
    return promise;
  }
  invalidate() { for (const controller of this.controllers.values()) controller.abort(); this.controllers.clear(); this.pending.clear(); this.cache.clear(); this.tracks.clear(); this.background.clear(); }
  setSpotify(track, value) {
    const match = String(value || '').trim().match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)?([a-zA-Z0-9]{22})(?:\?.*)?$/);
    if (!track?.title || !match) throw new Error('Нужна ссылка на эту же запись трека в Spotify.');
    this.matches.set(lyricKey(track), match[1]); this.invalidate();
  }
  setIdentity(track, value) {
    if (!/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/.test(track?.url || '')) throw new Error('Сначала выбери трек SoundCloud.');
    if (value === null) this.identities.delete(track.url);
    else {
      const title = typeof value?.title === 'string' ? value.title.trim() : '', artist = typeof value?.artist === 'string' ? value.artist.trim() : '';
      if (!title || title.length > 180 || !artist || artist.length > 100 || /[\x00-\x1f]/.test(title + artist)) throw new Error('Укажи название песни и исполнителя.');
      this.identities.delete(track.url); this.identities.set(track.url, { title, artist });
      if (this.identities.size > 200) this.identities.delete(this.identities.keys().next().value);
    }
    if (this.matchesFilename) writeJson(this.matchesFilename, { version: 1, tracks: Object.fromEntries(this.identities) });
    this.invalidate();
  }
  importLrc(track, text) {
    if (!track?.title || typeof text !== 'string' || text.length > 100_000) throw new Error('Выбери LRC-файл для текущего трека.');
    const lines = parseLrc(text);
    if (!lines.length || lines.some(line => track.duration && line.time > track.duration + 3)) throw new Error('В LRC нет подходящих временных меток для этого трека.');
    const key = lyricKey(track), result = { key, revision: ++this.revision, loading: false, found: true, lines, plain: lines.map(line => line.text).join('\n'), error: '', source: 'Локальный LRC' };
    this.overrides.set(key, result);
    if (this.filename) { fs.mkdirSync(path.dirname(this.filename), { recursive: true }); fs.writeFileSync(this.filename + '.tmp', JSON.stringify(Object.fromEntries(this.overrides)), { mode: 0o600 }); fs.renameSync(this.filename + '.tmp', this.filename); }
    return result;
  }
}
module.exports = { lyricKey, LyricsLibrary };
