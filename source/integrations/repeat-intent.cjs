'use strict';
const nextRepeat = mode => ({ off: 'all', all: 'one', one: 'off' }[mode] || 'all');
class RepeatIntent {
  constructor(now = Date.now) { this.now = now; this.pending = null; }
  read(track) {
    const value = this.pending, now = this.now();
    if (!value || value.url !== track.url || now >= value.until) { this.pending = null; return null; }
    if (track.repeat === value.mode) { if (value.confirmed === null) value.confirmed = now; if (now - value.confirmed >= 750) { this.pending = null; return null; } }
    else value.confirmed = null;
    return { mode: value.mode };
  }
  choose(track, mode) {
    if (mode !== undefined && !['off', 'all', 'one'].includes(mode)) throw new Error('Неизвестный режим повтора.');
    const target = mode || nextRepeat(this.read(track)?.mode || track.repeat || 'off');
    this.pending = { url: track.url, mode: target, until: this.now() + 5000, confirmed: null }; return target;
  }
}
module.exports = { RepeatIntent, nextRepeat };
