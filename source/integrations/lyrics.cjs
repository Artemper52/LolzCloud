'use strict';
const { getLyrics } = require('./music.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { parseLrc } = require('./lyric-source.cjs');
const lyricKey = track => [track?.artist || '', track?.title || '', track?.duration || 0].join('\n');
class LyricsLibrary {
  constructor(fetcher = getLyrics, filename = null) {
    this.fetcher = fetcher; this.filename = filename; this.cache = new Map(); this.pending = new Map(); this.overrides = new Map(); this.revision = 0; this.controllers = new Map(); this.matches = new Map(); this.tracks = new Map(); this.background = new Set();
    if (filename) { try { for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(filename, 'utf8')))) if (Array.isArray(value.lines) && value.lines.every(row => Number.isFinite(row.time) && row.time >= 0 && typeof row.text === 'string')) this.overrides.set(key, { ...value, key, revision: ++this.revision, loading: false, source: 'Локальный LRC' }); } catch { /* No personal timings yet. */ } }
  }
  state(track) {
    const key = lyricKey(track);
    const reusable = this.nearby(track);
    return this.overrides.get(key) || this.cache.get(key) || (reusable ? { ...this.cache.get(reusable), key } : null) || { key, revision: 0, loading: false, found: false, lines: [], plain: '', error: '', instrumental: false };
  }
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
    const requestedKey = lyricKey(track), key = !force && !this.overrides.has(requestedKey) ? this.nearby(track) || requestedKey : requestedKey;
    const present = result => key === requestedKey ? result : { ...result, key: requestedKey };
    if (!background) {
      for (const [other] of this.controllers) if (other !== key && !this.background.has(other)) this.abort(other);
      this.background.delete(key);
    }
    if (this.overrides.has(key)) return Promise.resolve(this.overrides.get(key));
    if (force && this.pending.has(key)) this.abort(key);
    if (this.pending.has(key)) return key === requestedKey ? this.pending.get(key) : this.pending.get(key).then(present);
    if (!force && this.cache.has(key)) return Promise.resolve(present(this.cache.get(key)));
    if (!track?.title) return Promise.resolve(this.state(track));
    if (background && this.background.size >= 2) return Promise.resolve(this.state(track));
    this.tracks.set(key, { ...track }); if (background) this.background.add(key);
    this.cache.set(key, { ...this.state(track), loading: true, error: '', revision: ++this.revision });
    const controller = new AbortController(); this.controllers.set(key, controller);
    const promise = Promise.resolve().then(() => this.fetcher({ ...track, spotifyId: this.matches.get(key) || track.spotifyId }, { signal: controller.signal, onProgress: result => {
      if (!controller.signal.aborted) this.cache.set(key, { ...result, key, loading: true, error: '', revision: ++this.revision });
    } })).then(result => this.overrides.get(key) || ({ ...result, key, loading: false, error: '', revision: ++this.revision }),
      () => ({ ...this.state(track), key, loading: false, error: controller.signal.aborted ? '' : 'Не удалось загрузить текст. Попробуй обновить.', revision: ++this.revision }));
    this.pending.set(key, promise);
    promise.then(result => {
      if (this.controllers.get(key) !== controller) return;
      this.controllers.delete(key); this.pending.delete(key); this.background.delete(key);
      if (controller.signal.aborted) this.cache.delete(key); else this.cache.set(key, result);
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
