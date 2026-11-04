'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const { ListeningRoom } = require('../source/integrations/room.cjs');
const alice = { id: 1, name: 'Alice' }, bob = { id: 2, name: 'Боб' };
async function setup(t, options = {}) {
  let time = Date.now(); const store = new CloudStore({ now: () => time }), server = createServer({ store, clientId: 'fixture-client', verifyProfile: async () => alice, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = 'http://127.0.0.1:' + server.address().port, a = store.login(alice), b = store.login(bob);
  const call = (url, { method = 'GET', body, secret = a.secret, headers = {} } = {}) => fetch(origin + url, { method, redirect: 'manual', headers: { ...(secret ? { Authorization: 'Bearer ' + secret } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { server, store, a, b, origin, call, advance: ms => { time += ms; } };
}
test('rooms require verified sessions and only their owner can publish or close them', async t => {
  const { call, b } = await setup(t);
  assert.equal((await call('/api/rooms', { method: 'POST', secret: null, body: {} })).status, 401);
  const made = await call('/api/rooms', { method: 'POST', body: { user: bob } }), room = await made.json(); assert.equal(made.status, 201); assert.equal(room.owner.id, 1); assert.match(room.url, /^https:\/\/lolzcloud\.com\/room\/[a-f0-9]{32}\/$/);
  const active = { fresh: true, private: false, playback: { title: 'Fixture song', artist: 'Test', url: 'https://soundcloud.com/fixture/song', playing: true, position: 12, duration: 100 } };
  assert.equal((await call('/api/rooms/' + room.id + '/state', { method: 'PUT', body: active, secret: b.secret })).status, 403);
  assert.equal((await call('/api/rooms/' + room.id, { method: 'DELETE', secret: b.secret })).status, 403);
  const response = await call('/api/rooms/' + room.id + '/state', { method: 'PUT', body: active }); assert.equal((await response.json()).playback.title, 'Fixture song');
  const anonymous = await call('/api/rooms/' + room.id, { secret: null }); assert.equal(anonymous.status, 401); assert.ok(!(await anonymous.text()).includes('Fixture song'));
  assert.equal((await call('/room/' + room.id + '/', { secret: null })).status, 303);
});
test('participants use server-verified identities, deduplicate tabs, expire and hide stale/private music', async t => {
  const { call, b, advance } = await setup(t), room = await (await call('/api/rooms', { method: 'POST', body: {} })).json();
  for (const connection of ['first-tab-111', 'second-tab-222']) await call('/api/rooms/' + room.id + '/join', { method: 'POST', body: { connection, user: { id: 1, name: 'Impersonator' } }, secret: b.secret });
  let state = await (await call('/api/rooms/' + room.id)).json(); assert.equal(state.viewers, 1); assert.equal(state.participants[1].name, 'Боб');
  const privateState = await (await call('/api/rooms/' + room.id + '/state', { method: 'PUT', body: { fresh: true, private: true, playback: { title: 'PRIVATE', url: 'https://soundcloud.com/private/song' } } })).json();
  assert.ok(!JSON.stringify(privateState.playback).includes('PRIVATE')); assert.equal(privateState.playback.url, '');
  advance(26000); state = await (await call('/api/rooms/' + room.id)).json(); assert.equal(state.viewers, 0); assert.equal(state.participants[0].online, false); assert.equal(state.playback.playing, false);
});
test('browser mutations require CSRF and the correct origin', async t => {
  const { call, a } = await setup(t), cookie = '__Host-lc_session=' + a.secret;
  assert.equal((await call('/api/rooms', { method: 'POST', body: {}, secret: null, headers: { Cookie: cookie } })).status, 403);
  assert.equal((await call('/api/rooms', { method: 'POST', body: {}, secret: null, headers: { Cookie: cookie, 'X-CSRF-Token': a.csrf, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/api/rooms', { method: 'POST', body: {}, secret: null, headers: { Cookie: cookie, 'X-CSRF-Token': a.csrf, Origin: 'https://lolzcloud.com' } })).status, 201);
});
test('OAuth callback binds state to its browser, rejects replay and never trusts callback user IDs', async t => {
  const { call, store } = await setup(t), state = store.beginLogin('/rooms');
  const body = { state, accessToken: 'fixture-only-not-a-real-token', user_id: 999 };
  assert.equal((await call('/api/auth/complete', { method: 'POST', secret: null, body, headers: { Origin: 'https://lolzcloud.com' } })).status, 403);
  const good = await call('/api/auth/complete', { method: 'POST', secret: null, body, headers: { Origin: 'https://lolzcloud.com', Cookie: '__Host-lc_login=' + state } });
  assert.equal(good.status, 200); assert.equal((await good.json()).user.id, 1); assert.match(good.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await call('/api/auth/complete', { method: 'POST', secret: null, body, headers: { Origin: 'https://lolzcloud.com', Cookie: '__Host-lc_login=' + state } })).status, 403);
  assert.ok(!JSON.stringify([...store.sessions]).includes(body.accessToken));
});
test('OAuth redirect modes preserve the request and cookie while only explicit mode sends the callback URI', async t => {
  for (const redirectMode of ['explicit', 'registered']) {
    const { call, store } = await setup(t, { redirectMode });
    const response = await call('/auth/lolz?next=%2Frooms', { secret: null }), destination = new URL(response.headers.get('location'));
    assert.equal(response.status, 303);
    assert.equal(destination.origin + destination.pathname, 'https://lolz.live/account/authorize');
    assert.equal(destination.searchParams.get('client_id'), 'fixture-client');
    assert.equal(destination.searchParams.get('response_type'), 'token');
    assert.equal(destination.searchParams.get('scope'), 'basic read');
    const state = destination.searchParams.get('state'); assert.match(state, /^[\w-]{43}$/);
    assert.match(response.headers.get('set-cookie'), new RegExp('^__Host-lc_login=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$'));
    assert.equal(store.states.size, 1);
    assert.deepEqual([...destination.searchParams.keys()].sort(), redirectMode === 'explicit' ? ['client_id', 'redirect_uri', 'response_type', 'scope', 'state'] : ['client_id', 'response_type', 'scope', 'state']);
    if (redirectMode === 'explicit') assert.equal(destination.searchParams.get('redirect_uri'), 'https://lolzcloud.com/auth/lolz/callback');
  }
  for (const redirectMode of ['', 'unrecognized']) assert.throws(() => createServer({ redirectMode, store: new CloudStore() }), /LOLZ_REDIRECT_MODE/);
});
test('neither OAuth redirect mode can complete login with a mismatched browser state', async t => {
  for (const redirectMode of ['explicit', 'registered']) {
    let verified = 0;
    const { call } = await setup(t, { redirectMode, verifyProfile: async () => { verified++; return alice; } });
    const response = await call('/auth/lolz?next=%2Frooms', { secret: null }), state = new URL(response.headers.get('location')).searchParams.get('state');
    const headers = { Origin: 'https://lolzcloud.com', Cookie: '__Host-lc_login=' + state };
    const body = { state: 'x'.repeat(43), accessToken: 'fixture-only-not-a-real-token', user_id: 999 };
    assert.equal((await call('/api/auth/complete', { method: 'POST', secret: null, body, headers })).status, 403);
    assert.equal(verified, 0);
    body.state = state;
    const accepted = await call('/api/auth/complete', { method: 'POST', secret: null, body, headers });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).user.id, alice.id);
    assert.equal(verified, 1);
    assert.equal((await call('/api/auth/complete', { method: 'POST', secret: null, body, headers })).status, 403);
    assert.equal(verified, 1);
  }
});
test('desktop pairing needs an authenticated approval and can only be redeemed once', async t => {
  const { call, a } = await setup(t), pair = await (await call('/api/desktop/start', { method: 'POST', secret: null, body: {} })).json();
  assert.equal((await (await call('/api/desktop/poll', { method: 'POST', secret: null, body: { deviceCode: pair.deviceCode } })).json()).pending, true);
  assert.equal((await call('/api/desktop/approve', { method: 'POST', secret: null, body: { code: pair.code } })).status, 401);
  assert.equal((await call('/api/desktop/approve', { method: 'POST', body: { code: pair.code } })).status, 200);
  const granted = await (await call('/api/desktop/poll', { method: 'POST', secret: null, body: { deviceCode: pair.deviceCode } })).json(); assert.equal(granted.user.id, a.user.id); assert.match(granted.token, /^[\w-]{43}$/);
  assert.equal((await call('/api/desktop/poll', { method: 'POST', secret: null, body: { deviceCode: pair.deviceCode } })).status, 410);
});
test('shared Spicy requests require login, preserve attribution and cache without revealing the key', async t => {
  let requests = 0; const upstream = { Body: { source: 'spicy_lyrics', UploadAttribution: { Maker: { username: 'Fixture maker', url: 'https://spicylyrics.org/test' } }, Content: [], mark: 'preserved' }, Status: 200 };
  const { call, b } = await setup(t, { spicyKey: 'fixture-server-only-key', fetcher: async (url, options) => { requests++; assert.equal(options.headers.Authorization, 'Bearer fixture-server-only-key'); return new Response(JSON.stringify(upstream)); } });
  const endpoint = '/api/lyrics/1234567890123456789012';
  assert.equal((await call(endpoint, { secret: null })).status, 401); assert.equal(requests, 0);
  assert.deepEqual(await (await call(endpoint)).json(), upstream); assert.deepEqual(await (await call(endpoint, { secret: b.secret })).json(), upstream); assert.equal(requests, 1);
  assert.ok(!JSON.stringify(await (await call('/api/session')).json()).includes('fixture-server-only-key'));
});
test('desktop private mode removes track metadata before sending anything to the server', async t => {
  const payloads = [], room = new ListeningRoom(() => ({ fresh: true, private: true, playback: { title: 'SECRET SONG', url: 'https://soundcloud.com/private/song' } }), { fetcher: async (_url, options) => { payloads.push(JSON.parse(options.body)); return new Response(JSON.stringify({ id: 'a'.repeat(32) })); } });
  t.after(() => room.dispose()); room.token = 'x'.repeat(43); room.expires = Date.now() + 60000; room.room = { id: 'a'.repeat(32) };
  await room.publish(); assert.deepEqual(payloads[0].playback, {}); assert.ok(!JSON.stringify(payloads[0]).includes('SECRET SONG')); room.room = null;
});
