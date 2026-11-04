'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  DEFAULT_SETTINGS, formatStatus, normalizePlayback, seconds, clock,
} = require('../source/integrations/lolzteam/status.cjs');
const { ApiError, retryDelay } = require('../source/integrations/lolzteam/api.cjs');
const { EncryptedStore } = require('../source/integrations/lolzteam/store.cjs');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');

const TOKEN = 'test-token-' + 'x'.repeat(40);
const track = (patch = {}) => ({
  title: 'Ночной город | live', artist: 'Исполнитель', position: 83, duration: 225,
  playing: true, url: 'https://soundcloud.com/artist/track', ...patch,
});

function fixture({ original = 'Мой прежний статус', canEdit = true, saved = null } = {}) {
  let time = 1_700_000_000_000;
  let disk = saved;
  const remote = { title: original, canEdit };
  const writes = [];
  const reads = [];
  const store = { load: () => disk && structuredClone(disk), save: value => { disk = structuredClone(value); } };
  const api = {
    async getUser(token) {
      assert.equal(token, TOKEN);
      reads.push(time);
      return { user_id: 123, username: 'test_user', custom_title: remote.title, user_title: 'Group title', edit_permissions: { user_title: remote.canEdit } };
    },
    async setTitle(token, title) {
      assert.equal(token, TOKEN);
      assert.equal(typeof title, 'string');
      writes.push({ time, title });
      remote.title = title;
      return { status: 'ok' };
    },
  };
  const service = new LolzteamService({ api, store, now: () => time });
  return {
    service, api, remote, writes, reads, store,
    advance: amount => { time += amount; },
    disk: () => structuredClone(disk),
    async start() { await service.connect(TOKEN); service.setPlayback(track()); await service.configure({ enabled: true }); },
    async tick() { await new Promise(resolve => setImmediate(resolve)); await service.tick(); },
  };
}

test('status includes artist, complete timecode and pipe characters from the track', () => {
  assert.equal(formatStatus(track()), '♫ Исполнитель — Ночной город | live · 1:23/3:45');
});

test('long Unicode names are shortened to 50 UTF-16 units without losing the timecode', () => {
  const status = formatStatus(track({ title: '🎵'.repeat(70), artist: 'Очень длинный исполнитель' }));
  assert.ok(status.length <= 50);
  assert.ok(status.endsWith(' · 1:23/3:45'));
  assert.ok(status.includes('…'));
  assert.equal(status.isWellFormed(), true);
});

test('normalization handles hours, missing durations and hostile data without evaluating it', () => {
  assert.equal(seconds('1:02:03'), 3723);
  assert.equal(clock(3723), '1:02:03');
  assert.equal(seconds('1:99'), 0);
  assert.equal(seconds('-40'), 0);
  const data = normalizePlayback(track({ position: 500, duration: 100, url: 'javascript:alert(1)', title: 'line\nnext' }));
  assert.equal(data.position, 100);
  assert.equal(data.url, '');
  assert.equal(data.title, 'line next');
  assert.equal(formatStatus(track({ duration: 0 })), '♫ Исполнитель — Ночной город | live · 1:23');
});

test('binding is read-only and the state returned to the UI never contains the token', async () => {
  const f = fixture();
  await f.service.connect(TOKEN);
  assert.equal(f.writes.length, 0);
  assert.equal(f.service.getState().settings.enabled, false);
  assert.ok(!JSON.stringify(f.service.getState()).includes(TOKEN));
  assert.equal(f.service.getState().originalTitle, 'Мой прежний статус');
});

test('automatic writes happen at least 60 seconds apart and use the newest track', async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.writes.length, 1);
  f.advance(59_999);
  f.service.setPlayback(track({ title: 'Второй трек', position: 17 }));
  await f.tick();
  assert.equal(f.writes.length, 1);
  f.advance(1);
  await f.tick();
  assert.equal(f.writes.length, 2);
  assert.ok(f.writes[1].title.includes('Второй трек'));
  assert.equal(f.writes[1].time - f.writes[0].time, 60_000);
  const restarted = fixture({ saved: f.disk() });
  assert.equal(restarted.service.getState().nextUpdateAt, f.disk().nextWriteAt);
});

