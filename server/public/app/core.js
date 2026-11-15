/* Shared, dependency-free policy for the installed web app and its tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LolzCloudAppCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const AUDIO = /^\/music\/audio\/([1-9][0-9]{0,15})\/([a-f0-9]{24})\.mp3$/;
  const LOCAL_ID = /^local:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const numericID = value => typeof value === 'string' && value.trim() === value && /^[1-9][0-9]{0,15}$/.test(value);
  const localID = value => typeof value === 'string' && value.trim() === value && LOCAL_ID.test(value);
  function sourceURL(value) {
    if(typeof value!=='string'||value.length>500)return '';
    try {const url=new URL(value);return url.protocol==='https:'&&['soundcloud.com','www.soundcloud.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/[\w-]+\/[\w-]+\/?$/.test(url.pathname)?'https://soundcloud.com'+url.pathname.replace(/\/$/,''):'';}catch{return '';}
  }
  const referenceID=value=>typeof value==='string'&&value.startsWith('ref:')&&sourceURL(value.slice(4))===value.slice(4);
  const trackID = value => numericID(value) || localID(value) || referenceID(value);
  function audioURL(value, origin) {
    try {
      const url = new URL(value, origin);
      return url.origin === origin && !url.username && !url.password && !url.search && !url.hash && AUDIO.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }
  function track(value, origin) {
    if (!value || typeof value !== 'object' || value.local === true || value.source === 'local' || !numericID(value.id)) return null;
    const audio = audioURL(value.audioUrl, origin);
    if (!audio || AUDIO.exec(new URL(audio).pathname)[1] !== value.id || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300) return null;
    const duration = Number(value.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 1200 || typeof value.artist !== 'string' || value.artist.length > 300) return null;
    let cover = '';
    try {
      const url = new URL(value.cover);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && (url.hostname === 'lolzcloud.com' || url.hostname.endsWith('.sndcdn.com'))) cover = url.href;
    } catch { /* Covers are optional; an invalid image never invalidates audio. */ }
    const result={ id: value.id, title: value.title.trim(), artist: value.artist, audioUrl: audio, duration, cover },url=sourceURL(value.url);
    if(url)result.url=url;
    return result;
  }
  function localTrack(value) {
    if (!value || !localID(value.id) || value.local !== true && value.source !== 'local' || value.audioUrl !== '' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300 || typeof value.artist !== 'string' || value.artist.length > 300 || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 86400) return null;
    return { id: value.id, local: true, source: 'local', audioUrl: '', title: value.title.trim(), artist: value.artist, duration: value.duration, cover: '' };
  }
  function referenceTrack(value) {
    if(!value||value.source!=='catalog'||value.audioUrl!==''||value.local===true||!(numericID(value.id)||referenceID(value.id)))return null;
    const url=sourceURL(value.url);
    if(referenceID(value.id)&&url!==value.id.slice(4)||value.url&&!url||typeof value.title!=='string'||!value.title.trim()||value.title.length>300||typeof value.artist!=='string'||value.artist.length>300||!Number.isFinite(value.duration)||value.duration<0||value.duration>86400)return null;
    return{id:value.id,source:'catalog',audioUrl:'',url,title:value.title.trim(),artist:value.artist,duration:value.duration,cover:''};
  }
  function savedTrack(value, origin) { return localTrack(value) || referenceTrack(value) || track(value, origin); }
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
    const offsetTag = text.match(/\[offset:\s*([^\]]*)\]/i), rawOffset = offsetTag?.[1]?.trim() || '0';
    if (!/^[+-]?\d{1,9}$/.test(rawOffset) || Math.abs(Number(rawOffset)) > 86400000) return [];
    const offset = Number(rawOffset) / 1000, rows = [];
    const stampTime = stamp => Number(stamp[1]) * 60 + Number(stamp[2]) + Number('0.' + (stamp[3] || '0'));
    let totalWords = 0;
    for (const line of text.split(/\r?\n/)) {
      const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)].filter(stamp => Number(stamp[2]) < 60);
      if (!stamps.length) continue;
      const body = line.replace(/\[[^\]]*\]/g, '').trim(), markers = [...body.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g)];
      const plain = body.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim().slice(0, 4000);
      const base = stampTime(stamps[0]), sourceWords = [];
      let validWords = markers.length > 0 && markers.length <= 513 && body.slice(0, markers[0]?.index || 0).trim() === '';
      for (let i = 0; validWords && i < markers.length; i++) {
        const marker = markers[i], next = markers[i + 1], time = stampTime(marker), end = next ? stampTime(next) : undefined;
        if (Number(marker[2]) >= 60 || time < base - .05 || time > 86400 || next && (Number(next[2]) >= 60 || end < time || end > 86400)) { validWords = false; break; }
        let words = body.slice(marker.index + marker[0].length, next?.index ?? body.length);
        if (i === 0) words = words.trimStart(); if (!next) words = words.trimEnd();
        if (words) sourceWords.push({ time, text: words, ...(end !== undefined ? { end } : {}) });
      }
      if (sourceWords.length) { sourceWords[0].text = sourceWords[0].text.trimStart(); sourceWords.at(-1).text = sourceWords.at(-1).text.trimEnd(); }
      while (sourceWords.length && !sourceWords[0].text) sourceWords.shift();
      while (sourceWords.length && !sourceWords.at(-1).text) sourceWords.pop();
      validWords &&= sourceWords.length > 0 && sourceWords.length <= 512 && sourceWords.map(word => word.text).join('') === plain;
      const terminal = markers.at(-1), terminalEnd = validWords && body.slice(terminal.index + terminal[0].length).trim() === '' ? stampTime(terminal) : undefined;
      for (const stamp of stamps) {
        if (rows.length >= 4000) break;
        const rawTime = stampTime(stamp), time = Math.max(0, rawTime + offset); if (time > 86400) continue;
        const row = { time, text: plain };
        if (validWords && totalWords + sourceWords.length <= 16000) {
          const shift = rawTime - base + offset;
          const words = sourceWords.map(word => ({ time: Math.max(0, word.time + shift), text: word.text,
            ...(word.end !== undefined ? { end: Math.max(0, word.end + shift) } : {}) }));
          if (words.every(word => word.time <= 86400 && (word.end === undefined || word.end <= 86400))) {
            row.words = Object.freeze(words.map(Object.freeze)); totalWords += words.length;
            if (terminalEnd !== undefined) row.end = Math.max(0, terminalEnd + shift);
          }
        }
        rows.push(Object.freeze(row));
      }
      if (rows.length >= 4000) break;
    }
    return Object.freeze(rows.sort((a, b) => a.time - b.time));
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
  return { audioURL, sourceURL, referenceID, referenceTrack, track, savedTrack, localTrack, trackID, audioFileType, importedLyrics, page, preparationURL, nextIndex, roomURL, parseLyrics, formatTime, lyricsIdentity, lyricsCandidate };
});
