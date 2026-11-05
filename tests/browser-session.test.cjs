'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { BrowserSessionTransfer, parseCookies, readExport, applyCookies, bookmarklet } = require('../source/integrations/browser-session.cjs');
const cookie = (value = 'fixture-session') => ({ domain: '.soundcloud.com', name: 'oauth_token', value, path: '/', secure: true, httpOnly: true, session: true, hostOnly: false });
function target(fail = false) {
  let rows = [cookie('old-fixture')], failed = false;
  return { cookies: {
    get: async () => structuredClone(rows), flushStore: async () => {},
    remove: async (_url, name) => { rows = rows.filter(row => row.name !== name); },
    set: async row => { if (fail && !failed && row.value === 'new-fixture') { failed = true; throw Error('storage failure'); } rows = rows.filter(value => value.name !== row.name); rows.push({ ...row, domain: row.domain || new URL(row.url).hostname, session: !row.expirationDate }); }
  }, values: () => rows };
}
test('browser exports accept JSON, Playwright-style expiry and Netscape HttpOnly without other sites', () => {
  const other = { ...cookie(), domain: '.example.org' };
  assert.equal(parseCookies(JSON.stringify({ cookies: [other, cookie()] })).length, 1);
  assert.equal(parseCookies('# Netscape HTTP Cookie File\n#HttpOnly_.soundcloud.com\tTRUE\t/\tTRUE\t0\toauth_token\tfixture-token')[0].httpOnly, true);
  assert.equal(parseCookies(JSON.stringify([{ ...cookie(), expires: -1 }]))[0].session, true);
  assert.throws(() => parseCookies(JSON.stringify([{ ...cookie(), domain: 'soundcloud.com.evil.test' }])));
  assert.throws(() => parseCookies(JSON.stringify([{ ...cookie(), session: false, expirationDate: 1 }])));
  assert.throws(() => parseCookies(JSON.stringify([{ ...cookie(), value: 'header\r\ninjection' }])));
});
test('replacing a session removes conflicting cookies and a failed write restores the old login', async () => {
  const clean = target(); await applyCookies(clean, [cookie('new-fixture')]); assert.equal(clean.values().length, 1); assert.equal(clean.values()[0].value, 'new-fixture');
  const broken = target(true); await assert.rejects(applyCookies(broken, [cookie('new-fixture')]), /сохранить вход/); assert.equal(broken.values()[0].value, 'old-fixture');
});
test('the actual browser bookmark encrypts its session, imports once and rejects other origins and tampering', async t => {
  let now = Date.now(); const destination = target(), events = [];
  const bridge = new BrowserSessionTransfer({ target: destination, now: () => now, onImported: result => events.push(result) }); t.after(() => bridge.stop());
  const url = await bridge.start(), context = bridge.context;
  const page = await fetch(url); assert.equal(page.status, 200); const html = await page.text();
  assert.ok(html.includes('Войти в LolzCloud')); assert.ok(!html.includes('{{')); assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  let navigation = ''; const location = { protocol: 'https:', hostname: 'soundcloud.com', assign: url => { navigation = url; } };
  await vm.runInNewContext(bookmarklet(context).replace(/^javascript:void /, ''), { location, document: { cookie: 'oauth_token=new-fixture; _ga=not-transferred' }, crypto: crypto.webcrypto, TextEncoder, Uint8Array, Set, JSON, atob, btoa, encodeURIComponent, alert: value => { throw Error(value); } });
  assert.ok(navigation.startsWith(url + 'receive#')); assert.ok(!navigation.includes('new-fixture'));
  const envelope = JSON.parse(decodeURIComponent(new URL(navigation).hash.slice(1))), endpoint = url + 'import';
  const post = (body, origin = context.origin) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await post(envelope, 'https://soundcloud.com.evil.test')).status, 403);
  assert.equal((await post(envelope, 'null')).status, 403);
  const bad = { ...envelope, data: Buffer.from('wrong ciphertext').toString('base64') }; assert.equal((await post(bad)).status, 400); assert.equal(destination.values()[0].value, 'old-fixture');
  const accepted = await post(envelope); assert.equal(accepted.status, 200); assert.equal((await accepted.json()).ok, true); assert.equal(destination.values()[0].value, 'new-fixture');
  assert.equal(events.length, 1); assert.ok(!JSON.stringify(bridge.state()).includes('new-fixture')); assert.ok(!JSON.stringify(events).includes('new-fixture')); assert.equal((await post(envelope)).status, 410);
  await bridge.start(); now += 6 * 60000; assert.equal((await fetch(bridge.context.url)).status, 410);
});
test('the browser helper exports HttpOnly login with a password and the app decrypts it without plaintext files', async () => {
  const controls = { password: { value: 'fixture-password-123' }, export: { disabled: false }, status: { textContent: '' } }; let handler, blob;
  const document = { querySelector: () => ({ addEventListener: (_type, value) => { handler = value; } }), getElementById: id => controls[id] ||= {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/app/session-transfer/helper/popup.js'), 'utf8'), { document, browser: { runtime: { sendMessage: async () => ({ ok: false, error: 'No active fixture transfer' }) }, cookies: { getAll: async () => [cookie('new-fixture'), { ...cookie('other-secret'), domain: '.example.org' }] } }, crypto: crypto.webcrypto, TextEncoder, Uint8Array, Date, Set, JSON, btoa, Blob, URL: { createObjectURL: value => { blob = value; return 'blob:test'; }, revokeObjectURL() {} }, setTimeout: () => {} });
  await handler({ preventDefault() {} }); assert.ok(blob); const text = await blob.text(); assert.ok(!text.includes('new-fixture')); assert.ok(!text.includes('other-secret')); assert.equal(controls.password.value, '');
  assert.equal((await readExport(text, 'fixture-password-123'))[0].value, 'new-fixture');
  await assert.rejects(readExport(text), error => error.code === 'SESSION_PASSWORD_REQUIRED'); await assert.rejects(readExport(text, 'wrong-password'), /Пароль/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../source/app/session-transfer/helper/manifest.json')));
  assert.deepEqual(manifest.permissions, ['cookies', 'storage', 'activeTab']); assert.ok(manifest.host_permissions.every(value => /^https:\/\/(?:\*\.)?soundcloud\.com\//.test(value) || value === 'http://127.0.0.1/*'));
});
