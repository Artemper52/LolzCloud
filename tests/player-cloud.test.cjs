'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const { encryptProfile, decryptProfile } = require('../source/integrations/portable-profile.cjs');
async function fixture(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-player-cloud-')), store = new CloudStore({ filename: path.join(directory, 'sessions.json') }), server = createServer({ store }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port, owner = store.login({ id: 1001, name: 'Fixture owner' }), other = store.login({ id: 1002, name: 'Other user' }); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); const resolved = path.resolve(directory); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-player-cloud-')) fs.rmSync(resolved, { recursive: true, force: true }); }); return { directory, store, owner, other, async request(endpoint, identity = owner, method = 'GET', body) { const response = await fetch(origin + endpoint, { method, headers: { ...(identity ? { Authorization: 'Bearer ' + identity.secret } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, value: await response.json() }; } }; }
test('phone remote accepts commands only from its verified owner, hides private tracks and acknowledges commands once', async t => {
  const f = await fixture(t); assert.equal((await f.request('/api/remotes', null, 'POST', {})).status, 401);
  const created = await f.request('/api/remotes', f.owner, 'POST', { name: 'Test computer', userId: f.other.user.id }); assert.equal(created.status, 201); const endpoint = '/api/remotes/' + created.value.id;
  assert.equal((await f.request(endpoint, f.other)).status, 404); assert.equal((await f.request(endpoint + '/command', f.other, 'POST', { command: 'pause' })).status, 404);
  await f.request(endpoint + '/command', f.owner, 'POST', { command: 'volume', value: .25 }); await f.request(endpoint + '/command', f.owner, 'POST', { command: 'seek', value: 42 });
  const data = { fresh: true, private: true, playback: { url: 'https://soundcloud.com/fixture/private', title: 'Private fixture song', artist: 'Hidden', position: 1, duration: 100, playing: true }, volume: .5, ack: 0 };
  const pending = await f.request(endpoint + '/state', f.owner, 'PUT', data); assert.equal(pending.value.commands.length, 2); assert.equal(pending.value.commands[0].id, 1);
  const view = await f.request(endpoint); assert.ok(!JSON.stringify(view.value).includes('Private fixture song')); assert.equal(view.value.volume, .5);
  const acknowledged = await f.request(endpoint + '/state', f.owner, 'PUT', { ...data, ack: 2 }); assert.equal(acknowledged.value.commands.length, 0);
  assert.equal((await f.request(endpoint + '/state', f.owner, 'PUT', { ...data, ack: 3 })).status, 400); assert.equal((await f.request(endpoint + '/command', f.owner, 'POST', { command: 'play-url', value: 'file:///private' })).status, 400);
  await f.request(endpoint, f.owner, 'DELETE'); assert.equal((await f.request(endpoint)).status, 404);
});
test('encrypted profile storage is scoped to the verified user and rejects conflicting updates without overwriting', async t => {
  const f = await fixture(t), envelope = await encryptProfile({ format: 'lolzcloud-profile', version: 1 }, 'a private fixture password');
  assert.equal((await f.request('/api/profile', null)).status, 401);
  const written = await f.request('/api/profile', f.owner, 'PUT', { revision: 0, envelope, userId: f.other.user.id }); assert.equal(written.status, 200); assert.equal(written.value.revision, 1);
  assert.equal((await f.request('/api/profile', f.other)).value.envelope, null); const loaded = (await f.request('/api/profile')).value; assert.equal((await decryptProfile(loaded.envelope, 'a private fixture password')).format, 'lolzcloud-profile');
  assert.equal((await f.request('/api/profile', f.owner, 'PUT', { revision: 0, envelope })).status, 409); assert.deepEqual((await f.request('/api/profile')).value.envelope, loaded.envelope);
  const stored = fs.readFileSync(path.join(f.directory, 'player-profiles.json'), 'utf8'); assert.ok(!stored.includes('collections')); assert.ok(!stored.includes('a private fixture password'));
});
