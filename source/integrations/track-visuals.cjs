'use strict';
const { scUrl } = require('./music.cjs');
const bpmValue = value => Number.isFinite(Number(value)) && Number(value) >= 30 && Number(value) <= 300 ? Number(value) : 0;
class TrackVisuals {
  constructor(provider) { this.provider = provider; this.cache = new Map(); this.pending = new Set(); }
  observe(snapshot) {
    const url = scUrl(snapshot.playback?.url);
    if (url && bpmValue(snapshot.playback.bpm)) { this.cache.set(url, bpmValue(snapshot.playback.bpm)); return; }
    if (!url || !snapshot.fresh || snapshot.private || this.cache.has(url) || this.pending.has(url)) return;
    this.pending.add(url);
    Promise.resolve().then(() => this.provider.resolve(url)).then(track => { this.cache.set(url, bpmValue(track.bpm || track.publisher_metadata?.bpm)); }, () => this.cache.set(url, 0)).finally(() => { this.pending.delete(url); if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value); });
  }
  state(snapshot, audio) {
    const track = snapshot.playback || {}, metadata = this.cache.get(track.url) || bpmValue(track.bpm);
    const live = audio?.tempo?.url === track.url && audio.tempo.available && Date.now() - audio.sampledAt < 4000;
    const measured = live && audio.tempo.confidence >= .6 ? bpmValue(audio.tempo.bpm) : 0;
    const bpm = metadata || (measured ? measured / (audio.rate || 1) : 0);
    return { url: track.url || '', bpm: bpm ? Math.round(bpm * 10) / 10 : 0, source: metadata ? 'SoundCloud' : measured ? 'analysis' : '', confidence: metadata ? 1 : measured ? audio.tempo.confidence : 0,
      beatAt: live && Number.isFinite(audio.tempo.beatAge) && audio.tempo.beatAge < 2.5 ? audio.sampledAt - audio.tempo.beatAge * 1000 : null };
  }
}
module.exports = { TrackVisuals, bpmValue };
