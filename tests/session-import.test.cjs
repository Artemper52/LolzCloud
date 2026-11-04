'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { transferable, cookieDetails } = require('../source/integrations/session-import.cjs');

test('session import transfers only SoundCloud login cookies', () => {
  assert.equal(transferable({ domain: '.soundcloud.com', name: 'oauth_token', value: 'test' }), true);
  assert.equal(transferable({ domain: 'soundcloud.com', name: '_ga', value: 'test' }), false);
  assert.equal(transferable({ domain: '.google.com', name: 'oauth_token', value: 'test' }), false);
  assert.equal(transferable({ domain: 'soundcloud.com.evil.example', name: 'oauth_token', value: 'test' }), false);
  assert.equal(transferable({ domain: 'soundcloud.com', name: 'oauth_token', value: '' }), false);
});

test('cookie import preserves security and host-only semantics without inventing expiry', () => {
  const host = cookieDetails({ domain: 'soundcloud.com', hostOnly: true, name: 'oauth_token', value: 'test', path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' });
  assert.equal(host.url, 'https://soundcloud.com/');
  assert.equal(host.httpOnly, true);
  assert.equal(host.secure, true);
  assert.equal(host.domain, undefined);
  assert.equal(host.expirationDate, undefined);
  const domain = cookieDetails({ domain: '.soundcloud.com', name: 'sc_session', value: 'test', path: '/', expirationDate: 2_000_000_000, session: false });
  assert.equal(domain.domain, '.soundcloud.com');
  assert.equal(domain.expirationDate, 2_000_000_000);
  assert.throws(() => cookieDetails({ domain: 'evil.example', name: 'oauth_token', value: 'test' }));
});
