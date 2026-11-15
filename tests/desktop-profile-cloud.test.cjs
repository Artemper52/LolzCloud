'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire, wrap } = require('node:module');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const { ListeningRoom } = require('../source/integrations/room.cjs');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const portable = require('../source/integrations/portable-profile.cjs');
const PASSPHRASE = 'Isolated desktop cloud fixture';
const profile = title => portable.normalizeProfile({ format: 'lolzcloud-profile', version: 1, music: { collections: [{ id: 'fixture-' + title, title, url: 'https://soundcloud.com/fixture/' + title.toLowerCase(), addedAt: 1 }] } });
function gate() {
  let arrived, release; const entered = new Promise(resolve => { arrived = resolve; }), completed = new Promise(resolve => { release = resolve; });
  return { entered, release, async wait() { arrived(); await completed; } };
}
function factory(hooks) {
  // Keep real normalization/scrypt/AES. The test gates only suspend completion
  // of actual crypto so an account change is deterministic at that await.
  const filename = path.resolve(__dirname, '../source/integrations/player-experience.cjs'), requireFrom = createRequire(filename), module = { exports: {} };
  const crypto = { ...portable,
    async encryptProfile(...args) { const value = await portable.encryptProfile(...args); await hooks.afterEncrypt?.(); return value; },
    async decryptProfile(...args) { const value = await portable.decryptProfile(...args); await hooks.afterDecrypt?.(); return value; },
  };
  vm.runInThisContext(wrap(fs.readFileSync(filename, 'utf8')), { filename })(module.exports,
    name => name === './portable-profile.cjs' ? crypto : requireFrom(name), module, filename, path.dirname(filename));
  return module.exports.createPlayerExperience;
}
async function fixture(t, { seeded = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-desktop-cloud-')), store = new CloudStore({ filename: path.join(directory, 'sessions.json') });
  const server = createServer({ store }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, alice = store.login({ id: 701, name: 'Fixture A' }), bob = store.login({ id: 702, name: 'Fixture B' });
  const hooks = {}, requests = [], dialogs = [], events = []; let confirmResponse = 0;
  async function direct(identity, method = 'GET', body) {
    const response = await fetch(origin + '/api/profile', { method, headers: { Authorization: 'Bearer ' + identity.secret, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); assert.equal(response.status, 200); return value;
  }
  const room = new ListeningRoom(() => ({}), { origin, fetcher: async (url, options) => {
    requests.push({ method: options.method, owner: options.headers.Authorization === 'Bearer ' + alice.secret ? alice.user.id : options.headers.Authorization === 'Bearer ' + bob.secret ? bob.user.id : 'refreshed-session' });
    let response = await fetch(url, options);
    if (options.method === 'GET') { await hooks.afterGET?.(); if (hooks.getResponse) response = await hooks.getResponse(response); }
    if (options.method === 'PUT') { await hooks.afterPUT?.(); if (hooks.putResponse) response = await hooks.putResponse(response); }
    return response;
  } });
  clearInterval(room.timer);
  function identity(value) { room.token = value?.secret || ''; room.user = value?.user || null; room.expires = value?.expires || 0; }
  identity(alice);
  const initial = profile('Local'), music = new MusicFeatures(path.join(directory, 'music.json')); Object.assign(music.data, initial.music); music.save(true);
  const wave = { data: initial.wave, stop() {}, save() { fs.writeFileSync(path.join(directory, 'wave.json'), JSON.stringify(this.data)); } };
  const playback = { url: '', title: '', artist: '', duration: 0, position: 0, playing: false };
  const experience = factory(hooks)({ app: { getPath: () => directory }, service: { displayPlayback: () => playback, getState: () => ({ playback, fresh: false }) }, music, wave,
    lyrics: {}, room, discovery: {}, downloads: { directory }, media: async () => {}, play: async () => {}, getWindow: () => ({ webContents: { send: channel => events.push(channel) } }), notify() {},
    dialog: { async showMessageBox() { dialogs.push('confirm'); await hooks.confirm?.(); return { response: confirmResponse }; } }, clipboard: {} });
  if (seeded) for (const [who, title] of [[alice, 'Alice'], [bob, 'Bob']]) await direct(who, 'PUT', { revision: 0, envelope: await portable.encryptProfile(profile(title), PASSPHRASE) });
  const state = () => ({ music: structuredClone(music.data), wave: structuredClone(wave.data), tools: experience.tools.state() });
  const backups = () => fs.existsSync(path.join(directory, 'profile-backups')) ? fs.readdirSync(path.join(directory, 'profile-backups')).length : 0;
  t.after(async () => {
    await experience.shutdown(); await room.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(directory); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('LolzCloud-desktop-cloud-')) throw Error('Unexpected fixture path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, store, alice, bob, room, music, experience, hooks, requests, dialogs, events, direct, state, backups,
    select(value, observe = true) { identity(value); if (observe) experience.state(); }, confirm(value) { confirmResponse = value; },
    act(type) { return experience.act({ type: 'profile-' + type, passphrase: PASSPHRASE }); },
  };
}

test('desktop cloud revision belongs to its exact account/session, not another owner with the same revision', async t => {
  const f = await fixture(t); await f.act('pull'); assert.equal(f.experience.state().cloudRevision, 1);
  f.select(f.bob); assert.equal(f.experience.state().cloudRevision, null); const before = await f.direct(f.bob);
  await assert.rejects(f.act('push'), /Сначала открой актуальную копию/);
  assert.deepEqual(await f.direct(f.bob), before); assert.equal(f.requests.filter(row => row.method === 'PUT').length, 0);
  await f.act('pull'); await f.act('push'); const loaded = await f.direct(f.bob);
  assert.equal(loaded.revision, 2); assert.equal((await portable.decryptProfile(loaded.envelope, PASSPHRASE)).music.collections[0].title, 'Bob');
});
test('late real HTTP GET from A cannot restore or authorize a write after switching to B', async t => {
  const f = await fixture(t), g = gate(), before = f.state(); f.hooks.afterGET = () => g.wait();
  const task = f.act('pull'), rejected = assert.rejects(task, /Аккаунт или сессия изменились/); await g.entered;
  f.select(f.bob); g.release(); await rejected;
  assert.deepEqual(f.state(), before); assert.equal(f.dialogs.length, 0); assert.equal(f.backups(), 0); assert.equal(f.experience.state().profileBusy, false);
});
test('account change during actual decryption discards A before showing a confirmation', async t => {
  const f = await fixture(t), g = gate(), before = f.state(); f.hooks.afterDecrypt = () => g.wait();
  const rejected = assert.rejects(f.act('pull'), /Аккаунт или сессия изменились/); await g.entered;
  f.select(f.bob); g.release(); await rejected; assert.deepEqual(f.state(), before); assert.equal(f.dialogs.length, 0); assert.equal(f.backups(), 0);
});
test('account change while confirmation is open rejects the stale restore without touching local data', async t => {
  const f = await fixture(t), g = gate(), before = f.state(); f.hooks.confirm = () => g.wait();
  const rejected = assert.rejects(f.act('pull'), /Аккаунт или сессия изменились/); await g.entered;
  f.select(f.bob); g.release(); await rejected; assert.deepEqual(f.state(), before); assert.equal(f.backups(), 0); assert.equal(f.experience.state().cloudRevision, null);
});
test('pull rereads the current server revision after confirmation and cannot apply a now obsolete copy', async t => {
  const f = await fixture(t), g = gate(), before = f.state(); f.hooks.confirm = () => g.wait();
  const rejected = assert.rejects(f.act('pull'), /изменилась во время подтверждения/); await g.entered;
  await f.direct(f.alice, 'PUT', { revision: 1, envelope: await portable.encryptProfile(profile('NewAlice'), PASSPHRASE) });
  g.release(); await rejected; assert.deepEqual(f.state(), before); assert.equal(f.backups(), 0); assert.equal(f.requests.length, 2); assert.equal(f.experience.state().cloudRevision, null);
});
test('same owner/new token refresh invalidates its old proof, whereas same token/session metadata refresh stays usable', async t => {
  const f = await fixture(t); await f.act('pull');
  f.select({ ...f.alice, user: { ...f.alice.user, name: 'Refreshed display name' }, expires: f.alice.expires + 1000 });
  assert.equal(f.experience.state().cloudRevision, 1); await f.act('push'); assert.equal(f.experience.state().cloudRevision, 2);
  f.select(f.store.login({ id: f.alice.user.id, name: 'Same owner/new session' })); assert.equal(f.experience.state().cloudRevision, null);
  await assert.rejects(f.act('push'), /Сначала открой актуальную копию/); assert.equal((await f.direct(f.alice)).revision, 2);
});
test('same-owner token refresh during encryption cannot send the prepared envelope under the replacement token', async t => {
  const f = await fixture(t), g = gate(); await f.act('pull'); f.hooks.afterEncrypt = () => g.wait();
  const rejected = assert.rejects(f.act('push'), /Аккаунт или сессия изменились/); await g.entered;
  f.select(f.store.login({ id: f.alice.user.id, name: 'Refreshed token' })); g.release(); await rejected;
  assert.equal(f.requests.filter(row => row.method === 'PUT').length, 0); assert.equal((await f.direct(f.alice)).revision, 1); assert.equal(f.experience.state().cloudRevision, null);
});
test('logout/login ABA invalidates the pending generation even when the old fixture token is restored', async t => {
  const f = await fixture(t), g = gate(), before = f.state(); f.hooks.confirm = () => g.wait();
  const rejected = assert.rejects(f.act('pull'), /Аккаунт или сессия изменились/); await g.entered;
  f.select(null); assert.equal(f.experience.state().cloudRevision, null); f.select(f.alice); g.release(); await rejected;
  assert.deepEqual(f.state(), before); assert.equal(f.backups(), 0);
});
test('GET ownerId mismatch is rejected before decrypt/confirmation and local profile remains intact', async t => {
  const f = await fixture(t), before = f.state(); f.hooks.getResponse = async response => new Response(JSON.stringify({ ...await response.json(), ownerId: f.bob.user.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(f.act('pull'), /подтвердить владельца/); assert.deepEqual(f.state(), before); assert.equal(f.dialogs.length, 0); assert.equal(f.backups(), 0);
});
test('late successful PUT from A cannot grant B a revision or alter B; its dispatched write remains scoped to A', async t => {
  const f = await fixture(t), g = gate(); await f.act('pull'); const beforeB = await f.direct(f.bob);
  f.hooks.afterPUT = () => g.wait(); const rejected = assert.rejects(f.act('push'), /Аккаунт или сессия изменились/); await g.entered;
  f.select(f.bob); g.release(); await rejected; assert.deepEqual(await f.direct(f.bob), beforeB); assert.equal(f.experience.state().cloudRevision, null);
  assert.deepEqual(f.requests.filter(row => row.method === 'PUT').map(row => row.owner), [f.alice.user.id]); assert.equal((await f.direct(f.alice)).revision, 2);
});
test('PUT owner/revision mismatch cannot create a trusted proof for the next overwrite', async t => {
  const f = await fixture(t); await f.act('pull'); f.hooks.putResponse = async response => new Response(JSON.stringify({ ...await response.json(), ownerId: f.bob.user.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(f.act('push'), /подтвердить владельца/); assert.equal(f.experience.state().cloudRevision, null);
  delete f.hooks.putResponse; await assert.rejects(f.act('push'), /Сначала открой актуальную копию/);
});
test('server409 after encryption stays a conflict and does not retry or promote the old read proof', async t => {
  const f = await fixture(t), g = gate(); await f.act('pull'); f.hooks.afterEncrypt = () => g.wait();
  const rejected = assert.rejects(f.act('push'), error => error.status === 409); await g.entered;
  await f.direct(f.alice, 'PUT', { revision: 1, envelope: await portable.encryptProfile(profile('OtherDevice'), PASSPHRASE) });
  g.release(); await rejected; assert.equal(f.experience.state().cloudRevision, null); assert.equal(f.requests.filter(row => row.method === 'PUT').length, 1);
  assert.equal((await portable.decryptProfile((await f.direct(f.alice)).envelope, PASSPHRASE)).music.collections[0].title, 'OtherDevice');
});
test('fresh empty cloud permits explicit save and consecutive verified saves without replacing current playback/profile', async t => {
  const f = await fixture(t, { seeded: false }), before = f.state(); await f.act('push'); await f.act('push');
  assert.equal((await f.direct(f.alice)).revision, 2); assert.equal(f.experience.state().cloudRevision, 2); assert.deepEqual(f.state(), before); assert.equal(f.backups(), 0);
});
test('cancelled restore neither changes local data nor authorizes overwriting the unread remote copy', async t => {
  const f = await fixture(t), before = f.state(); f.confirm(1); await f.act('pull');
  assert.deepEqual(f.state(), before); assert.equal(f.backups(), 0); assert.equal(f.experience.state().cloudRevision, null); await assert.rejects(f.act('push'), /Сначала открой актуальную копию/);
});
