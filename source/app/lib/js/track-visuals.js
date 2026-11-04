(() => {
  'use strict';
  const colors = window.LolzCloudColors, cache = new Map();
  class TrackVisuals {
    constructor() { this.views = new Set(); this.palette = colors.fallback.map(color => [...color]); this.cover = null; this.tempo = {}; this.sample = null; this.epoch = 0; }
    subscribe(view) { this.views.add(view); view.setPalette(this.palette); }
    notify() { for (const view of this.views) view.setPalette(this.palette); }
    loadPalette(url) {
      if (!cache.has(url)) cache.set(url, new Promise(resolve => {
        const image = new Image(); image.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(colors.fallback), 8000);
        image.onload = () => { clearTimeout(timer); try { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40; const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, 40, 40); resolve(colors.palette(context.getImageData(0, 0, 40, 40).data)); } catch { resolve(colors.fallback); } };
        image.onerror = () => { clearTimeout(timer); resolve(colors.fallback); }; image.src = url;
      }));
      if (cache.size > 24) cache.delete(cache.keys().next().value);
      return cache.get(url);
    }
    update(snapshot) {
      const track = snapshot.playback || {}, playing = track.playing && snapshot.fresh !== false;
      const key = track.url || [track.artist, track.title].join('\n');
      if (!this.sample || this.sample.key !== key || this.sample.position !== track.position || this.sample.playing !== playing || this.sample.rate !== track.rate) this.sample = { key, position: Number(track.position) || 0, playing, rate: track.rate || 1, at: Date.now() };
      const tempo = snapshot.features?.visuals || snapshot.visuals || {};
      this.tempo = tempo.url && tempo.url !== track.url ? {} : { ...tempo, bpm: tempo.bpm || track.bpm || 0 };
      const url = /^https:\/\//.test(track.cover || '') ? track.cover : '';
      if (url !== this.cover) {
        this.cover = url; const epoch = ++this.epoch;
        if (!url) { this.palette = colors.fallback.map(color => [...color]); this.notify(); }
        else this.loadPalette(url).then(palette => { if (epoch !== this.epoch) return; this.palette = palette; this.notify(); document.documentElement.dataset.coverPalette = 'ready'; });
      }
      const bpm = this.effectiveBpm();
      document.documentElement.style.setProperty('--beat-duration', bpm ? 60 / bpm + 's' : '0s');
      document.documentElement.dataset.bpm = bpm ? String(Math.round(bpm)) : '';
      for (const [index, color] of this.palette.entries()) document.documentElement.style.setProperty('--cover-color-' + (index + 1), 'rgb(' + color.join(',') + ')');
    }
    effectiveBpm() { const bpm = Number(this.tempo.bpm); return bpm >= 30 && bpm <= 300 ? bpm * (this.sample?.rate || 1) : 0; }
    pulse(now = Date.now()) {
      if (!this.sample?.playing) return 0;
      const bpm = this.effectiveBpm(), anchor = this.tempo.beatAt;
      if (!bpm) { const age = Number.isFinite(anchor) ? (now - anchor) / 1000 : Infinity; return age >= 0 && age < .8 ? Math.exp(-age / .17) : 0; }
      const beats = Number.isFinite(anchor) ? (now - anchor) / 60_000 * bpm : (this.sample.position + Math.max(0, now - this.sample.at) / 1000 * this.sample.rate) * this.tempo.bpm / 60;
      const phase = ((beats % 1) + 1) % 1;
      return Math.exp(-phase * 7);
    }
    caption() { const bpm = this.effectiveBpm(); return bpm ? (this.tempo.source === 'analysis' ? '≈ ' : '') + Math.round(bpm) + ' BPM' : ''; }
  }
  window.LolzCloudVisuals = new TrackVisuals();
})();
