'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { DuckEnvelope, AudioDucker } = require('../source/integrations/audio-ducker.cjs');
const { DEFAULT_PROTECTION, normalizeProtection } = require('../source/integrations/sound-protection.cjs');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const session = (name, peak = .1, pid = 101) => ({ name, pid, peak });
const sample = (...sessions) => ({ available: true, sessions });
function directory(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-protection-test-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; }

test('ducking waits for sustained sound, holds between words and releases to unity', () => {
  const duck = new DuckEnvelope(DEFAULT_PROTECTION, { ownPid: 1 });
  assert.equal(duck.update(sample(session('Discord')), 0).active, false);
  assert.equal(duck.update(sample(), 80).active, false, 'A short notification must not duck.');
  assert.equal(duck.update(sample(session('Discord')), 200).active, false);
  assert.equal(duck.update(sample(session('Discord')), 320).active, true);
  assert.ok(Math.abs(duck.value.gain - 10 ** (-14 / 20)) < 1e-9);
  assert.equal(duck.update(sample(), 440).active, true);
  assert.equal(duck.update(sample(), 1100).active, true, 'Do not pump the music between words.');
  assert.equal(duck.update(sample(), 1300).active, false); assert.equal(duck.value.gain, 1);
});
test('own audio, silent/invalid sessions and unselected apps never trigger ducking', () => {
  const duck = new DuckEnvelope(DEFAULT_PROTECTION, { ownName: 'electron', ownPid: 7 });
  const rows = [session('LOLZCLOUD'), session('electron'), session('Discord', .5, 7), session('chrome', 0), session('Discord', .00001), session('Game'), session('Discord', NaN), session('Bad\nname'), { name: 'chrome', peak: .8 }];
  duck.update(sample(...rows), 0); assert.equal(duck.update(sample(...rows), 500).active, false);
  duck.configure({ ...DEFAULT_PROTECTION, scope: 'all' }); duck.update(sample(session('Game')), 600); assert.equal(duck.update(sample(session('Game')), 720).active, true);
  assert.deepEqual(duck.value.sources, ['Game']);
  assert.equal(duck.update({ available: false }, 800).gain, 1, 'A failed monitor must release the music.');
});
test('browser sound ducks music, settings disable it, and stale data cannot keep it ducked', () => {
  const duck = new DuckEnvelope(DEFAULT_PROTECTION);
  duck.update(sample(session('msedge')), 100); assert.equal(duck.update(sample(session('msedge')), 220).active, true);
  assert.equal(duck.update(sample(session('msedge')), 3000).active, false, 'A long gap must re-arm the attack.');
  duck.configure({ ...DEFAULT_PROTECTION, ducking: false }); duck.update(sample(session('Discord')), 3100); assert.equal(duck.update(sample(session('Discord')), 3300).gain, 1);
});
test('loopback copies of LolzCloud in Discord, Steam and OBS cannot trigger ducking', () => {
  const duck = new DuckEnvelope({ ...DEFAULT_PROTECTION, scope: 'all' });
  for (let at = 0; at < 1500; at += 120) {
    const peak = .07 + Math.sin(at / 120) * .02;
    const data = { available: true, ownAudio: [{ device: 3, peak }], sessions: ['Discord', 'steam', 'obs64'].map((name, index) => ({ ...session(name, peak * (index ? .98 : 1), 100 + index), device: 3 })) };
    assert.equal(duck.update(data, at).active, false);
  }
  assert.equal(duck.value.gain, 1); assert.deepEqual(duck.value.ignoredEchoes, ['Discord', 'steam', 'obs64']);
  const real = { available: true, ownAudio: [{ device: 3, peak: .08 }], sessions: [{ ...session('Discord', .25), device: 3 }] };
  duck.update(real, 1700); assert.equal(duck.update(real, 1820).active, true);
  assert.deepEqual(duck.value.sources, ['Discord']);
  const quiet = { available: true, ownAudio: [{ device: 3, peak: .08 }], sessions: [{ ...session('obs64', .08), device: 3 }] };
  assert.equal(duck.update(quiet, 3000).gain, 1);
});
test('independent sound on a different output is not suppressed by the echo guard', () => {
  const duck = new DuckEnvelope(DEFAULT_PROTECTION);
  const data = { available: true, ownAudio: [{ device: 1, peak: .1 }], sessions: [{ ...session('Discord', .1), device: 2 }] };
  duck.update(data, 0); assert.equal(duck.update(data, 120).active, true);
});
test('audio protection settings persist atomically without changing the user volume', t => {
  const file = path.join(directory(t), 'music.json'), music = new MusicFeatures(file);
  music.configurePlayer({ volume: .37 }); music.configureProtection({ ceilingDb: -6, duckDb: -18, thresholdDb: -35, scope: 'all' });
  const before = music.getState().protection;
  assert.throws(() => music.configureProtection({ limiter: false, ceilingDb: 1 })); assert.deepEqual(music.getState().protection, before);
  assert.throws(() => music.configureProtection({ duckDb: -100 })); assert.throws(() => music.configureProtection({ scope: 'browser-only' }));
  const reopened = new MusicFeatures(file); assert.deepEqual(reopened.getState().protection, before); assert.equal(reopened.getState().player.volume, .37);
  assert.equal(normalizeProtection({ ceilingDb: Infinity, duckDb: -12 }).ceilingDb, -3);
});
test('Windows monitor uses a hidden owned helper, ignores bad protocol and stops cleanly', t => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}; let killed = 0, launched;
  child.kill = () => { killed++; child.emit('exit', 0); };
  const changes = [], monitor = new AudioDucker({ directory: directory(t), settings: DEFAULT_PROTECTION, platform: 'win32', spawnProcess: (...args) => { launched = args; return child; }, onChange: (config, state) => changes.push({ config, state }) });
  t.after(() => monitor.dispose()); monitor.start();
  assert.equal(launched[2].windowsHide, true); assert.ok(launched[1].includes('-Mta'));
  child.stdout.emit('data', 'bad json\n{"available":true,"sessions":[]}\n'); assert.equal(monitor.state().available, true);
  const revision = monitor.config().revision; monitor.configure({ ...DEFAULT_PROTECTION, ducking: false });
  assert.equal(killed, 1); assert.equal(monitor.state().active, false); assert.equal(monitor.config().duckGain, 1); assert.ok(monitor.config().revision > revision);
  child.stdout.emit('data', '{"available":false,"sessions":[]}\n'); assert.equal(changes.at(-1).config.duckGain, 1);
});
