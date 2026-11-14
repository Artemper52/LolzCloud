'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CloudStore } = require('../server/core.cjs');
const { createServer } = require('../server/index.cjs');
async function setup(t, { filename, ownerUserIds = [101] } = {}) {
  const store = new CloudStore({ filename }), server = createServer({ store, socialOptions: { ownerUserIds, plusUserIds: [] } });
  const a = store.login({ id: 101, name: 'Владелец · тест', user_groups: [{ id: 7, title: 'Форумный титул' }] });
  const b = store.login({ id: 202, name: 'Тестер · тест' }), c = store.login({ id: 303, name: 'Artemper' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (url, { method = 'GET', body, token = a.secret, headers = {} } = {}) => fetch(origin + url, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = async (url, options) => { const response = await call(url, options), result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const card = id => server.social.get(id, a.user), change = (id, roles, token = a.secret, revision = card(id).revision) => call('/api/social/users/' + id + '/roles', { method: 'PUT', token, body: { roles, revision } });
  return { store, server, a, b, c, call, json, card, change };
}

test('owner bootstrap uses an explicit canonical id and app roles stay separate from forum titles and rank', async t => {
  const s = await setup(t), own = (await s.json('/api/social/me')).profile;
  assert.deepEqual(own.roles, [{ id: 'owner', label: 'Владелец', source: 'lolzcloud' }]);
  assert.equal(own.canManageRoles, false); assert.equal(s.card(202).canManageRoles, true);
  assert.equal(own.rank.id, 'listener'); assert.ok(own.titles.every(title => title.source === 'lolzteam'));
  assert.deepEqual(s.card(303).roles, [], 'Copying the owner name grants no permission');
  const session = await s.json('/api/session'); assert.equal(session.user.roles[0].id, 'owner');
});

test('only server-authorized owners can assign Tester or Owner to another user', async t => {
  const s = await setup(t);
  assert.equal((await s.change(202, ['tester'], s.b.secret)).status, 403);
  assert.equal((await s.change(101, ['owner'], s.c.secret)).status, 403);
  assert.equal((await s.change(202, ['tester'])).status, 200);
  assert.deepEqual(s.card(202).roles, [{ id: 'tester', label: 'Тестер', source: 'lolzcloud' }]);
  assert.equal((await s.json('/api/social/users/303', { token: s.b.secret })).profile.canManageRoles, false);
  assert.equal((await s.change(303, ['owner'], s.b.secret)).status, 403, 'Tester grants no administrative power');
  assert.equal((await s.change(202, ['owner', 'tester'])).status, 200);
  assert.equal((await s.change(303, ['tester'], s.b.secret)).status, 200, 'A newly appointed owner is authorized from persisted server state');
});

test('self-role edits and removal of the final owner fail without changing access', async t => {
  const s = await setup(t), before = s.card(101);
  assert.equal((await s.change(101, [])).status, 409);
  assert.equal((await s.change(101, ['owner', 'tester'])).status, 403);
  assert.equal(s.card(101).revision, before.revision); assert.equal(s.server.social.ownerCount(), 1);
  await s.change(202, ['owner']);
  assert.equal((await s.change(101, [])).status, 403, 'Even with two owners, a user cannot lock out their own account');
  assert.equal((await s.change(101, [], s.b.secret)).status, 200);
  assert.equal((await s.change(303, ['owner'], s.a.secret)).status, 403, 'An old authenticated session does not retain revoked owner rights');
});

test('role writes use revision checks, a closed field/role set and normal profile writes cannot bypass authority', async t => {
  const s = await setup(t), revision = s.card(202).revision;
  await s.change(202, ['tester']); assert.equal((await s.change(202, [], s.a.secret, revision)).status, 409);
  for (const roles of [['admin'], ['owner', 'owner'], ['tester', 'owner', 'tester'], 'owner', null, [1]])
    assert.equal((await s.call('/api/social/users/202/roles', { method: 'PUT', body: { revision: s.card(202).revision, roles } })).status, 400);
  assert.equal((await s.call('/api/social/users/202/roles', { method: 'PUT', body: { revision: s.card(202).revision, roles: [], titles: [] } })).status, 400);
  for (const body of [{ roles: ['owner'] }, { appRoles: ['owner'] }, { titles: [] }, { rank: { id: 'listener_plus' } }, { canManageRoles: true }])
    assert.equal((await s.call('/api/social/me', { method: 'PUT', token: s.b.secret, body: { revision: s.card(202).revision, ...body } })).status, 400);
  assert.deepEqual(s.card(202).roles.map(role => role.id), ['tester']);
});

test('role route enforces authentication, cookie CSRF and exact request Origin', async t => {
  const s = await setup(t), body = { revision: s.card(202).revision, roles: ['tester'] }, url = '/api/social/users/202/roles';
  assert.equal((await s.call(url, { method: 'PUT', token: '', body })).status, 401);
  assert.equal((await s.call(url, { method: 'PUT', token: '', body, headers: { Cookie: '__Host-lc_session=' + s.a.secret } })).status, 403);
  assert.equal((await s.call(url, { method: 'PUT', body, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call(url, { method: 'PUT', token: '', body, headers: { Cookie: '__Host-lc_session=' + s.a.secret, Origin: 'https://lolzcloud.com', 'X-CSRF-Token': s.a.csrf } })).status, 200);
});

test('role badges decorate rooms and fresh session cards without changing verified forum identity', async t => {
  const s = await setup(t); await s.change(202, ['tester']);
  const roomResponse = await s.call('/api/rooms', { method: 'POST', token: s.b.secret, body: {} });
  const room = await roomResponse.json(); assert.equal(roomResponse.status, 201);
  assert.equal(room.owner.roles[0].id, 'tester');
  assert.equal((await s.json('/api/session', { token: s.b.secret })).user.roles[0].label, 'Тестер');
  const before = s.card(101).titles; await s.change(202, ['owner']);
  assert.deepEqual(s.card(101).titles, before);
});

test('persistent roles survive restart and bootstrap never promotes another configured id when an owner already exists', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-role-test-')), filename = path.join(directory, 'sessions.json');
  t.after(() => { const resolved = path.resolve(directory); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('lolzcloud-role-test-')) fs.rmSync(resolved, { recursive: true, force: true }); });
  const s = await setup(t, { filename }); await s.change(202, ['tester']);
  const store = new CloudStore({ filename }), restored = createServer({ store, socialOptions: { ownerUserIds: [303], plusUserIds: [] } });
  t.after(() => restored.social.dispose());
  assert.equal(restored.social.isOwner({ id: 101 }), true); assert.equal(restored.social.isOwner({ id: 303 }), false);
  assert.deepEqual(restored.social.get(202, { id: 101 }).roles.map(role => role.id), ['tester']);
  const original = s.server.social.filename; s.server.social.filename = directory;
  assert.throws(() => s.server.social.updateRoles(s.a.user, 202, { revision: s.card(202).revision, roles: ['owner'] }));
  s.server.social.filename = original; assert.deepEqual(s.card(202).roles.map(role => role.id), ['tester']);
});

test('a service without a configured canonical owner never grants authority by name or client identity fields', async t => {
  const s = await setup(t, { ownerUserIds: [] });
  assert.equal(s.server.social.ownerCount(), 0); assert.deepEqual(s.card(303).roles, []);
  s.store.login({ id: 303, name: 'Artemper', roles: ['owner'], appRoles: ['owner'], canManageRoles: true });
  assert.equal(s.server.social.isOwner({ id: 303, roles: ['owner'] }), false);
  assert.equal((await s.change(202, ['owner'], s.c.secret)).status, 403);
});
