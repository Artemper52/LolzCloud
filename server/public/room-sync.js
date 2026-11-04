(function (root) {
  'use strict';
  class RoomClock {
    constructor(now = () => performance.now()) { this.now = now; this.samples = []; this.offset = null; this.rtt = 0; }
    sample(serverTime, sentAt, receivedAt = this.now()) { if (![serverTime, sentAt, receivedAt].every(Number.isFinite) || receivedAt < sentAt) return; const rtt = receivedAt - sentAt; this.samples.push({ rtt, offset: serverTime - (sentAt + receivedAt) / 2 }); this.samples = this.samples.slice(-12); const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3); this.offset = best.reduce((sum, row) => sum + row.offset, 0) / best.length; this.rtt = best.reduce((sum, row) => sum + row.rtt, 0) / best.length; }
    time() { return this.now() + (this.offset || 0); }
    position(state) { const track = state?.playback || {}; const elapsed = track.playing ? Math.max(0, this.time() - (state.sampledAt || state.serverTime || this.time())) / 1000 : 0; return Math.max(0, Math.min(track.duration || 14400, (Number(track.position) || 0) + elapsed)); }
  }
  class DriftCorrection {
    constructor() { this.lastSeek = -Infinity; this.driftCount = 0; this.lastTrack = ''; }
    decide(actualMs, targetMs, now, track, force = false) { if (track !== this.lastTrack) { this.lastTrack = track; this.lastSeek = -Infinity; this.driftCount = 0; } const drift = targetMs - actualMs; this.driftCount = Math.abs(drift) > 350 ? this.driftCount + 1 : 0; const needed = force || Math.abs(drift) > 1200 || this.driftCount >= 3; if (needed && now - this.lastSeek >= (force ? 250 : 2500)) { this.lastSeek = now; this.driftCount = 0; return { seek: true, position: targetMs, drift }; } return { seek: false, drift }; }
  }
  const api = { RoomClock, DriftCorrection }; if (typeof module === 'object' && module.exports) module.exports = api; else root.LolzCloudRoomSync = api;
})(typeof window === 'object' ? window : globalThis);
