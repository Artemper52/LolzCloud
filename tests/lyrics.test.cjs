'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseLrc, parseTtml, readTtml, parseYrc, parseSpicy, parseRichsync } = require('../source/integrations/lyric-formats.cjs');
const { LyricSettings } = require('../source/integrations/lyric-settings.cjs');
const { LyricsEngine, ProviderError } = require('../source/integrations/lyric-providers.cjs');
const { LyricsLibrary } = require('../source/integrations/lyrics.cjs');
const { sameRecording, mergeTimings } = require('../source/integrations/lyric-match.cjs');
const track = { title: 'Original test recording', artist: 'Example Artist', duration: 100 };
const words = [{ time: 2, end: 3, text: 'Original ' }, { time: 3, end: 4, text: 'test' }];
const rich = { lines: [{ time: 2, end: 4, text: 'Original test', words }], plain: '' };
const plain = { lines: [], plain: 'Original test\nAnother original line' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('TTML preserves sub-minute and namespaced word timings, whitespace, ends and XML entities', () => {
  const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="2.000" end="4s"><span begin="2.0" end="3s">Original &amp; </span><span begin="00:03.000" end="4.0">test</span><span ttm:role="x-bg" begin="3s">Backing text</span></p><p begin="01:01.500" end="64s">A later line</p></div></body></tt>';
  const lines = parseTtml(xml);
  assert.equal(lines.length, 2); assert.equal(lines[0].time, 2); assert.equal(lines[0].end, 4);
  assert.equal(lines[0].text, 'Original & test'); assert.equal(lines[0].words[1].time, 3); assert.equal(lines[1].time, 61.5);
  assert.deepEqual(parseTtml('<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///secret">]><tt/>'), []);
  assert.deepEqual(parseTtml('<tt><p begin="2">broken</tt>'), []);
  assert.deepEqual(readTtml('<tt><body><p>Original static text</p></body></tt>'), { lines: [], plain: 'Original static text' });
  assert.equal(parseSpicy({ Body: { Type: 'Static', Lines: [{ Text: 'Original static text' }] } }).plain, 'Original static text');
});
test('enhanced LRC, NetEase YRC, Musixmatch and Spicy retain real word ends', () => {
  assert.equal(parseLrc('[offset:200]\n[00:02.00]<00:02.00>Original <00:03.00>test')[0].words[0].time, 2.2);
  assert.deepEqual(parseYrc('[2000,2000](2000,1000,0)Original (3000,1000,0)test')[0], rich.lines[0]);
  assert.equal(parseRichsync(JSON.stringify([{ ts: 2, te: 4, x: 'Original test', l: [{ o: 0, c: 'Original ' }, { o: 1, c: 'test' }] }]))[0].words[1].time, 3);
  assert.equal(parseRichsync([{ ts: 2, te: 4, x: 'Original test', l: [{ o: 0, c: 'Original' }, { o: 1, c: 'test' }] }])[0].words.map(word => word.text).join(''), 'Original test');
  const spicy = parseSpicy({ Body: { Type: 'Syllable', Content: [{ Type: 'Vocal', Lead: { StartTime: 2, EndTime: 4, Syllables: [{ StartTime: 2, EndTime: 3, Text: 'Original', IsPartOfWord: false }, { StartTime: 3, EndTime: 4, Text: 'test' }] } }] } });
  assert.deepEqual(spicy.lines[0], rich.lines[0]);
});
test('recording matching keeps remix, slowed and other-duration versions separate', () => {
  assert.equal(sameRecording({ ...track, title: 'original TEST recording!', duration: 101 }, track), true);
  for (const value of [{ ...track, title: track.title + ' (Slowed)' }, { ...track, artist: 'Someone Else' }, { ...track, duration: 110 }, { ...track, duration: null }]) assert.equal(sameRecording(value, track), false);
});
test('timing concatenation aligns split rows and never fabricates words or borrows changed lyrics', () => {
  const base = { source: 'Line source', lines: [{ time: 2, text: 'Original test' }, { time: 8, text: 'Another original line' }] };
  const donor = { source: 'Word source', lines: [{ time: 2, text: 'Original', words: [{ time: 2, end: 2.8, text: 'Original ' }] }, { time: 3, text: 'test', words: [{ time: 3, end: 4, text: 'test' }] }, { time: 8, text: 'Another original line' }] };
  const result = mergeTimings(base, donor);
  assert.equal(result.merged, true); assert.equal(result.lines[0].words[0].end, 2.8); assert.equal(result.lines[0].words[1].time, 3); assert.equal(result.lines[1].words, undefined);
  assert.equal(mergeTimings(base, { ...donor, lines: [{ time: 2, text: 'A different song', words }] }), base);
  assert.equal(mergeTimings(base, { ...donor, lines: donor.lines.map(line => ({ ...line, words: line.words?.map(word => ({ ...word, time: word.time + 20 })) })) }), base);
});
test('fallback is sequential, preserves plain progress, skips missing keys and continues after a refusal', async () => {
  const settings = new LyricSettings(), calls = [], updates = [];
  const engine = new LyricsEngine({ settings, adapters: {
    bini: async () => { calls.push('bini'); return plain; },
    unison: async () => { calls.push('unison'); throw new ProviderError('limited', Date.now() + 60_000); },
    netease: async () => { calls.push('netease'); return rich; },
    lrclib: async () => { throw new Error('Should have stopped at word sync'); },
  } });
  const result = await engine.search(track, { onProgress: value => updates.push(value) });
  assert.deepEqual(calls, ['bini', 'unison', 'netease']); assert.equal(result.source, 'NetEase'); assert.equal(result.precision, 'word');
  assert.equal(result.attempts[0].status, 'needs-key'); assert.equal(result.attempts[2].status, 'needs-key'); assert.equal(result.attempts[3].status, 'limited');
  assert.ok(updates.some(value => value.plain === plain.plain));
  calls.length = 0; await engine.search({ ...track, title: 'Next test track' }); assert.deepEqual(calls, ['bini', 'netease']);
});
test('LRCLIB plain text cannot stop the subsequent QQ and KuGou attempts', async () => {
  const settings = new LyricSettings(); settings.configure({ disabled: ['bini', 'unison', 'netease'] }); const calls = [];
  const engine = new LyricsEngine({ settings, adapters: { lrclib: async () => plain, qq: async () => { calls.push('qq'); return null; }, kugou: async () => { calls.push('kugou'); return rich; } } });
  const result = await engine.search(track); assert.deepEqual(calls, ['qq', 'kugou']); assert.equal(result.source, 'KuGou');
});
test('BiniLyrics follows its catalogue migration and only downloads approved lyric storage', async () => {
  const calls = [];
  const engine = new LyricsEngine({ fetcher: async url => { calls.push(url); if (url.includes('binimum.org/getLyrics')) return new Response(null, { status: 307, headers: { Location: 'https://lrc.red/api/v1?q=test' } }); if (url.includes('/api/v1')) return json({ results: [{ track_name: track.title, artist_name: track.artist, duration: 100, lyricsUrl: 'https://lrc.red/s/test.ttml' }, { track_name: track.title, artist_name: track.artist, duration: 120, lyricsUrl: 'https://evil.test/private' }] }); return new Response('<tt><body><p begin="2"><span begin="2">Original </span><span begin="3">test</span></p></body></tt>'); } });
  const result = await engine.bini(track, { signal: AbortSignal.timeout(1000) }); assert.equal(result.lines[0].words.length, 2); assert.equal(calls.length, 3);
  const hostile = new LyricsEngine({ fetcher: async () => json({ results: [{ track_name: track.title, artist_name: track.artist, duration: 100, lyricsUrl: 'https://evil.test/private' }] }) });
  await assert.rejects(hostile.bini(track, {}), { code: 'invalid' });
});
test('Spicy uses the user client key, real Spotify ID and conditional contributor attribution', async () => {
  const settings = new LyricSettings(); settings.configure({ keys: { spicy: 'sl_pk_original_test_key' }, disabled: ['bini', 'musixmatch', 'unison', 'netease', 'lrclib', 'qq', 'kugou'] });
  const engine = new LyricsEngine({ settings, fetcher: async (url, options) => {
    assert.ok(url.endsWith('/1234567890123456789012')); assert.equal(options.headers.Authorization, 'Bearer sl_pk_original_test_key');
    return json({ Body: { source: 'spicy_lyrics', Type: 'Line', UploadAttribution: { Maker: { username: 'Example maker', url: 'https://spicylyrics.org/uid/123' } }, Content: [{ Type: 'Vocal', StartTime: 2, EndTime: 4, Text: 'Original test' }] } });
  } });
  const result = await engine.search({ ...track, spotifyId: '1234567890123456789012' });
  assert.equal(result.credits[1].name, 'Example maker'); assert.ok(!JSON.stringify(result).includes(settings.keys.spicy));
});
test('lyric API keys are encrypted at rest, omitted from state and updated atomically', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-lyrics-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'sources.json');
  const storage = { getSelectedStorageBackend: () => 'gnome_libsecret', isEncryptionAvailable: () => true, encryptString: text => Buffer.from([...Buffer.from(text)].map(byte => byte ^ 91)), decryptString: bytes => Buffer.from([...bytes].map(byte => byte ^ 91)).toString() };
  const settings = new LyricSettings(filename, storage); settings.configure({ keys: { spicy: 'sl_pk_original_test_key' } });
  assert.ok(!fs.readFileSync(filename, 'utf8').includes('sl_pk_original_test_key')); assert.ok(!JSON.stringify(settings.state()).includes('sl_pk_original_test_key'));
  const reopened = new LyricSettings(filename, storage); assert.equal(reopened.keys.spicy, settings.keys.spicy);
  assert.throws(() => settings.configure({ keys: { spicy: 'sl_sk_do_not_ship' } })); assert.equal(settings.keys.spicy, 'sl_pk_original_test_key');
  settings.configure({ remove: ['spicy'] }); assert.equal(new LyricSettings(filename, storage).state().configured.spicy, false);
});
test('a new track cancels an old lookup and late progress cannot replace the new text', async () => {
  let firstOptions, finish;
  const library = new LyricsLibrary((value, options) => value.title === track.title ? new Promise(resolve => { firstOptions = options; finish = resolve; }) : rich);
  const first = library.load(track); await Promise.resolve();
  const nextTrack = { ...track, title: 'A new original track' }; await library.load(nextTrack);
  assert.equal(firstOptions.signal.aborted, true); firstOptions.onProgress(plain); finish(plain); await first;
  assert.equal(library.state(nextTrack).lines[0].text, 'Original test'); assert.equal(library.state(track).found, false);
});
test('QQ and KuGou decode their catalogue responses without using a different recording', async () => {
  const lrc = '[00:02.00]Original test';
  const engine = new LyricsEngine({ fetcher: async url => {
    if (url.includes('client_search_cp')) return json({ data: { song: { list: [{ songname: track.title, singer: [{ name: track.artist }], interval: 125, songmid: 'wrong' }, { songname: track.title, singer: [{ name: track.artist }], interval: 100, songmid: 'correct' }] } } });
    if (url.includes('fcg_query_lyric')) { assert.ok(url.includes('songmid=correct')); return new Response('MusicJsonCallback(' + JSON.stringify({ code: 0, lyric: Buffer.from(lrc).toString('base64') }) + ');'); }
    if (url.includes('/search?')) return json({ candidates: [{ song: track.title, singer: track.artist, duration: 100000, id: 12, accesskey: 'public-candidate-key' }] });
    return json({ status: 200, content: Buffer.from(lrc).toString('base64') });
  } });
  assert.equal((await engine.qq(track, {})).lines[0].time, 2);
  assert.equal((await engine.kugou(track, {})).lines[0].text, 'Original test');
});
test('NetEase prefers its YRC words while Musixmatch falls back when richsync is not permitted', async () => {
  const settings = new LyricSettings(); settings.configure({ keys: { musixmatch: 'original_test_key' } });
  const engine = new LyricsEngine({ settings, fetcher: async url => {
    if (url.includes('music.163.com/api/search')) return json({ result: { songs: [{ id: 12, name: track.title, artists: [{ name: track.artist }], duration: 100000 }] } });
    if (url.includes('music.163.com/api/song/lyric')) return json({ yrc: { lyric: '[2000,2000](2000,1000,0)Original (3000,1000,0)test' }, lrc: { lyric: '[00:02]Original test' } });
    assert.ok(url.includes('apikey=original_test_key'));
    if (url.includes('matcher.track.get')) return json({ message: { header: { status_code: 200 }, body: { track: { track_name: track.title, artist_name: track.artist, track_length: 100, track_id: 12, has_richsync: 1, has_subtitles: 1 } } } });
    if (url.includes('track.richsync.get')) return json({ message: { header: { status_code: 403 }, body: {} } });
    return json({ message: { header: { status_code: 200 }, body: { subtitle: { subtitle_body: '[00:02]Original test', subtitle_copyright: 'Test fixture' } } } });
  } });
  assert.deepEqual((await engine.netease(track, {})).lines, rich.lines);
  const musix = await engine.musixmatch(track, {}); assert.equal(musix.lines[0].text, 'Original test'); assert.equal(musix.copyright, 'Test fixture');
});
test('the search returns to a previously cancelled song with a new request', async () => {
  let count = 0; const waiting = [];
  const library = new LyricsLibrary(() => { count++; return new Promise(resolve => waiting.push(resolve)); });
  const a = library.load(track); await Promise.resolve();
  const b = library.load({ ...track, title: 'Second song' }); await Promise.resolve();
  const again = library.load(track); await Promise.resolve();
  assert.equal(count, 3); waiting.forEach(resolve => resolve(rich)); await Promise.all([a, b, again]);
  assert.equal(library.state(track).lines[0].text, 'Original test');
});

