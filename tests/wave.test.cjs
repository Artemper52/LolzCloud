'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersonalWave, tasteProfile, rankCandidates } = require('../source/integrations/wave.cjs');
const { normalizeTrack } = require('../source/integrations/discovery.cjs');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const { selectLyrics, parseLrc } = require('../source/integrations/lyric-source.cjs');
const { LyricsLibrary } = require('../source/integrations/lyrics.cjs');
const song = (slug, artist = 'Liked artist') => ({ url: 'https://soundcloud.com/test/' + slug, title: slug, artist, duration: 100 });
function files(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-wave-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('likes and long listening strengthen affinity, while quick skips weaken it', () => {
  const profile = tasteProfile([{ ...song('long'), seconds: 80 }, { ...song('skip', 'Skipped artist'), seconds: 2, quickSkip: true }], [song('liked')]);
  assert.ok(profile.artists.get('liked artist') > 8); assert.ok(profile.artists.get('skipped artist') < 0);
  const rows = rankCandidates([song('good'), song('bad', 'Skipped artist'), song('neutral', 'Other artist')], profile, { random: () => .5 });
  assert.equal(rows[0].title, 'good'); assert.equal(rows.at(-1).title, 'bad');
});
test('wave avoids repeat tracks, excludes bans and discourages repeated quick skips', () => {
  const rows = rankCandidates([song('heard'), song('ban'), song('skipped'), song('new'), song('new')], tasteProfile([], []), {
    recent: [song('heard')], feedback: { [song('ban').url]: { banned: true }, [song('skipped').url]: { skips: 3 } }, random: () => 0,
  });
  assert.deepEqual(rows.map(row => row.title), ['new']);
});
test('recommendations import only metadata and preserve the correct track duration', () => {
  assert.equal(normalizeTrack({ permalink_url: song('api').url, title: 'API', user: { username: 'Artist' }, duration: 91000 }).duration, 91);
  assert.equal(normalizeTrack({ ...song('long'), duration: 1800 }).duration, 1800);
  assert.equal(normalizeTrack({ ...song('blocked'), policy: 'BLOCK' }), null);
  assert.equal(normalizeTrack({ ...song('bad'), url: 'https://evil.example/song' }), null);
});
test('a personal wave starts a queue, learns skip feedback and persists local choices', async t => {
  const filename = path.join(files(t), 'wave.json'), plays = [], seed = song('seed');
  let snapshot = { fresh: true, private: false, soundcloudProfile: { url: 'https://soundcloud.com/test' }, playback: { ...seed, position: 0, playing: true } };
  const provider = { likes: async () => [seed], related: async () => [song('one'), song('two'), song('three', 'Another artist')] };
  const wave = new PersonalWave({ filename, provider, getSnapshot: () => snapshot, getHistory: () => [], play: url => plays.push(url), now: () => 1_000_000_000, random: () => .5 });
  await wave.start(); assert.equal(wave.active, true); assert.equal(plays.length, 1); assert.equal(wave.data.likes.length, 1);
  snapshot = { ...snapshot, playback: { ...wave.current, position: 3, playing: true } }; wave.observe(snapshot);
  const skipped = wave.current.url; await wave.next('skip'); assert.notEqual(wave.current.url, skipped); assert.equal(wave.data.feedback[skipped].skips, 1);
  snapshot = { ...snapshot, private: true, playback: { ...wave.current, position: 2, playing: true } }; wave.feedback('love'); assert.equal(wave.data.feedback[wave.current.url], undefined);
  wave.stop(); await wave.next('next'); assert.equal(plays.length, 2);
  const reopened = new PersonalWave({ filename, provider, getSnapshot: () => snapshot, getHistory: () => [], play: () => {} });
  assert.equal(reopened.data.feedback[skipped].skips, 1); assert.equal(reopened.data.likes.length, 1); assert.equal(reopened.active, false);
});
test('pausing does not create another listening session or record a skip', t => {
  let now = 10000; const music = new MusicFeatures(path.join(files(t), 'music.json'), () => now);
  const state = { fresh: true, private: false, playback: { ...song('first'), position: 0, playing: true, liked: true } };
  music.observe(state); now += 1000; state.playback.position = 1; music.observe(state);
  state.playback.playing = false; now += 1000; music.observe(state);
  state.playback.playing = true; now += 1000; music.observe(state);
  assert.equal(music.data.history.length, 1); assert.equal(music.data.history[0].liked, true); assert.equal(music.data.history[0].quickSkip, undefined);
  state.playback = { ...song('second'), position: 0, playing: true }; now += 1000; music.observe(state);
  assert.equal(music.data.history.find(row => row.title === 'first').quickSkip, true);
});

test('wave reactions toggle once, ignore stale clicks and ban before advancing', async t => {
  let snapshot = { fresh: true, private: false, playback: { ...song('one'), position: 3, playing: true } };
  const wave = new PersonalWave({ filename: path.join(files(t), 'wave.json'), provider: {}, getSnapshot: () => snapshot, getHistory: () => [], play() {}, random: () => 0 });
  wave.active = true; wave.current = song('one'); wave.queue = [song('two'), song('three')];
  assert.equal(wave.state().canFeedback, true);
  await wave.react('love', song('stale').url); assert.equal(wave.data.feedback[song('one').url], undefined);
  await wave.react('love', song('one').url); assert.equal(wave.state().reaction, 'love'); assert.equal(wave.data.feedback[song('one').url].loves, 1);
  await wave.react('love', song('one').url); assert.equal(wave.state().reaction, '');
  await wave.react('love', song('one').url); await wave.react('ban', song('one').url);
  assert.equal(wave.data.feedback[song('one').url].banned, true); assert.equal(wave.data.feedback[song('one').url].loves, 0); assert.equal(wave.current.url, song('two').url);
  assert.equal(wave.state().canFeedback, false, 'The old track must not receive another reaction while the new song loads.');
  snapshot = { ...snapshot, playback: { ...wave.current, position: 1, playing: true } }; wave.observe(snapshot); assert.equal(wave.state().canFeedback, true);
  snapshot.private = true; await wave.react('love', wave.current.url); assert.equal(wave.data.feedback[wave.current.url], undefined);
});
test('synced lyrics selection rejects other artists and different song versions', () => {
  const wanted = { title: 'Song', artist: 'Artist', duration: 100 };
  const rows = [{ id: 1, artistName: 'Other', trackName: 'Song', duration: 100, syncedLyrics: '[00:01]Wrong artist' },
    { id: 2, artistName: 'Artist', trackName: 'Song', duration: 200, syncedLyrics: '[00:01]Wrong version' },
    { id: 3, artistName: 'Artist', trackName: 'Song', duration: 100, syncedLyrics: '[00:01]The right original test line' }];
  assert.equal(selectLyrics(rows, wanted).id, 3); assert.equal(selectLyrics(rows.slice(0, 2), wanted), null);
});
test('enhanced LRC exposes real word timestamps and personal timings survive restart', t => {
  const text = '[00:01.00]<00:01.00>Original <00:01.50>test words';
  assert.deepEqual(parseLrc(text)[0].words.map(row => row.time), [1, 1.5]);
  const filename = path.join(files(t), 'timing.json'), library = new LyricsLibrary(undefined, filename), track = song('original');
  library.importLrc(track, text);
  assert.equal(new LyricsLibrary(undefined, filename).state(track).source, 'Локальный LRC');
  assert.throws(() => library.importLrc(track, 'Text without any timestamps'));
});
