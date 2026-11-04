'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { BeatTracker } = require('../source/plugins/beat-tracker.js');
const { palette, fallback } = require('../source/app/lib/js/track-colors.js');
const { TrackVisuals } = require('../source/integrations/track-visuals.cjs');
test('tempo estimation follows regular beats at different speeds and clears on seek or silence', () => {
  for (const bpm of [60, 80, 100, 120, 160, 180]) {
    const tracker = new BeatTracker();
    for (let index = 0; index < 900; index++) { const time = index / 30; tracker.push(time, .005 + .2 * Math.exp(-(time % (60 / bpm)) * 35)); }
    const result = tracker.state(29.97); assert.ok(Math.abs(result.bpm - bpm) < 1.5, bpm + ': ' + result.bpm); assert.ok(result.confidence >= .6);
    assert.equal(tracker.state(40).bpm, 0); tracker.reset(); assert.equal(tracker.state(1).bpm, 0);
  }
  const silent = new BeatTracker(); for (let index = 0; index < 900; index++) silent.push(index / 30, .01); assert.equal(silent.state(30).bpm, 0);
});
test('cover colours determine the palette, including monochrome artwork and missing covers', () => {
  const pixels = [];
  for (let index = 0; index < 100; index++) pixels.push(...(index < 70 ? [230, 30, 55, 255] : [35, 65, 225, 255]));
  const result = palette(Uint8ClampedArray.from(pixels));
  assert.ok(result[0][0] > result[0][2] * 2); assert.ok(result.some(color => color[2] > color[0] * 2)); assert.equal(result.length, 4);
  const gray = palette(Uint8ClampedArray.from([100, 100, 100, 255, 150, 150, 150, 255])); assert.ok(gray.every(color => Math.max(...color) - Math.min(...color) < 1));
  assert.deepEqual(palette(new Uint8ClampedArray()), fallback);
});
test('metadata BPM is cached by track; live estimates respect tempo changes and reject stale samples', async () => {
  let calls = 0; const model = new TrackVisuals({ resolve: async () => { calls++; return { bpm: 120 }; } });
  const snapshot = { fresh: true, private: false, playback: { url: 'https://soundcloud.com/test/song' } };
  model.observe(snapshot); model.observe(snapshot); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(model.state(snapshot, {}).bpm, 120);
  const other = { ...snapshot, playback: { url: 'https://soundcloud.com/test/other' } }, audio = { rate: 1.2, sampledAt: Date.now(), tempo: { url: other.playback.url, available: true, bpm: 144, confidence: .9, beatAge: .1 } };
  const result = model.state(other, audio); assert.equal(result.bpm, 120); assert.equal(result.source, 'analysis'); assert.ok(result.beatAt > Date.now() - 200);
  assert.equal(model.state(other, { ...audio, sampledAt: Date.now() - 6000 }).bpm, 0);
  model.observe({ ...other, private: true }); await Promise.resolve(); assert.equal(calls, 1);
});
