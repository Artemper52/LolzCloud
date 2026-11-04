'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PersonalWave, rankCandidates, tasteProfile } = require('../source/integrations/wave.cjs');
const { DAY, markPlayed, playedRecently, prunePlayed } = require('../source/integrations/wave-history.cjs');
const { DEFAULTS, contextProfile, preferenceScore } = require('../source/integrations/wave-preferences.cjs');
const song = (id, artist = 'Artist ' + id) => ({ id, url: 'https://soundcloud.com/test/song-' + id, title: 'Song ' + id, artist, duration: 100 });
function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-wave-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = 100 * DAY, snapshot = { fresh: true, private: false, playback: { ...song(999), position: 2, playing: true } };
  const plays = [], tracks = Array.from({ length: 12 }, (_, i) => song(i + 1)), filename = path.join(directory, 'wave.json');
  const args = { filename, provider: { related: async () => tracks }, getSnapshot: () => snapshot, getHistory: () => [], now: () => time, random: () => .25, play: url => { plays.push(url); const track = tracks.find(row => row.url === url); if (track) snapshot = { ...snapshot, playback: { ...track, position: 2, playing: true } }; }, ...options };
  const wave = new PersonalWave(args); t.after(() => wave.dispose());
  return { wave, args, filename, tracks, plays, now: () => time, advance: value => { time += value; }, snapshot: () => snapshot, update: patch => { snapshot = { ...snapshot, ...patch }; } };
}
test('24-hour exclusion survives restarting, shaking, resetting and manually selecting a stale queue row', async t => {
  const model = setup(t), { wave, plays } = model;
  await wave.start(); wave.observe(model.snapshot()); const first = wave.current;
  await wave.next('skip'); wave.observe(model.snapshot()); const second = wave.current;
  wave.reset(); await wave.fill(); await wave.shake();
  assert.ok(wave.state().queue.every(row => ![first.url, second.url].includes(row.url)));
  wave.queue.unshift(first); await assert.rejects(wave.select(first.url), /24/);
  const reopened = new PersonalWave(model.args); t.after(() => reopened.dispose());
  await reopened.start(); assert.notEqual(reopened.current.url, first.url); assert.notEqual(reopened.current.url, second.url);
  assert.equal(plays.length, 3);
  assert.equal(playedRecently(first, reopened.data.played24h, model.now()), true);
  model.advance(DAY - 1); assert.equal(playedRecently(first, reopened.data.played24h, model.now()), true);
  model.advance(1); assert.equal(playedRecently(first, reopened.data.played24h, model.now()), false);
});
test('aliases of the same SoundCloud ID are deduplicated and no cooldown can be bypassed by changing a slug', () => {
  const original = song(12), alias = { ...original, url: 'https://soundcloud.com/test/renamed' }, cache = {};
  markPlayed(original, cache, 5 * DAY);
  assert.equal(playedRecently(alias, cache, 5 * DAY + 1), true);
  assert.deepEqual(rankCandidates([original, alias], tasteProfile([]), { now: 5 * DAY + 1, played24h: cache }), []);
  assert.equal(rankCandidates([original, alias], tasteProfile([])).length, 1);
  assert.equal(Object.keys(prunePlayed({ ...cache, bad: 12 }, 6 * DAY)).length, 0);
});
test('private wave sessions keep only expiring fingerprints and do not learn private reactions or titles', async t => {
  const model = setup(t);
  model.update({ private: true });
  model.wave.data.likes = [song(999)];
  await model.wave.start(); model.wave.observe(model.snapshot()); model.wave.feedback('love');
  assert.deepEqual(model.wave.data.feedback, {});
  const data = JSON.parse(fs.readFileSync(model.filename, 'utf8'));
  assert.ok(Object.keys(data.played24h).every(key => /^[a-f0-9]{64}$/.test(key)));
  assert.ok(Object.values(data.played24h).every(value => value === model.now()));
  assert.ok(!JSON.stringify(data.played24h).includes(model.wave.current.title));
});
test('reading state preserves queue order and does not consume random ranking or trigger requests', async t => {
  let randomCalls = 0; const model = setup(t, { random: () => { randomCalls++; return .25; } });
  await model.wave.start(); const before = randomCalls, one = model.wave.state().queue.map(row => row.url), two = model.wave.state().queue.map(row => row.url);
  assert.deepEqual(one, two); assert.equal(randomCalls, before);
  const expected = one[0]; await model.wave.next('skip'); assert.equal(model.wave.current.url, expected);
});
test('simultaneous next requests share the same fill and start exactly one song', async t => {
  let resolve, requests = 0;
  const model = setup(t, { provider: { related: async () => { requests++; return new Promise(done => { resolve = done; }); } } });
  model.wave.active = true;
  const first = model.wave.next(), second = model.wave.next();
  assert.equal(first, second); await new Promise(done => setImmediate(done)); resolve(model.tracks); await first;
  assert.equal(requests, 1); assert.equal(model.plays.length, 1);
});

