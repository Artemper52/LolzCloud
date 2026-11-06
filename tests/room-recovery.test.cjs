'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { ListeningRoom } = require('../source/integrations/room.cjs');

test('pairing recovers from a network timeout and clears an expired attempt', async t => {
  let result = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const room = new ListeningRoom(() => ({}), { fetcher: async () => {
    if (result instanceof Error) throw result;
    return Response.json(result.body, { status: result.status });
  } });
  clearInterval(room.timer); t.after(() => room.dispose());
  const pair = room.pair = { expires: Date.now() + 60000, code: 'fixture-code', deviceCode: 'd'.repeat(43) };
  await room.tick();
  assert.match(room.getState().error, /Повторяем подключение автоматически/);
  assert.equal(room.getState().connecting, true);
  result = { body: { pending: true }, status: 200 }; pair.nextPoll = 0;
  await room.tick();
  assert.equal(room.getState().error, '');
  result = { body: { error: 'Подключение истекло.' }, status: 410 }; pair.nextPoll = 0;
  await room.tick();
  assert.equal(room.getState().connecting, false);
  assert.equal(room.getState().code, '');
  assert.equal(room.getState().error, 'Подключение истекло.');
});

for (const failure of ['storage', 'session']) test('a paired desktop resumes room creation after a temporary ' + failure + ' failure', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-room-recovery-'));
  let available = failure !== 'storage', sessionFailures = failure === 'session' ? 1 : 0, created = 0, opened = 0;
  const id = 'a'.repeat(32), roomState = { id, url: 'https://lolzcloud.com/room/' + id + '/', participants: [], viewers: 0 };
  const room = new ListeningRoom(() => ({ fresh: false, private: false, playback: {} }), {
    filename: path.join(directory, 'session.json'),
    safeStorage: { getSelectedStorageBackend: () => 'gnome_libsecret', isEncryptionAvailable: () => available, encryptString: value => Buffer.from('fixture:' + value), decryptString: value => value.toString().slice(8) },
    openExternal: async () => { opened++; },
    fetcher: async (url, options) => {
      if (url.endsWith('/api/desktop/start')) return Response.json({ code: 'c'.repeat(12), deviceCode: 'd'.repeat(43), verificationUrl: 'https://lolzcloud.com/connect?code=' + 'c'.repeat(12), expiresIn: 600 });
      if (url.endsWith('/api/desktop/poll')) return Response.json({ pending: false, token: 't'.repeat(43), expires: Date.now() + 60000, user: { id: 1, name: 'Fixture' } });
      if (url.endsWith('/api/session')) {
        if (sessionFailures-- > 0) return Response.json({ error: 'Fixture temporary failure' }, { status: 503 });
        return Response.json({ authenticated: true, spicyAvailable: true });
      }
      if (url.endsWith('/api/rooms') && options.method === 'POST') { created++; return Response.json(roomState); }
      return Response.json(roomState);
    },
  });
  clearInterval(room.timer);
  t.after(async () => {
    await room.dispose();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('lolzcloud-room-recovery-')) fs.rmSync(directory, { recursive: true, force: true });
  });
  await room.start();
  await room.tick();
  assert.equal(room.getState().authenticated, true);
  assert.equal(room.getState().connecting, false);
  assert.equal(room.getState().active, false);
  available = true;
  await room.tick();
  assert.equal(room.getState().active, true);
  assert.equal(room.getState().spicyAvailable, true);
  assert.equal(room.getState().error, '');
  await room.tick();
  assert.equal(created, 1);
  assert.equal(opened, 1);
});

test('cancelling while a deferred room start is checking the session cannot revive the room', async t => {
  let resolveSession, created = 0;
  const room = new ListeningRoom(() => ({}), { fetcher: async (url) => {
    if (url.endsWith('/api/session')) return new Promise(resolve => { resolveSession = () => resolve(Response.json({ authenticated: true })); });
    created++; return Response.json({});
  } });
  clearInterval(room.timer); t.after(() => room.dispose());
  room.token = 't'.repeat(43); room.expires = Date.now() + 60000; room.wantStart = true;
  const pending = room.tick();
  await room.stop(); resolveSession(); await pending;
  assert.equal(room.getState().active, false);
  assert.equal(room.wantStart, false);
  assert.equal(created, 0);
});

test('a slow room creation is shared and a room closed elsewhere stays closed', async t => {
  let created = 0, finishCreate, closed = false;
  const id = 'a'.repeat(32), state = { id, url: 'https://lolzcloud.com/room/' + id + '/' };
  const room = new ListeningRoom(() => ({}), { fetcher: async (url, options) => {
    if (url.endsWith('/api/rooms') && options.method === 'POST') {
      created++;
      return new Promise(resolve => { finishCreate = () => resolve(Response.json(state)); });
    }
    if (closed) return Response.json({ error: 'Комната закрыта' }, { status: 404 });
    return Response.json(state);
  } });
  clearInterval(room.timer); t.after(() => room.dispose());
  room.token = 't'.repeat(43); room.expires = Date.now() + 60000;
  const first = room.start(), second = room.start();
  await room.tick();
  assert.equal(created, 1);
  finishCreate();
  await Promise.all([first, second]);
  closed = true;
  await room.tick();
  await room.tick();
  assert.equal(room.getState().active, false);
  assert.equal(created, 1);
});
