/* Shared, dependency-free policy for the installed web app and its tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LolzCloudAppCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const AUDIO = /^\/music\/audio\/([1-9][0-9]{0,15})\/([a-f0-9]{24})\.mp3$/;
  const LOCAL_ID = /^local:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const trackID = value => typeof value === 'string' && (/^[1-9][0-9]{0,15}$/.test(value) || LOCAL_ID.test(value));
  function audioURL(value, origin) {
    try {
      const url = new URL(value, origin);
      return url.origin === origin && !url.username && !url.password && !url.search && !url.hash && AUDIO.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }
  function track(value, origin) {
    if (!value || typeof value !== 'object' || value.local === true || value.source === 'local' || !/^[1-9][0-9]{0,15}$/.test(value.id)) return null;
    const audio = audioURL(value.audioUrl, origin);
    if (!audio || AUDIO.exec(new URL(audio).pathname)[1] !== value.id || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300) return null;
    const duration = Number(value.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 1200 || typeof value.artist !== 'string' || value.artist.length > 300) return null;
    let cover = '';
    try {
      const url = new URL(value.cover);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && (url.hostname === 'lolzcloud.com' || url.hostname.endsWith('.sndcdn.com'))) cover = url.href;
    } catch { /* Covers are optional; an invalid image never invalidates audio. */ }
    return { id: value.id, title: value.title.trim(), artist: value.artist, audioUrl: audio, duration, cover };
  }
  function localTrack(value) {
    if (!value || !LOCAL_ID.test(value.id) || value.local !== true && value.source !== 'local' || value.audioUrl !== '' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300 || typeof value.artist !== 'string' || value.artist.length > 300 || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 86400) return null;
    return { id: value.id, local: true, source: 'local', audioUrl: '', title: value.title.trim(), artist: value.artist, duration: value.duration, cover: '' };
  }
  function savedTrack(value, origin) { return localTrack(value) || track(value, origin); }
  function audioFileType(name, header) {
    const extension = typeof name === 'string' ? name.toLowerCase().match(/\.(mp3|wav|m4a|flac)$/)?.[1] : '';
    const text = (start, length) => String.fromCharCode(...header.slice(start, start + length));
    if (extension === 'mp3' && (text(0, 3) === 'ID3' || header[0] === 255 && (header[1] & 224) === 224 && (header[1] & 6) === 2 && (header[1] & 24) !== 8)) return 'audio/mpeg';
    if (extension === 'wav' && text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') return 'audio/wav';
    if (extension === 'm4a' && header.length >= 12 && text(4, 4) === 'ftyp') return 'audio/mp4';
    if (extension === 'flac' && text(0, 4) === 'fLaC') return 'audio/flac';
    return '';
  }
  function importedLyrics(name, bytes) {
    if (typeof name !== 'string' || !/\.(txt|lrc)$/i.test(name) || !bytes?.byteLength || bytes.byteLength > 512 * 1024) throw new Error('Выбери TXT или LRC до 512 КБ.');
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim(); } catch { throw new Error('Текст должен быть сохранён в UTF-8.'); }
    if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('В файле нет пригодного текста.');
    const lines = parseLyrics(text).filter(line => line.text.trim());
    if (/\.lrc$/i.test(name) && !lines.length) throw new Error('В LRC нет строк с отметками [мм:сс].');
    return { plain: lines.length ? lines.map(line => line.text).join('\n') : text, synced: lines.length ? text : '', imported: true, filename: name.slice(0, 300), importedAt: Date.now(), durationMatched: true };
  }
  function page(value, origin, offset = '0') {
    if (!value || !Array.isArray(value.tracks) || value.tracks.length > 20) throw new Error('Каталог вернул неверный список треков.');
    const next = value.nextOffset == null ? '' : value.nextOffset;
    if (typeof next !== 'string' || next && (!/^(?:[1-9][0-9]{0,2})$/.test(next) || +next > 300 || +next % 20 || +next <= +offset)) throw new Error('Каталог вернул повторяющуюся страницу.');
    const seen = new Set(), tracks = [];
    for (const row of value.tracks) {
      const item = track(row, origin);
      if (!item) throw new Error('Каталог вернул недопустимый источник музыки.');
      if (!seen.has(item.id)) { seen.add(item.id); tracks.push(item); }
    }
    return { tracks, nextOffset: next };
  }
  function preparationURL(value, origin) {
    const address = audioURL(value, origin);
    return address ? origin + new URL(address).pathname.replace('/music/audio/', '/music/prepare/').replace(/\.mp3$/, '') : '';
  }
  function nextIndex(length, index, { shuffle = false, repeat = 'off', automatic = false, random = Math.random } = {}) {
    if (!length) return -1;
    if (automatic && repeat === 'one') return Math.max(0, index);
    if (shuffle && length > 1) return (Math.max(0, index) + 1 + Math.floor(Math.min(0.999999, Math.max(0, random())) * (length - 1))) % length;
    if (index + 1 < length) return index + 1;
    return repeat === 'all' ? 0 : -1;
  }
  function roomURL(value, origin) {
    try { const url = new URL(value, origin); return url.origin === origin && !url.username && !url.password && /^\/room\/[a-f0-9]{32}\/$/.test(url.pathname) && !url.search && !url.hash ? url.href : ''; } catch { return ''; }
  }
  function parseLyrics(text) {
    if (typeof text !== 'string' || text.length > 512 * 1024) return [];
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const words = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const stamp of stamps) {
        const time = +stamp[1] * 60 + +stamp[2] + +(stamp[3] || '0') / 10 ** (stamp[3]?.length || 1);
        if (+stamp[2] < 60 && time <= 86400) rows.push({ time, text: words });
      }
    }
    return rows.sort((a, b) => a.time - b.time).slice(0, 4000);
  }
  function formatTime(seconds) { const total = Math.max(0, Math.floor(Number(seconds) || 0)); return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0'); }
  function lyricsIdentity(value) {
    return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[\p{M}\p{Cf}]/gu, '').replace(/\.(?:mp3|flac|m4a|ogg|wav|opus|aac)$/i, '').replace(/[(\[]\s*(?:official\s+(?:audio|video|music\s+video)|lyrics?|visuali[sz]er|music\s+video|hq|hd)\s*[)\]]/gi, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ') : '';
  }
  function lyricsCandidate(row, title, artist, seconds) {
    const ownTitle = lyricsIdentity(title), ownArtist = lyricsIdentity(artist);
    if (!row || !ownTitle || !ownArtist || lyricsIdentity(row.trackName) !== ownTitle || lyricsIdentity(row.artistName) !== ownArtist) return null;
    const durationMatched = typeof row.duration === 'number' && Number.isFinite(row.duration) && seconds > 0 && Math.abs(row.duration - seconds) <= 2;
    const rawSynced = typeof row.syncedLyrics === 'string' ? row.syncedLyrics.slice(0, 200000) : '';
    const plain = typeof row.plainLyrics === 'string' && row.plainLyrics.trim() ? row.plainLyrics.slice(0, 200000) : parseLyrics(rawSynced).map(line => line.text).join('\n');
    const synced = durationMatched ? rawSynced : '';
    return plain.trim() || synced.trim() || row.instrumental === true ? { plain, synced, instrumental: row.instrumental === true, durationMatched } : null;
  }
  return { audioURL, track, savedTrack, localTrack, trackID, audioFileType, importedLyrics, page, preparationURL, nextIndex, roomURL, parseLyrics, formatTime, lyricsIdentity, lyricsCandidate };
});
