'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { EncryptedStore } = require('../source/integrations/lolzteam/store.cjs');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');
const { SoundCloudSession } = require('../source/integrations/soundcloud-session.cjs');
const { LyricSettings } = require('../source/integrations/lyric-settings.cjs');
const { ListeningRoom } = require('../source/integrations/room.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-persistence-'));
  t.after(() => { if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('lolzcloud-persistence-')) fs.rmSync(dir, { recursive: true, force: true }); });
  const key = crypto.randomBytes(32); let available = true;
  const safe = { getSelectedStorageBackend: () => 'gnome_libsecret', isEncryptionAvailable: () => available, encryptString(value) { const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final()]); }, decryptString(value) { if (!available) throw new Error('OS key unavailable'); const decipher = crypto.createDecipheriv('aes-256-cbc', key, value.subarray(0, 16)); return Buffer.concat([decipher.update(value.subarray(16)), decipher.final()]).toString(); } };
  return { dir, safe, available: value => { available = value; } };
}
function browser(initial = []) {
  const cookies = new EventEmitter(); let rows = structuredClone(initial); let flushes = 0;
  cookies.get = async () => structuredClone(rows);
  cookies.set = async value => { rows = rows.filter(row => row.name !== value.name); rows.push({ ...value, domain: value.domain || new URL(value.url).hostname, session: value.expirationDate === undefined, hostOnly: !value.domain }); };
  cookies.flushStore = async () => { flushes++; };
  return { cookies, flushStorageData() {}, rows: () => rows, clear() { const row = rows.find(row => row.name === 'oauth_token'); rows = []; cookies.emit('changed', {}, row, 'explicit', true); }, flushes: () => flushes };
}
const cookie = { domain: '.soundcloud.com', hostOnly: false, name: 'oauth_token', value: 'fixture-soundcloud-login', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true };
test('track navigation never replaces known metadata with an empty welcome state', () => {
  const service = new LolzteamService({ api: {}, store: { load: () => null, save() {} } });
  const first = { url: 'https://soundcloud.com/test/first', title: 'First', artist: 'Fixture', duration: 100, playing: true };
  service.setPlayback(first); service.setPlayback({}); assert.equal(service.getState().displayPlayback.title, 'First'); assert.equal(service.getState().playback.title, '');
  const next = { ...first, url: 'https://soundcloud.com/test/next', title: 'Next' }; service.beginPlayback(next); service.setPlayback({});
  assert.equal(service.getState().displayPlayback.title, 'Next'); assert.equal(service.getState().displayPlayback.playing, false);
  service.setPlayback(next); assert.equal(service.getState().transitioning, false); assert.equal(service.getState().displayPlayback.title, 'Next');
});
test('temporary Windows key failures cannot erase a forum binding and recover automatically', async t => {
  const f = fixture(t), file = path.join(f.dir, 'forum.json'), store = new EncryptedStore(file, f.safe);
  store.save({ token: 'fixture-forum-login', user: { id: 123, name: 'Fixture' }, settings: { prefix: '♫' } }); const original = fs.readFileSync(file);
  f.available(false); let time = Date.now(); const model = new LolzteamService({ api: {}, store, now: () => time });
  assert.equal(model.getState().storagePending, true); model.setProfile({ url: 'https://soundcloud.com/fixture', name: 'Fixture' });
  assert.deepEqual(fs.readFileSync(file), original); assert.throws(() => store.save({ token: '' }), /сохранённая|Сохранённая/); await assert.rejects(model.configure({ prefix: 'x' }));
  f.available(true); time += 5001; await model.tick(); assert.equal(model.getState().connected, true); assert.equal(model.getState().storagePending, false); assert.equal(model.getState().settings.prefix, '♫');
});
test('explicitly forgetting an unreadable forum binding never resurrects it on another launch', async t => {
  const f = fixture(t), file = path.join(f.dir, 'forum.json'), store = new EncryptedStore(file, f.safe); store.save({ token: 'fixture-forum-login', user: { id: 123, name: 'Fixture' }, settings: {} });
  f.available(false); const model = new LolzteamService({ api: {}, store }); await model.disconnect(true); f.available(true);
  assert.equal(new LolzteamService({ api: {}, store: new EncryptedStore(file, f.safe) }).getState().connected, false);
});
test('SoundCloud session cookies survive a cold start in an encrypted snapshot without invented cookie expiry', async t => {
  const f = fixture(t), filename = path.join(f.dir, 'soundcloud.json'), first = browser([cookie]), saved = new SoundCloudSession({ session: first, safeStorage: f.safe, filename });
  await saved.start(); await saved.dispose(); assert.ok(!fs.readFileSync(filename, 'utf8').includes(cookie.value));
  const second = browser(), restored = new SoundCloudSession({ session: second, safeStorage: f.safe, filename }); await restored.start(); t.after(() => restored.dispose());
  assert.equal(second.rows()[0].value, cookie.value); assert.equal(second.rows()[0].expirationDate, undefined); assert.equal(second.rows()[0].secure, true); assert.equal(second.rows()[0].httpOnly, true); assert.equal(restored.state().restored, true); assert.ok(second.flushes());
});
test('an explicit SoundCloud logout clears the snapshot and cannot be undone by a restart', async t => {
  const f = fixture(t), filename = path.join(f.dir, 'soundcloud.json'), session = browser([cookie]), model = new SoundCloudSession({ session, safeStorage: f.safe, filename }); await model.start(); session.clear(); await model.dispose();
  const second = browser(), next = new SoundCloudSession({ session: second, safeStorage: f.safe, filename }); await next.start(); t.after(() => next.dispose()); assert.equal(second.rows().length, 0); assert.equal(JSON.parse(fs.readFileSync(filename)).cleared, true);
});
test('a saved SoundCloud login remains intact while Windows encryption is temporarily unavailable', async t => {
  const f = fixture(t), filename = path.join(f.dir, 'soundcloud.json'), original = new SoundCloudSession({ session: browser([cookie]), safeStorage: f.safe, filename }); await original.start(); await original.dispose(); const bytes = fs.readFileSync(filename);
  f.available(false); const session = browser(), next = new SoundCloudSession({ session, safeStorage: f.safe, filename }); await next.start(); await next.flush(); assert.equal(next.state().recovering, true); assert.deepEqual(fs.readFileSync(filename), bytes);
  f.available(true); await next.restore(); assert.equal(session.rows()[0].value, cookie.value); t.after(() => next.dispose());
});
test('a current SoundCloud account takes precedence over a cached account and expired snapshots are ignored', async t => {
  const f = fixture(t), filename = path.join(f.dir, 'soundcloud.json'); let now = Date.now(); const original = new SoundCloudSession({ session: browser([cookie]), safeStorage: f.safe, filename, now: () => now }); await original.start(); await original.dispose();
  const session = browser([{ ...cookie, value: 'fixture-other-account' }]), next = new SoundCloudSession({ session, safeStorage: f.safe, filename, now: () => now }); await next.start(); assert.equal(session.rows()[0].value, 'fixture-other-account'); await next.dispose();
  now += 31 * 86400000; const empty = browser(), expired = new SoundCloudSession({ session: empty, safeStorage: f.safe, filename, now: () => now }); await expired.start(); t.after(() => expired.dispose()); assert.equal(empty.rows().length, 0);
});
test('encrypted lyric keys are not cleared by an unrelated setting change during a key failure', t => {
  const f = fixture(t), file = path.join(f.dir, 'lyrics.json'), first = new LyricSettings(file, f.safe); first.configure({ keys: { spicy: 'sl_pk_fixture_lyrics_key' } }); const original = fs.readFileSync(file);
  f.available(false); const next = new LyricSettings(file, f.safe); assert.equal(next.state().locked, true); assert.throws(() => next.configure({ merge: false })); assert.deepEqual(fs.readFileSync(file), original);
  f.available(true); next.retryAt = 0; assert.equal(next.retry(), true); assert.equal(next.state().configured.spicy, true);
});
test('cloud room sessions recover from temporary Windows key failures without opening a new login', async t => {
  const f = fixture(t), file = path.join(f.dir, 'cloud.json'), first = new ListeningRoom(() => ({}), { filename: file, safeStorage: f.safe }); first.token = 'x'.repeat(43); first.expires = Date.now() + 86400000; first.user = { id: 123, name: 'Fixture' }; first.persist(); await first.dispose(); const original = fs.readFileSync(file);
  f.available(false); const next = new ListeningRoom(() => ({}), { filename: file, safeStorage: f.safe }); assert.equal(next.getState().recovering, true); await assert.rejects(next.login()); assert.deepEqual(fs.readFileSync(file), original);
  f.available(true); next.storageRetryAt = 0; await next.tick(); assert.equal(next.getState().authenticated, true); assert.equal(next.getState().recovering, false); t.after(() => next.dispose());
});