test('deliberately replaying a previous wave track preserves the queue and daily exclusions', async t => {
  const model = setup(t); await model.wave.start(); const first = model.wave.current;
  model.wave.observe(model.snapshot()); await model.wave.next('skip'); const second = model.wave.current;
  const queue = model.wave.queue.map(row => row.url); model.wave.replay(first);
  assert.equal(model.wave.active, true); assert.equal(model.wave.current.url, first.url);
  assert.deepEqual(model.wave.queue.map(row => row.url), queue);
  assert.equal(playedRecently(second, model.wave.data.played24h, model.now()), true);
  model.wave.observe(model.snapshot()); assert.equal(model.wave.active, true);
});
test('stopping while a request is pending cannot revive the wave or play a late result', async t => {
  let resolve; const model = setup(t, { provider: { related: () => new Promise(done => { resolve = done; }) } });
  const request = model.wave.start(); await new Promise(done => setImmediate(done)); model.wave.stop(); resolve(model.tracks); await request;
  assert.equal(model.wave.active, false); assert.equal(model.plays.length, 0); assert.equal(model.wave.queue.length, 0);
});

test('a wave advances through multiple tracks even without a browser ended event or a changed URL', async t => {
  const model = setup(t); await model.wave.start();
  for (let index = 0; index < 3; index++) {
    const current = model.wave.current;
    model.update({ playback: { ...current, playing: true, position: 99, duration: 100 } }); model.wave.observe(model.snapshot());
    model.update({ playback: { ...current, playing: false, position: 100, duration: 100 } }); model.wave.observe(model.snapshot());
    if (model.wave.busy) await model.wave.busy;
    assert.notEqual(model.wave.current.url, current.url);
    const count = model.plays.length; await model.wave.complete(current.url); assert.equal(model.plays.length, count, 'A delayed completion from the previous track cannot skip another song.');
  }
  assert.equal(model.plays.length, 4);
});

test('repeat-one, manual pauses, deliberate seeking and stale media never advance the wave', async t => {
  const model = setup(t); await model.wave.start(); const current = model.wave.current;
  model.wave.observe(model.snapshot());
  model.update({ playback: { ...current, playing: true, position: 99, duration: 100, ended: false } }); model.wave.observe(model.snapshot());
  model.update({ playback: { ...current, playing: false, position: 99.9, duration: 100, ended: false } }); model.wave.observe(model.snapshot());
  assert.equal(model.plays.length, 1);
  model.update({ playback: { ...current, playing: false, position: 100, duration: 100, ended: true, repeat: 'one' } }); model.wave.observe(model.snapshot()); await model.wave.complete(); assert.equal(model.plays.length, 1);
  model.wave.seeking(); model.update({ playback: { ...current, playing: false, position: 100, duration: 100, ended: true } }); model.wave.observe(model.snapshot()); assert.equal(model.plays.length, 1);
  model.advance(2001); model.update({ fresh: false }); model.wave.observe(model.snapshot()); assert.equal(model.plays.length, 1);
  model.update({ fresh: true }); model.wave.observe(model.snapshot()); if (model.wave.busy) await model.wave.busy; assert.equal(model.plays.length, 2);
});
test('settings replace pending recommendations atomically and stale results cannot overwrite the new mood', async t => {
  let resolve, requests = 0; const calm = { ...song(1), genre: 'ambient', tags: 'piano instrumental' }, fast = { ...song(2), genre: 'hard techno', bpm: 170 };
  const pool = [fast, calm, ...Array.from({ length: 10 }, (_, i) => song(i + 3))];
  const model = setup(t, { provider: { related: async () => ++requests === 1 ? new Promise(done => { resolve = done; }) : pool } });
  const old = model.wave.fill(); await new Promise(done => setImmediate(done));
  model.wave.configure({ mood: 'calm', activity: 'focus' }); const newest = model.wave.fill(); resolve(pool); await Promise.all([old, newest]);
  assert.equal(model.wave.queue[0].url, calm.url); assert.equal(requests, 2);
  const saved = JSON.parse(fs.readFileSync(model.filename, 'utf8')); assert.equal(saved.preferences.mood, 'calm');
  assert.throws(() => model.wave.configure({ mood: 'sad', bad: true })); assert.equal(model.wave.data.preferences.mood, 'calm');
});
test('catalogue exhaustion reports the rule instead of replaying songs from the last 24 hours', async t => {
  const model = setup(t); for (const track of model.tracks) markPlayed(track, model.wave.data.played24h, model.now());
  model.wave.active = true; await assert.rejects(model.wave.next(), /24/); assert.equal(model.plays.length, 0);
});
test('known/fresh modes, mood, language and time context actually change recommendation scores', () => {
  const known = { ...song(1), title: 'Тихий вечер', genre: 'ambient', tags: 'instrumental piano' }, fresh = { ...song(2), title: 'Night dance', genre: 'hard techno', bpm: 150 };
  const profile = tasteProfile([], [known]);
  assert.deepEqual(rankCandidates([known, fresh], profile, { settings: { ...DEFAULTS, character: 'discover' } }).map(row => row.url), [fresh.url]);
  assert.deepEqual(rankCandidates([known, fresh], profile, { settings: { ...DEFAULTS, character: 'familiar' } }).map(row => row.url), [known.url]);
  assert.ok(preferenceScore(known, { ...DEFAULTS, activity: 'focus', mood: 'calm', language: 'ru' }).score > preferenceScore(fresh, { ...DEFAULTS, activity: 'focus', mood: 'calm', language: 'ru' }).score);
  const now = new Date(2026, 10, 4, 20).getTime(), history = [7, 14, 21].map(days => ({ ...known, playedAt: now - days * DAY, seconds: 60 })), context = contextProfile(history, now);
  assert.equal(context.signals, 3); assert.ok(preferenceScore(known, DEFAULTS, context).score > preferenceScore(fresh, DEFAULTS, context).score);
});
