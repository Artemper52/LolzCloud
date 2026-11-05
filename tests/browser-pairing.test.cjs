'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), vm = require('node:vm');
const { createBrowserIdentity } = require('../source/integrations/browser-session-identity.cjs');
const { BrowserSessionTransfer } = require('../source/integrations/browser-session.cjs');
const bridge = require('../source/app/session-transfer/helper/bridge.js');
const helper = path.join(__dirname, '../source/app/session-transfer/helper');
const cookie = { domain: '.soundcloud.com', name: 'oauth_token', value: 'fixture-httponly-session', path: '/', secure: true, httpOnly: true, session: true };
const target = () => { let rows = []; return { cookies: { get: async () => rows, set: async row => { rows.push(row); }, remove: async () => { rows = []; }, flushStore: async () => {} }, rows: () => rows }; };
function worker(engine, context) {
  let listener, reads = 0, retried = 0, stored = {};
  const runtime = { getURL: name => 'chrome-extension://fixture/' + name, onMessage: { addListener: callback => { listener = callback; } } };
  const api = { runtime, cookies: { getAll: async () => { reads++; return [cookie, { ...cookie, domain: '.example.org', value: 'unrelated-secret' }]; } }, storage: { local: { get: async () => structuredClone(stored), set: async value => { stored = { ...stored, ...structuredClone(value) }; }, remove: async name => { delete stored[name]; } } }, tabs: { query: async () => [{ id: 7, url: context.url }], sendMessage: async (_id, message) => { if (message.type === 'describe-transfer') return { request: context.request }; retried++; return { ok: true }; } } };
  if (engine === 'chrome') {
    for (const object of [api.cookies, api.storage.local, api.tabs]) for (const name of Object.keys(object)) {
      const original = object[name]; object[name] = (...args) => { const callback = args.pop(); original(...args).then(callback); };
    }
  }
  const scope = { [engine]: api, crypto: crypto.webcrypto, TextEncoder, Uint8Array, atob, btoa, URL, Date, Set, JSON, Promise };
  vm.createContext(scope); vm.runInContext(fs.readFileSync(path.join(helper, 'bridge.js'), 'utf8'), scope); vm.runInContext(fs.readFileSync(path.join(helper, 'background.js'), 'utf8'), scope);
  return { send: (message, sender) => new Promise(resolve => listener(message, sender, resolve)), reads: () => reads, stored: () => stored, retried: () => retried };
}

test('persistent browser pairing keys remain OS-encrypted and a temporarily unavailable key is preserved', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-pairing-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32), safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: value => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]); }, decryptString: value => { const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(); } };
  const filename = path.join(directory, 'browser-pairing.json'), identity = createBrowserIdentity({ filename, safeStorage }), saved = fs.readFileSync(filename, 'utf8');
  assert.equal(identity.persistent, true); assert.ok(!saved.includes('PRIVATE KEY')); assert.equal(createBrowserIdentity({ filename, safeStorage }).publicKey, identity.publicKey);
  const temporary = createBrowserIdentity({ filename, safeStorage: { isEncryptionAvailable: () => false } }); assert.equal(temporary.persistent, false); assert.notEqual(temporary.publicKey, identity.publicKey); assert.equal(fs.readFileSync(filename, 'utf8'), saved);
});

test('browser request signatures bind the receiver, encryption key, expiry and installation identity', async t => {
  const app = new BrowserSessionTransfer({ target: target() }); t.after(() => app.stop()); const url = await app.start(), request = app.context.request;
  assert.equal((await bridge.verify(request, url)).code, app.state().pairingCode);
  for (const change of [{ key: crypto.randomBytes(32).toString('base64') }, { expiresAt: request.expiresAt + 100 }, { publicKey: createBrowserIdentity().publicKey }]) await assert.rejects(bridge.verify({ ...request, ...change }, url));
  for (const invalid of [url.replace('127.0.0.1', 'localhost'), url + '?fake', url + '#fake', url.replace('http:', 'https:'), url.replace('127.0.0.1', '127.0.0.1.evil.test'), url.replace('127.0.0.1', 'name@127.0.0.1')]) await assert.rejects(bridge.verify(request, invalid));
  await assert.rejects(bridge.verify(request, url, request.expiresAt));
  const html = await (await fetch(url)).text(); assert.ok(html.includes('lolzcloud-transfer-request')); assert.ok(html.includes(app.state().pairingCode)); assert.ok(!html.includes('{{'));
});

