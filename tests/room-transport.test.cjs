'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const T = require('../server/public/app/room-transport.js');
const roomId = 'a'.repeat(32), documentId = '12345678-1234-4567-89ab-123456789abc';
const commandID = n => '87654321-1234-4567-89ab-' + n.toString(16).padStart(12, '0');
function fixture(perform) {
  const calls = [], events = [], state = { playback: { url: 'https://soundcloud.com/fixture/room', title: 'Room', artist: 'Artist', cover: '', duration: 200, position: 20, playing: false }, capabilities: { play: true, pause: true, next: true, previous: true, seek: true } };
  const transport = T.create({ roomId, documentId, read: () => state, perform: perform || ((type, value) => { calls.push([type, value]); state.playback.playing = type === 'play'; if (type === 'seek') state.playback.position = value; return true; }), notify: value => events.push(value) });
  return { transport, state, calls, events, command(type, n = 1, value) { const owner = transport.snapshot(); return transport.command({ ...owner, id: commandID(n), command: type, value }); } };
}
test('joined room cannot run system commands before an explicit room playback choice', async () => {
  const f = fixture(); assert.equal(f.transport.snapshot().active, false);
  assert.equal((await f.command('play')).ok, false); assert.deepEqual(f.calls, []);
  f.transport.acquire(); assert.equal((await f.command('play', 2)).ok, true);
  assert.deepEqual(f.calls, [['play', undefined]]); assert.equal(f.transport.snapshot().playback.playing, true);
});
test('pause retains the room owner for hardware Resume; release never autoplays solo', async () => {
  const f = fixture(); f.transport.acquire(); const owner = T.owner(f.transport.snapshot());
  await f.command('pause'); assert.equal(T.owner(f.transport.snapshot()), owner); assert.equal(f.transport.snapshot().active, true);
  await f.command('play', 2); assert.equal(f.transport.snapshot().playback.playing, true);
  await f.command('release', 3); assert.equal(f.transport.snapshot().active, false); assert.equal(f.transport.snapshot().playback.playing, false);
  assert.equal((await f.command('play', 4)).reason, 'stale-owner'); assert.deepEqual(f.calls.map(row => row[0]), ['pause', 'play', 'release']);
});
test('reacquiring the same document increments epoch and rejects late commands/releases', async () => {
  const f = fixture(); const first = f.transport.acquire(); f.transport.release(first); const second = f.transport.acquire();
  assert.equal(second.epoch, first.epoch + 1); assert.equal(f.transport.release(first), false);
  assert.equal((await f.transport.command({ ...first, id: commandID(1), command: 'next' })).reason, 'stale-owner');
  assert.equal(f.transport.snapshot().active, true); assert.equal(T.owner(f.transport.snapshot()), T.owner(second)); assert.deepEqual(f.calls, []);
});
test('controller permissions are checked when executing, after a queued command and before any side effect', async () => {
  let unlock, count = 0; const gate = new Promise(resolve => { unlock = resolve; });
  const f = fixture(async type => { count++; if (type === 'play') await gate; return true; }); f.transport.acquire();
  const first = f.command('play'), second = f.command('next', 2); await new Promise(resolve => setImmediate(resolve));
  f.state.capabilities.next = false; unlock(); await first; assert.equal((await second).reason, 'unavailable'); assert.equal(count, 1);
});
test('handoff pauses immediately despite a slow Next and stale completion cannot reclaim a room', async () => {
  let unlock; const gate = new Promise(resolve => { unlock = resolve; }), calls = [];
  const f = fixture(async type => { calls.push(type); if (type === 'next') await gate; return true; }); f.transport.acquire();
  const next = f.command('next'); await new Promise(resolve => setImmediate(resolve)); const release = f.command('release', 2);
  assert.deepEqual(calls, ['next', 'release']); assert.equal(f.transport.snapshot().active, false);
  const newer = f.transport.acquire(); unlock(); assert.equal((await next).reason, 'stale-owner'); await release;
  assert.equal(T.owner(f.transport.snapshot()), T.owner(newer)); assert.equal(f.transport.snapshot().active, true);
});
test('duplicates execute once and a pending command captures the immutable seek value', async () => {
  let unlock; const gate = new Promise(resolve => { unlock = resolve; }), seen = [];
  const f = fixture(async (type, value) => { seen.push([type, value]); if (type === 'play') await gate; return true; }); const owner = f.transport.acquire();
  const first = f.command('play'), value = { ...owner, id: commandID(2), command: 'seek', value: 23 }, second = f.transport.command(value), duplicate = f.transport.command({ ...value });
  value.value = 99; unlock(); await first; assert.equal((await second).ok, true); assert.deepEqual(await duplicate, await second); assert.deepEqual(seen, [['play', undefined], ['seek', 23]]);
});
test('malformed owners, cross-document commands, excessive pending requests and arbitrary media URLs are rejected', async () => {
  let unlock; const gate = new Promise(resolve => { unlock = resolve; }); const f = fixture(() => gate); const owner = f.transport.acquire();
  for (const input of [{ ...owner, roomId: roomId + '\n' }, { ...owner, documentId: documentId + '\n' }, { ...owner, epoch: Infinity }, { ...owner, revision: 0 }, { ...owner, playback: { ...owner.playback, url: 'https://user:password@soundcloud.com/a/b' } }, { ...owner, playback: { ...owner.playback, url: 'https://untrusted.test/file.mp3' } }]) assert.equal(T.snapshot(input), null);
  assert.equal((await f.transport.command({ ...owner, documentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', id: commandID(1), command: 'play' })).reason, 'stale-owner');
  for (const value of [-1, NaN, Infinity, '20', 86401]) assert.equal((await f.command('seek', 10, value)).reason, 'invalid-command');
  const requests = [1, 2, 3, 4].map(n => f.command('play', n)); assert.equal((await f.command('next', 5)).reason, 'busy'); const release=f.command('release',6);assert.equal(f.transport.snapshot().active,false);unlock(true);await release;await Promise.all(requests);
  assert.ok(Object.isFrozen(owner) && Object.isFrozen(owner.playback) && Object.isFrozen(owner.capabilities));
});
