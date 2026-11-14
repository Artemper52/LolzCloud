(function (root) {
  'use strict';
  class RoomClock {
    constructor(now = () => performance.now()) { this.now = now; this.samples = []; this.offset = null; this.rtt = 0; }
    sample(serverTime, sentAt, receivedAt = this.now()) { if (![serverTime, sentAt, receivedAt].every(Number.isFinite) || receivedAt < sentAt) return; const rtt = receivedAt - sentAt; this.samples.push({ rtt, offset: serverTime - (sentAt + receivedAt) / 2 }); this.samples = this.samples.slice(-12); const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3); this.offset = best.reduce((sum, row) => sum + row.offset, 0) / best.length; this.rtt = best.reduce((sum, row) => sum + row.rtt, 0) / best.length; }
    time() { return this.now() + (this.offset || 0); }
    position(state) {
      const track = state?.playback || {}, now = this.time();
      const sampledAt = Number.isFinite(state?.sampledAt) ? state.sampledAt : Number.isFinite(state?.serverTime) ? state.serverTime : now;
      const expires = state?.controller?.expires;
      const at = Number.isFinite(expires) ? Math.min(now, expires) : now;
      const rate = Number.isFinite(track.rate) && track.rate > 0 && track.rate <= 4 ? track.rate : 1;
      const elapsed = track.playing && !state?.reconnecting ? Math.max(0, at - sampledAt) / 1000 * rate : 0;
      const duration = Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 14400;
      return Math.max(0, Math.min(duration, (Number(track.position) || 0) + elapsed));
    }
  }
  class DriftCorrection {
    constructor() { this.lastSeek = -Infinity; this.nextCheck = null; this.lastTrack = ''; }
    decide(actualMs, targetMs, now, track, force = false, scheduled = false) {
      if (![actualMs, targetMs, now].every(Number.isFinite)) return { seek: false, drift: null, periodic: false };
      if (track !== this.lastTrack || this.nextCheck === null) {
        this.lastTrack = track; this.lastSeek = -Infinity; this.nextCheck = now + 5000;
      }
      const drift = targetMs - actualMs, periodic = scheduled || now >= this.nextCheck;
      if (periodic || force) this.nextCheck = now + 5000;
      // Check all active clients every five seconds. Aligned audio keeps playing
      // without an audible seek; large drift and explicit resync recover earlier.
      const needed = force || Math.abs(drift) > 1200 || periodic && Math.abs(drift) >= 350;
      if (needed && now - this.lastSeek >= (force ? 250 : 2500)) {
        this.lastSeek = now;
        return { seek: true, position: targetMs, drift, periodic };
      }
      return { seek: false, drift, periodic };
    }
  }
  class RoomAdvanceGate {
    constructor() { this.pending = null; this.completed = ''; }
    rearm(key) { if (!this.pending && this.completed === key) this.completed = ''; }
    run(key, automatic, action) {
      if (this.pending) return this.pending;
      if (automatic && key === this.completed) return Promise.resolve(false);
      // Once an end was handled, a late duplicate must not pop another queue
      // entry. A failed HTTP response is ambiguous; only an explicit retry may
      // advance that same recording again.
      this.completed = key;
      const result = Promise.resolve().then(action).finally(() => { if (this.pending === result) this.pending = null; });
      this.pending = result;
      return result;
    }
  }
  const api = { RoomClock, DriftCorrection, RoomAdvanceGate }; if (typeof module === 'object' && module.exports) module.exports = api; else root.LolzCloudRoomSync = api;
})(typeof window === 'object' ? window : globalThis);
