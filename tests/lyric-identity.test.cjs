'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { lyricIdentity } = require('../source/integrations/lyric-identity.cjs');
const { sameRecording } = require('../source/integrations/lyric-match.cjs');
const { LyricsEngine } = require('../source/integrations/lyric-providers.cjs');
const { LyricsLibrary } = require('../source/integrations/lyrics.cjs');
const json = value => new Response(JSON.stringify(value));
test('SoundCloud reupload metadata cleans promotion, artist prefixes, features and decorative Unicode', () => {
  assert.equal(lyricIdentity({ title: 'вклубе @tg: cocaineshawtymethadone', artist: 'тёмный принц' }).title, 'вклубе');
  const prefixed = lyricIdentity({ title: 'madk1d x паранойя - цена', artist: 'madk1d, паранойя' }); assert.equal(prefixed.title, 'цена'); assert.equal(prefixed.artist, 'madk1d, паранойя');
  const collab = lyricIdentity({ title: 'Знак + тёмный принц (prod. negative.creeper)', artist: 'FONFORINO' }); assert.equal(collab.title, 'Знак'); assert.equal(collab.artist, 'FONFORINO, тёмный принц');
  assert.equal(sameRecording({ title: 'S.T.A.L', artist: 'ТЕМНЫЙ ПРИНЦ', duration: 135 }, { title: '𝐒.𝐓.𝐀.𝐋’', artist: 'тёмный принц', duration: 135 }), true);
  assert.equal(sameRecording({ title: 'MAYHEM', artist: 'тёмный принц', duration: 109 }, { title: '⨢M̟A̟Y̟H̟E̟M̟⨢', artist: 'тёмный принц', duration: 109 }), true);
});

test('artist names in an uploader title can be found in either direction without accepting arbitrary matches', () => {
  const { lyricCandidates } = require('../source/integrations/lyric-identity.cjs');
  const rows = lyricCandidates({ title: 'Fixture title - Actual Singer', artist: 'Reupload channel', duration: 100 });
  assert.ok(rows.some(row => row.title === 'Fixture title' && row.artist === 'Actual Singer'));
  assert.equal(lyricCandidates({ title: 'Fixture title - Slowed', artist: 'Singer' }).length, 1);
  const aliases = lyricIdentity({ title: 'madk1d x паранойя - цена', artist: 'madk1d, Paranoia' }); assert.equal(aliases.artist, 'madk1d, паранойя');
});

test('a temporary empty lookup retries later rather than poisoning the recording for the whole session', async () => {
  let now = 0, calls = 0;
  const library = new LyricsLibrary(async () => { calls++; return calls === 1 ? { found: false, lines: [], plain: '' } : { found: true, lines: [{ time: 1, text: 'Original fixture' }], plain: '' }; }, null, () => now);
  const track = { title: 'Fixture', artist: 'Singer', duration: 100 }; await library.load(track); await library.load(track); assert.equal(calls, 1);
  now = 61000; await library.load(track); assert.equal(calls, 2); assert.equal(library.state(track).found, true);
});

