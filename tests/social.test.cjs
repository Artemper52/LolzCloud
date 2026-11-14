'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CloudStore, profile, safeNext } = require('../server/core.cjs');
const { createServer } = require('../server/index.cjs');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3ZysIAAAAASUVORK5CYII=';
const alice = { user_id: 101, username: 'Алиса', links: { avatar: 'https://example.com/alice.png' }, user_groups: [{ user_group_id: 22, user_group_title: 'Постоялец' }, { user_group_id: 700, user_group_title: 'Discord сотрудник' }], custom_title: 'Модератор маркета' };
const bob = { id: 202, name: 'Боб' }, charlie = { id: 303, name: 'Чарли' };
async function setup(t, options = {}) {
  let now = Date.now(); const store = options.store || new CloudStore({ now: () => now, filename: options.filename });
  const server = createServer({ store, socialOptions: { plusUserIds: [101] } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = 'http://127.0.0.1:' + server.address().port, a = store.login(alice), b = store.login(bob), c = store.login(charlie);
  const call = (url, { method = 'GET', body, token = a.secret, headers = {} } = {}) => fetch(origin + url, { method, redirect: 'manual', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = async (url, options) => { const response = await call(url, options); const value = await response.json(); assert.ok([200, 201].includes(response.status), JSON.stringify(value)); return value; };
  return { store, server, origin, a, b, c, call, json, advance(ms) { now += ms; } };
}
async function befriend(s) { await s.json('/api/social/friends', { method: 'POST', body: { userId: 202 } }); await s.json('/api/social/friends/101/accept', { method: 'POST', body: {}, token: s.b.secret }); }

test('verified group labels survive normalization; editable custom titles never become membership badges', () => {
  const user = profile(alice); assert.deepEqual(user.titles.map(item => item.label), ['Постоялец', 'Discord сотрудник']);
  assert.deepEqual(profile(user), user);
  const curator = profile({ id: 4, name: 'Куратор', curator_titles: ['Музыка'] }); assert.equal(profile(curator).titles[0].label, 'Куратор');
  assert.ok(!JSON.stringify(user).includes('Модератор маркета'));
  assert.equal(safeNext('/social?tab=notifications&user=202'), '/social?tab=notifications&user=202');
  for (const bad of ['/social//evil.example', '//evil.example/social', '/social?next=https://evil.example', '/social?user=-1']) assert.equal(safeNext(bad), '/rooms');
});

test('profiles have shared authenticated identity and server-owned ranks; client cannot forge badges', async t => {
  const s = await setup(t);
  assert.equal((await s.call('/api/social/me', { token: '' })).status, 401);
  const own = (await s.json('/api/social/me')).profile; assert.equal(own.avatar, alice.links.avatar); assert.equal(own.rank.label, 'Слушатель+');
  const peer = (await s.json('/api/social/users/101', { token: s.b.secret })).profile; assert.equal(peer.rank.label, 'Слушатель+'); assert.equal(peer.editable, false); assert.ok(!peer.preferences);
  for (const forged of [{ rank: 'moderator' }, { titles: [{ label: 'Модератор' }] }, { id: 202 }]) assert.equal((await s.call('/api/social/me', { method: 'PUT', body: { revision: own.revision, ...forged } })).status, 400);
  const saved = (await s.json('/api/social/me', { method: 'PUT', body: { revision: own.revision, bio: '<hello> музыка', backgroundPreset: 'paper' } })).profile;
  assert.equal(saved.bio, '<hello> музыка'); assert.equal(saved.revision, own.revision + 1);
  assert.equal((await s.call('/api/social/me', { method: 'PUT', body: { revision: own.revision, bio: 'stale' } })).status, 409);
  assert.equal((await s.json('/api/social/users?q=ал')).users[0].id, 101);
});

test('older sessions cannot undo a newer Lolzteam identity refresh', async t => {
  const s = await setup(t); s.advance(1000);
  const renewed = s.store.login({ ...alice, username: 'Новое имя', user_groups: [{ user_group_id: 21, user_group_title: 'Местный' }] });
  assert.equal((await s.json('/api/social/me', { token: renewed.secret })).profile.name, 'Новое имя');
  const oldSession = (await s.json('/api/session', { token: s.a.secret })).user;
  assert.equal(oldSession.name, 'Новое имя'); assert.deepEqual(oldSession.titles.map(row => row.label), ['Местный']);
});

test('friend requests require consent, deduplicate, notify only the target and support cancellation/removal', async t => {
  const s = await setup(t);
  for (let n = 0; n < 2; n++) assert.equal((await s.json('/api/social/friends', { method: 'POST', body: { userId: 202, user: charlie } })).relationship, 'outgoing');
  const incoming = await s.json('/api/social/friends', { token: s.b.secret }); assert.equal(incoming.incoming.length, 1); assert.equal(incoming.incoming[0].id, 101);
  const inbox = await s.json('/api/social/notifications', { token: s.b.secret }); assert.equal(inbox.notifications.length, 1); assert.equal(inbox.notifications[0].actor.id, 101);
  assert.equal((await s.json('/api/social/notifications', { token: s.c.secret })).unread, 0);
  assert.equal((await s.call('/api/social/friends/101/accept', { method: 'POST', body: {}, token: s.c.secret })).status, 404);
  await s.json('/api/social/friends/101/accept', { method: 'POST', body: {}, token: s.b.secret });
  assert.equal((await s.json('/api/social/friends')).friends[0].id, 202);
  assert.equal((await s.json('/api/social/notifications')).notifications[0].type, 'friend_accept');
  await s.json('/api/social/friends/202', { method: 'DELETE' }); assert.equal((await s.json('/api/social/friends')).friends.length, 0);
});

test('privacy preferences suppress unsolicited requests, invitations and native alert delivery', async t => {
  const s = await setup(t), own = (await s.json('/api/social/me', { token: s.b.secret })).profile;
  await s.json('/api/social/me', { method: 'PUT', body: { revision: own.revision, allowFriendRequests: false, allowRoomInvites: 'none', notificationsEnabled: false }, token: s.b.secret });
  assert.equal((await s.call('/api/social/friends', { method: 'POST', body: { userId: 202 } })).status, 403);
  const room = await s.json('/api/rooms', { method: 'POST', body: {} });
  assert.equal((await s.call('/api/social/invitations', { method: 'POST', body: { roomId: room.id, userId: 202 } })).status, 403);
  assert.equal((await s.json('/api/social/notifications', { token: s.b.secret })).enabled, false);
});

test('room invitations enforce sender membership, recipient identity and explicit acceptance without autoplay', async t => {
  const s = await setup(t); await befriend(s); const room = await s.json('/api/rooms', { method: 'POST', body: {} });
  const invitation = (await s.json('/api/social/invitations', { method: 'POST', body: { userId: 202, roomId: room.id } })).invitation;
  assert.equal(invitation.type, 'room_invite'); assert.equal(invitation.actor.id, 101);
  assert.equal((await s.json('/api/social/invitations', { method: 'POST', body: { userId: 202, roomId: room.id } })).invitation.id, invitation.id);
  assert.equal((await s.call('/api/social/invitations', { method: 'POST', body: { userId: 202, roomId: room.id }, token: s.c.secret })).status, 403);
  assert.equal((await s.call('/api/social/invitations/' + invitation.id + '/respond', { method: 'POST', body: { accept: true } })).status, 404);
  const result = await s.json('/api/social/invitations/' + invitation.id + '/respond', { method: 'POST', body: { accept: true }, token: s.b.secret });
  assert.equal(result.url, room.url); assert.equal(s.store.room(room.id).members.size, 0); assert.equal(s.store.room(room.id).playback.playing, false);
  assert.equal((await s.json('/api/social/invitations/' + invitation.id + '/respond', { method: 'POST', body: { accept: true }, token: s.b.secret })).url, room.url);
});

test('expired/closed/banned room invitations cannot grant access', async t => {
  const s = await setup(t); await befriend(s); let room = await s.json('/api/rooms', { method: 'POST', body: {} });
  let invite = (await s.json('/api/social/invitations', { method: 'POST', body: { userId: 202, roomId: room.id } })).invitation;
  await s.json('/api/rooms/' + room.id + '/control', { method: 'POST', body: { type: 'kick', userId: 202 } });
  assert.equal((await s.call('/api/social/invitations/' + invite.id + '/respond', { method: 'POST', body: { accept: true }, token: s.b.secret })).status, 403);
  await s.json('/api/rooms/' + room.id, { method: 'DELETE' });
  assert.equal((await s.call('/api/social/invitations/' + invite.id + '/respond', { method: 'POST', body: { accept: true }, token: s.b.secret })).status, 410);
  room = await s.json('/api/rooms', { method: 'POST', body: {} }); invite = (await s.json('/api/social/invitations', { method: 'POST', body: { userId: 202, roomId: room.id } })).invitation;
  s.advance(3600001); assert.equal((await s.call('/api/social/invitations/' + invite.id + '/respond', { method: 'POST', body: { accept: true }, token: s.b.secret })).status, 410);
});

test('read acknowledgements are account-scoped and never accept an invitation', async t => {
  const s = await setup(t); await befriend(s); const room = await s.json('/api/rooms', { method: 'POST', body: {} });
  const invite = (await s.json('/api/social/invitations', { method: 'POST', body: { userId: 202, roomId: room.id } })).invitation;
  await s.json('/api/social/notifications/read', { method: 'POST', body: { ids: [invite.id] } });
  let inbox = await s.json('/api/social/notifications', { token: s.b.secret }); assert.equal(inbox.notifications.find(row => row.id === invite.id).readAt, null);
  await s.json('/api/social/notifications/read', { method: 'POST', body: { all: true }, token: s.b.secret });
  inbox = await s.json('/api/social/notifications', { token: s.b.secret }); assert.equal(inbox.unread, 0); assert.equal(inbox.notifications.find(row => row.id === invite.id).status, 'pending');
});

test('image upload validates bytes/size/ownership and serves a custom avatar without trusting external URLs', async t => {
  const s = await setup(t), upload = await s.call('/api/social/media', { method: 'POST', body: { kind: 'avatar', dataUrl: PNG } }); assert.equal(upload.status, 201);
  const { url } = await upload.json(), own = (await s.json('/api/social/me')).profile;
  const saved = (await s.json('/api/social/me', { method: 'PUT', body: { revision: own.revision, avatarUrl: url } })).profile; assert.equal(saved.avatar, url); assert.equal(saved.lolzAvatar, alice.links.avatar);
  const image = await s.call(new URL(url).pathname, { token: '' }); assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(PNG.split(',')[1], 'base64'));
  const peer = (await s.json('/api/social/me', { token: s.b.secret })).profile;
  assert.equal((await s.call('/api/social/me', { method: 'PUT', body: { revision: peer.revision, avatarUrl: url }, token: s.b.secret })).status, 400);
  for (const address of ['https://evil.example/track.svg', 'data:image/svg+xml,<svg/>']) assert.equal((await s.call('/api/social/me', { method: 'PUT', body: { revision: saved.revision, avatarUrl: address } })).status, 400);
  assert.equal((await s.call('/api/social/media', { method: 'POST', body: { kind: 'avatar', dataUrl: 'data:image/png;base64,' + Buffer.from('not an image at all').toString('base64') } })).status, 413);
  const reset = (await s.json('/api/social/me', { method: 'PUT', body: { revision: saved.revision, avatarUrl: '' } })).profile; assert.equal(reset.avatarSource, 'lolz'); assert.equal(reset.avatar, alice.links.avatar);
});

test('browser social mutations keep CSRF/origin guards', async t => {
  const s = await setup(t), own = (await s.json('/api/social/me')).profile, body = { revision: own.revision, bio: 'new' };
  assert.equal((await s.call('/api/social/me', { method: 'PUT', body, token: '', headers: { Cookie: '__Host-lc_session=' + s.a.secret } })).status, 403);
  assert.equal((await s.call('/api/social/me', { method: 'PUT', body, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call('/api/social/me', { method: 'PUT', body, token: '', headers: { Cookie: '__Host-lc_session=' + s.a.secret, 'X-CSRF-Token': s.a.csrf, Origin: 'https://lolzcloud.com' } })).status, 200);
});

test('notification SSE streams only that account and immediately publishes changes', async t => {
  const s = await setup(t), response = await s.call('/api/social/events', { token: s.b.secret }); assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(); t.after(() => reader.cancel().catch(() => {}));
  const initial = new TextDecoder().decode((await reader.read()).value); assert.match(initial, /"userId":202/); assert.match(initial, /"unread":0/);
  await s.json('/api/social/friends', { method: 'POST', body: { userId: 202 } });
  const next = new TextDecoder().decode((await reader.read()).value); assert.match(next, /friend_request/); assert.match(next, /"userId":202/); assert.ok(!next.includes('Чарли'));
});

test('logout revokes an already open room SSE stream instead of retaining cached authorization', async t => {
  const s = await setup(t), room = await s.json('/api/rooms', { method: 'POST', body: {} });
  const response = await s.call('/api/rooms/' + room.id + '/events');
  const reader = response.body.getReader(); t.after(() => reader.cancel().catch(() => {}));
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: state/);
  await s.json('/api/logout', { method: 'POST', body: {} });
  await s.json('/api/rooms/' + room.id + '/join', { method: 'POST', body: { connection: 'revocation-fixture' }, token: s.b.secret });
  assert.equal((await reader.read()).done, true, 'A new room update cannot be delivered through the revoked session');
});

test('social profiles and friendships survive restart without provider secrets; persistence failure rolls back', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-social-tests-')), filename = path.join(directory, 'sessions.json');
  t.after(() => { if (path.basename(directory).startsWith('lolzcloud-social-tests-')) fs.rmSync(directory, { recursive: true, force: true }); });
  const s = await setup(t, { filename }); await befriend(s); const own = (await s.json('/api/social/me')).profile;
  await s.json('/api/social/me', { method: 'PUT', body: { revision: own.revision, bio: 'Остаётся после рестарта' } });
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'social-state.json'))); assert.ok(!JSON.stringify(saved).includes('encryptedToken')); assert.ok(!JSON.stringify(saved).includes(s.a.secret));
  const restored = new CloudStore({ filename }), other = createServer({ store: restored }); t.after(() => new Promise(resolve => other.close(resolve)));
  assert.equal(restored.session(s.a.secret).csrf, s.a.csrf, 'Restart keeps CSRF valid for already open room windows');
  assert.equal(other.social.get(101, { id: 101 }).bio, 'Остаётся после рестарта'); assert.equal(other.social.friendList({ id: 101 }).friends[0].id, 202);
  const previous = s.server.social.filename; s.server.social.filename = directory;
  assert.throws(() => s.server.social.update({ id: 101 }, { revision: own.revision + 1, bio: 'must roll back' })); s.server.social.filename = previous;
  assert.equal(s.server.social.get(101, { id: 101 }).bio, 'Остаётся после рестарта');
});
