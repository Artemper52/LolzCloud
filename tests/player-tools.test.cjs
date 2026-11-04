'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { PlayerTools } = require('../source/integrations/player-tools.cjs');
const { LocalLibrary } = require('../source/integrations/local-library.cjs');
const { ReleaseRadar } = require('../source/integrations/release-radar.cjs');
const { normalizeProfile, exportProfile, encryptProfile, decryptProfile } = require('../source/integrations/portable-profile.cjs');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const { markPlayed } = require('../source/integrations/wave-history.cjs');
function temporary(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-player-tools-')); t.after(() => { const resolved = path.resolve(directory); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-player-tools-')) fs.rmSync(resolved, { recursive: true, force: true }); }); return directory; }
const track = { url: 'https://soundcloud.com/fixture/song', title: 'Song', artist: 'Artist', duration: 100 };
test('moment bookmarks persist exact positions and edits, reject invalid destinations and never expose local paths', t => {
  const directory = temporary(t), filename = path.join(directory, 'tools.json'), tools = new PlayerTools(filename);
  const row = tools.addBookmark({ ...track, position: 23.456, note: 'Припев' }); tools.addBookmark({ ...track, position: 23.46, note: 'Тот самый припев' });
  const next = new PlayerTools(filename); assert.equal(next.state().bookmarks.length, 1); assert.equal(next.state().bookmarks[0].position, 23.46); assert.equal(next.state().bookmarks[0].note, 'Тот самый припев');
  for (const url of ['file:///private/file.mp3', 'javascript:alert(1)', 'https://soundcloud.com.attacker.test/a/b']) assert.throws(() => next.addBookmark({ ...track, url, position: 1 }));
  next.removeBookmark(row.id); assert.equal(new PlayerTools(filename).state().bookmarks.length, 0);
});
test('confirmed reuploads close transitive groups and obey the existing 24-hour wave cooldown', t => {
  const tools = new PlayerTools(path.join(temporary(t), 'tools.json')), second = 'https://soundcloud.com/fixture/reupload', third = 'https://soundcloud.com/fixture/another';
  tools.group(track.url, second); tools.group(second, third); assert.equal(tools.data.groups.length, 1); assert.equal(tools.data.groups[0].length, 3);
  const cache = {}; markPlayed(track, cache, 100000); assert.equal(tools.duplicate({ url: third }, cache, 100010), true); assert.equal(tools.duplicate({ url: third }, cache, 100000 + 86400000), false);
  tools.ungroup(third); assert.equal(tools.duplicate({ url: third }, cache, 100010), false);
});
test('offline library imports bounded audio files, reads Unicode ID3 and navigates only registered files', t => {
  const directory = temporary(t), filename = path.join(directory, 'local.json'), audio = path.join(directory, 'Artist - Song.mp3');
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from('Мой трек')]), frame = Buffer.alloc(10); frame.write('TIT2'); frame.writeUInt32BE(payload.length, 4); const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, frame.length + payload.length]); fs.writeFileSync(audio, Buffer.concat([header, frame, payload, Buffer.alloc(32)]));
  const second = path.join(directory, 'Second.wav'); fs.writeFileSync(second, Buffer.alloc(100)); const script = path.join(directory, 'ignored.exe'); fs.writeFileSync(script, 'no');
  const library = new LocalLibrary(filename, directory); library.import([audio, second, script]); assert.equal(library.tracks.length, 2); assert.equal(library.tracks.find(row => row.path === audio).title, 'Мой трек'); assert.ok(library.state().tracks.every(row => !Object.hasOwn(row, 'path')));
  const id = library.tracks.find(row => row.path === audio).id; const played = library.play(id); assert.ok(played.source.startsWith('file:')); assert.equal(played.url, 'lolzcloud-local://' + id); assert.throws(() => library.play('../../other'));
  library.repeat = 'one'; assert.equal(library.step(1, true).id, id); library.duration(id, 42.5); assert.equal(new LocalLibrary(filename, directory).get(id).duration, 42.5);
  library.remove(id); assert.equal(fs.existsSync(audio), true, 'Removing from the library must not delete the music file.');
});
test('portable profiles export preferences without login data, file paths or private listening history', t => {
  const directory = temporary(t), music = new MusicFeatures(path.join(directory, 'music.json')), tools = new PlayerTools(path.join(directory, 'tools.json'));
  music.data.token = 'private-token'; music.data.history.push({ ...track, seconds: 20, playedAt: Date.now() }); music.addCollection(track); tools.addBookmark({ ...track, position: 12 }); tools.addBookmark({ ...track, url: 'lolzcloud-local://' + 'a'.repeat(32), position: 5 });
  const wave = { data: { likes: [track], feedback: {}, preferences: {}, played24h: {}, adventurous: .35 } }, profile = exportProfile(music, wave, tools), serialized = JSON.stringify(profile);
  assert.ok(!serialized.includes('private-token')); assert.ok(!serialized.includes('history')); assert.ok(!serialized.includes('lolzcloud-local')); assert.equal(profile.tools.bookmarks.length, 1); assert.equal(profile.music.collections.length, 1);
  assert.throws(() => normalizeProfile({ ...profile, version: 55 })); assert.throws(() => normalizeProfile({ ...profile, tools: { bookmarks: [{ url: 'file:///private/file', position: 0 }] } }));
});
test('cloud copies use authenticated encryption and wrong passwords or altered ciphertext cannot import data', async () => {
  const value = normalizeProfile({ format: 'lolzcloud-profile', version: 1 }), encrypted = await encryptProfile(value, 'a long private passphrase');
  assert.ok(!JSON.stringify(encrypted).includes('collections')); const restored = await decryptProfile(encrypted, 'a long private passphrase'); assert.equal(restored.format, value.format);
  await assert.rejects(decryptProfile(encrypted, 'a different private passphrase')); const bytes = Buffer.from(encrypted.ciphertext, 'base64'); bytes[0] ^= 1; await assert.rejects(decryptProfile({ ...encrypted, ciphertext: bytes.toString('base64') }, 'a long private passphrase'));
});
test('release radar uses uploads rather than reposts, keeps good results after partial failures and remembers heard songs', async t => {
  const directory = temporary(t), discovery = { resolve: async url => ({ id: url.endsWith('broken') ? 2 : 1, kind: 'user', username: url.split('/').pop() }), request: async endpoint => { if (endpoint.includes('/2/')) throw new Error('temporary'); return { collection: [{ kind: 'track', id: 9, permalink_url: track.url, title: track.title, user: { username: track.artist }, duration: 100000, created_at: new Date().toISOString() }] }; } };
  const radar = new ReleaseRadar(path.join(directory, 'radar.json'), discovery); await radar.follow('https://soundcloud.com/fixture'); await radar.follow('https://soundcloud.com/broken'); await radar.refresh(); assert.equal(radar.state().tracks.length, 1); assert.ok(radar.state().error.includes('broken')); assert.equal(radar.busy, false); radar.heard(track.url); assert.equal(new ReleaseRadar(radar.filename, discovery).state().tracks.length, 0); await assert.rejects(radar.follow('https://example.test/artist'));
});
function meter(amplitude, seconds = 12, inputVolume = 1) {
  const classes = {}, messages = [], sampleRate = 48000, context = { sampleRate, currentTime: 0, Float32Array, Float64Array, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } }, registerProcessor: (name, value) => { classes[name] = value; } };
  vm.createContext(context); vm.runInContext(require('../source/plugins/normalization-worklet.js').source, context); const processor = new classes['lolzcloud-normalization'](); processor.port.onmessage({ data: { enabled: true, key: track.url, inputVolume } });
  const input = new Float32Array(128), output = [new Float32Array(128), new Float32Array(128)]; let energy = 0, count = 0;
  for (let frame = 0; frame < sampleRate * seconds; frame += 128) { for (let i = 0; i < input.length; i++) input[i] = amplitude * Math.sin((frame + i) * 2 * Math.PI * 1000 / sampleRate); processor.process([[input]], [output]); if (frame > sampleRate * (seconds - 1)) for (const value of output[0]) { assert.ok(Number.isFinite(value)); energy += value * value; count++; } }
  return { processor, messages, energy: energy / Math.max(1, count), output };
}
test('real normalization processor increases quiet music, lowers loud music, preserves mono channels and ignores silence', () => {
  const quiet = meter(.04), loud = meter(.7), silence = meter(0, 4); assert.ok(quiet.processor.targetDb > 3); assert.ok(loud.processor.targetDb < -3); assert.ok(quiet.energy > .04 ** 2 / 2); assert.ok(loud.energy < .7 ** 2 / 2); assert.equal(silence.energy, 0); assert.ok(quiet.messages.some(row => row.measured)); assert.deepEqual(quiet.output[0], quiet.output[1]);
  const loweredVolume = meter(.07, 12, .1); assert.ok(Math.abs(loweredVolume.processor.targetDb - loud.processor.targetDb) < .001, 'User volume must not be cancelled by automatic gain');
});
