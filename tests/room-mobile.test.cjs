'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { CloudStore } = require('../server/core.cjs'), { RoomEngine, LEASE_MS } = require('../server/room-engine.cjs'), { PlayerServices } = require('../server/player-services.cjs');
const { createServer } = require('../server/index.cjs');
const owner = { id: 801, name: 'Owner fixture' }, dj = { id: 802, name: 'DJ fixture' }, listener = { id: 803, name: 'Listener fixture' };
const track = name => ({ url: 'https://soundcloud.com/fixture/' + name, title: name, artist: 'Fixture artist', duration: 200, playing: true, position: 17, rate: 1 });
function fixture(t) {
  let now = 100000; const store = new CloudStore({ now: () => now }), engine = new RoomEngine(store), players = new PlayerServices(store, engine), room = store.createRoom(owner);
  const controller = engine.control(room.id, owner, { type: 'claim', connection: 'owner-desktop' });
  const command = { connection: 'owner-desktop', lease: controller.lease }, add = name => { players.queue(room.id, owner, { type: 'add', track: track(name) }); return store.room(room.id).queue.at(-1); };
  t.after(() => engine.dispose()); return { store, engine, players, id: room.id, command, add, advance: value => { now += value; } };
}
test('play-queue atomically selects one non-head ID and preserves chat, other entries and subsequent Next', t => {
  const f = fixture(t), first = f.add('first'), chosen = f.add('chosen'), last = f.add('last');
  f.engine.message(f.id, owner, { text: 'Chat stays in this room' });
  f.store.updateRoom(f.id, owner, { ...f.command, sequence: 1, fresh: true, playback: track('previous') });
  const snapshots = []; f.engine.subscribe(f.id, () => snapshots.push(f.store.viewRoom(f.store.room(f.id), owner)));
  const selected = f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 2 });
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].playback.url, chosen.track.url); assert.deepEqual(snapshots[0].queue.map(row => row.id), [first.id, last.id]);
  assert.equal(selected.track.url, chosen.track.url); assert.equal(selected.room.playback.position, 0); assert.equal(selected.room.playback.playing, false);
  assert.equal(selected.room.chat[0].text, 'Chat stays in this room'); assert.equal(selected.room.history.at(-1).url, track('previous').url);
  assert.equal(f.players.queue(f.id, owner, { ...f.command, type: 'next' }).track.url, first.track.url);
  assert.deepEqual(f.store.room(f.id).queue.map(row => row.id), [last.id]);
});
test('persisted equal-URL entries are distinguished by queue ID', t => {
  const f = fixture(t), first = f.add('same');
  // Current add deduplicates URLs, but persisted older queues may contain them.
  const second = { ...first, id: 'b'.repeat(24), votes: new Set() }; f.store.room(f.id).queue.push(second);
  f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: second.id, sequence: 1 });
  assert.deepEqual(f.store.room(f.id).queue.map(row => row.id), [first.id]);
  assert.throws(() => f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: second.id, sequence: 2 }), error => error.status === 404);
  assert.deepEqual(f.store.room(f.id).queue.map(row => row.id), [first.id]);
});
test('an older in-flight state cannot overwrite an atomic queue choice; failed selection does not consume anything', t => {
  const f = fixture(t), chosen = f.add('chosen'), last = f.add('last');
  f.store.updateRoom(f.id, owner, { ...f.command, sequence: 2, fresh: true, playback: track('old') });
  assert.throws(() => f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 2 }), error => error.status === 409);
  assert.equal(f.store.room(f.id).queue.length, 2);
  f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 3 });
  f.store.updateRoom(f.id, owner, { ...f.command, sequence: 2, fresh: true, playback: track('old') });
  assert.equal(f.store.room(f.id).playback.url, chosen.track.url); assert.deepEqual(f.store.room(f.id).queue.map(row => row.id), [last.id]);
  for (const id of ['not-an-id', '0'.repeat(24)]) assert.throws(() => f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id, sequence: 4 }), error => error.status === 404);
  assert.equal(f.store.room(f.id).controller.sequence, 3); assert.equal(f.store.room(f.id).queue.length, 1);
});
test('owner phone handoff invalidates old desktop selection and publication without consuming queue entries', t => {
  const f = fixture(t), chosen = f.add('chosen');
  const phone = f.engine.control(f.id, owner, { type: 'claim', connection: 'owner-phone', force: true });
  assert.throws(() => f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 99 }), error => error.status === 409);
  assert.throws(() => f.store.updateRoom(f.id, owner, { ...f.command, sequence: 100, fresh: true, playback: track('old') }), error => error.status === 409);
  assert.equal(f.store.room(f.id).queue.length, 1);
  f.engine.control(f.id, owner, { type: 'play-queue', id: chosen.id, connection: 'owner-phone', lease: phone.lease, sequence: 1 });
  assert.equal(f.store.room(f.id).playback.url, chosen.track.url); assert.equal(f.store.room(f.id).queue.length, 0);
});
test('listener and revoked DJ cannot play queue entries, assigned DJ needs the exact active lease', t => {
  const f = fixture(t), chosen = f.add('chosen'); f.engine.join(f.id, dj, { connection: 'dj-phone' });
  assert.throws(() => f.engine.control(f.id, listener, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 1, userId: owner.id }), error => error.status === 403);
  f.engine.control(f.id, owner, { type: 'role', userId: dj.id, role: 'dj' });
  assert.throws(() => f.engine.control(f.id, dj, { type: 'claim', connection: 'dj-phone', force: true }), error => error.status === 409);
  f.engine.control(f.id, owner, { ...f.command, type: 'release' });
  const controller = f.engine.control(f.id, dj, { type: 'claim', connection: 'dj-phone' });
  assert.throws(() => f.engine.control(f.id, dj, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 1 }), error => error.status === 409);
  f.engine.control(f.id, dj, { type: 'play-queue', id: chosen.id, connection: 'dj-phone', lease: controller.lease, sequence: 1 });
  const next = f.add('next'); f.engine.control(f.id, owner, { type: 'role', userId: dj.id, role: 'listener' });
  assert.throws(() => f.engine.control(f.id, dj, { type: 'play-queue', id: next.id, connection: 'dj-phone', lease: controller.lease, sequence: 2 }), error => error.status === 403);
  assert.equal(f.store.room(f.id).queue.length, 1);
});
test('an expired controller cannot consume a queued selection', t => {
  const f = fixture(t), chosen = f.add('chosen'); f.advance(LEASE_MS + 1);
  assert.throws(() => f.engine.control(f.id, owner, { ...f.command, type: 'play-queue', id: chosen.id, sequence: 1 }), error => error.status === 409);
  assert.equal(f.store.room(f.id).queue.length, 1);
});
test('real HTTP play-queue keeps cookie CSRF, origin and authentication guards', async t => {
  const store = new CloudStore(), server = createServer({ store }), login = store.login(owner); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port, id = store.createRoom(login.user).id;
  const bearer = { Authorization: 'Bearer ' + login.secret, 'Content-Type': 'application/json' };
  const post = (action, body, headers = bearer) => fetch(origin + '/api/rooms/' + id + '/' + action, { method: 'POST', headers, body: JSON.stringify(body) });
  const controller = await (await post('control', { type: 'claim', connection: 'http-owner' })).json();
  const added = await (await post('queue', { type: 'add', track: track('chosen') })).json(), chosen = added.room.queue[0];
  const body = { type: 'play-queue', id: chosen.id, connection: 'http-owner', lease: controller.lease, sequence: 1 }, cookie = { Cookie: '__Host-lc_session=' + login.secret, 'Content-Type': 'application/json' };
  assert.equal((await post('control', body, {})).status, 401);
  assert.equal((await post('control', body, cookie)).status, 403);
  assert.equal((await post('control', body, { ...cookie, 'X-CSRF-Token': login.csrf, Origin: 'https://evil.invalid' })).status, 403);
  assert.equal(store.room(id).queue.length, 1);
  const response = await post('control', body, { ...cookie, 'X-CSRF-Token': login.csrf }); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.room.playback.url, chosen.track.url); assert.equal(result.room.queue.length, 0);
});
