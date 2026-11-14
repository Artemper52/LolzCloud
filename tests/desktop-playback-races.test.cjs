'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { LocalLibrary } = require('../source/integrations/local-library.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function emitter() { const target = new EventEmitter(); target.addEventListener = target.on.bind(target); target.dispatchEvent = event => target.emit(event.type, event); return target; }
function localRenderer() {
  const resume = deferred(), ipc = new EventEmitter(), window = emitter(); ipc.send = () => {};
  const audio = Object.assign(emitter(), { paused: true, ended: false, duration: 120, currentTime: 0, playCalls: 0,
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }, load() {}, removeAttribute() {} });
  const param = () => ({ value: 0, setTargetAtTime() {} }), node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), delayTime: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  let resumeCalls = 0;
  class AudioContext {
    sampleRate = 100; currentTime = 0; destination = node();
    createMediaElementSource() { return node(); } createBiquadFilter() { return node(); } createGain() { return node(); }
    createDelay() { return node(); } createConvolver() { return node(); } createDynamicsCompressor() { return node(); }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    resume() { resumeCalls++; return resume.promise; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/app/lib/js/local-player.js'), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { ipcRenderer: ipc }; }, document: { createElement: () => audio, body: { append() {} } }, window, AudioContext, setInterval() {},
  });
  return { audio, ipc, resume, window, resumeCalls: () => resumeCalls };
}
test('a local pause cancels a play still waiting for the audio device', async () => {
  const fixture = localRenderer(); fixture.ipc.emit('lolzcloud:local-play', {}, { id: 'a'.repeat(32), token: 1, source: 'file:///fixture.mp3', volume: 1 });
  await flush(); assert.equal(fixture.resumeCalls(), 1, 'Playback reached the asynchronous device resume');
  fixture.ipc.emit('lolzcloud:local-media', {}, { command: 'pause' }); fixture.resume.resolve(); await flush();
  assert.equal(fixture.audio.playCalls, 0); assert.equal(fixture.audio.paused, true);
});
test('a local stop fences an older pending play', async () => {
  const fixture = localRenderer(); fixture.ipc.emit('lolzcloud:local-play', {}, { id: 'a'.repeat(32), token: 1, source: 'file:///fixture.mp3', volume: 1 });
  await flush(); fixture.ipc.emit('lolzcloud:local-stop'); fixture.resume.resolve(); await flush();
  assert.equal(fixture.audio.playCalls, 0); assert.equal(fixture.window.LolzCloudLocal.current, null);
});
test('local play/pause toggles cancel preparation and resume the selected track once', async () => {
  const fixture = localRenderer(); fixture.ipc.emit('lolzcloud:local-play', {}, { id: 'a'.repeat(32), token: 1, source: 'file:///fixture.mp3', volume: 1 });
  await flush(); fixture.window.LolzCloudLocal.command({ command: 'playPause' }); fixture.resume.resolve(); await flush();
  assert.equal(fixture.audio.playCalls, 0); fixture.window.LolzCloudLocal.command({ command: 'playPause' }); await flush();
  assert.equal(fixture.audio.playCalls, 1); assert.equal(fixture.audio.paused, false);
});
function youtubeRenderer() {
  const ipc = new EventEmitter(), window = emitter(), sources = [], commits = [], intervals = [], elements = new Map(), sent = [];
  ipc.send = (channel, value) => sent.push({ channel, value }); ipc.invoke = async (_channel, value) => { if (value.type === 'playback-source') { sources.push(value.source); if (value.source === 'youtube') { const pending = deferred(); commits.push(pending); await pending.promise; } } };
  const element = () => Object.assign(emitter(), { hidden: true, disabled: false, append() {}, setAttribute() {}, focus() {}, close() {}, getURL: () => 'https://music.youtube.com/', executeJavaScript: async () => null, loadURL: async () => {} });
  const document = { body: { dataset: {} }, createElement: element, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
  window.lolzSelectNavigation = () => {}; window.LolzCloudStudio = { open() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/app/lib/js/youtube-music.js'), 'utf8'), {
    require: name => name === 'electron' ? { ipcRenderer: ipc } : name === 'node:fs' ? { readFileSync: () => '' } : name === 'node:path' ? path : name === './lib/js/media-source.js' ? require('../source/app/lib/js/media-source.js') : assert.fail(name),
    __dirname, document, window, URL, Event, setInterval: callback => intervals.push(callback), setTimeout,
  });
  return { ipc, window, sources, commits, intervals, elements, sent };
}
test('an older YouTube open cannot revert a newer source selection', async () => {
  const fixture = youtubeRenderer(), youtube = fixture.window.LolzCloudYouTube;
  const older = youtube.open(true); await flush(); assert.equal(fixture.commits.length, 1);
  const newer = youtube.open(true); await flush(); assert.equal(fixture.commits.length, 2);
  fixture.commits[1].resolve(); await newer; fixture.commits[0].resolve(); await older; await flush();
  assert.equal(youtube.active, true); assert.equal(fixture.sources.at(-1), 'youtube');
});
test('pausing a pending YouTube track prevents its delayed autoplay', async () => {
  const fixture = youtubeRenderer(), youtube = fixture.window.LolzCloudYouTube, opening = youtube.open(true);
  await flush(); fixture.commits[0].resolve(); await opening;
  const snapshot = deferred(), commands = [], url = 'https://music.youtube.com/watch?v=aaaaaaaaaaa'; let snapshots = 0;
  youtube.view.getURL = () => url;
  youtube.view.executeJavaScript = async code => {
    if (code.includes('snapshot()')) { snapshots++; return snapshot.promise; }
    if (code.includes('.command(')) { commands.push(JSON.parse('[' + code.split('.command(')[1].slice(0, -1) + ']')[0]); return true; }
    return null;
  };
  fixture.ipc.emit('lolzcloud:play-youtube', {}, { url }); await flush(); assert.equal(snapshots, 1);
  const paused = youtube.media('pause'); snapshot.resolve({ url, title: 'Fixture', duration: 120 }); await paused; await flush();
  assert.ok(commands.includes('pause')); assert.ok(!commands.includes('play'), 'A cancelled navigation must not start its track before pausing it');
});
test('leaving a pending YouTube open returns the authoritative source to SoundCloud', async () => {
  const fixture = youtubeRenderer(), youtube = fixture.window.LolzCloudYouTube, opening = youtube.open(true);
  await flush(); youtube.leave(); fixture.commits[0].resolve(); await opening; await flush();
  assert.equal(youtube.active, false); assert.equal(fixture.sources.at(-1), 'soundcloud');
});
test('YouTube polling drops old source samples and reads playback plus audio in one guest call', async () => {
  const fixture = youtubeRenderer(), youtube = fixture.window.LolzCloudYouTube, opening = youtube.open(true);
  await flush(); fixture.commits[0].resolve(); await opening;
  const sample = deferred(); youtube.view.executeJavaScript = () => sample.promise;
  const polling = fixture.intervals[0](); youtube.leave(); const reopened = youtube.open(true); await flush(); fixture.commits[1].resolve(); await reopened;
  sample.resolve({ playback: { url: 'https://music.youtube.com/watch?v=aaaaaaaaaaa', title: 'Old' }, audio: { available: true } }); await polling;
  assert.equal(fixture.sent.length, 0, 'Old asynchronous snapshots must not overwrite a reopened source');
  let calls = 0; youtube.view.executeJavaScript = async () => { calls++; return { playback: { url: 'https://music.youtube.com/watch?v=bbbbbbbbbbb', title: 'Current' }, audio: { available: true } }; };
  await fixture.intervals[0](); assert.equal(calls, 1); assert.deepEqual(fixture.sent.map(row => row.channel), ['youtube:playback', 'features:audio']);
});
test('repeat-all skips unavailable files across both ends of a local queue', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-desktop-races-'));
  t.after(() => { const resolved = path.resolve(directory); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-desktop-races-')) fs.rmSync(resolved, { recursive: true, force: true }); });
  const filenames = ['A.mp3', 'B.mp3', 'C.mp3'].map(name => path.join(directory, name)); filenames.forEach(file => fs.writeFileSync(file, Buffer.alloc(32)));
  const library = new LocalLibrary(path.join(directory, 'library.json'), directory), queue = library.import(filenames).map(row => row.id); library.repeat = 'all';
  library.play(queue[1], queue); fs.unlinkSync(filenames[2]); assert.equal(library.step(1)?.id, queue[0]);
  library.play(queue[1], queue); fs.writeFileSync(filenames[2], Buffer.alloc(32)); fs.unlinkSync(filenames[0]); assert.equal(library.step(-1)?.id, queue[2]);
  filenames.forEach(file => { if (fs.existsSync(file)) fs.unlinkSync(file); }); assert.equal(library.step(1), null);
  library.repeat = 'one'; assert.equal(library.step(1, true), null, 'A disconnected repeat-one file must stop without an exception');
  assert.doesNotThrow(() => library.duration(library.current, 120), 'A buffered track can still report metadata after its disk disappears');
});
