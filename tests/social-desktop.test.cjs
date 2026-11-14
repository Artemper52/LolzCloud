'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { SocialNotifications } = require('../source/integrations/social-notifications.cjs');
const { ROOM_ORIGIN, ROOM_PARTITION, roomUrl, socialUrl, appGuestUrl, roomGuestPreferences, protectRoomGuest } = require('../source/integrations/room-view.cjs');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const item = (n, values = {}) => ({ id: uuid(n), type: 'friend_request', actor: { id: 2, name: 'Друг' }, createdAt: 1000 + n, readAt: null, status: 'pending', ...values });
function harness(options = {}) {
  const h = { session: { authenticated: true, user: { id: 1 } }, response: { userId: 1, notifications: [], unread: 0, revision: 1, enabled: true }, shown: [], opened: [], events: [], focused: false, restored: 0 };
  const window = { isDestroyed: () => false, isFocused: () => h.focused, isMinimized: () => !h.focused, restore: () => h.restored++, show() {}, focus() {} };
  class Notice extends EventEmitter { constructor(value) { super(); this.value = value; } show() { h.shown.push(this); } close() { this.emit('close'); } }
  h.client = new SocialNotifications({ intervalMs: 0, getSession: () => h.session, request: async endpoint => { assert.equal(endpoint, '/api/social/notifications'); return h.response; }, createNotification: value => new Notice(value), getWindow: () => window, onOpen: value => h.opened.push(value), onState: value => h.events.push(value), now: () => 5000, ...options });
  return h;
}

test('desktop social pages use an exact origin/route allowlist without gaining the room bridge', () => {
  const address = ROOM_ORIGIN + '/social?tab=friends&user=42';
  assert.equal(socialUrl(address), address); assert.equal(roomUrl(address), ''); assert.equal(appGuestUrl(address), address);
  for (const value of [ROOM_ORIGIN + '/social?tab=admin', ROOM_ORIGIN + '/social?user=-1', ROOM_ORIGIN + '/social?user=1e3', ROOM_ORIGIN + '/social/nope', 'https://user@lolzcloud.com/social', 'https://lolzcloud.com.evil.test/social', ROOM_ORIGIN + '/cloud/../social', ROOM_ORIGIN + '/cloud/%2e%2e/social']) assert.equal(socialUrl(value), '', value);
  assert.equal(appGuestUrl(ROOM_ORIGIN + '/api/social/notifications'), ''); assert.equal(appGuestUrl(ROOM_ORIGIN + '/auth/lolz'), '');
  const preferences = {}, event = { preventDefault() { throw new Error('Valid social guest was rejected'); } };
  assert.equal(roomGuestPreferences(event, preferences, { partition: ROOM_PARTITION, src: address }), true);
  assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true);
  const handlers = {}, contents = { getURL: () => address, on: (name, handler) => { handlers[name] = handler; }, setWindowOpenHandler() {} }; protectRoomGuest(contents);
  let prevented = false;
  handlers['will-navigate']({ preventDefault() { prevented = true; } }, ROOM_ORIGIN + '/room/' + 'a'.repeat(32) + '/');
  assert.equal(prevented, true, 'A social webview must not acquire the room-only preload by navigating itself');
  prevented = false; handlers['will-navigate']({ preventDefault() { prevented = true; } }, ROOM_ORIGIN + '/social?tab=notifications'); assert.equal(prevented, false);
});

test('first inbox snapshot is quiet; new notifications arrive once and click only opens inbox', async () => {
  const h = harness(); h.response.notifications = [item(1)]; h.response.unread = 1;
  await h.client.poll(); assert.equal(h.shown.length, 0); assert.equal(h.client.state().unread, 1);
  h.response = { ...h.response, notifications: [item(2), item(1)], unread: 2, revision: 2 };
  await h.client.poll(); await h.client.poll(); assert.equal(h.shown.length, 1); assert.match(h.shown[0].value.body, /Друг/);
  h.shown[0].emit('click'); assert.deepEqual(h.opened, [{ tab: 'notifications' }]); assert.equal(h.restored, 1);
  h.session = { authenticated: false }; await h.client.poll(); h.shown[0].emit('click'); assert.equal(h.opened.length, 1); assert.equal(h.client.state().unread, 0); h.client.dispose();
});

test('disabled, foreground, read, expired and resolved notifications never become OS toasts', async () => {
  const h = harness(); await h.client.poll();
  h.response = { ...h.response, notifications: [item(1)], enabled: false }; await h.client.poll(); assert.equal(h.shown.length, 0);
  h.response.enabled = true; await h.client.poll(); assert.equal(h.shown.length, 0, 'Enabling notifications must not replay disabled-period items');
  h.focused = true; h.response.notifications.unshift(item(2)); await h.client.poll(); h.focused = false; await h.client.poll(); assert.equal(h.shown.length, 0);
  h.response.notifications.unshift(item(3, { readAt: 4000 }), item(4, { expiresAt: 4500 }), item(5, { status: 'declined' })); await h.client.poll(); assert.equal(h.shown.length, 0);
  h.response.notifications.unshift(item(6, { type: 'friend_accept', status: 'accepted' })); await h.client.poll(); assert.equal(h.shown.length, 1); assert.match(h.shown[0].value.title, /друзья/); h.client.dispose();
});

test('persisted per-user dedup survives restart without cross-account notifications', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-social-notifications-')), filename = path.join(directory, 'seen.json');
  try {
    const first = harness({ filename }); await first.client.poll(); first.response.notifications = [item(1)]; await first.client.poll(); assert.equal(first.shown.length, 1); first.client.dispose();
    const second = harness({ filename }); second.response.notifications = [item(1), item(2)]; await second.client.poll(); assert.equal(second.shown.length, 1); assert.equal(second.client.state().userId, 1);
    second.session = { authenticated: true, user: { id: 3 } }; second.response = { ...second.response, userId: 3, notifications: [item(3)] }; await second.client.poll(); assert.equal(second.shown.length, 1, 'A new account establishes its own quiet baseline'); second.client.dispose();
  } finally { const target = path.resolve(directory); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('LolzCloud-social-notifications-')) fs.rmSync(target, { recursive: true, force: true }); }
});

test('a delayed snapshot cannot publish after logout or a user switch', async () => {
  let finish; const h = harness({ request: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.client.poll(); h.session = { authenticated: true, user: { id: 7 } }; finish({ userId: 1, notifications: [item(1)], unread: 1, enabled: true }); await pending;
  assert.equal(h.client.state().userId, null); assert.equal(h.events.length, 0); assert.equal(h.shown.length, 0); h.client.dispose();
});
