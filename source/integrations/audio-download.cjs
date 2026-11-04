'use strict';
const fs = require('node:fs/promises');
const { createDecipheriv } = require('node:crypto');
const { normalizeTrack } = require('./discovery.cjs');
const LIMIT = 512 * 1024 * 1024;
function mediaUrl(value, base) {
  let url; try { url = new URL(value, base); } catch { throw new Error('Некорректная ссылка на аудио.'); }
  const trusted = /(^|\.)sndcdn\.com$/i.test(url.hostname) || url.hostname === 'playback.media-streaming.soundcloud.cloud';
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !trusted) throw new Error('SoundCloud вернул неподдерживаемый адрес аудио.');
  return url.href;
}
function attributes(line) {
  return Object.fromEntries([...line.matchAll(/(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(match => [match[1], match[2].replace(/^"|"$/g, '')]));
}
const isMp3 = row => /^audio\/mpeg(?:\s*;|$)/i.test(row.format?.mime_type || '');
function formatScore(row) {
  // Prefer a dedicated full stream; SoundCloud's adaptive "abr" playlists may
  // be unavailable even when the same recording has working AAC/Opus streams.
  const preset = String(row.preset || ''), bitrate = Number(preset.match(/(\d+)k(?:_|$)/)?.[1]) || (isMp3(row) ? 128 : 0);
  return (/^abr(?:_|$)/.test(preset) || /mpegurl/i.test(row.format?.mime_type || '') ? -1000 : 0)
    + (row.quality === 'hq' ? 500 : 0) + bitrate + (row.format?.protocol === 'progressive' ? 5 : 0);
}
function parsePlaylist(text, base) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Не удалось прочитать аудиопоток SoundCloud.');
  const rows = text.split(/\r?\n/).map(row => row.trim()).filter(Boolean), segments = [];
  let key = null, sequence = 0n, duration = 0, partDuration = 0, init = '', range = null, end = 0, rangeUrl = '', variant = false;
  for (const row of rows) {
    if (row.startsWith('#EXT-X-STREAM-INF:')) { variant = true; continue; }
    if (variant && !row.startsWith('#')) return { variant: mediaUrl(row, base) };
    if (row.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { sequence = BigInt(row.split(':')[1]); continue; }
    if (row.startsWith('#EXT-X-KEY:')) {
      const attrs = attributes(row.slice(11));
      if (attrs.METHOD === 'NONE') key = null;
      else if (attrs.METHOD === 'AES-128' && (!attrs.KEYFORMAT || attrs.KEYFORMAT === 'identity')) {
        if (attrs.IV && !/^0x[0-9a-f]{32}$/i.test(attrs.IV)) throw new Error('Неподдерживаемый формат аудиопотока.');
        key = { url: mediaUrl(attrs.URI, base), iv: attrs.IV || '' };
      } else throw new Error('Этот защищённый формат аудиопотока не поддерживает сохранение.');
      continue;
    }
    if (row.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(row.slice(11)), next = mediaUrl(attrs.URI, base);
      if (attrs.BYTERANGE || key || init && next !== init) throw new Error('Этот формат аудиопотока пока не поддерживается.');
      init = next; continue;
    }
    if (row.startsWith('#EXT-X-BYTERANGE:')) { const match = row.slice(17).match(/^(\d+)(?:@(\d+))?$/); if (!match) throw new Error('Некорректный диапазон аудио.'); range = { length: Number(match[1]), offset: match[2] === undefined ? null : Number(match[2]) }; continue; }
    if (row.startsWith('#EXTINF:')) { partDuration = Number.parseFloat(row.slice(8)) || 0; continue; }
    if (row.startsWith('#')) continue;
    const url = mediaUrl(row, base);
    if (range) { if (range.offset === null) { if (rangeUrl !== url) throw new Error('Некорректный диапазон аудио.'); range.offset = end; } end = range.offset + range.length; rangeUrl = url; if (!Number.isSafeInteger(end) || range.length <= 0 || range.length > 32 * 1024 * 1024) throw new Error('Слишком большой фрагмент аудио.'); }
    segments.push({ url, key, sequence, range }); sequence++; duration += partDuration; partDuration = 0; range = null;
    if (segments.length > 4000 || duration > 4 * 3600) throw new Error('Для скачивания поддерживаются записи до четырёх часов.');
  }
  if (!rows.includes('#EXT-X-ENDLIST') || !segments.length) throw new Error('Сохранение прямых эфиров пока не поддерживается.');
  return { segments, init, duration };
}
class SoundCloudAudioSource {
  constructor(provider, fetcher = fetch, { session = null } = {}) { this.provider = provider; this.fetcher = fetcher; this.session = session; }
  async credentials() {
    // Reuse only this application's existing SoundCloud sign-in. Credentials
    // stay in memory and are sent solely to the fixed SoundCloud API origin.
    if (!this.session) return {};
    const rows = await this.session.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' });
    const token = rows.find(row => typeof row.value === 'string' && row.value.length >= 8 && row.value.length <= 8192 && !/[\s\x00-\x1f]/.test(row.value))?.value;
    return token ? { Authorization: 'OAuth ' + token } : {};
  }
  async response(url, signal, headers = {}) {
    for (let redirect = 0; redirect < 4; redirect++) {
      url = mediaUrl(url);
      const response = await this.fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), headers, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); await response.body?.cancel(); url = mediaUrl(location, url); continue; }
      if (!response.ok || !response.body) throw new Error('Не удалось загрузить аудио SoundCloud. Попробуй ещё раз.');
      return response;
    }
    throw new Error('Слишком много перенаправлений аудиопотока.');
  }
  async bytes(url, signal, limit, headers) {
    const response = await this.response(url, signal, headers), chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) { await response.body.cancel().catch(() => {}); throw new Error('Слишком большой фрагмент аудио.'); } chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  }
  async save(url, filename, { signal, onProgress = () => {} }) {
    let headers = await this.credentials(), raw;
    try { raw = await this.provider.request('/resolve', { url }, { signal, headers }); }
    catch (error) { if (!headers.Authorization || ![401, 403].includes(error.status)) throw error; headers = {}; raw = await this.provider.request('/resolve', { url }, { signal }); }
    const track = normalizeTrack(raw);
    // MONETIZE is a playable, ad-supported recording, not a preview. The
    // author's "downloadable" flag controls original files, not stream formats.
    if (!track?.title) throw new Error(raw?.policy === 'SNIP' ? 'SoundCloud отдаёт только отрывок. Для полной записи может потребоваться вход или подписка.' : 'SoundCloud не предоставил доступ к этой записи. Проверь вход и доступность трека.');
    track.duration = Math.max(track.duration, Math.round((Number(raw.full_duration) || 0) / 1000));
    const choices = (raw.media?.transcodings || []).filter(row => !row.snipped && !/\/preview\//i.test(row.url || '') && ['progressive', 'hls', 'encrypted-hls'].includes(row.format?.protocol) && (!row.duration || row.duration >= track.duration * 800 - 1000));
    choices.sort((a, b) => formatScore(b) - formatScore(a));
    if (!choices.length) throw new Error('SoundCloud не предоставил полный поддерживаемый поток для этой записи.');
    let lastError;
    for (const choice of choices) {
      signal.throwIfAborted();
      try { return await this.saveFormat(raw, track, choice, headers, filename, { signal, onProgress }); }
      catch (error) { if (signal.aborted || /^(ENOSPC|EACCES|EPERM|EEXIST)$/.test(error.code || '')) throw error; lastError = error; }
    }
    throw lastError;
  }
  async saveFormat(raw, track, choice, headers, filename, { signal, onProgress }) {
    const api = new URL(choice.url);
    if (api.origin !== 'https://api-v2.soundcloud.com' || api.username || api.password) throw new Error('Неизвестный источник аудио.');
    api.searchParams.set('client_id', await this.provider.clientId());
    if (raw.track_authorization) api.searchParams.set('track_authorization', raw.track_authorization);
    const info = await this.fetcher(api.href, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: 'application/json', ...headers } });
    if (!info.ok) throw new Error('Не удалось открыть аудиопоток. Возможно, трек требует отдельного доступа.');
    const media = mediaUrl((await info.json()).url);
    const file = await fs.open(filename, 'wx'); let size = 0, complete = false;
    onProgress({ bytes: 0, percent: 0 });
    const write = async buffer => {
      signal.throwIfAborted(); size += buffer.length; if (size > LIMIT) throw new Error('Запись превышает ограничение 512 МБ.');
      let at = 0; while (at < buffer.length) at += (await file.write(buffer, at, buffer.length - at)).bytesWritten;
    };
    try {
      if (choice.format.protocol === 'progressive') {
        const response = await this.response(media, signal), total = Number(response.headers.get('content-length')) || 0;
        for await (const chunk of response.body) { await write(chunk); onProgress({ bytes: size, percent: total ? Math.min(99, size / total * 100) : null }); }
      } else {
        let playlist, source = media;
        for (let depth = 0; depth < 3; depth++) {
          playlist = parsePlaylist((await this.bytes(source, signal, 1024 * 1024)).toString('utf8'), source);
          if (!playlist.variant) break; source = playlist.variant;
        }
        if (!playlist?.segments) throw new Error('Слишком сложный аудиопоток.');
        if (track.duration > 45 && playlist.duration < track.duration * .8) throw new Error('Доступен только отрывок; он не будет сохранён как полная песня.');
        if (playlist.init) await write(await this.bytes(playlist.init, signal, 8 * 1024 * 1024));
        const keys = new Map(); let done = 0;
        for (const segment of playlist.segments) {
          const headers = segment.range ? { Range: 'bytes=' + segment.range.offset + '-' + (segment.range.offset + segment.range.length - 1) } : {};
          let buffer = await this.bytes(segment.url, signal, 32 * 1024 * 1024, headers);
          if (segment.range && buffer.length !== segment.range.length) throw new Error('Сервер вернул неполный фрагмент аудио.');
          if (segment.key) {
            let key = keys.get(segment.key.url); if (!key) { key = await this.bytes(segment.key.url, signal, 16); if (key.length !== 16) throw new Error('Неподдерживаемый ключ аудиопотока.'); keys.set(segment.key.url, key); }
            const iv = segment.key.iv ? Buffer.from(segment.key.iv.slice(2), 'hex') : Buffer.from(segment.sequence.toString(16).padStart(32, '0'), 'hex');
            const cipher = createDecipheriv('aes-128-cbc', key, iv); buffer = Buffer.concat([cipher.update(buffer), cipher.final()]);
          }
          await write(buffer); onProgress({ bytes: size, percent: ++done / playlist.segments.length * 100 });
        }
      }
      if (size < 128) throw new Error('SoundCloud вернул пустую запись.');
      complete = true;
      return { track, mp3: isMp3(choice) };
    } finally { await file.close(); if (!complete) await fs.rm(filename, { force: true }); }
  }
}
module.exports = { SoundCloudAudioSource, parsePlaylist, mediaUrl };
