'use strict';
const fs = require('node:fs');
const { writeJson } = require('./durable-json.cjs');
const { normalizeTrack } = require('./discovery.cjs');
const { scUrl } = require('./music.cjs');
const { text } = require('./player-tools.cjs');
const artistUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && ['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) && /^\/[\w-]+\/?$/.test(url.pathname) ? 'https://soundcloud.com' + url.pathname.replace(/\/$/, '') : ''; } catch { return ''; } };
class ReleaseRadar {
  constructor(filename, discovery) {
    Object.assign(this, { filename, discovery, busy: false, error: '', data: { artists: [], tracks: [], heard: [], updatedAt: 0 } });
    try { const value = JSON.parse(fs.readFileSync(filename, 'utf8')); this.data = { artists: (value.artists || []).filter(row => artistUrl(row.url)).slice(0, 30), tracks: (value.tracks || []).filter(row => scUrl(row.url)).slice(0, 600), heard: (value.heard || []).map(scUrl).filter(Boolean).slice(-3000), updatedAt: Number(value.updatedAt) || 0 }; } catch { /* First run. */ }
  }
  save() { writeJson(this.filename, this.data); }
  state() { return { ...structuredClone(this.data), busy: this.busy, error: this.error, tracks: this.data.tracks.filter(row => !this.data.heard.includes(row.url)) }; }
  async follow(value) {
    const url = artistUrl(value); if (!url) throw new Error('Нужна ссылка на профиль артиста SoundCloud.');
    if (this.data.artists.some(row => row.url === url)) return;
    if (this.data.artists.length >= 30) throw new Error('В радаре уже 30 артистов.');
    const result = await this.discovery.resolve(url);
    if (result.kind !== 'user' || !Number.isSafeInteger(result.id)) throw new Error('SoundCloud не подтвердил профиль артиста.');
    this.data.artists.push({ id: result.id, url, name: text(result.username || url.split('/').pop(), 100) }); this.save();
  }
  unfollow(url) { this.data.artists = this.data.artists.filter(row => row.url !== url); this.save(); }
  heard(url) { if (!scUrl(url)) return; this.data.heard = [...new Set([...this.data.heard, url])].slice(-3000); this.save(); }
  restoreHeard() { this.data.heard = []; this.save(); }
  async refresh() {
    if (this.busy) return; this.busy = true; this.error = '';
    try {
      const artists = [...this.data.artists], tracks = new Map(this.data.tracks.map(row => [row.url, row])), errors = [];
      for (let offset = 0; offset < artists.length; offset += 2) {
        const batch = await Promise.allSettled(artists.slice(offset, offset + 2).map(async artist => {
          const result = await this.discovery.request('/users/' + artist.id + '/tracks', { limit: 30, linked_partitioning: 1 });
          return (result.collection || []).map(value => { const track = normalizeTrack(value); return track ? { ...track, publishedAt: Date.parse(value.created_at || '') || 0, artistProfile: artist.url } : null; }).filter(Boolean);
        }));
        batch.forEach((result, index) => { if (result.status === 'fulfilled') result.value.forEach(track => tracks.set(track.url, track)); else errors.push(artists[offset + index].name); });
      }
      this.data.tracks = [...tracks.values()].filter(row => this.data.artists.some(artist => artist.url === row.artistProfile)).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 600);
      this.error = errors.length ? 'Пока не обновились: ' + errors.join(', ') : ''; this.data.updatedAt = Date.now(); this.save();
    } finally { this.busy = false; }
  }
}
module.exports = { ReleaseRadar, artistUrl };
