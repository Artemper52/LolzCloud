'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function setup() {
  let clicks = 0; const target = 'https://soundcloud.com/test/song', audio = { duration: 100, currentTime: 4, paused: false, ended: false };
  const button = { disabled: false, getBoundingClientRect: () => ({ width: 40, height: 40 }), click() { clicks++; } };
  const child = { location: new URL('https://soundcloud.com/n/test/song'), querySelectorAll(selector) { if (selector === 'iframe') return []; if (selector === 'audio') return [audio]; return selector.includes('aria-label="Play"') ? [button] : []; } };
  const doc = { location: new URL(target), querySelector(selector) { if (selector === '.playbackSoundBadge__titleLink') return { href: target }; if (selector === '.playbackTimeline__duration') return { textContent: '1:40' }; return null; }, querySelectorAll(selector) { return selector === 'iframe' ? [{ contentDocument: child }, { get contentDocument() { throw new Error('Cross origin'); } }] : []; } };
  const window = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/plugins/playback-control.js'), 'utf8'), { document: doc, window, URL, location: new URL(target) });
  return { api: window.__lolzcloudPlayback, audio, clicks: () => clicks };
}
test('new SoundCloud track pages can start through their same-origin embedded player', () => {
  const model = setup(); assert.equal(model.api.play('https://soundcloud.com/test/song'), 'started'); assert.equal(model.clicks(), 1); assert.equal(model.api.canonical('https://soundcloud.com/n/test/song?crossfade=true'), 'https://soundcloud.com/test/song'); assert.equal(model.api.play('https://evil.test/test/song'), 'waiting'); assert.equal(model.clicks(), 1);
});
test('seeking reaches the actual embedded audio immediately and preserves its end state', () => {
  const model = setup(); assert.equal(model.api.seek(42), true); assert.equal(model.audio.currentTime, 42); model.audio.paused = true; assert.equal(model.api.seek(200), true); assert.equal(model.audio.currentTime, 100); model.audio.ended = true; assert.equal(model.api.media('https://soundcloud.com/test/song', 100).ended, true); assert.equal(model.api.seek(NaN), false);
});
