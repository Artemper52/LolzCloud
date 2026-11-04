'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CloudStore } = require('../server/core.cjs');
const { RoomEngine, LEASE_MS } = require('../server/room-engine.cjs');
const { PlayerServices } = require('../server/player-services.cjs');
const { RoomClock, DriftCorrection } = require('../server/public/room-sync.js');
const owner = { id: 101, name: 'Owner' }, guest = { id: 202, name: 'Guest' }, other = { id: 303, name: 'Other' };
const track = { url: 'https://soundcloud.com/fixture/song', title: 'Song', artist: 'Artist', duration: 200, position: 10, playing: true, rate: 1 };
function fixture(filename) { let now = 100000; const store = new CloudStore({ filename, now: () => now }); const engine = new RoomEngine(store), services = new PlayerServices(store, engine), room = store.createRoom(owner); return { store, engine, services, id: room.id, advance: milliseconds => { now += milliseconds; }, now: () => now }; }
function claim(f, user = owner, connection = 'desktop-1234', force = false) { return f.engine.control(f.id, user, { type: 'claim', connection, name: connection, force }); }
test('app and browser have one authoritative controller; old and duplicate updates cannot rewind music', () => {
  const f = fixture(), desktop = claim(f);
  const send = (lease, connection, sequence, position) => f.store.updateRoom(f.id, owner, { lease, connection, sequence, fresh: true, playback: { ...track, position } });
  send(desktop.lease, 'desktop-1234', 1, 10); f.advance(500); assert.equal(f.store.viewRoom(f.store.room(f.id), guest).playback.position, 10.5);
  send(desktop.lease, 'desktop-1234', 3, 30); send(desktop.lease, 'desktop-1234', 2, 2); send(desktop.lease, 'desktop-1234', 3, 0); assert.equal(f.store.room(f.id).playback.position, 30);
  const browser = claim(f, owner, 'browser-1234', true); assert.notEqual(browser.lease, desktop.lease); assert.equal(browser.room.playback.playing, false);
  assert.throws(() => send(desktop.lease, 'desktop-1234', 4, 0), error => error.status === 409); assert.throws(() => f.store.updateRoom(f.id, owner, { fresh: true, playback: track }), error => error.status === 409);
  send(browser.lease, 'browser-1234', 1, 42); assert.equal(f.store.viewRoom(f.store.room(f.id), guest).playback.position, 42); f.engine.dispose();
});
test('lease expiry pauses a room and a listener cannot claim, publish, approve or consume the queue', () => {
  const f = fixture(); const controller = claim(f); f.store.updateRoom(f.id, owner, { lease: controller.lease, connection: 'desktop-1234', sequence: 1, fresh: true, playback: track });
  f.advance(LEASE_MS + 1000); const state = f.store.viewRoom(f.store.room(f.id), guest); assert.equal(state.playback.playing, false); assert.equal(state.reconnecting, true); assert.ok(state.playback.position <= 25);
  assert.throws(() => claim(f, guest, 'guest-12345'), error => error.status === 403);
  f.engine.join(f.id, guest, { connection: 'guest-12345' }); f.services.queue(f.id, guest, { type: 'add', track }); const row = f.services.queueView(f.store.room(f.id), guest)[0];
  for (const type of ['approve', 'next']) assert.throws(() => f.services.queue(f.id, guest, { type, id: row.id }), error => error.status === 403); f.engine.dispose();
});
test('DJ roles, voting, limits and moderation work across devices without trusting client identities', () => {
  const f = fixture(); f.engine.join(f.id, guest, { connection: 'guest-12345' }); f.engine.join(f.id, other, { connection: 'other-12345' });
  f.services.queue(f.id, guest, { type: 'add', track: { ...track, user: owner } }); f.services.queue(f.id, guest, { type: 'add', track: { ...track, url: 'https://soundcloud.com/fixture/two' } }); f.services.queue(f.id, guest, { type: 'add', track: { ...track, url: 'https://soundcloud.com/fixture/three' } });
  assert.throws(() => f.services.queue(f.id, guest, { type: 'add', track: { ...track, url: 'https://soundcloud.com/fixture/four' } }), error => error.status === 429);
  const row = f.services.queueView(f.store.room(f.id), guest)[0]; assert.equal(row.proposedBy.id, guest.id);
  f.services.queue(f.id, guest, { type: 'vote', id: row.id }); f.services.queue(f.id, other, { type: 'vote', id: row.id }); assert.equal(f.services.queueView(f.store.room(f.id), guest)[0].votes, 2);
  f.services.queue(f.id, guest, { type: 'vote', id: row.id }); assert.equal(f.services.queueView(f.store.room(f.id), guest)[0].votes, 1);
  f.engine.control(f.id, owner, { type: 'role', userId: guest.id, role: 'dj' }); const dj = claim(f, guest, 'guest-12345'); assert.ok(dj.lease); f.services.queue(f.id, guest, { type: 'approve', id: row.id }); assert.throws(() => f.services.queue(f.id, owner, { type: 'next' }), error => error.status === 409); assert.equal(f.services.queue(f.id, guest, { type: 'next', lease: dj.lease, connection: 'guest-12345' }).track.url, track.url);
  f.engine.control(f.id, owner, { type: 'kick', userId: guest.id }); assert.throws(() => claim(f, guest, 'guest-12345'), error => error.status === 403); assert.throws(() => f.services.queue(f.id, guest, { type: 'add', track }), error => error.status === 403); f.engine.dispose();
});
test('room chat treats text as content and ordinary speed is required for compatible guests', () => {
  const f = fixture(), controller = claim(f); f.engine.join(f.id, guest, { connection: 'guest-12345' });
  const value = f.engine.message(f.id, guest, { text: '<img src=x onerror=alert(1)>' }); assert.equal(value.chat[0].text, '<img src=x onerror=alert(1)>'); assert.equal(value.chat[0].user.id, guest.id);
  f.engine.control(f.id, owner, { type: 'settings', settings: { chat: false } }); assert.throws(() => f.engine.message(f.id, guest, { text: 'hello' }), error => error.status === 403);
  assert.throws(() => f.store.updateRoom(f.id, owner, { lease: controller.lease, connection: 'desktop-1234', sequence: 1, fresh: true, playback: { ...track, rate: 1.2 } }), error => error.status === 422); f.engine.dispose();
});
test('rooms restore paused with their queue and settings, without restoring active controller secrets', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-room-state-')); const filename = path.join(directory, 'sessions.json');
  try { const f = fixture(filename); claim(f); f.services.queue(f.id, owner, { type: 'add', track }); f.engine.control(f.id, owner, { type: 'settings', settings: { name: 'Ночная комната', public: true } }); f.engine.dispose(); const next = fixture(filename); const restored = next.store.viewRoom(next.store.room(f.id), owner); assert.equal(restored.settings.name, 'Ночная комната'); assert.equal(restored.queue.length, 1); assert.equal(restored.playback.playing, false); assert.equal(restored.controller, null); assert.ok(!fs.readFileSync(path.join(directory, 'rooms-state.json'), 'utf8').includes('secret')); next.engine.dispose(); } finally { const resolved = path.resolve(directory); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-room-state-')) fs.rmSync(resolved, { recursive: true, force: true }); }
});
test('synchronization clock handles arbitrary wall-clock skew, latency and paused positions', () => {
  let monotonic = 1000; const a = new RoomClock(() => monotonic), b = new RoomClock(() => monotonic + 9000000);
  a.sample(1000050, 1000, 1100); b.sample(1000050, 9001000, 9001100); monotonic = 2000;
  const state = { sampledAt: 1000000, playback: { position: 20, duration: 200, playing: true } };
  assert.ok(Math.abs(a.position(state) - b.position(state)) < .001); assert.equal(a.position(state), 21);
  state.playback.playing = false; monotonic += 100000; assert.equal(a.position(state), 20);
});
test('drift correction ignores jitter but corrects sustained offsets, late joins and track changes', () => {
  const drift = new DriftCorrection(); assert.equal(drift.decide(10000, 10090, 0, 'a').seek, false); assert.equal(drift.decide(10000, 11500, 1000, 'a').seek, true); assert.equal(drift.decide(10000, 11400, 1100, 'a').seek, false); assert.equal(drift.decide(0, 30000, 1200, 'b').seek, true); assert.equal(drift.decide(0, 30000, 1300, 'b', true).seek, false); assert.equal(drift.decide(0, 30000, 1600, 'b', true).seek, true);
});
