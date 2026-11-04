'use strict';
const { parseLrc, readTtml, parseYrc, parseRichsync, parseSpicy, tidyLines } = require('./lyric-formats.cjs');
const { sameRecording, quality, wordCoverage, bestLyrics } = require('./lyric-match.cjs');
const { LyricSettings, PROVIDERS } = require('./lyric-settings.cjs');
const { lyricIdentity, lyricCandidates, artistNames } = require('./lyric-identity.cjs');
const makeUrl = (base, values) => base + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
const metadata = (title, artist, duration) => ({ title, artist, duration: Number(duration) || 0 });
const catalogueMatch = (rows, track, convert) => (Array.isArray(rows) ? rows : []).map(row => ({ row, track: convert(row) })).filter(value => sameRecording(value.track, track)).sort((a, b) => Math.abs(a.track.duration - track.duration) - Math.abs(b.track.duration - track.duration))[0];
const lyricsFrom = (text, format = 'lrc') => {
  if (format === 'ttml') return readTtml(text);
  const lines = format === 'plain' ? [] : parseLrc(text);
  return { lines, plain: !lines.length && format !== 'ttml' ? String(text || '').replace(/^\[[a-z]+:[^\]]*\]\s*$/gim, '').trim().slice(0, 60_000) : '' };
};
class ProviderError extends Error {
  constructor(code, retryAt = 0) { super(code); this.code = code; this.retryAt = retryAt; }
}
class LyricsEngine {
  constructor({ settings = new LyricSettings(), fetcher = (...args) => fetch(...args), adapters = null, now = Date.now, shared = null } = {}) {
    this.settings = settings; this.fetcher = fetcher; this.adapters = adapters; this.now = now; this.shared = shared; this.cooldowns = new Map(); this.spotifyToken = null; this.albumCache = new Map();
  }
  async request(url, { signal, headers = {}, method = 'GET', body, text = false, redirectHosts = [] } = {}) {
    let response;
    for (let hop = 0; hop <= 2; hop++) {
      response = await this.fetcher(url, { method, body, headers: { 'User-Agent': 'LolzCloud/0.9.1 (+https://lolzcloud.com; https://github.com/Artemper52/LolzCloud/issues)', ...headers }, signal, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const target = new URL(response.headers.get('location'), url);
      if (hop === 2 || method !== 'GET' || Object.keys(headers).some(key => /authorization/i.test(key)) || target.protocol !== 'https:' || target.username || target.password || !redirectHosts.includes(target.hostname)) throw new ProviderError('invalid');
      await response.body?.cancel?.(); url = target.href;
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw new ProviderError('access', this.now() + 300_000);
    if (response.status === 429) {
      const header = response.headers.get('retry-after'), seconds = Number(header);
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.parse(header) - this.now();
      throw new ProviderError('limited', this.now() + Math.min(86_400_000, Math.max(60_000, delay || 60_000)));
    }
    if (!response.ok) throw new ProviderError('unavailable');
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new ProviderError('invalid');
    const reader = response.body?.getReader?.(); let data;
    if (reader) {
      let size = 0; const chunks = [];
      while (true) { const value = await reader.read(); if (value.done) break; size += value.value.length; if (size > 2_000_000) { await reader.cancel(); throw new ProviderError('invalid'); } chunks.push(Buffer.from(value.value)); }
      data = Buffer.concat(chunks).toString('utf8');
    } else data = await response.text();
    if (data.length > 2_000_000) throw new ProviderError('invalid');
    return text ? data : JSON.parse(data);
  }
  async musix(endpoint, params, ctx) {
    const json = await this.request(makeUrl('https://api.musixmatch.com/ws/1.1/' + endpoint, { ...params, format: 'json', apikey: this.settings.keys.musixmatch }), { signal: ctx.signal });
    const code = json?.message?.header?.status_code;
    if (code === 401 || code === 403) throw new ProviderError('access', this.now() + 300_000);
    if (code === 402 || code === 429) throw new ProviderError('limited', this.now() + 300_000);
    if (code === 404) return null;
    if (code !== 200) throw new ProviderError('unavailable');
    return json.message.body;
  }
  async musixTrack(track, ctx) {
    if (!ctx.musixTrack) ctx.musixTrack = this.musix('matcher.track.get', { q_track: track.title, q_artist: track.artist }, ctx).then(data => {
      const row = data?.track;
      return row && sameRecording(metadata(row.track_name, row.artist_name, row.track_length), track) ? row : null;
    });
    return ctx.musixTrack;
  }
  async spotifyId(track, ctx) {
    const direct = String(track.spotifyId || '').match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)?([a-zA-Z0-9]{22})(?:\?.*)?$/)?.[1];
    if (direct) return direct;
    const keys = this.settings.keys;
    if (keys.musixmatch) { try { const row = await this.musixTrack(track, ctx); if (/^[a-zA-Z0-9]{22}$/.test(row?.track_spotify_id || '')) return row.track_spotify_id; } catch { /* The normal Musixmatch step reports its own error. */ } }
    if (!keys.spotifyId || !keys.spotifySecret) throw new ProviderError('needs-match');
    if (!this.spotifyToken || this.spotifyToken.until < this.now()) {
      const auth = await this.request('https://accounts.spotify.com/api/token', { signal: ctx.signal, method: 'POST', body: 'grant_type=client_credentials', headers: { Authorization: 'Basic ' + Buffer.from(keys.spotifyId + ':' + keys.spotifySecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!auth?.access_token) throw new ProviderError('access');
      this.spotifyToken = { token: auth.access_token, until: this.now() + Math.max(0, Number(auth.expires_in) - 60) * 1000 };
    }
    const rows = await this.request(makeUrl('https://api.spotify.com/v1/search', { q: 'track:' + track.title + ' artist:' + track.artist, type: 'track', limit: 10 }), { signal: ctx.signal, headers: { Authorization: 'Bearer ' + this.spotifyToken.token } });
    return catalogueMatch(rows?.tracks?.items, track, row => metadata(row.name, row.artists?.map(artist => artist.name).join(', '), row.duration_ms / 1000))?.row.id || null;
  }
  async spicy(track, ctx) {
    const id = await this.spotifyId(track, ctx); if (!id) return null;
    const json = this.shared?.available() ? await this.shared.get(id, ctx.signal) : await this.request('https://api.spicylyrics.org/v1/lyrics/' + id, { signal: ctx.signal, headers: { Authorization: 'Bearer ' + this.settings.keys.spicy } });
    if (!json) return null;
    const body = json.Body || json;
    const names = { spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music', spotify: 'Spotify' };
    const credits = [{ name: names[body.source] || body.source || 'Источник не указан', url: body.source === 'apple_music' ? 'https://music.apple.com' : body.source === 'spotify' ? 'https://open.spotify.com' : 'https://spicylyrics.org' }];
    if (body.source === 'spicy_lyrics') for (const role of ['Uploader', 'Maker']) {
      const person = body.UploadAttribution?.[role], name = typeof person === 'string' ? person : person?.username || person?.Username || person?.name;
      if (name) credits.push({ name, url: /^https:\/\//.test(person?.url || '') ? person.url : '' });
    }
    return { ...parseSpicy(json), source: names[body.source] || body.source || 'Источник не указан', credits, recordId: id };
  }
  async bini(track, ctx) {
    const redirectHosts = ['lyrics-api.binimum.org', 'lyrics-storage.binimum.org', 'lrc.red'];
    let data = await this.request(makeUrl('https://lyrics-api.binimum.org/getLyrics', { q: track.artist + ' ' + track.title }), { signal: ctx.signal, redirectHosts });
    let selected = catalogueMatch(data?.results, track, row => metadata(row.track_name, row.artist_name, row.duration));
    if (!selected && artistNames(track.artist).length > 1) { data = await this.request(makeUrl('https://lyrics-api.binimum.org/getLyrics', { q: artistNames(track.artist)[0] + ' ' + track.title }), { signal: ctx.signal, redirectHosts }); selected = catalogueMatch(data?.results, track, row => metadata(row.track_name, row.artist_name, row.duration)); }
    if (!selected) { data = await this.request(makeUrl('https://lyrics-api.binimum.org/getLyrics', { q: track.title }), { signal: ctx.signal, redirectHosts }); selected = catalogueMatch(data?.results, track, row => metadata(row.track_name, row.artist_name, row.duration)); }
    if (!selected?.row.lyricsUrl) return null;
    const url = new URL(selected.row.lyricsUrl, 'https://lyrics-storage.binimum.org/');
    if (url.protocol !== 'https:' || !['lyrics-storage.binimum.org', 'lrc.red'].includes(url.hostname) || url.username || url.password) throw new ProviderError('invalid');
    const text = await this.request(url.href, { signal: ctx.signal, text: true, redirectHosts });
    return { ...lyricsFrom(text, 'ttml'), recordId: selected.row.id, credits: [{ name: 'BiniLyrics', url: 'https://lyrics.binimum.org' }, ...(url.hostname === 'lrc.red' ? [{ name: 'lrc.red', url: 'https://lrc.red' }] : [])] };
  }
  async album(track, ctx) {
    if (track.album) return track.album;
    const key = [track.artist, track.title, track.duration].join('\n');
    if (this.albumCache.has(key)) return this.albumCache.get(key);
    this.appleRequests = (this.appleRequests || []).filter(time => this.now() - time < 60000);
    if (this.appleRequests.length >= 18) return '';
    this.appleRequests.push(this.now());
    const request = this.request(makeUrl('https://itunes.apple.com/search', { term: artistNames(track.artist)[0] + ' ' + track.title, entity: 'song', country: 'US', limit: 12 }), { signal: ctx.signal }).then(data => catalogueMatch(data?.results, track, row => metadata(row.trackName, row.artistName, row.trackTimeMillis / 1000))?.row.collectionName || '', () => '');
    this.albumCache.set(key, request);
    if (this.albumCache.size > 80) this.albumCache.delete(this.albumCache.keys().next().value);
    return request;
  }
  async better(track, ctx) {
    const album = await this.album(track, ctx);
    let data;
    try { data = await this.request(makeUrl('https://api.betterlyrics.org/getLyrics', { s: track.title, a: track.artist, al: album, d: Math.round(track.duration) || 0 }), { signal: ctx.signal }); }
    catch (error) { if (error.code === 'access') return null; throw error; }
    if (typeof data?.ttml !== 'string') return null;
    return { ...readTtml(data.ttml), credits: [{ name: 'Better Lyrics', url: 'https://better-lyrics.boidu.dev' }] };
  }
  async musixmatch(track, ctx) {
    const row = await this.musixTrack(track, ctx); if (!row) return null;
    const params = { track_id: row.track_id };
    let lines = [], plain = '', copyright = '';
    if (row.has_richsync) {
      try { lines = parseRichsync((await this.musix('track.richsync.get', params, ctx))?.richsync?.richsync_body); } catch (error) { if (error.code !== 'access') throw error; }
    }
    if (!lines.length && row.has_subtitles) {
      try {
        const subtitle = (await this.musix('track.subtitle.get', { ...params, subtitle_format: 'lrc' }, ctx))?.subtitle;
        copyright = subtitle?.subtitle_copyright || ''; lines = parseLrc(subtitle?.subtitle_body);
        if (!lines.length && subtitle?.subtitle_body) {
          try { lines = tidyLines(JSON.parse(subtitle.subtitle_body).map(line => ({ time: Number(line.time?.total), text: line.text || '' }))); } catch { /* Unknown subtitle format. */ }
        }
      } catch (error) { if (error.code !== 'access') throw error; }
    }
    if (!lines.length) { const lyrics = (await this.musix('track.lyrics.get', params, ctx))?.lyrics; plain = lyrics?.lyrics_body?.slice(0, 60_000) || ''; copyright = lyrics?.lyrics_copyright || ''; }
    return { lines, plain, copyright, credits: [{ name: 'Musixmatch', url: row.track_share_url || 'https://www.musixmatch.com' }], recordId: row.track_id };
  }
  async unison(track, ctx) {
    const response = await this.request(makeUrl('https://unison.boidu.dev/lyrics', { song: track.title, artist: track.artist, duration: track.duration || undefined }), { signal: ctx.signal });
    const row = response?.success && response.data;
    if (!row || !sameRecording(metadata(row.song, row.artist, row.duration), track)) return null;
    return { ...lyricsFrom(row.lyrics, row.format), recordId: row.id };
  }
  async netease(track, ctx) {
    const search = await this.request(makeUrl('https://music.163.com/api/search/get', { s: track.artist + ' ' + track.title, type: 1, limit: 10 }), { signal: ctx.signal, headers: { Referer: 'https://music.163.com/' } });
    const pick = catalogueMatch(search?.result?.songs, track, row => metadata(row.name, row.artists?.map(artist => artist.name).join(', '), row.duration / 1000));
    if (!pick) return null;
    const data = await this.request(makeUrl('https://music.163.com/api/song/lyric', { id: pick.row.id, lv: -1, kv: -1, tv: -1, yv: -1 }), { signal: ctx.signal, headers: { Referer: 'https://music.163.com/' } });
    const words = parseYrc(data?.yrc?.lyric);
    return { ...(words.length ? { lines: words, plain: '' } : lyricsFrom(data?.lrc?.lyric)), instrumental: data?.nolyric === true, recordId: pick.row.id };
  }
  async lrclib(track, ctx) {
    const query = { track_name: track.title, artist_name: track.artist, duration: track.duration || undefined };
    let record = null;
    try { record = await this.request(makeUrl('https://lrclib.net/api/get', query), { signal: ctx.signal }); }
    catch (error) { if (error.code === 'limited' || ctx.signal?.aborted) throw error; /* Exact lookup failures must not prevent catalogue search. */ }
    if (record && !sameRecording(metadata(record.trackName, record.artistName, record.duration), track)) record = null;
    if (!parseLrc(record?.syncedLyrics).length && !record?.instrumental) {
      try {
        let rows = await this.request(makeUrl('https://lrclib.net/api/search', { track_name: track.title, artist_name: track.artist }), { signal: ctx.signal });
        if (!rows?.length && artistNames(track.artist).length > 1) rows = await this.request(makeUrl('https://lrclib.net/api/search', { track_name: track.title, artist_name: artistNames(track.artist)[0] }), { signal: ctx.signal });
        if (!rows?.length) rows = await this.request(makeUrl('https://lrclib.net/api/search', { track_name: track.title }), { signal: ctx.signal });
        const picks = (rows || []).filter(row => sameRecording(metadata(row.trackName, row.artistName, row.duration), track)).sort((a, b) => Math.abs(a.duration - track.duration) - Math.abs(b.duration - track.duration));
        record = picks.find(row => parseLrc(row.syncedLyrics).length) || record || picks[0];
        if (!record) {
          // A shortened upload can still show the correct written lyrics; it
          // must not borrow a full recording's synchronized timestamps.
          const written = (rows || []).filter(row => row.plainLyrics && sameRecording(metadata(row.trackName, row.artistName, 0), { ...track, duration: 0 })).sort((a, b) => Math.abs(a.duration - track.duration) - Math.abs(b.duration - track.duration))[0];
          if (written) return { lines: [], plain: written.plainLyrics.slice(0, 60000), versionMismatch: true, recordId: written.id };
        }
      } catch (error) { if (!record) throw error; }
    }
    return record ? { lines: parseLrc(record.syncedLyrics), plain: record.plainLyrics?.slice(0, 60_000) || '', instrumental: record.instrumental === true, recordId: record.id } : null;
  }
  async qq(track, ctx) {
    const headers = { Referer: 'https://y.qq.com/' };
    const data = await this.request(makeUrl('https://c.y.qq.com/soso/fcgi-bin/client_search_cp', { w: track.artist + ' ' + track.title, format: 'json', p: 1, n: 10 }), { signal: ctx.signal, headers });
    const pick = catalogueMatch(data?.data?.song?.list, track, row => metadata(row.songname, row.singer?.map(artist => artist.name).join(', '), row.interval));
    if (!pick) return null;
    const response = await this.request(makeUrl('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', { songmid: pick.row.songmid, format: 'json', nobase64: 1 }), { signal: ctx.signal, headers, text: true });
    if (!response) return null;
    const json = JSON.parse(response.replace(/^MusicJsonCallback\(/, '').replace(/\);?\s*$/, ''));
    if (json.code !== 0 || !json.lyric) return null;
    const lyric = json.lyric.includes('[') ? json.lyric : Buffer.from(json.lyric, 'base64').toString('utf8');
    return { ...lyricsFrom(lyric.replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')), recordId: pick.row.songmid };
  }
  async kugou(track, ctx) {
    const response = await this.request(makeUrl('https://lyrics.kugou.com/search', { ver: 1, man: 'yes', client: 'pc', keyword: track.artist + ' ' + track.title, duration: track.duration ? Math.round(track.duration * 1000) : undefined }), { signal: ctx.signal });
    const pick = catalogueMatch(response?.candidates, track, row => metadata(row.song, row.singer, row.duration / 1000));
    if (!pick?.row.id || !pick.row.accesskey) return null;
    const result = await this.request(makeUrl('https://lyrics.kugou.com/download', { ver: 1, client: 'pc', fmt: 'lrc', charset: 'utf8', id: pick.row.id, accesskey: pick.row.accesskey }), { signal: ctx.signal });
    return result?.status === 200 && result.content ? { ...lyricsFrom(Buffer.from(result.content, 'base64').toString('utf8')), recordId: pick.row.id } : null;
  }
  async search(track, options = {}) {
    let best = null;
    for (const candidate of lyricCandidates(track)) {
      const result = await this.searchIdentity(candidate, { ...options, onProgress: value => options.onProgress?.({ ...value, identity: { ...value.identity, changed: value.identity?.title !== track.title || value.identity?.artist !== track.artist } }) });
      result.identity.changed = result.identity.title !== track.title || result.identity.artist !== track.artist;
      if (!best || quality(result) > quality(best)) best = result;
      if (result.found && !result.versionMismatch) return result;
    }
    return best;
  }
  async searchIdentity(track, { signal, onProgress = () => {} } = {}) {
    if (!track?.title) throw new Error('Сначала включи трек.');
    const original = { title: track.title, artist: track.artist };
    track = lyricIdentity(track);
    const results = [], attempts = [], ctx = {};
    const currentBest = () => this.settings.merge ? bestLyrics(results) : [...results].sort((a, b) => quality(b) - quality(a))[0] || bestLyrics([]);
    const identity = { title: track.title, artist: track.artist, changed: original.title !== track.title || original.artist !== track.artist };
    const emit = () => onProgress({ ...currentBest(), identity, attempts: structuredClone(attempts) });
    for (const id of this.settings.order) {
      if (signal?.aborted) throw signal.reason;
      const provider = PROVIDERS.find(value => value.id === id), attempt = { id, name: provider.name, status: 'searching' }; attempts.push(attempt);
      if (this.settings.disabled.includes(id)) attempt.status = 'disabled';
      else if (provider.key && !this.settings.keys[provider.key] && !(id === 'spicy' && this.shared?.available())) attempt.status = 'needs-key';
      else if ((this.cooldowns.get(id)?.until || 0) > this.now()) { attempt.status = this.cooldowns.get(id).code; attempt.retryAt = this.cooldowns.get(id).until; }
      else {
        emit();
        ctx.signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
        try {
          const result = await (this.adapters?.[id] ? this.adapters[id](track, ctx) : this[id](track, ctx));
          if (signal?.aborted) throw signal.reason;
          if (result?.lines?.some(line => track.duration > 0 && (line.time > track.duration + 3 || line.end > track.duration + 3 || line.words?.some(word => word.time > track.duration + 3 || word.end > track.duration + 3)))) throw new ProviderError('version');
          if (result && (quality(result) || result.instrumental)) {
            results.push({ ...result, lines: result.lines || [], plain: result.plain || '', source: result.source || provider.name, credits: result.credits || [{ name: provider.name, url: provider.url }] });
            attempt.status = wordCoverage(result) ? 'word' : result.lines?.length ? 'line' : result.instrumental ? 'instrumental' : 'plain';
          } else attempt.status = 'miss';
        } catch (error) {
          if (signal?.aborted) throw signal.reason;
          attempt.status = error instanceof ProviderError ? error.code : 'unavailable';
          const until = error.retryAt || (attempt.status === 'unavailable' ? this.now() + 30_000 : 0);
          if (until) { this.cooldowns.set(id, { until, code: attempt.status }); attempt.retryAt = until; }
        }
      }
      emit();
      const best = currentBest();
      if (wordCoverage(best) >= .95) return { ...best, found: true, precision: 'word', attempts, identity };
    }
    const best = currentBest();
    return { ...best, found: !!quality(best), attempts, identity, instrumental: !quality(best) && results.some(result => result.instrumental) };
  }
}
module.exports = { LyricsEngine, ProviderError, catalogueMatch };
