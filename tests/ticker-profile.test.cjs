'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../source/plugins/infoticker.js'), 'utf8');
function read({ me, headerProfile, visibleLogin = false } = {}) {
  const messages = [];
  const login = { getClientRects: () => visibleLogin ? [{}] : [] };
  const link = headerProfile ? { href: headerProfile, getAttribute: () => 'Listener', textContent: 'Listener', closest() { return this; } } : null;
  const context = {
    window: { __sc_hydration: me ? [{ hydratable: 'me', data: me }] : [] },
    document: {
      querySelector: selector => selector === '.header__loginButton, .header__login' ? login : null,
      querySelectorAll: () => link ? [link] : [],
    },
    navigator: {}, console: { log: value => messages.push(value) },
    URL, getComputedStyle: () => ({ visibility: 'visible' }),
    setInterval: () => 1, clearInterval() {},
  };
  vm.runInNewContext(code, context, { timeout: 500 });
  return JSON.parse(messages.find(message => message.startsWith('LolzCloudReceive|Playback|')).slice('LolzCloudReceive|Playback|'.length));
}
test('a hidden login element cannot erase the signed-in listener or expose their token', () => {
  const result = read({ me: { id: 33, username: 'Listener', permalink_url: 'https://soundcloud.com/listener', oauth_token: 'DO_NOT_EXPORT' } });
  assert.equal(result.account.url, 'https://soundcloud.com/listener');
  assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));
});
test('the avatar inside the header profile anchor identifies the listener', () => {
  assert.equal(read({ headerProfile: 'https://soundcloud.com/listener' }).account.url, 'https://soundcloud.com/listener');
});
test('logged-out and unresolved sessions do not invent a SoundCloud button', () => {
  assert.equal(read({ visibleLogin: true }).account, null);
  assert.equal(Object.hasOwn(read({ headerProfile: 'https://soundcloud.com/you' }), 'account'), false);
});
