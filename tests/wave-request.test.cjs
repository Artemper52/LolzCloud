'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { parseRequest, parseEra, requestMatch } = require('../source/integrations/wave-request.cjs');
const { normalizeTrack } = require('../source/integrations/discovery.cjs');
const { PersonalWave } = require('../source/integrations/wave.cjs');
test('natural music requests extract genre, mood, activity and actual historical decades', () => {
  const cowboy = parseRequest('Включи мне ковбойские песни 1900-х годов');
  assert.deepEqual(cowboy.genres, ['country']); assert.equal(cowboy.era.from, 1900); assert.equal(cowboy.era.to, 1909); assert.ok(cowboy.queries.every(q => !q.includes('-х')));
  const happy = parseRequest('Подбери песни, чтобы поднять настроение'); assert.equal(happy.settings.mood, 'happy'); assert.ok(happy.queries[0].includes('happy'));
  const focus = parseRequest('Спокойный джаз для работы без слов'); assert.equal(focus.settings.activity, 'focus'); assert.equal(focus.settings.mood, 'calm'); assert.equal(focus.settings.language, 'instrumental'); assert.deepEqual(focus.genres, ['jazz']);
  assert.deepEqual(parseRequest('Включи фанк без рэпа').excluded, ['hiphop']);
  assert.ok(parseRequest('Включи «The 1975»').queries[0].includes('The 1975')); assert.equal(parseRequest('Включи «The 1975»').era, null);
});
test('ambiguous, empty, future and contradictory requests report a useful error', () => {
  for (const value of ['', '1234', 'x'.repeat(241), 'включи просто песни', 'кантри без кантри']) assert.throws(() => parseRequest(value));
  assert.throws(() => parseEra('2090-х', 2026)); assert.throws(() => parseEra('2000-1900', 2026)); assert.throws(() => parseEra('2099', 2026));
});
test('historical matching never mistakes upload dates or modern remixes for the requested era', () => {
  const request = parseRequest('Ковбойские песни 1900-х'), track = { title: 'Cowboy recording 1907', artist: 'Archive', duration: 120 };
  assert.equal(requestMatch(track, request).eligible, true); assert.equal(requestMatch({ ...track, releaseYear: 2024 }, request).eligible, false); assert.equal(requestMatch({ ...track, title: track.title + ' remix' }, request).eligible, false);
  const upload = normalizeTrack({ permalink_url: 'https://soundcloud.com/test/cowboy', title: 'Cowboy', user: { username: 'Archive' }, duration: 120000, created_at: '1907-01-01T00:00:00Z' });
  assert.equal(upload.releaseYear, 0); assert.equal(requestMatch(upload, request).eligible, false);
});
test('request searches real catalogue metadata without overwriting saved wave preferences or the 24-hour rule', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-request-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidates = Array.from({ length: 4 }, (_, i) => ({ url: 'https://soundcloud.com/test/cowboy-' + i, title: 'Cowboy archive 190' + i, artist: 'Archive ' + i, duration: 120 }));
  const searches = [], plays = []; let snapshot = { fresh: true, private: false, playback: { title: 'Previous', url: 'https://soundcloud.com/test/previous', position: 2, playing: true } };
  const wave = new PersonalWave({ filename: path.join(dir, 'wave.json'), provider: { search: async (query, options) => { searches.push([query, options]); return candidates; }, related: async () => candidates }, getSnapshot: () => snapshot, getHistory: () => [], play: url => { plays.push(url); snapshot = { ...snapshot, playback: { ...candidates.find(row => row.url === url), position: 2, playing: true } }; }, random: () => .25 }); t.after(() => wave.dispose());
  wave.configure({ mood: 'sad' }); await wave.start({ prompt: 'Ковбойские песни 1900-х' }); wave.observe(snapshot);
  assert.ok(searches.length); assert.equal(plays.length, 1); assert.ok(wave.state().request); assert.equal(wave.data.preferences.mood, 'sad');
  const first = wave.current.url; await wave.next('skip'); wave.observe(snapshot); await wave.shake(); assert.ok(wave.state().queue.every(row => row.url !== first));
  const oldRequest = wave.request; await assert.rejects(wave.start({ prompt: '123' })); assert.equal(wave.request, oldRequest); wave.clearRequest(); assert.equal(wave.state().request, null); assert.equal(wave.state().preferences.mood, 'sad');
});
