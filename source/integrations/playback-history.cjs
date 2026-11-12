'use strict';
const { normalizePlayback } = require('./lolzteam/status.cjs');
const { scUrl } = require('./music.cjs');
const { mediaUrl } = require('../app/lib/js/media-source.js');

// In-memory transport history also works in private mode without saving it.
class PlaybackHistory {
  constructor(now = Date.now) { this.now = now; this.entries = []; this.index = -1; this.pending = null; }
  request(value) {
    const url = mediaUrl(value?.url);
    if (url && this.pending?.url !== url) this.pending = { url, until: this.now() + 30000 };
  }
  observe(value) {
    const track = normalizePlayback(value), url = mediaUrl(track.url);
    if (!url || !track.title) return true;
    if (this.pending && this.pending.until <= this.now()) this.pending = null;
    if (this.pending && url !== this.pending.url) return false;
    this.pending = null;
    if (this.entries[this.index]?.url === url) this.entries[this.index] = { ...track, url };
    else {
      this.entries.splice(this.index + 1);
      this.entries.push({ ...track, url });
      if (this.entries.length > 200) this.entries.shift();
      this.index = this.entries.length - 1;
    }
    return true;
  }
  step(direction) {
    const index = this.index + (direction < 0 ? -1 : 1);
    if (index < 0 || index >= this.entries.length) return null;
    this.index = index;
    const track = { ...this.entries[index], position: 0, playing: false, ended: null };
    this.pending = { url: track.url, until: this.now() + 30000 };
    return track;
  }
  state() { return { canPrevious: this.index > 0, canForward: this.index >= 0 && this.index + 1 < this.entries.length }; }
}
module.exports = { PlaybackHistory };