test('pause restores the actual custom title, including an empty original title', async () => {
  const f = fixture({ original: '' });
  await f.start();
  f.advance(60_000);
  f.service.setPlayback(track({ playing: false }));
  await f.tick();
  assert.equal(f.remote.title, '');
  assert.equal(f.disk().ownsStatus, false);
});

test('paused and keep policies behave differently; disabling always restores', async () => {
  const f = fixture();
  await f.start();
  await f.service.configure({ pauseBehavior: 'paused' });
  f.advance(60_000);
  f.service.setPlayback(track({ playing: false }));
  await f.tick();
  assert.ok(f.remote.title.startsWith('Ⅱ '));
  await f.service.configure({ pauseBehavior: 'keep' });
  f.advance(60_000);
  f.service.setPlayback(track({ playing: false, position: 100 }));
  await f.tick();
  assert.equal(f.writes.length, 2);
  await f.service.configure({ enabled: false });
  assert.equal(f.remote.title, 'Мой прежний статус');
});

test('missing playback heartbeats restore stale music instead of broadcasting forever', async () => {
  const f = fixture();
  await f.start();
  f.advance(60_000);
  await f.tick();
  assert.equal(f.remote.title, 'Мой прежний статус');
  assert.equal(f.service.getState().fresh, false);
});

test('private mode immediately restores the original title and excludes the track', async () => {
  const f = fixture(); await f.start();
  await f.service.configure({ privateMode: true });
  assert.equal(f.remote.title, 'Мой прежний статус'); assert.equal(f.service.getState().private, true);
  await f.service.configure({ privateMode: false, excludedTracks: ['https://soundcloud.com/artist/track'] });
  assert.equal(f.service.getState().private, true);
});

test('a manual forum edit stops broadcasting and is never overwritten by restoration', async () => {
  const f = fixture();
  await f.start();
  f.remote.title = 'Статус, установленный вручную';
  f.advance(60_000);
  f.service.setPlayback(track({ position: 143 }));
  await f.tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.remote.title, 'Статус, установленный вручную');
  assert.equal(f.service.getState().settings.enabled, false);
  await f.service.shutdown();
  assert.equal(f.remote.title, 'Статус, установленный вручную');
});

test('the forum edit_permissions hint does not block an otherwise permitted status write', async () => {
  const f = fixture({ canEdit: false });
  await f.start();
  assert.equal(f.writes.length, 1);
  assert.equal(f.service.getState().user.canEditStatus, true);
});

test('an actual 403 disables publication and reports the permission failure', async () => {
  const f = fixture();
  await f.service.connect(TOKEN);
  f.service.setPlayback(track());
  f.api.setTitle = async () => { throw new ApiError('Недостаточно прав.', 403); };
  await f.service.configure({ enabled: true });
  assert.equal(f.writes.length, 0);
  assert.equal(f.service.getState().settings.enabled, false);
  assert.equal(f.service.getState().user.canEditStatus, false);
  assert.equal(f.service.getState().error, 'Недостаточно прав.');
});

test('an account linked by the older permission check migrates without requiring its token again', () => {
  const f = fixture({ saved: {
    token: TOKEN, user: { id: 123, name: 'test_user', canEditStatus: false }, settings: { ...DEFAULT_SETTINGS },
  } });
  assert.equal(f.service.getState().connected, true);
  assert.equal(f.service.getState().user.canEditStatus, null);
});

test('429 honors server retry time, including manual restore attempts', async () => {
  const f = fixture();
  await f.service.connect(TOKEN);
  f.service.setPlayback(track());
  const setTitle = f.api.setTitle;
  let attempts = 0;
  f.api.setTitle = async () => { attempts++; throw new ApiError('Лимит Lolzteam.', 429, 180_000); };
  await f.service.configure({ enabled: true });
  assert.equal(attempts, 1);
  f.advance(120_000);
  f.service.setPlayback(track({ position: 100 }));
  await f.tick();
  assert.equal(attempts, 1);
  f.api.setTitle = setTitle;
  f.advance(60_000);
  f.service.setPlayback(track({ position: 120 }));
  await f.tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.service.getState().error, '');
});

