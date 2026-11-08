'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const { normalizeSound, SOUND_PRESETS, validateSoundPatch } = require('../source/integrations/sound-settings.cjs');
const { LyricsLibrary, lyricKey } = require('../source/integrations/lyrics.cjs');

function model(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-sound-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'music.json');
  return { file, value: new MusicFeatures(file) };
}
test('Slowed + Reverb, Speed Up and Bass Boost change real effect settings', t => {
  const { value } = model(t);
  value.configureDsp({ preset: 'Slowed + Reverb' });
  assert.equal(value.data.dsp.enabled, true); assert.equal(value.data.dsp.rate, .85); assert.ok(value.data.dsp.reverb > 0);
  value.configureDsp({ preset: 'Speed Up' });
  assert.equal(value.data.dsp.rate, 1.2); assert.equal(value.data.dsp.reverb, 0);
  value.configureDsp({ preset: 'Bass Boost' });
  assert.equal(value.data.dsp.rate, 1); assert.ok(value.data.dsp.gains[0] > 0);
  value.configureDsp({ preset: 'Original' });
  assert.equal(value.data.dsp.enabled, false); assert.equal(value.data.dsp.rate, 1);
});
test('a personal preset and mini-player lyrics survive restarting the app', t => {
  const { value, file } = model(t);
  value.configureDsp({ enabled: true, rate: .75, reverb: .3, echo: .2, preservesPitch: true, saveAs: 'Вечер' });
  value.configureMini({ lyrics: true, fontScale: 1.2 });
  const reopened = new MusicFeatures(file); reopened.configureDsp({ preset: 'Original' }); reopened.configureDsp({ preset: 'Вечер' });
  assert.equal(reopened.data.dsp.rate, .75); assert.equal(reopened.data.dsp.reverb, .3); assert.equal(reopened.data.dsp.echo, .2); assert.equal(reopened.data.dsp.preservesPitch, true);
  assert.deepEqual(reopened.data.mini, { lyrics: true, lyricsOnly: false, fontScale: 1.2, alwaysOnTop: true });
});
test('invalid sound changes cannot partially update or corrupt the saved settings', t => {
  const { value } = model(t); value.configureDsp({ preset: 'Speed Up' });
  const before = structuredClone(value.data.dsp);
  assert.throws(() => value.configureDsp({ enabled: false, rate: 99 }));
  assert.deepEqual(value.data.dsp, before);
  for (const name of Object.keys(SOUND_PRESETS)) assert.doesNotThrow(() => value.configureDsp({ preset: name }));
  assert.throws(() => validateSoundPatch({ reverb: Infinity }));
  assert.throws(() => validateSoundPatch({ echo: -.1 }));
  assert.equal(normalizeSound({ gains: [1, 2, 3, 2, 1], enabled: true }).rate, 1);
});
test('lyrics share pending requests and cannot mix different track versions', async () => {
  let finish, calls = 0;
  const library = new LyricsLibrary(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const track = { title: 'Original test song', artist: 'Test', duration: 180 };
  const first = library.load(track), second = library.load(track);
  await Promise.resolve(); assert.equal(first, second); assert.equal(calls, 1); assert.equal(library.state(track).loading, true);
  finish({ lines: [{ time: 2, text: 'An original line written for this test' }], plain: '', found: true });
  await first; assert.equal(library.state(track).found, true);
  assert.equal(library.state({ ...track, duration: 240 }).found, false);
  assert.notEqual(lyricKey(track), lyricKey({ ...track, title: 'Another song' }));
});
test('a failed lyric lookup stays quiet until explicitly retried', async () => {
  let calls = 0;
  const library = new LyricsLibrary(async () => { calls++; throw new Error('Offline'); });
  const track = { title: 'A test song', artist: 'Test' };
  await library.load(track); await library.load(track);
  assert.equal(calls, 1); assert.equal(library.state(track).loading, false); assert.ok(library.state(track).error);
  await library.load(track, true); assert.equal(calls, 2);
});

test('volume and interface settings persist without changing the single visual theme', t => {
  const { value, file } = model(t);
  value.configurePlayer({ volume: .37 }); value.configurePreferences({ autoFollow: true, density: 'compact', reduceMotion: true, startupView: 'wave' }); value.configureMini({ alwaysOnTop: false });
  const reopened = new MusicFeatures(file);
  assert.equal(reopened.data.player.volume, .37); assert.equal(reopened.data.preferences.density, 'compact'); assert.equal(reopened.data.preferences.startupView, 'wave'); assert.equal(reopened.data.mini.alwaysOnTop, true);
  assert.throws(() => reopened.configurePlayer({ volume: 2 })); assert.throws(() => reopened.configurePreferences({ theme: 'another-theme' }));
  assert.equal(reopened.data.player.volume, .37);
});

test('lyrics-only, enlarged lyrics, interface zoom and repeat survive app restart', t => {
  const { value, file } = model(t);
  value.configureMini({ lyricsOnly: true, fontScale: 1.8 });
  value.configurePreferences({ lyricsFontScale: 1.6, uiScale: 1.2 });
  value.configurePlayer({ repeat: 'one' });
  const restored = new MusicFeatures(file);
  assert.equal(restored.data.mini.lyricsOnly, true); assert.equal(restored.data.mini.lyrics, true);
  assert.equal(restored.data.preferences.lyricsFontScale, 1.6); assert.equal(restored.data.preferences.uiScale, 1.2);
  assert.equal(restored.data.player.repeat, 'one');
  restored.configureMini({ lyrics: false }); assert.equal(restored.data.mini.lyricsOnly, false);
});