for (const engine of ['browser', 'chrome']) test(engine + ': HttpOnly sessions transfer automatically only after popup approval, survive app restart and can be revoked', async t => {
  const destination = target(), identity = createBrowserIdentity(), app = new BrowserSessionTransfer({ target: destination, identity }); t.after(() => app.stop());
  const url = await app.start(), context = { url, request: app.context.request }, extension = worker(engine, context);
  const sender = () => ({ url: context.url, frameId: 0, tab: { id: 7, url: context.url } }), popup = { url: 'chrome-extension://fixture/popup.html' };
  const transfer = () => extension.send({ type: 'auto-transfer', request: context.request }, sender());
  assert.equal((await transfer()).needsPairing, true); assert.equal(extension.reads(), 0);
  assert.equal((await extension.send({ type: 'pair', fingerprint: 'fake' }, sender())).ok, false); assert.equal(extension.reads(), 0);
  const info = await extension.send({ type: 'pair-info' }, popup); assert.equal(info.code, app.state().pairingCode); assert.equal(info.paired, false);
  assert.equal((await extension.send({ type: 'pair', fingerprint: info.fingerprint }, popup)).ok, true); assert.equal(extension.retried(), 1);
  const result = await transfer(); assert.equal(result.ok, true); assert.ok(result.envelope); assert.equal(extension.reads(), 1); assert.ok(!JSON.stringify(result).includes(cookie.value));
  const accepted = await fetch(context.url + 'import', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.context.origin }, body: JSON.stringify(result.envelope) }); assert.equal(accepted.status, 200); assert.equal(destination.rows()[0].value, cookie.value); assert.ok(!JSON.stringify(destination.rows()).includes('unrelated-secret'));
  app.stop(); context.url = await app.start(); context.request = app.context.request;
  assert.ok((await transfer()).envelope, 'The already paired app must work on a different loopback port without approval');
  const readCount = extension.reads();
  for (const invalid of [{ ...sender(), frameId: 1 }, { ...sender(), url: 'https://soundcloud.com/' }, { ...sender(), tab: { url: 'http://127.0.0.1:9/' } }]) assert.equal((await extension.send({ type: 'auto-transfer', request: context.request }, invalid)).ok, false);
  assert.equal(extension.reads(), readCount);
  const original = context.request; context.request = { ...original, key: crypto.randomBytes(32).toString('base64') }; assert.equal((await transfer()).ok, false); assert.equal(extension.reads(), readCount); context.request = original;
  const fake = new BrowserSessionTransfer({ target: target() }); t.after(() => fake.stop()); context.url = await fake.start(); context.request = fake.context.request;
  assert.equal((await transfer()).needsPairing, true); assert.equal(extension.reads(), readCount, 'A different local server must never get cookies without approval');
  context.url = app.context.url; context.request = app.context.request;
  assert.equal((await extension.send({ type: 'forget' }, popup)).ok, true); assert.equal((await transfer()).needsPairing, true); assert.equal(extension.reads(), readCount);
  assert.ok(!JSON.stringify(extension.stored()).includes(cookie.value));
});

test('the helper ships separate Chromium worker and Firefox background manifests', async () => {
  await require('../tools/build-session-helper.cjs').buildSessionHelper();
  const open = filename => new Promise((resolve, reject) => require('yauzl').open(filename, { lazyEntries: true }, (error, zip) => error ? reject(error) : resolve(zip)));
  for (const firefox of [false, true]) {
    const zip = await open(path.join(helper, '..', firefox ? 'helper-firefox.zip' : 'helper.zip'));
    const manifest = await new Promise((resolve, reject) => { zip.on('entry', entry => { if (entry.fileName !== 'manifest.json') return zip.readEntry(); zip.openReadStream(entry, (error, stream) => { if (error) return reject(error); const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('end', () => { resolve(JSON.parse(Buffer.concat(chunks))); zip.close(); }); }); }); zip.on('error', reject); zip.readEntry(); });
    assert.deepEqual(manifest.background, firefox ? { scripts: ['bridge.js', 'background.js'] } : { service_worker: 'background.js' });
  }
});
