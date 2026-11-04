'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCipheriv } = require('node:crypto');
const { Downloads, safeFilename, ffmpegPath, encodeMp3 } = require('../source/integrations/downloads.cjs');
const { SoundCloudAudioSource, parsePlaylist, mediaUrl } = require('../source/integrations/audio-download.cjs');
const song = { url: 'https://soundcloud.com/test/song', title: 'Тестовая песня', artist: 'Исполнитель', duration: 2 };
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-download-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
async function finish(downloads) { while (downloads.running) await downloads.running; }
test('MP3 filenames cannot traverse folders, overwrite device files or keep invalid Windows characters', () => {
  assert.equal(safeFilename('', 'CON'), 'Песня CON.mp3');
  const file = safeFilename('../../artist', 'song: <test>?'); assert.equal(path.basename(file), file); assert.ok(!/[<>:"/\\|?*]/.test(file)); assert.ok(file.endsWith('.mp3'));
});
test('the bundled converter produces real MP3 audio and preserves Unicode title tags', async t => {
  const dir = directory(t), input = path.join(dir, 'input.m4a'), output = path.join(dir, 'output.mp3'), executable = ffmpegPath();
  execFileSync(executable, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', input], { windowsHide: true });
  await encodeMp3(input, output, { track: song, mp3: false, signal: new AbortController().signal });
  const data = fs.readFileSync(output); assert.equal(data.toString('ascii', 0, 3), 'ID3'); assert.ok(data.length > 5000);
  const result = execFileSync(executable, ['-hide_banner', '-i', output, '-f', 'ffmetadata', '-'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(result.includes('title=Тестовая песня')); assert.ok(result.includes('artist=Исполнитель'));
});
test('downloads serialize jobs, deduplicate a track and preserve existing MP3 files', async t => {
  const dir = directory(t), dest = path.join(dir, 'saved'); fs.mkdirSync(dest); const existing = path.join(dest, safeFilename(song.artist, song.title)); fs.writeFileSync(existing, 'keep');
  let running = 0, max = 0;
  const downloads = new Downloads({ directory: dest, runtime: path.join(dir, 'runtime'), filename: path.join(dir, 'history.json'), source: { async save(url, file) { max = Math.max(max, ++running); await fsp.writeFile(file, 'source'); await new Promise(done => setTimeout(done, 10)); running--; return { track: { ...song, url }, mp3: true }; } }, encoder: async (input, output) => fsp.copyFile(input, output) });
  t.after(() => downloads.dispose()); const id = downloads.enqueue(song); assert.equal(downloads.enqueue(song), id); downloads.enqueue({ ...song, url: song.url + '-2' }); await finish(downloads);
  assert.equal(max, 1); assert.equal(fs.readFileSync(existing, 'utf8'), 'keep'); assert.equal(downloads.state().items.filter(row => row.status === 'complete').length, 2); assert.ok(downloads.file(id).endsWith('(2).mp3')); assert.deepEqual(fs.readdirSync(path.join(dir, 'runtime')), []);
});
test('cancelled downloads leave no final file or temporary audio', async t => {
  const dir = directory(t); let started;
  const began = new Promise(done => { started = done; });
  const downloads = new Downloads({ directory: path.join(dir, 'saved'), runtime: path.join(dir, 'runtime'), filename: path.join(dir, 'history.json'), source: { async save(url, file, { signal }) { await fsp.writeFile(file, 'partial'); started(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); } } });
  t.after(() => downloads.dispose()); const id = downloads.enqueue(song); await began; downloads.cancel(id); await finish(downloads); assert.equal(downloads.state().items[0].status, 'cancelled'); assert.deepEqual(fs.readdirSync(downloads.directory), []); assert.deepEqual(fs.readdirSync(downloads.runtime), []);
});

test('cancelling while the final MP3 is being copied removes only the newly created file', async t => {
  const dir = directory(t), dest = path.join(dir, 'saved'); fs.mkdirSync(dest);
  const existing = path.join(dest, safeFilename(song.artist, song.title)); fs.writeFileSync(existing, 'keep');
  let began, resume;
  const copying = new Promise(resolve => { began = resolve; }), release = new Promise(resolve => { resume = resolve; });
  const copyFile = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (...args) => {
    await copyFile(...args);
    if (path.dirname(args[1]) === dest) { began(); await release; }
  });
  const downloads = new Downloads({ directory: dest, runtime: path.join(dir, 'runtime'), filename: path.join(dir, 'history.json'),
    source: { async save(_url, file) { await fsp.writeFile(file, 'source'); return { track: song, mp3: true }; } },
    encoder: async (input, output) => copyFile(input, output) });
  t.after(() => downloads.dispose());
  const id = downloads.enqueue(song); await copying; downloads.cancel(id); resume(); await finish(downloads);
  assert.equal(downloads.state().items[0].status, 'cancelled');
  assert.deepEqual(fs.readdirSync(dest), [path.basename(existing)]);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(downloads.runtime), []);
});
test('retrying a failed download reuses its row and completes without duplicate files or list entries', async t => {
  const dir = directory(t); let attempts = 0;
  const options = { directory: path.join(dir, 'saved'), runtime: path.join(dir, 'runtime'), filename: path.join(dir, 'history.json'), source: { async save(url, file) { if (++attempts === 1) throw new Error('Temporary stream failure.'); await fsp.writeFile(file, 'audio'); return { track: song, mp3: true }; } }, encoder: async (input, output) => fsp.copyFile(input, output) };
  const downloads = new Downloads(options); t.after(() => downloads.dispose()); const id = downloads.enqueue(song); await finish(downloads); assert.equal(downloads.state().items[0].status, 'error');
  assert.equal(downloads.retry(id), id); await finish(downloads); assert.equal(downloads.state().items.length, 1); assert.equal(downloads.state().items[0].status, 'complete'); assert.equal(downloads.enqueue(song), id); assert.equal(attempts, 2); assert.equal(fs.readdirSync(downloads.directory).length, 1); assert.throws(() => downloads.retry('missing'));
});
test('interrupted jobs clean only their own UUID temporary files on restart', t => {
  const dir = directory(t), runtime = path.join(dir, 'runtime'); fs.mkdirSync(runtime); fs.writeFileSync(path.join(runtime, '2a7daa42-7340-8358-5e9b-472900a881d2.source'), 'partial'); fs.writeFileSync(path.join(runtime, 'keep.mp3'), 'keep');
  const downloads = new Downloads({ directory: path.join(dir, 'saved'), runtime, filename: path.join(dir, 'history.json'), source: {} }); assert.deepEqual(fs.readdirSync(runtime), ['keep.mp3']); t.after(() => downloads.dispose());
});
test('HLS parser accepts finite playlists, preserves ranges, and rejects untrusted/DRM/live sources', () => {
  const base = 'https://cf-hls-media.sndcdn.com/test/list.m3u8';
  const result = parsePlaylist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2,\n#EXT-X-BYTERANGE:16@0\naudio.mp3\n#EXTINF:2,\n#EXT-X-BYTERANGE:16\naudio.mp3\n#EXT-X-ENDLIST', base);
  assert.equal(result.duration, 4); assert.equal(result.segments[1].range.offset, 16); assert.equal(result.segments[1].sequence, 8n);
  assert.throws(() => parsePlaylist('#EXTM3U\n#EXTINF:2,\naudio.mp3', base), /эфиров/);
  assert.throws(() => parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n', base), /защищённый/);
  for (const url of ['http://cf-media.sndcdn.com/a', 'https://sndcdn.com.evil.test/a', 'https://127.0.0.1/a', 'https://user:pass@cf-media.sndcdn.com/a']) assert.throws(() => mediaUrl(url));
  assert.equal(mediaUrl('https://playback.media-streaming.soundcloud.cloud/audio'), 'https://playback.media-streaming.soundcloud.cloud/audio');
  assert.throws(() => mediaUrl('https://playback.media-streaming.soundcloud.cloud.evil.test/audio'));
});
test('HLS source saves complete ordinary AES-128 segments without persisting signed URLs or keys', async t => {
  const dir = directory(t), key = Buffer.alloc(16, 1), iv = Buffer.alloc(16), original = Buffer.alloc(160, 30); iv[15] = 7;
  const encrypt = createCipheriv('aes-128-cbc', key, iv), encoded = Buffer.concat([encrypt.update(original), encrypt.final()]);
  const raw = { kind: 'track', permalink_url: song.url, title: song.title, duration: 2000, user: { username: song.artist }, policy: 'ALLOW', media: { transcodings: [{ url: 'https://api-v2.soundcloud.com/media/test', duration: 2000, format: { protocol: 'hls', mime_type: 'audio/mpeg' } }] } };
  const fetcher = async url => { if (url.startsWith('https://api-v2')) return Response.json({ url: 'https://media.sndcdn.com/list?signature=private' }); if (url.includes('/list?')) return new Response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI="https://media.sndcdn.com/key"\n#EXTINF:2,\nhttps://media.sndcdn.com/audio\n#EXT-X-ENDLIST'); return new Response(url.endsWith('/key') ? key : encoded); };
  const source = new SoundCloudAudioSource({ request: async () => raw, clientId: async () => 'public-client' }, fetcher), output = path.join(dir, 'audio.source');
  const result = await source.save(song.url, output, { signal: new AbortController().signal }); assert.equal(result.mp3, true); assert.deepEqual(fs.readFileSync(output), original); assert.ok(!JSON.stringify(result).includes('signature'));
  raw.policy = 'SNIP'; await assert.rejects(source.save(song.url, path.join(dir, 'preview'), { signal: new AbortController().signal }), /отрывок/); assert.equal(fs.existsSync(path.join(dir, 'preview')), false);
});
test('MONETIZE tracks with downloads disabled choose the full AAC stream instead of the adaptive playlist', async t => {
  const dir = directory(t), requested = [], raw = { kind: 'track', permalink_url: song.url, title: song.title, duration: 2000, full_duration: 2000, user: { username: song.artist }, policy: 'MONETIZE', downloadable: false, media: { transcodings: [
    { preset: 'abr_sq', duration: 2000, format: { protocol: 'hls', mime_type: 'audio/mpegurl' }, url: 'https://api-v2.soundcloud.com/media/abr' },
    { preset: 'aac_96k', duration: 2000, format: { protocol: 'hls', mime_type: 'audio/mp4' }, url: 'https://api-v2.soundcloud.com/media/low' },
    { preset: 'aac_160k', duration: 2000, format: { protocol: 'hls', mime_type: 'audio/mp4' }, url: 'https://api-v2.soundcloud.com/media/high' },
  ] } };
  const source = new SoundCloudAudioSource({ request: async () => raw, clientId: async () => 'client' }, async url => {
    requested.push(url); if (url.startsWith('https://api-v2')) return Response.json({ url: 'https://media.sndcdn.com/list' });
    return url.endsWith('/list') ? new Response('#EXTM3U\n#EXTINF:2,\naudio\n#EXT-X-ENDLIST') : new Response(Buffer.alloc(256, 1));
  });
  const result = await source.save(song.url, path.join(dir, 'audio'), { signal: new AbortController().signal }); assert.ok(requested[0].includes('/high?')); assert.equal(result.mp3, false); assert.equal(fs.statSync(path.join(dir, 'audio')).size, 256);
});
test('an unavailable or malformed stream falls back to another full format and cleans partial bytes', async t => {
  const dir = directory(t), raw = { kind: 'track', permalink_url: song.url, title: song.title, duration: 2000, user: { username: song.artist }, policy: 'MONETIZE', media: { transcodings: [256, 160].map(rate => ({ preset: 'aac_' + rate + 'k', duration: 2000, format: { protocol: 'hls', mime_type: 'audio/mp4' }, url: 'https://api-v2.soundcloud.com/media/' + rate })) } };
  const source = new SoundCloudAudioSource({ request: async () => raw, clientId: async () => 'client' }, async url => {
    if (url.startsWith('https://api-v2')) return Response.json({ url: 'https://media.sndcdn.com/' + (url.includes('/256?') ? 'broken' : 'list') });
    if (url.endsWith('/broken')) return new Response('not an audio playlist');
    return url.endsWith('/list') ? new Response('#EXTM3U\n#EXTINF:2,\naudio\n#EXT-X-ENDLIST') : new Response(Buffer.alloc(256, 2));
  });
  const output = path.join(dir, 'audio'); await source.save(song.url, output, { signal: new AbortController().signal }); assert.deepEqual(fs.readFileSync(output), Buffer.alloc(256, 2));
  raw.media.transcodings = [{ ...raw.media.transcodings[0], url: 'https://evil.test/stream' }];
  await assert.rejects(source.save(song.url, output, { signal: new AbortController().signal }), /источник/); assert.deepEqual(fs.readFileSync(output), Buffer.alloc(256, 2), 'Never remove a pre-existing file after a failure before opening it.');
});
test('session access is used only with the SoundCloud API and is never sent to media CDNs or returned in metadata', async t => {
  const dir = directory(t), raw = { kind: 'track', permalink_url: song.url, title: song.title, duration: 2000, user: { username: song.artist }, policy: 'MONETIZE', media: { transcodings: [{ preset: 'aac_160k', duration: 2000, format: { protocol: 'hls', mime_type: 'audio/mp4' }, url: 'https://api-v2.soundcloud.com/media/track' }] } }, fakeToken = 'test-existing-user-session'; let apiCalls = 0;
  const source = new SoundCloudAudioSource({ async request(endpoint, params, options) { assert.equal(options.headers.Authorization, 'OAuth ' + fakeToken); return raw; }, clientId: async () => 'client' }, async (url, options) => {
    if (url.startsWith('https://api-v2')) { apiCalls++; assert.equal(options.headers.Authorization, 'OAuth ' + fakeToken); assert.equal(options.redirect, 'error'); return Response.json({ url: 'https://media.sndcdn.com/list' }); }
    assert.ok(!Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)));
    return url.endsWith('/list') ? new Response('#EXTM3U\n#EXTINF:2,\naudio\n#EXT-X-ENDLIST') : new Response(Buffer.alloc(256, 3));
  }, { session: { cookies: { async get(filter) { assert.equal(filter.name, 'oauth_token'); return [{ value: fakeToken }]; } } } });
  const result = await source.save(song.url, path.join(dir, 'audio'), { signal: new AbortController().signal }); assert.equal(apiCalls, 1); assert.ok(!JSON.stringify(result).includes(fakeToken));
});
test('expired session access retries public tracks anonymously and never saves previews as complete songs', async t => {
  const dir = directory(t); let calls = 0;
  const raw = { kind: 'track', permalink_url: song.url, title: song.title, duration: 30000, full_duration: 180000, user: { username: song.artist }, policy: 'ALLOW', media: { transcodings: [{ duration: 30000, format: { protocol: 'hls', mime_type: 'audio/mp4' }, url: 'https://api-v2.soundcloud.com/media/preview' }] } };
  const source = new SoundCloudAudioSource({ async request(endpoint, params, options) { calls++; if (calls === 1) { const error = new Error('expired'); error.status = 401; throw error; } assert.equal(options.headers, undefined); return raw; } }, () => { throw Error('Must not download a preview.'); }, { session: { cookies: { get: async () => [{ value: 'expired-session' }] } } });
  await assert.rejects(source.save(song.url, path.join(dir, 'preview'), { signal: new AbortController().signal }), /полный/); assert.equal(calls, 2); assert.equal(fs.existsSync(path.join(dir, 'preview')), false);
});
