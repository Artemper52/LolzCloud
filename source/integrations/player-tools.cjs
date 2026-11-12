'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { writeJson } = require('./durable-json.cjs');
const { scUrl } = require('./music.cjs');
const { mediaUrl } = require('../app/lib/js/media-source.js');
const { playedRecently } = require('./wave-history.cjs');
const text = (value, limit = 180) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, limit) : '';
const localUrl = value => typeof value === 'string' && /^lolzcloud-local:\/\/[a-f0-9]{32}$/.test(value) ? value : '';
const trackUrl = value => mediaUrl(value) || localUrl(value);
function bookmark(value) {
  const url = trackUrl(value?.url), position = Number(value?.position);
  if (!url || !Number.isFinite(position) || position < 0 || position > 14400) throw new Error('Некорректная закладка трека.');
  return { id: /^[\w-]{1,80}$/.test(value.id || '') ? value.id : randomUUID(), url, title: text(value.title), artist: text(value.artist, 100), position: Math.round(position * 100) / 100, note: text(value.note, 240), createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now() };
}
function normalizeTools(value = {}) {
  const bookmarks = (Array.isArray(value.bookmarks) ? value.bookmarks : []).slice(0, 2000).map(bookmark);
  const groups = (Array.isArray(value.groups) ? value.groups : []).slice(0, 500).map(group => [...new Set((Array.isArray(group) ? group : []).map(scUrl).filter(Boolean))].slice(0, 50)).filter(group => group.length > 1);
  const gains = {};
  for (const [url, row] of Object.entries(value.gains || {}).slice(-500)) if (trackUrl(url) && Number.isFinite(row?.gainDb) && Math.abs(row.gainDb) <= 8) gains[url] = { gainDb: row.gainDb, measuredAt: Number(row.measuredAt) || 0 };
  return { bookmarks, groups, normalization: value.normalization === true, gains };
}
class PlayerTools {
  constructor(filename) {
    this.filename = filename; this.data = normalizeTools();
    try { this.data = normalizeTools(JSON.parse(fs.readFileSync(filename, 'utf8'))); } catch { /* A damaged file is kept until an explicit edit. */ }
  }
  save() { writeJson(this.filename, this.data); }
  state() { return structuredClone(this.data); }
  addBookmark(value) {
    const row = bookmark(value), existing = this.data.bookmarks.find(item => item.url === row.url && Math.abs(item.position - row.position) < .5);
    if (existing) Object.assign(existing, { note: row.note, title: row.title, artist: row.artist });
    else this.data.bookmarks.unshift(row);
    this.data.bookmarks = this.data.bookmarks.slice(0, 2000); this.save(); return existing || row;
  }
  removeBookmark(id) { this.data.bookmarks = this.data.bookmarks.filter(row => row.id !== id); this.save(); }
  group(first, second) {
    first = scUrl(first); second = scUrl(second);
    if (!first || !second || first === second) throw new Error('Выбери две разные записи SoundCloud.');
    const members = new Set([first, second]), keep = [];
    for (const group of this.data.groups) { if (group.some(url => members.has(url))) group.forEach(url => members.add(url)); else keep.push(group); }
    // Close transitive groups too; no result depends on the order of earlier confirmations.
    let changed = true;
    while (changed) { changed = false; for (let i = keep.length - 1; i >= 0; i--) if (keep[i].some(url => members.has(url))) { keep.splice(i, 1)[0].forEach(url => members.add(url)); changed = true; } }
    if (members.size > 50) throw new Error('В одной группе может быть до 50 записей.');
    this.data.groups = [...keep, [...members]].slice(-500); this.save();
  }
  ungroup(url) { this.data.groups = this.data.groups.map(group => group.filter(value => value !== url)).filter(group => group.length > 1); this.save(); }
  duplicate(track, cache, now) { return this.data.groups.some(group => group.includes(track.url) && group.some(url => url !== track.url && playedRecently({ url }, cache, now))); }
  gain(url, gainDb) { if (!trackUrl(url) || !Number.isFinite(gainDb) || Math.abs(gainDb) > 8) return; this.data.gains[url] = { gainDb, measuredAt: Date.now() }; const keys = Object.keys(this.data.gains); if (keys.length > 500) delete this.data.gains[keys[0]]; this.save(); }
}
module.exports = { PlayerTools, normalizeTools, bookmark, trackUrl, localUrl, text };