test('an explicit lyric reload replaces a pending lookup and ignores its late result', async () => {
  const attempts = [];
  const library = new LyricsLibrary((_track, options) => new Promise(resolve => attempts.push({ resolve, ...options })));
  const first = library.load(track); await Promise.resolve();
  const reloaded = library.load(track, true); await Promise.resolve();
  const count = attempts.length, cancelled = attempts[0].signal.aborted;
  attempts.at(-1).resolve({ ...rich, source: 'Reloaded source' });
  await reloaded;
  attempts[0].onProgress({ ...plain, source: 'Stale source' });
  attempts[0].resolve({ ...plain, source: 'Stale source' }); await first;
  assert.equal(count, 2, 'Reload must start a new request without waiting for the old provider.');
  assert.equal(cancelled, true);
  assert.equal(library.state(track).source, 'Reloaded source');
});
test('upcoming lyrics share a request with playback and reuse the warmed recording immediately', async () => {
  let calls = 0, finish;
  const library = new LyricsLibrary(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const upcoming = { ...track, url: 'https://soundcloud.com/test/upcoming' };
  library.warm([upcoming]); await Promise.resolve();
  const foreground = library.load(upcoming); await Promise.resolve(); assert.equal(calls, 1); assert.equal(library.background.size, 0);
  finish({ ...rich, found: true }); await foreground;
  const cached = await library.load({ ...upcoming, duration: upcoming.duration + 1 }); assert.equal(cached.found, true); assert.equal(cached.lines[0].text, rich.lines[0].text); assert.equal(calls, 1);
  assert.equal(library.state({ ...upcoming, duration: 120 }).lines.length, 0);
});
test('warming the next songs does not cancel the current lyric request', async () => {
  const waiting = [], options = [];
  const library = new LyricsLibrary((_track, request) => { options.push(request); return new Promise(resolve => waiting.push(resolve)); });
  const current = library.load(track); await Promise.resolve();
  library.warm([{ ...track, title: 'Next', url: 'https://soundcloud.com/test/next' }, { ...track, title: 'After', url: 'https://soundcloud.com/test/after' }]); await Promise.resolve();
  assert.equal(options[0].signal.aborted, false); assert.equal(library.background.size, 2);
  library.warm([]); assert.equal(options[0].signal.aborted, false); assert.equal(options[1].signal.aborted, true); assert.equal(options[2].signal.aborted, true);
  waiting.forEach(resolve => resolve(rich)); await current;
});
test('prefetch resolves actual upcoming metadata and skips private listening', async () => {
  const { LyricPrefetcher } = require('../source/integrations/lyric-prefetch.cjs');
  const warmed = [], requested = [], loads = [];
  const model = new LyricPrefetcher({ load(value) { loads.push(value); }, warm(values) { warmed.push(values); } }, { async resolve(url) { requested.push(url); return { title: 'Next recording', duration: 101900, user: { username: 'Next artist' } }; } });
  model.setUpcoming(['https://soundcloud.com/test/next', 'file:///secret']);
  const snapshot = { playback: track, fresh: true, private: true }; model.observe(snapshot); assert.equal(loads.length, 0); assert.equal(requested.length, 0);
  snapshot.private = false; model.observe(snapshot); await new Promise(resolve => setImmediate(resolve)); model.observe(snapshot);
  assert.equal(requested.length, 1); assert.equal(warmed.at(-1)[0].duration, 101); assert.equal(warmed.at(-1)[0].artist, 'Next artist');
  model.stop();
});