test('retry-after supports HTTP dates and Unix reset headers', () => {
  const now = Date.UTC(2026, 10, 3);
  assert.equal(retryDelay({ 'retry-after': '180' }, now), 180_000);
  assert.equal(retryDelay({ 'retry-after': new Date(now + 240_000).toUTCString() }, now), 240_000);
  assert.equal(retryDelay({ 'x-ratelimit-reset': String((now + 300_000) / 1000) }, now), 300_000);
});

test('an interrupted PUT is reconciled both when it reached the server and when it did not', async () => {
  for (const applied of [false, true]) {
    const f = fixture();
    await f.service.connect(TOKEN);
    f.service.setPlayback(track());
    const setTitle = f.api.setTitle;
    f.api.setTitle = async (token, title) => {
      if (applied) await setTitle(token, title);
      throw new ApiError('Соединение прервано.');
    };
    await f.service.configure({ enabled: true });
    assert.ok(f.disk().pendingWrite);
    f.api.setTitle = setTitle;
    f.advance(60_000);
    f.service.setPlayback(track({ position: 120 }));
    await f.tick();
    assert.equal(f.service.getState().settings.enabled, true);
    assert.ok(f.remote.title.endsWith('2:00/3:45'));
    assert.equal(f.disk().pendingWrite, null);
    await f.service.shutdown();
    assert.equal(f.remote.title, 'Мой прежний статус');
  }
});

test('the track is sampled again after a slow API preflight; overlapping ticks are dropped', async () => {
  const f = fixture();
  await f.service.connect(TOKEN);
  await f.service.configure({ enabled: true });
  await new Promise(resolve => setImmediate(resolve));
  f.service.setPlayback(track({ title: 'Старый трек' }));
  const getUser = f.api.getUser;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.api.getUser = async token => { await gate; return getUser(token); };
  const updating = f.service.tick();
  await new Promise(resolve => setImmediate(resolve));
  f.service.setPlayback(track({ title: 'Новый трек' }));
  await f.service.tick();
  release();
  await updating;
  assert.equal(f.writes.length, 1);
  assert.ok(f.remote.title.includes('Новый трек'));
});

test('regular exit and disconnect restore the original; explicit local forget removes credentials', async () => {
  const f = fixture();
  await f.start();
  await f.service.shutdown();
  assert.equal(f.remote.title, 'Мой прежний статус');
  assert.equal(f.disk().settings.enabled, true);
  const g = fixture();
  await g.start();
  await g.service.disconnect();
  assert.equal(g.remote.title, 'Мой прежний статус');
  assert.equal(g.disk().token, '');
  const h = fixture();
  await h.start();
  await h.service.disconnect(true);
  assert.ok(h.remote.title.startsWith('♫ '));
  assert.equal(h.disk().token, '');
});

test('the on-disk store encrypts the token and has no plaintext fallback', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-lzt-test-'));
  const filename = path.join(directory, 'lolzteam.json');
  const key = crypto.randomBytes(32);
  const safeStorage = {
    getSelectedStorageBackend: () => 'gnome_libsecret', isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, value.subarray(0, 16));
      return Buffer.concat([decipher.update(value.subarray(16)), decipher.final()]).toString('utf8');
    },
  };
  try {
    const store = new EncryptedStore(filename, safeStorage);
    store.save({ token: TOKEN, settings: DEFAULT_SETTINGS });
    assert.ok(!fs.readFileSync(filename, 'utf8').includes(TOKEN));
    assert.equal(store.load().token, TOKEN);
    safeStorage.isEncryptionAvailable = () => false;
    assert.throws(() => store.save({ token: TOKEN }), /зашифровать/);
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});
