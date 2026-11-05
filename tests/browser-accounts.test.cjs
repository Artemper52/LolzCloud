'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { BrowserProfiles, discoverBrowsers } = require('../source/integrations/browser-profiles.cjs');
const { BrowserSessionTransfer } = require('../source/integrations/browser-session.cjs');
const { recoverPreviousSession } = require('../source/integrations/session-recovery.cjs');
const { previewSessionProfile } = require('../source/integrations/sc-profile.cjs');
const bridge = require('../source/app/session-transfer/helper/bridge.js');
function temporary(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-browser-choice-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
function target() { let rows = []; return { cookies: { get: async () => rows, set: async value => { rows.push(value); }, remove: async () => { rows = []; }, flushStore: async () => {} }, values: () => rows }; }
const cookie = value => ({ domain: '.soundcloud.com', path: '/', name: 'oauth_token', value, secure: true, httpOnly: true, session: true });
const profile = name => ({ id: name === 'Alice' ? 1 : 2, name, url: 'https://soundcloud.com/' + name.toLowerCase() });

test('browser profiles are discovered from names only, unsafe profile paths stay out of launch arguments', async t => {
  const directory = temporary(t), options = { platform: 'win32', local: path.join(directory, 'Local'), roaming: path.join(directory, 'Roaming'), programs: path.join(directory, 'Programs'), programsX86: path.join(directory, 'Programs32') };
  const executable = path.join(options.programs, 'Google/Chrome/Application/chrome.exe'), state = path.join(options.local, 'Google/Chrome/User Data/Local State');
  fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, 'fixture executable'); fs.mkdirSync(path.dirname(state), { recursive: true }); fs.writeFileSync(state, JSON.stringify({ os_crypt: { encrypted_key: 'fixture-key-do-not-export' }, profile: { info_cache: { Default: { name: 'Main', user_name: 'main@example.test' }, 'Profile 1': { name: 'Music' }, '../outside': { name: 'Ignore' } } } }));
  const rows = discoverBrowsers(options); assert.equal(rows.length, 2); assert.deepEqual(rows[1].args, ['--profile-directory=Profile 1']);
  let launched; const catalog = new BrowserProfiles({ discover: () => rows, launch: (file, args) => { launched = { file, args }; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; } });
  const shown = catalog.list(); assert.ok(shown.some(row => row.detail.includes('main@example.test'))); assert.ok(!JSON.stringify(shown).includes('fixture-key-do-not-export')); assert.ok(!JSON.stringify(shown).includes(executable));
  const url = 'http://127.0.0.1:4567/transfer/' + 'a'.repeat(48) + '/'; await catalog.open(shown[1].id, url); assert.deepEqual(launched.args, ['--profile-directory=Profile 1', url]);
  await assert.rejects(catalog.open(shown[0].id, 'https://evil.test/')); await assert.rejects(catalog.open('missing', url));
});

test('several browser accounts can be previewed without replacing the app login, only the chosen session is imported', async t => {
  const destination = target(), events = [], app = new BrowserSessionTransfer({ target: destination, onImported: async value => events.push(value) }); t.after(() => app.stop());
  const url = await app.start({ choose: true }), request = app.context.request;
  async function offer(name, browser) { const envelope = await bridge.encrypt(request, [cookie('fixture-' + name)], { profile: profile(name), browser }); const response = await fetch(url + 'import', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.context.origin }, body: JSON.stringify(envelope) }); assert.equal(response.status, 200); assert.equal((await response.json()).pendingChoice, true); }
  await offer('Alice', 'Microsoft Edge'); await offer('Bob', 'Firefox'); await offer('Alice', 'Microsoft Edge');
  assert.equal(app.state().accounts.length, 2); assert.equal(destination.values().length, 0); assert.equal(events.length, 0); assert.ok(!JSON.stringify(app.state()).includes('fixture-Alice')); assert.ok(!JSON.stringify(app.state()).includes('fixture-Bob'));
  const bob = app.state().accounts.find(row => row.name === 'Bob'); await app.select(bob.id);
  assert.equal(destination.values()[0].value, 'fixture-Bob'); assert.equal(events[0].profile.name, 'Bob'); assert.equal(app.state().imported, true); assert.equal(app.state().accounts.length, 0); await assert.rejects(app.select(bob.id));
});

test('an expired or cancelled account chooser cannot import a previously offered account', async t => {
  let now = Date.now(); const app = new BrowserSessionTransfer({ target: target(), now: () => now }); t.after(() => app.stop());
  await app.start({ choose: true }); await app.offer([cookie('fixture')], { profile: profile('Alice') }); const id = app.state().accounts[0].id;
  now += 6 * 60000; await assert.rejects(app.select(id)); app.stop(); assert.equal(app.state().accounts.length, 0); await assert.rejects(app.select(id));
});

test('account preview uses only the offered SoundCloud token without borrowing or replacing the active login', async () => {
  let request;
  const destination = { fetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ id: 1, username: 'Alice', permalink_url: 'https://soundcloud.com/alice', email: 'private@example.test' }) }; } };
  const result = await previewSessionProfile(destination, [cookie('offered-fixture')]);
  assert.equal(request.url, 'https://api.soundcloud.com/me'); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.headers.Authorization, 'OAuth offered-fixture');
  assert.equal(result.name, 'Alice'); assert.ok(!JSON.stringify(result).includes('private@example.test'));
  request = null; assert.equal(await previewSessionProfile(destination, [{ ...cookie('wrong-domain'), domain: 'evil.test' }]), null); assert.equal(request, null);
});

test('a previous LolzCloud installation is recovered automatically before browser onboarding, while logout is respected', async t => {
  const directory = temporary(t), app = { getPath: name => name === 'appData' ? directory : path.join(directory, 'LolzCloud') };
  let allowed = true, started = 0, imported = 0, accepted = 0;
  const saved = { start: async () => { started++; }, canRecoverLegacy: () => allowed, acceptImported: async () => { accepted++; } };
  await recoverPreviousSession({ app, target: {}, saved, importPrevious: async () => { imported++; } }); assert.equal(started, 1); assert.equal(imported, 1); assert.equal(accepted, 1); assert.equal(saved.source, 'previous-version');
  allowed = false; await recoverPreviousSession({ app, target: {}, saved, importPrevious: async () => { imported++; } }); assert.equal(imported, 1);
  allowed = true; await recoverPreviousSession({ app: { getPath: () => directory }, target: {}, saved, importPrevious: async () => { imported++; } }); assert.equal(imported, 1, 'Isolated test profiles must not read a real previous account');
});
