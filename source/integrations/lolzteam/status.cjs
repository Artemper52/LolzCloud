'use strict';

const INTERVAL_MS = 60_000;
const STALE_MS = 15_000;
// A conservative title budget; keep the timecode visible even for long names.
const MAX_TITLE_LENGTH = 50;
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  discordEnabled: true,
  discordSoundcloud: true,
  discordLolzteam: true,
  privateMode: false,
  excludedTracks: [],
  theme: true,
  showTime: true,
  showDuration: true,
  format: 'artist-title',
  pauseBehavior: 'restore',
  prefix: '♫',
});

function clean(value, max = 512) {
  return typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
    : '';
}

function truncate(value, max) {
  if (value.length <= max) return value;
  if (max <= 0) return '';
  let result = '';
  for (const char of value) {
    if (result.length + char.length > max - 1) break;
    result += char;
  }
  return result.trimEnd() + '…';
}

function seconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 604800) : 0;
  }
  if (typeof value !== 'string' || !/^\d{1,6}(?::\d{1,2}){0,2}$/.test(value.trim())) return 0;
  const parts = value.trim().split(':').map(Number);
  if (parts.slice(1).some(part => part > 59)) return 0;
  return Math.min(parts.reduce((total, part) => total * 60 + part, 0), 604800);
}

function clock(value) {
  const total = seconds(value);
  const sec = String(total % 60).padStart(2, '0');
  const min = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
}

function soundcloudUrl(value) {
  try {
    const url = new URL(value, 'https://soundcloud.com');
    if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) return '';
    if (url.username || url.password) return '';
    return url.origin + url.pathname;
  } catch { return ''; }
}

function normalizePlayback(value) {
  const data = value && typeof value === 'object' ? value : {};
  const duration = seconds(data.duration);
  return {
    title: clean(data.title),
    artist: clean(data.artist),
    url: soundcloudUrl(data.url || ''),
    cover: typeof data.cover === 'string' && /^https:\/\/[^\s]+$/u.test(data.cover) ? data.cover.slice(0, 2048) : '',
    position: duration > 0 ? Math.min(typeof data.position === 'number' && Number.isFinite(data.position) ? Math.max(0, data.position) : seconds(data.position), duration) : seconds(data.position),
    duration,
    rate: Number.isFinite(data.rate) && data.rate >= .65 && data.rate <= 1.5 ? data.rate : 1,
    playing: data.playing === true,
    ended: typeof data.ended === 'boolean' ? data.ended : null,
    liked: data.liked === true,
    repeat: ['off', 'all', 'one'].includes(data.repeat) ? data.repeat : 'off',
    bpm: Number.isFinite(data.bpm) && data.bpm >= 30 && data.bpm <= 300 ? data.bpm : 0,
  };
}

function validateSettings(patch, current = DEFAULT_SETTINGS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Некорректные настройки.');
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (['enabled', 'discordEnabled', 'discordSoundcloud', 'discordLolzteam', 'privateMode', 'theme', 'showTime', 'showDuration'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error('Некорректное значение переключателя.');
    } else if (key === 'excludedTracks') {
      if (!Array.isArray(value) || value.length > 200 || value.some(item => typeof item !== 'string' || item.length > 512 || !/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/.test(item))) throw new Error('Список исключений содержит неверную ссылку на трек.');
    } else if (key === 'format') {
      if (!['artist-title', 'title-artist', 'title'].includes(value)) throw new Error('Неизвестный формат статуса.');
    } else if (key === 'pauseBehavior') {
      if (!['restore', 'paused', 'keep'].includes(value)) throw new Error('Неизвестное поведение на паузе.');
    } else if (key === 'prefix') {
      if (typeof value !== 'string' || value.length > 8) throw new Error('Префикс: не более 8 символов.');
    } else {
      throw new Error('Неизвестная настройка.');
    }
    next[key] = key === 'prefix' ? clean(value, 8) : key === 'excludedTracks' ? [...new Set(value)] : value;
  }
  return next;
}

function formatStatus(playback, settings = DEFAULT_SETTINGS) {
  const track = normalizePlayback(playback);
  if (!track.title) return '';
  const prefix = track.playing ? clean(settings.prefix, 8) : 'Ⅱ';
  let body;
  if (settings.format === 'title') body = track.title;
  else if (settings.format === 'title-artist') body = [track.title, track.artist].filter(Boolean).join(' — ');
  else body = [track.artist, track.title].filter(Boolean).join(' — ');
  const suffix = settings.showTime
    ? ` · ${clock(track.position)}${settings.showDuration && track.duration ? '/' + clock(track.duration) : ''}`
    : '';
  const start = prefix ? prefix + ' ' : '';
  return start + truncate(body, MAX_TITLE_LENGTH - start.length - suffix.length) + suffix;
}

module.exports = {
  INTERVAL_MS, STALE_MS, MAX_TITLE_LENGTH, DEFAULT_SETTINGS, clean, truncate,
  seconds, clock, normalizePlayback, validateSettings, formatStatus,
};
