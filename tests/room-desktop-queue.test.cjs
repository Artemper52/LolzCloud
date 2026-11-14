'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ListeningRoom } = require('../source/integrations/room.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const roomId = 'a'.repeat(32), rowId = 'b'.repeat(24);
const previous = { url: 'https://soundcloud.com/fixture/previous', title: 'Previous', duration: 120, position: 50, playing: true, rate: 1 };
const selected = { url: 'https://soundcloud.com/fixture/selected', title: 'Selected', duration: 100, position: 0, playing: false, rate: 1 };
function fixture(t) {
  let source = { fresh: true, private: false, transitioning: false, playback: previous }, lost = 0;
  const room = new ListeningRoom(() => source, { onControlLost: () => { lost++; } }); clearInterval(room.timer);
  room.room = { id: roomId, protocol: 2, playback: previous, epoch: 1 }; room.lease = 'lease-a';
  t.after(() => { room.closed = true; clearInterval(room.timer); clearTimeout(room.eventPublish); });
  return { room, source: value => { source = value; }, lost: () => lost, result: () => ({ track: selected, room: { id: roomId, protocol: 2, playback: selected, epoch: 2, queue: [] } }) };
}

test('a selected queue entry suppresses old heartbeats until native loading has started', async t => {
  const f = fixture(t), pending = deferred(), calls = [], played = [];
  f.room.request = async (url, options) => { calls.push({ url, ...options }); return pending.promise; };
  const choosing = f.room.playQueued(rowId, async track => { played.push(track.url); });
  await f.room.publish(); assert.equal(calls.length, 1, 'No previous-song PUT may cross the pending control action');
  assert.deepEqual(calls[0].body, { type: 'play-queue', id: rowId, connection: f.room.connection, lease: 'lease-a', sequence: 1 });
  pending.resolve(f.result()); await choosing;
  assert.deepEqual(played, [selected.url]); assert.equal(f.room.room.playback.url, selected.url);
});

test('a late successful heartbeat cannot overwrite an atomic queue selection', async t => {
  const f = fixture(t), heartbeat = deferred(); let action;
  f.room.request = (url, options) => options.method === 'PUT' ? heartbeat.promise : (action = options.body, Promise.resolve(f.result()));
  const oldPublish = f.room.publish(); await f.room.playQueued(rowId, async () => {});
  assert.equal(action.sequence, 2); heartbeat.resolve({ id: roomId, protocol: 2, playback: previous, epoch: 1 }); await oldPublish;
  assert.equal(f.room.room.playback.url, selected.url); assert.equal(f.room.lease, 'lease-a');
});

test('an obsolete rejected heartbeat cannot revoke the lease after a newer queue action', async t => {
  const f = fixture(t), heartbeat = deferred();
  f.room.request = (url, options) => options.method === 'PUT' ? heartbeat.promise : Promise.resolve(f.result());
  const oldPublish = f.room.publish(); await f.room.playQueued(rowId, async () => {});
  heartbeat.reject(Object.assign(new Error('Old sequence'), { status: 409 })); await oldPublish;
  assert.equal(f.lost(), 0); assert.equal(f.room.lease, 'lease-a'); assert.equal(f.room.room.playback.url, selected.url);
});

test('while a provider prepares a selected song the room publishes that song paused at its start', async t => {
  const f = fixture(t), requests = [];
  f.source({ fresh: true, private: false, transitioning: true, playback: previous, displayPlayback: { ...selected, playing: true } });
  f.room.request = async (_url, options) => { requests.push(options.body); return { id: roomId, protocol: 2, playback: options.body.playback }; };
  await f.room.publish(); assert.equal(requests[0].playback.url, selected.url); assert.equal(requests[0].playback.playing, false); assert.equal(requests[0].playback.position, 0);
  f.source({ fresh: true, private: false, transitioning: false, playback: { ...selected, position: 2, playing: true } });
  await f.room.publish(); assert.equal(requests[1].playback.url, selected.url); assert.equal(requests[1].playback.playing, true); assert.equal(requests[1].playback.position, 2);
});

test('private transition metadata is never published to a room', async t => {
  const f = fixture(t); let sent;
  f.source({ fresh: true, private: true, transitioning: true, playback: previous, displayPlayback: selected });
  f.room.request = async (_url, options) => { sent = options.body; return f.room.room; }; await f.room.publish();
  assert.deepEqual(sent.playback, {}); assert.equal(sent.private, true);
});

test('leaving a room cancels a slow queue result before it can start native audio', async t => {
  const f = fixture(t), pending = deferred(); let plays = 0;
  f.room.request = async (_url, options) => options.body?.type === 'play-queue' ? pending.promise : { room: null };
  const choosing = f.room.playQueued(rowId, async () => { plays++; });
  await f.room.stop({ close: false }); pending.resolve(f.result()); await assert.rejects(choosing, /изменилось/);
  assert.equal(plays, 0); assert.equal(f.room.room, null); assert.equal(f.room.queueSelection, null);
});

test('a double selection sends one control request and does not consume a second entry', async t => {
  const f = fixture(t), pending = deferred(); let calls = 0;
  f.room.request = async () => { calls++; return pending.promise; };
  const choosing = f.room.playQueued(rowId, async () => {});
  await assert.rejects(f.room.playQueued('c'.repeat(24), async () => {}), /открывается/);
  pending.resolve(f.result()); await choosing; assert.equal(calls, 1);
});

test('a malformed queue id or missing lease never reaches the server', async t => {
  const f = fixture(t); let calls = 0; f.room.request = async () => { calls++; };
  await assert.rejects(f.room.playQueued('b'.repeat(32), async () => {}), /Неверная/);
  f.room.lease = ''; await assert.rejects(f.room.playQueued(rowId, async () => {}), /управление/); assert.equal(calls, 0);
});
