'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { clean, clock, normalizePlayback } = require('./lolzteam/status.cjs');
const { profileLinks } = require('./profiles.cjs');
const { SOUND_PRESETS, validGains, validateSoundPatch, normalizeSound, presetSound } = require('./sound-settings.cjs');
const { normalizeProtection, validateProtection } = require('./sound-protection.cjs');
const WINDOW_STYLES = Object.freeze(['mac', 'windows', 'studio']);
const STARTUP_VIEWS = Object.freeze(['browser', 'wave', 'library', 'audio', 'room']);
const DEFAULT_PREFERENCES = Object.freeze({ autoFollow: true, reduceMotion: false, density: 'comfortable', startupView: 'browser', windowStyle: 'mac', lyricsFontScale: 1, uiScale: 1 });

const PRESETS = Object.freeze({
  'Ровный': [0, 0, 0, 0, 0], 'Бас': [6, 3, 0, -1, 0],
  'Вокал': [-2, -1, 4, 3, -1], 'Яркий': [-2, 0, 1, 3, 5], 'Ночной': [-4, -2, 2, 0, -3],
});
const DEFAULT_KEYS = Object.freeze({ playPause: 'Control+Alt+Space', next: 'Control+Alt+Right', previous: 'Control+Alt+Left', volumeUp: 'Control+Alt+Up', volumeDown: 'Control+Alt+Down', studio: 'Control+Alt+B', mini: 'Control+Alt+M' });

function scUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) || url.username || url.password) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length >= 2 && parts.every(part => /^[\w-]+$/.test(part)) ? 'https://soundcloud.com/' + parts.join('/') : '';
  } catch { return ''; }
}
function forumUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['lolz.live', 'zelenka.guru', 'lolz.guru', 'lolz.team'].includes(url.hostname)
      && !url.username && !url.password && /^\/threads\/\d+/.test(url.pathname) ? url.origin + url.pathname : '';
  } catch { return ''; }
}
function validateKey(value) {
  return value === '' || typeof value === 'string' && value.length <= 60
    && /^(?:(?:Control|Alt|Shift)\+){1,3}(?:[A-Z0-9]|Space|Right|Left|Up|Down|F[6-9]|F1[0-2])$/.test(value)
    && new Set(value.split('+').slice(0, -1)).size === value.split('+').length - 1;
}
function canonicalKey(value) {
  if (!value) return '';
  const parts = value.split('+'), key = parts.pop();
  return [...['Control', 'Alt', 'Shift'].filter(modifier => parts.includes(modifier)), key].join('+');
}
function collectionRow(value, addedAt) {
  const url = scUrl(value?.url); if (!url) throw new Error('Нужна ссылка на трек или плейлист SoundCloud.');
  const source = value.source ? forumUrl(value.source) : ''; if (value.source && !source) throw new Error('Источник: ссылка на тему Lolzteam.');
  return { id: randomUUID(), title: clean(value.title, 100) || url.split('/').slice(3).join(' / '), url, source, addedAt };
}
function bbText(value) { return clean(value).replace(/\[/g, '［').replace(/\]/g, '］'); }
function shareText(snapshot, withCover = true) {
  const track = normalizePlayback(snapshot.playback);
  if (!track.title || !scUrl(track.url)) throw new Error('Сначала включи трек.');
  const profiles = profileLinks(snapshot.user, snapshot.soundcloudProfile);
  const lines = ['[CENTER][B]Сейчас слушаю[/B]', `[URL="${track.url}"]${bbText(track.artist)} — ${bbText(track.title)}[/URL]`, `${clock(track.position)} / ${clock(track.duration)}`];
  if (withCover && /^https:\/\/(?:[^/]+\.)?sndcdn\.com\//.test(track.cover)) lines.push(`[IMG]${track.cover}[/IMG]`);
  if (profiles.lolzteam) lines.push(`[URL="${profiles.lolzteam.url}"]${bbText(profiles.lolzteam.name)} · Lolzteam[/URL]`);
  if (profiles.soundcloud) lines.push(`[URL="${profiles.soundcloud.url}"]Мой SoundCloud[/URL]`);
  lines.push('[/CENTER]');
  return lines.join('\n');
}
const { parseLrc, lyricIndex, getLyrics } = require('./lyric-source.cjs');

class MusicFeatures {
  constructor(filename, now = Date.now) {
    this.filename = filename; this.now = now;
    this.data = { history: [], collections: [], customPresets: {}, customEffects: {}, dsp: normalizeSound(), protection: normalizeProtection(), mini: { lyrics: false, lyricsOnly: false, fontScale: 1, alwaysOnTop: true }, player: { volume: null }, preferences: { ...DEFAULT_PREFERENCES }, hotkeys: { ...DEFAULT_KEYS } };
    this.previous = null; this.currentEntry = null; this.dirty = false; this.lastSaved = 0;
    try {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (Array.isArray(saved.history)) this.data.history = saved.history.filter(row => scUrl(row.url)).slice(0, 1000);
      if (Array.isArray(saved.collections)) this.data.collections = saved.collections.filter(row => scUrl(row.url)).slice(0, 100);
      if (saved.customPresets && typeof saved.customPresets === 'object') {
        for (const [name, gains] of Object.entries(saved.customPresets)) if (this.validGains(gains)) this.data.customPresets[clean(name, 32)] = gains;
      }
      this.data.dsp = normalizeSound(saved.dsp);
      this.data.protection = normalizeProtection(saved.protection);
      for (const [name, value] of Object.entries(saved.customEffects || {})) if (!['__proto__', 'constructor', 'prototype'].includes(name)) this.data.customEffects[clean(name, 32)] = normalizeSound(value);
      if (typeof saved.mini?.lyrics === 'boolean') this.data.mini.lyrics = saved.mini.lyrics;
      if (typeof saved.mini?.lyricsOnly === 'boolean') this.data.mini.lyricsOnly = saved.mini.lyricsOnly;
      if (this.data.mini.lyricsOnly) this.data.mini.lyrics = true;
      if (Number.isFinite(saved.mini?.fontScale)) this.data.mini.fontScale = Math.max(.7, Math.min(2, saved.mini.fontScale));
      if (Number.isFinite(saved.preferences?.lyricsFontScale)) this.data.preferences.lyricsFontScale = Math.max(.7, Math.min(2, saved.preferences.lyricsFontScale));
      if (Number.isFinite(saved.preferences?.uiScale)) this.data.preferences.uiScale = Math.max(.85, Math.min(1.5, saved.preferences.uiScale));
      if (Number.isFinite(saved.player?.volume)) this.data.player.volume = Math.max(0, Math.min(1, saved.player.volume));
      if (['off', 'all', 'one'].includes(saved.player?.repeat)) this.data.player.repeat = saved.player.repeat;
      for (const key of ['autoFollow', 'reduceMotion']) if (typeof saved.preferences?.[key] === 'boolean') this.data.preferences[key] = saved.preferences[key];
      if (['comfortable', 'compact'].includes(saved.preferences?.density)) this.data.preferences.density = saved.preferences.density;
      if (STARTUP_VIEWS.includes(saved.preferences?.startupView)) this.data.preferences.startupView = saved.preferences.startupView;
      if (WINDOW_STYLES.includes(saved.preferences?.windowStyle)) this.data.preferences.windowStyle = saved.preferences.windowStyle;
      for (const [action, key] of Object.entries(saved.hotkeys || {})) if (Object.hasOwn(DEFAULT_KEYS, action) && validateKey(key)) this.data.hotkeys[action] = canonicalKey(key);
    } catch { /* First launch. */ }
  }
  validGains(gains) { return validGains(gains); }
  save(force = false) {
    if (!this.dirty || !force && this.now() - this.lastSaved < 5000) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(this.filename + '.tmp', this.filename);
    this.dirty = false; this.lastSaved = this.now();
  }
  observe(snapshot) {
    const time = this.now(); const track = normalizePlayback(snapshot.playback);
    const hidden = snapshot.private === true;
    const active = snapshot.fresh && track.playing && track.title && scUrl(track.url) && !hidden;
    if (!hidden && snapshot.fresh && this.previous?.active && this.previous.url !== track.url && this.currentEntry && this.currentEntry.seconds < 12 && this.previous.position < 15) {
      this.currentEntry.quickSkip = true; this.dirty = true;
    }
    if (active) {
      const same = this.currentEntry?.url === track.url;
      if (!same) {
        this.currentEntry = { id: randomUUID(), url: track.url, title: track.title, artist: track.artist, cover: track.cover, duration: track.duration, liked: track.liked, playedAt: time, seconds: 0 };
        this.data.history.unshift(this.currentEntry); this.data.history.length = Math.min(1000, this.data.history.length); this.dirty = true;
      } else if (this.previous.active) {
        const elapsed = (time - this.previous.time) / 1000; const progressed = track.position - this.previous.position;
        if (elapsed > 0 && elapsed < 6 && progressed > 0 && progressed <= elapsed + 3) {
          this.currentEntry.seconds += Math.min(elapsed, progressed); this.dirty = true;
        }
      }
      if (this.currentEntry.liked !== track.liked) { this.currentEntry.liked = track.liked; this.dirty = true; }
    }
    if (hidden || !snapshot.fresh) this.currentEntry = null;
    this.previous = { url: snapshot.fresh && !hidden ? track.url : null, position: track.position, time, active: !!active };
    this.save();
  }
  getState() {
    const tracks = new Map(), artists = new Map(); let seconds = 0;
    for (const row of this.data.history) {
      const count = Number(row.seconds) || 0; seconds += count;
      const track = tracks.get(row.url) || { url: row.url, title: row.title, artist: row.artist, seconds: 0, plays: 0 };
      track.seconds += count; track.plays++; tracks.set(row.url, track);
      artists.set(row.artist || 'Без исполнителя', (artists.get(row.artist || 'Без исполнителя') || 0) + count);
    }
    return {
      history: this.data.history.slice(0, 100).map(row => ({ ...row })), collections: this.data.collections.map(row => ({ ...row })),
      stats: { seconds, uniqueTracks: tracks.size, plays: this.data.history.length, topTracks: [...tracks.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 5), topArtists: [...artists].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, seconds]) => ({ name, seconds })) },
      dsp: structuredClone(this.data.dsp), presets: { ...PRESETS, ...this.data.customPresets }, hotkeys: { ...this.data.hotkeys },
      soundPresets: Object.entries({ ...SOUND_PRESETS, ...this.data.customEffects }).map(([name, value]) => ({ name, label: value.label || name, description: value.description || 'Твоё звучание', icon: value.icon || '♫', color: value.color || 'mint' })),
      mini: { ...this.data.mini },
      player: { ...this.data.player },
      protection: { ...this.data.protection },
      preferences: { ...this.data.preferences },
    };
  }
  configureDsp(patch) {
    const { preset, saveAs, ...controls } = patch || {};
    const validated = validateSoundPatch(controls);
    let next = { ...this.data.dsp, gains: [...this.data.dsp.gains] };
    if (preset) {
      const legacy = Object.fromEntries(Object.entries({ ...PRESETS, ...this.data.customPresets }).map(([name, gains]) => [name, { gains }]));
      next = presetSound(preset, { ...legacy, ...this.data.customEffects });
    }
    Object.assign(next, validated);
    if (Object.keys(controls).some(key => key !== 'enabled')) next.preset = 'Свой';
    if (saveAs) {
      const name = clean(saveAs, 32); if (!name || ['__proto__', 'constructor', 'prototype'].includes(name) || Object.hasOwn(SOUND_PRESETS, name)) throw new Error('Укажи другое имя пресета.');
      this.data.customPresets[name] = [...next.gains]; this.data.customEffects[name] = { ...next, gains: [...next.gains] }; next.preset = name;
    }
    this.data.dsp = next;
    this.dirty = true; this.save(true);
  }
  configureMini(patch) {
    if (typeof patch?.lyrics === 'boolean') this.data.mini.lyrics = patch.lyrics;
    if (typeof patch?.lyricsOnly === 'boolean') this.data.mini.lyricsOnly = patch.lyricsOnly;
    if (patch?.lyrics === false) this.data.mini.lyricsOnly = false;
    if (this.data.mini.lyricsOnly) this.data.mini.lyrics = true;
    this.data.mini.alwaysOnTop = true;
    if (Number.isFinite(patch?.fontScale)) this.data.mini.fontScale = Math.max(.7, Math.min(2, patch.fontScale));
    this.dirty = true; this.save(true);
  }
  configureProtection(patch) {
    this.data.protection = { ...this.data.protection, ...validateProtection(patch) };
    this.dirty = true; this.save(true);
  }
  configurePlayer(patch) {
    if (Object.hasOwn(patch || {}, 'volume') && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 1)) throw new Error('Громкость должна быть от 0 до 100%.');
    if (Object.hasOwn(patch || {}, 'repeat') && !['off', 'all', 'one'].includes(patch.repeat)) throw new Error('Неизвестный режим повтора.');
    if (!Object.hasOwn(patch || {}, 'volume') && !Object.hasOwn(patch || {}, 'repeat')) throw new Error('Нет настроек плеера.');
    if (Object.hasOwn(patch, 'volume')) this.data.player.volume = patch.volume;
    if (Object.hasOwn(patch, 'repeat')) this.data.player.repeat = patch.repeat;
    this.dirty = true; this.save(true);
  }
  configurePreferences(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Некорректные настройки интерфейса.');
    const next = { ...this.data.preferences };
    for (const [key, value] of Object.entries(patch)) {
      if (['autoFollow', 'reduceMotion'].includes(key)) { if (typeof value !== 'boolean') throw new Error('Некорректный переключатель.'); }
      else if (key === 'density') { if (!['comfortable', 'compact'].includes(value)) throw new Error('Неизвестный размер интерфейса.'); }
      else if (key === 'startupView') { if (!STARTUP_VIEWS.includes(value)) throw new Error('Неизвестный начальный раздел.'); }
      else if (key === 'windowStyle') { if (!WINDOW_STYLES.includes(value)) throw new Error('Неизвестный стиль кнопок окна.'); }
      else if (key === 'lyricsFontScale') { if (!Number.isFinite(value) || value < .7 || value > 2) throw new Error('Размер текста: от 70% до 200%.'); }
      else if (key === 'uiScale') { if (!Number.isFinite(value) || value < .85 || value > 1.5) throw new Error('Масштаб интерфейса: от 85% до 150%.'); }
      else throw new Error('Неизвестная настройка интерфейса.');
      next[key] = value;
    }
    this.data.preferences = next; this.dirty = true; this.save(true);
  }
  setHotkeys(patch) {
    const next = { ...this.data.hotkeys };
    for (const [action, key] of Object.entries(patch || {})) { if (!Object.hasOwn(DEFAULT_KEYS, action) || !validateKey(key)) throw new Error('Некорректное сочетание клавиш.'); next[action] = canonicalKey(key); }
    const used = Object.values(next).filter(Boolean); if (new Set(used).size !== used.length) throw new Error('Сочетания не должны повторяться.');
    this.data.hotkeys = next; this.dirty = true; this.save(true);
  }
  addCollection(value) {
    const entry = collectionRow(value, this.now());
    if (this.data.collections.some(row => row.url === entry.url)) return;
    this.data.collections.unshift(entry);
    this.data.collections = this.data.collections.slice(0, 100); this.dirty = true; this.save(true);
  }
  removeCollection(id) { this.data.collections = this.data.collections.filter(row => row.id !== id); this.dirty = true; this.save(true); }
  importCollections(text) {
    if (typeof text !== 'string' || text.length > 100_000) throw new Error('Подборка слишком большая.');
    const rows = JSON.parse(text); if (!Array.isArray(rows) || rows.length > 100) throw new Error('Нужен список до 100 подборок.');
    const entries = rows.map(row => collectionRow(row, this.now()));
    const next = [...this.data.collections], known = new Set(next.map(row => row.url));
    for (const entry of entries) if (!known.has(entry.url)) { known.add(entry.url); next.unshift(entry); }
    this.data.collections = next.slice(0, 100); this.dirty = true; this.save(true);
  }
}
module.exports = { WINDOW_STYLES, STARTUP_VIEWS, MusicFeatures, PRESETS, DEFAULT_KEYS, validateKey, scUrl, forumUrl, shareText, parseLrc, lyricIndex, getLyrics };
