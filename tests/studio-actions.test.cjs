'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events'), { createRequire } = require('node:module');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-studio-actions-'));
  const handlers = new Map(), keys = new Map(), sent = [];
  const app = new EventEmitter(); app.getPath = () => directory;
  const host = { webContents: { send: (...args) => sent.push(args), isDestroyed: () => false }, isDestroyed: () => false };
  const electron = {
    app, screen: new EventEmitter(), ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    globalShortcut: { register: (key, handler) => (keys.set(key, handler), true), unregister: key => keys.delete(key) },
    safeStorage: {}, session: { defaultSession: {} }, shell: {},
  };
  const filename = path.resolve(__dirname, '../source/integrations/studio.cjs'), originalRequire = createRequire(filename);
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), fetch, console, Buffer,
    require(name) {
      if (name === 'electron') return electron;
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
  return { studio, keys, sent, directory };
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
