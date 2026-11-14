'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { roomAsset, roomClientResponse, installRoomClient } = require('../source/integrations/room-client.cjs');
const id = 'a'.repeat(32), origin = 'https://lolzcloud.com';
test('packaged room frontend routes only its own presentation, preserving API/auth traffic', () => {
  assert.equal(roomAsset(origin + '/room/' + id + '/'), 'room.html');
  assert.equal(roomAsset(origin + '/cloud/room-sync.js?v=2'), 'room-sync.js');
  assert.equal(roomAsset(origin + '/cloud/room.js'), 'room.js');
  assert.equal(roomAsset(origin + '/assets/logo.svg'), 'logo.svg');
  assert.equal(roomAsset(origin + '/social?tab=friends'), 'social.html');
  assert.equal(roomAsset(origin + '/rooms'), 'rooms.html');
  assert.equal(roomAsset(origin + '/cloud/social.js'), 'social.js');
  assert.equal(roomAsset(origin + '/cloud/social.css'), 'social.css');
  for (const url of [origin + '/api/rooms/' + id, origin + '/auth/lolz/callback', origin + '/login',
    'https://evil.example/cloud/room.js', 'http://lolzcloud.com/cloud/room.js', 'https://lolzcloud.com.evil.example/cloud/room.js',
    'https://user@lolzcloud.com/cloud/room.js', origin + '/cloud/../api/health', origin + '/cloud/%2e%2e/room.js',
    origin + '/room/no-id/', origin + '/cloud/%2e%2e/social', origin + '/cloud/../social', origin + '/social/not-a-page', 'file:///cloud/room.js']) assert.equal(roomAsset(url), '', url);
  assert.equal(roomAsset(origin + '/cloud/room.js', 'POST'), '');
});
test('bundled response retains same-origin CSP and never handles backend requests', async () => {
  const response = roomClientResponse({ url: origin + '/room/' + id + '/', method: 'GET' }, path.join(__dirname, '../server/public'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/html/);
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.match(response.headers.get('Content-Security-Policy'), /object-src 'none'/);
  assert.match(await response.text(), /id="host-seek"/);
  assert.equal(roomClientResponse({ url: origin + '/api/session', method: 'GET' }), null);
});
test('room network fallback uses the same session and bypasses only protocol recursion', async () => {
  let handler, installed = 0, forwarded;
  const roomSession = { protocol: { handle(scheme, value) { assert.equal(scheme, 'https'); handler = value; installed++; } },
    fetch(request, options) { forwarded = { request, options }; return Promise.resolve(new Response('network')); } };
  assert.equal(await installRoomClient(roomSession), true);
  assert.equal(await installRoomClient(roomSession), true);
  assert.equal(installed, 1);
  const request = { url: origin + '/api/rooms/' + id, method: 'POST', headers: { Cookie: 'isolated-room-session' } };
  assert.equal(await (await handler(request)).text(), 'network');
  assert.equal(forwarded.request, request);
  assert.deepEqual(forwarded.options, { bypassCustomProtocolHandlers: true });
});
test('older runtimes keep the service frontend when session forwarding is unavailable', async () => {
  assert.equal(await installRoomClient({ protocol: {} }), false);
});
