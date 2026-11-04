'use strict';
const { scUrl } = require('./music.cjs');
const { clean } = require('./lolzteam/status.cjs');
class LyricPrefetcher {
  constructor(library, provider) { this.library = library; this.provider = provider; this.urls = []; this.metadata = new Map(); this.pending = new Set(); this.stopped = false; }
  setUpcoming(urls) { this.urls = Array.isArray(urls) ? [...new Set(urls.slice(0, 3).map(scUrl).filter(Boolean))] : []; }
  observe(snapshot, waveQueue = null) {
    if (this.stopped) return;
    if (snapshot.private || !snapshot.fresh) { this.library.warm([]); return; }
    const current = snapshot.playback;
    if (current?.title && current.duration > 0) void this.library.load(current);
    if (waveQueue) { this.library.warm(waveQueue.slice(0, 2)); return; }
    const urls = this.urls.filter(url => url !== current?.url).slice(0, 2);
    this.library.warm(urls.map(url => this.metadata.get(url)).filter(Boolean));
    for (const url of urls) {
      if (this.metadata.has(url) || this.pending.has(url)) continue;
      this.pending.add(url);
      Promise.resolve().then(() => this.provider.resolve(url)).then(track => {
        if (!this.stopped) this.metadata.set(url, { url, title: clean(track.title), artist: clean(track.user?.username), duration: Math.floor(Number(track.duration) / 1000) || 0 });
      }, () => this.metadata.set(url, null)).finally(() => { this.pending.delete(url); if (this.metadata.size > 40) this.metadata.delete(this.metadata.keys().next().value); });
    }
  }
  stop() { this.stopped = true; this.library.warm([]); }
}
module.exports = { LyricPrefetcher };
