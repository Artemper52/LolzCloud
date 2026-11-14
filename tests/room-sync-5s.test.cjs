'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomClock, DriftCorrection, RoomAdvanceGate } = require('../server/public/room-sync.js');

test('room drift is checked on the five-second boundary without seeking already aligned audio', () => {
  const correction = new DriftCorrection();
  assert.equal(correction.decide(10000, 10000, 0, 'source-a').seek, false);
  for (const now of [1000, 2000, 3000, 4000, 4999]) {
    const decision = correction.decide(10000, 10400, now, 'source-a');
    assert.equal(decision.seek, false, 'ordinary moderate drift waits for the planned check');
    assert.equal(decision.periodic, false);
  }
  const due = correction.decide(10000, 10400, 5000, 'source-a');
  assert.equal(due.seek, true);
  assert.equal(due.position, 10400);
  assert.equal(due.periodic, true);
  const aligned = correction.decide(20000, 20090, 10000, 'source-a');
  assert.equal(aligned.periodic, true);
  assert.equal(aligned.seek, false, 'a scheduled check must not cause an unnecessary audible seek');
});

test('five-second correction handles both faster and slower players including paused position drift', () => {
  for (const drift of [-600, -350, 350, 600]) {
    const correction = new DriftCorrection();
    correction.decide(30000, 30000, 0, 'paused-or-playing');
    const decision = correction.decide(30000, 30000 + drift, 5000, 'paused-or-playing');
    assert.equal(decision.seek, true);
    assert.equal(decision.position, 30000 + drift);
    assert.equal(decision.drift, drift);
  }
  for (const drift of [-349, 0, 349]) {
    const correction = new DriftCorrection();
    correction.decide(30000, 30000, 0, 'aligned');
    assert.equal(correction.decide(30000, 30000 + drift, 5000, 'aligned').seek, false);
  }
});

test('an independent scheduled tick checks drift without waiting for a later one-second poll', () => {
  const correction = new DriftCorrection();
  correction.decide(0, 0, 725, 'asynchronously-loaded');
  assert.equal(correction.decide(10000, 10900, 5000, 'asynchronously-loaded').seek, false);
  const scheduled = correction.decide(10000, 10900, 5000, 'asynchronously-loaded', false, true);
  assert.equal(scheduled.periodic, true);
  assert.equal(scheduled.seek, true);
  assert.equal(scheduled.position, 10900);
  assert.equal(correction.decide(20000, 20000, 10000, 'asynchronously-loaded', false, true).seek, false);
});

test('large drift and explicit resync recover promptly while seek cooldown remains bounded', () => {
  const correction = new DriftCorrection();
  correction.decide(10000, 10000, 0, 'a');
  assert.equal(correction.decide(10000, 12000, 1000, 'a').seek, true);
  assert.equal(correction.decide(10000, 12000, 1100, 'a').seek, false);
  assert.equal(correction.decide(10000, 10000, 1200, 'a', true).seek, false);
  assert.equal(correction.decide(10000, 10000, 1300, 'a', true).seek, true);
  assert.equal(correction.decide(0, 50000, 1400, 'new-generation').seek, true, 'new recording has its own correction state');
  assert.deepEqual(correction.decide(NaN, 1, 1500, 'new-generation'), { seek: false, drift: null, periodic: false });
});

test('room clock projects server playback rate, freezes pause/reconnect and never runs past the controller lease', () => {
  let monotonic = 0;
  const clock = new RoomClock(() => monotonic);
  clock.sample(100000, 0, 0);
  const sample = { sampledAt: 100000, controller: { expires: 110000 }, playback: { position: 20, duration: 200, playing: true, rate: 2 } };
  monotonic = 2500;
  assert.equal(clock.position(sample), 25);
  assert.equal(clock.position({ ...sample, playback: { ...sample.playback, rate: .5 } }), 21.25);
  monotonic = 12000;
  assert.equal(clock.position(sample), 40, 'server reference stops at lease expiry even before a new SSE state arrives');
  assert.equal(clock.position({ ...sample, playback: { ...sample.playback, playing: false } }), 20);
  assert.equal(clock.position({ ...sample, reconnecting: true }), 20);
  assert.equal(clock.position({ ...sample, playback: { ...sample.playback, duration: 30 } }), 30);
  assert.equal(clock.position({ ...sample, playback: { ...sample.playback, rate: NaN } }), 30, 'invalid source rate safely falls back to 1x');
});

test('monotonic server clock supports a zero timestamp without replacing it with the current time', () => {
  let now = 0;
  const clock = new RoomClock(() => now);
  clock.sample(0, 0, 0);
  now = 5000;
  assert.equal(clock.position({ sampledAt: 0, playback: { position: 1, duration: 20, playing: true, rate: 1 } }), 6);
});

test('one automatic end and its simultaneous duplicate share one queue advance', async () => {
  const gate = new RoomAdvanceGate();
  let calls = 0, complete;
  const transition = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const first = gate.run('epoch1|controllerA|generation1|sourceA', true, transition);
  const duplicate = gate.run('epoch1|controllerA|generation1|sourceA', true, transition);
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);
  complete('queued-track-b');
  assert.equal(await first, 'queued-track-b');
  assert.equal(await duplicate, 'queued-track-b');
  assert.equal(await gate.run('epoch1|controllerA|generation1|sourceA', true, transition), false, 'a late finish cannot consume another queued track');
  assert.equal(await gate.run('epoch1|controllerA|generation2|sourceB', true, () => { calls++; return 'queued-track-c'; }), 'queued-track-c');
  assert.equal(calls, 2);
});

test('failed automatic advance is not repeated ambiguously but a deliberate manual retry is possible', async () => {
  const gate = new RoomAdvanceGate();
  let calls = 0;
  const uncertain = () => { calls++; throw new Error('Response lost after server may have removed the queue item'); };
  await assert.rejects(gate.run('source-a', true, uncertain), /Response lost/);
  assert.equal(await gate.run('source-a', true, uncertain), false);
  assert.equal(calls, 1);
  assert.equal(await gate.run('source-a', false, () => { calls++; return 'manual'; }), 'manual');
  assert.equal(calls, 2);
});

test('a seek-to-end and an overlapping manual next remain one in-flight queue action', async () => {
  const gate = new RoomAdvanceGate();
  let count = 0, finish;
  const ended = gate.run('same-recording', true, () => { count++; return new Promise(resolve => { finish = resolve; }); });
  const clicked = gate.run('same-recording', false, () => { count++; return 'unexpected'; });
  await Promise.resolve();
  finish('first-approved-entry');
  assert.equal(await ended, 'first-approved-entry');
  assert.equal(await clicked, 'first-approved-entry');
  assert.equal(count, 1);
});

test('seeking back deliberately rearms the same recording without allowing an in-flight duplicate', async () => {
  const gate = new RoomAdvanceGate();
  let complete, calls = 0;
  const first = gate.run('replayed-recording', true, () => { calls++; return new Promise(resolve => { complete = resolve; }); });
  await Promise.resolve();
  gate.rearm('replayed-recording');
  assert.equal(gate.run('replayed-recording', true, () => { calls++; }), first);
  complete('ended');
  await first;
  assert.equal(await gate.run('replayed-recording', true, () => { calls++; }), false);
  gate.rearm('different-recording');
  assert.equal(await gate.run('replayed-recording', true, () => { calls++; }), false);
  gate.rearm('replayed-recording');
  assert.equal(await gate.run('replayed-recording', true, () => { calls++; return 'new-end'; }), 'new-end');
  assert.equal(calls, 2);
});