test('manual artist corrections are kept per recording and never change another track', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-lyric-match-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'timing.json'), calls = [], fetcher = async track => { calls.push(track); return { found: true, lines: [], plain: 'Fixture words' }; };
  const original = { title: 'Uploaded name', artist: 'Channel', url: 'https://soundcloud.com/fixture/song', duration: 100 };
  const library = new LyricsLibrary(fetcher, filename); library.setIdentity(original, { title: 'Actual title', artist: 'Actual Singer' }); await library.load(original); assert.equal(calls[0].artist, 'Actual Singer'); assert.equal(calls[0].duration, 100);
  const reopened = new LyricsLibrary(fetcher, filename); await reopened.load(original); assert.equal(calls[1].title, 'Actual title');
  await reopened.load({ ...original, url: 'https://soundcloud.com/fixture/other' }); assert.equal(calls[2].title, 'Uploaded name');
  reopened.setIdentity(original, null); await reopened.load(original); assert.equal(calls[3].artist, 'Channel');
});
test('identity cleanup retains recording versions and rejects unrelated artists or collaborations', () => {
  const track = { title: 'Original song', artist: 'Singer', duration: 100 };
  for (const suffix of ['(remix)', '(slowed)', '(live)', '(cover)', '(sped up)']) assert.equal(sameRecording({ ...track, title: track.title + ' ' + suffix }, track), false);
  assert.equal(sameRecording({ ...track, artist: 'Other Singer' }, track), false);
  assert.equal(sameRecording({ ...track, artist: 'Singer, Guest A' }, { ...track, artist: 'Singer, Guest B' }), false);
  assert.equal(sameRecording({ ...track, duration: 111 }, track), false);
});
test('Better Lyrics uses a matched album and duration and preserves genuine word timings', async () => {
  const calls = [], track = { title: 'Fixture @tg: advertisement', artist: 'Singer', duration: 99 };
  const engine = new LyricsEngine({ fetcher: async url => {
    calls.push(url); const query = new URL(url).searchParams;
    if (url.startsWith('https://itunes.apple.com')) return json({ results: [{ trackName: 'Fixture', artistName: 'Singer', trackTimeMillis: 200000, collectionName: 'Wrong recording' }, { trackName: 'Fixture', artistName: 'Singer', trackTimeMillis: 99000, collectionName: 'Matched album' }] });
    assert.equal(query.get('s'), 'Fixture'); assert.equal(query.get('al'), 'Matched album'); assert.equal(query.get('d'), '99');
    return json({ ttml: '<tt><body><p begin="2" end="4"><span begin="2" end="3">Original </span><span begin="3" end="4">words</span></p></body></tt>' });
  } });
  const result = await engine.better(lyricIdentity(track), {}); assert.equal(result.lines[0].words.length, 2); assert.equal(result.lines[0].words[1].time, 3); assert.equal(calls.length, 2);
  await engine.better(lyricIdentity(track), {}); assert.equal(calls.filter(url => url.includes('itunes.apple.com')).length, 1);
});
test('a short upload can show matching written lyrics but never adopts the full recording timings', async () => {
  const engine = new LyricsEngine({ fetcher: async url => url.includes('/api/get') ? new Response(null, { status: 404 }) : json([{ trackName: 'Fixture', artistName: 'Singer', duration: 100, syncedLyrics: '[00:50]Original fixture words', plainLyrics: 'Original fixture words' }]) });
  const result = await engine.lrclib({ title: 'Fixture', artist: 'Singer', duration: 43 }, {}); assert.equal(result.plain, 'Original fixture words'); assert.deepEqual(result.lines, []); assert.equal(result.versionMismatch, true);
});

test('LRCLIB exact-lookup failures do not disable the working search endpoint for later recordings', async () => {
  const engine = new LyricsEngine({ fetcher: async url => url.includes('/api/get') ? new Response('temporary exact-lookup failure', { status: 500 }) : json([{ trackName: 'Fixture', artistName: 'Singer', duration: 100, syncedLyrics: '[00:02]Original fixture words', plainLyrics: 'Original fixture words' }]) });
  const result = await engine.lrclib({ title: 'Fixture', artist: 'Singer', duration: 100 }, {}); assert.equal(result.lines[0].time, 2);
});

test('a catalogue whose search only indexes titles still checks the artist and recording duration', async () => {
  const engine = new LyricsEngine({ fetcher: async url => {
    if (url.includes('getLyrics')) return json({ results: new URL(url).searchParams.get('q') === 'Fixture' ? [{ track_name: 'Fixture', artist_name: 'Singer', duration: 100, lyricsUrl: 'https://lrc.red/s/fixture.ttml' }, { track_name: 'Fixture', artist_name: 'Other Singer', duration: 100, lyricsUrl: 'https://evil.test/fixture' }] : [] });
    return new Response('<tt><body><p begin="2"><span begin="2">Original </span><span begin="3">fixture</span></p></body></tt>');
  } });
  const result = await engine.bini({ title: 'Fixture', artist: 'Singer', duration: 100 }, {}); assert.equal(result.lines[0].words.length, 2);
});
