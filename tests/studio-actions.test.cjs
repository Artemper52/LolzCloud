'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events'), { createRequire } = require('node:module');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-studio-actions-'));
  const handlers = new Map(), keys = new Map(), sent = [];
  const app = new EventEmitter(); app.getPath = () => directory;
  const host = { webContents: { send: (...args) => sent.push(args), isDestroyed: () => false }, isDestroyed: () => false };
  const electron = {
    app, screen: new EventEmitter(), ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    globalShortcut: { register: (key, handler) => (keys.set(key, handler), true), unregister: key => keys.delete(key) },
    safeStorage: {}, session: { defaultSession: {}, fromPartition: () => ({ cookies: { set: async () => {} } }) }, shell: {},
  };
  const filename = path.resolve(__dirname, '../source/integrations/studio.cjs'), originalRequire = createRequire(filename);
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), fetch, console, Buffer,
    require(name) {
      if (name === 'electron') return electron;
      if (name === './room.cjs' && options.room) return { ListeningRoom: class { constructor() { return options.room; } } };
      if (name === './audio-ducker.cjs') return { AudioDucker: class { start() {} dispose() {} state() { return {}; } config() { return {}; } } };
      return originalRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const service = new LolzteamService({ store: { load: () => null, save() {} }, api: {} });
  const studio = sandbox.module.exports.createStudio({ app, service, getWindow: () => host, trusted: () => true });
  t.after(async () => {
    await studio.shutdown();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('LolzCloud-studio-actions-')) fs.rmSync(directory, { recursive: true, force: true });
  });
  return { studio, service, keys, sent, directory };
}

test('volume hotkeys update the audible command, both players and the saved volume together', async t => {
  const { studio, keys, sent, directory } = fixture(t);
  await studio.act({ type: 'player', settings: { volume: .4 } });
  keys.get('Control+Alt+Down')();
  assert.ok(Math.abs(studio.getState().player.volume - .35) < 1e-9);
  assert.equal(sent.at(-1)[0], 'lolzcloud:media');
  assert.equal(sent.at(-1)[1].command, 'volume');
  assert.ok(Math.abs(sent.at(-1)[1].value - .35) < 1e-9);
  keys.get('Control+Alt+Up')();
  assert.ok(Math.abs(new MusicFeatures(path.join(directory, 'music-library.json')).data.player.volume - .4) < 1e-9);
  await studio.act({ type: 'player', settings: { volume: 0 } });
  keys.get('Control+Alt+Down')();
  assert.equal(studio.getState().player.volume, 0);
});

test('footer, mini and hotkey transport return to actual previous tracks without restarting the current one', async t => {
  const { studio, service, sent, keys } = fixture(t);
  const song = id => ({ url: 'https://soundcloud.com/fixture/song-' + id, title: 'Song ' + id, artist: 'Artist', duration: 100, position: 70, playing: true });
  const accept = value => { const allowed = studio.acceptSoundCloud(value); if (allowed) service.setPlayback(value); return allowed; };
  [1, 2, 3].forEach(id => accept(song(id)));
  await studio.act({ type: 'media', command: 'previous' });
  assert.equal(sent.at(-1)[0], 'lolzcloud:play-url'); assert.equal(sent.at(-1)[1].url, song(2).url);
  assert.equal(service.displayPlayback().url, song(2).url);
  await studio.act({ type: 'media', command: 'previous' }); assert.equal(sent.at(-1)[1].url, song(1).url);
  assert.equal(accept(song(2)), false); assert.equal(accept(song(3)), false); assert.equal(accept(song(1)), true);
  await studio.act({ type: 'media', command: 'next' }); assert.equal(sent.at(-1)[1].url, song(2).url);
  accept(song(2)); keys.get('Control+Alt+Left')(); assert.equal(sent.at(-1)[1].url, song(1).url);
});

test('a failed room start temporarily restores original transport without overwriting personal tone or tempo', async t => {
  let failStart;
  const room = {
    origin: 'https://lolzcloud.com', room: null, lease: '', user: null,
    getState() { return { authenticated: true, hosting: false, active: false, queue: [], settings: {} }; },
    start() { return new Promise((_resolve, reject) => { failStart = reject; }); },
    dispose: async () => {},
  };
  const { studio, service, sent } = fixture(t, { room });
  await studio.act({ type: 'dsp', settings: { rate: 1.5, pitch: .75, transportEnabled: true, enabled: false, preservesPitch: true } });
  service.setPlayback({ title: 'Room source fixture', artist: 'Fixture artist', url: 'https://soundcloud.com/fixture/room-transport', duration: 100, position: 10, playing: true, rate: 1 });
  const broadcast = studio.act({ type: 'room-broadcast' });
  assert.equal(studio.getState().room.audioLocked, true);
  const temporary = sent.filter(value => value[0] === 'lolzcloud:dsp').at(-1)[1];
  assert.equal(temporary.rate, 1); assert.equal(temporary.pitch, 1);
  assert.equal(studio.getState().dsp.rate, 1.5); assert.equal(studio.getState().dsp.pitch, .75);
  failStart(new Error('Synthetic room network failure'));
  await assert.rejects(broadcast, /Synthetic room network failure/);
  assert.equal(studio.getState().room.audioLocked, false);
  const restored = sent.filter(value => value[0] === 'lolzcloud:dsp').at(-1)[1];
  assert.equal(restored.rate, 1.5); assert.equal(restored.pitch, .75); assert.equal(restored.enabled, false);
  assert.equal(studio.getState().dsp.rate, 1.5); assert.equal(studio.getState().dsp.pitch, .75);
});
