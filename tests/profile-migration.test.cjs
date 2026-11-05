'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateProfile } = require('../source/integrations/profile-migration.cjs');
const { createSnapshot, cleanSnapshot } = require('../source/integrations/session-import.cjs');
const legacy = require('../source/legacy-profiles.json');

test('profile migration preserves encrypted credentials and cookies without replacing the original', t => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-profile-test-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const original = path.join(appData, legacy[0]);
  fs.mkdirSync(path.join(original, 'Network'), { recursive: true });
  fs.writeFileSync(path.join(original, 'Network/Cookies'), 'encrypted cookie fixture');
  fs.writeFileSync(path.join(original, 'Local State'), 'encrypted key fixture');
  fs.writeFileSync(path.join(original, 'lolzteam.json'), '{"encryptedToken":"opaque-fixture"}');
  const result = migrateProfile(appData);
  assert.equal(result.migrated, true);
  for (const file of ['Network/Cookies', 'Local State', 'lolzteam.json']) {
    assert.deepEqual(fs.readFileSync(path.join(result.path, file)), fs.readFileSync(path.join(original, file)));
  }
  fs.writeFileSync(path.join(result.path, 'lolzteam.json'), 'new settings');
  assert.equal(migrateProfile(appData).migrated, false);
  assert.equal(fs.readFileSync(path.join(result.path, 'lolzteam.json'), 'utf8'), 'new settings');
});

test('a clean installation never invents an account', t => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-profile-test-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const result = migrateProfile(appData);
  assert.equal(result.migrated, false);
  assert.equal(fs.existsSync(result.path), false);
});

test('an encrypted old session can migrate and be imported even without a Chromium cookie database', t => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'lolzcloud-profile-test-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const original = path.join(appData, legacy[0]); fs.mkdirSync(original);
  fs.writeFileSync(path.join(original, 'soundcloud-session.json'), '{"version":1,"encryptedCookies":"opaque-fixture"}');
  fs.writeFileSync(path.join(original, 'Local State'), 'encrypted key fixture');
  const result = migrateProfile(appData); assert.equal(result.migrated, true);
  assert.deepEqual(fs.readFileSync(path.join(result.path, 'soundcloud-session.json')), fs.readFileSync(path.join(original, 'soundcloud-session.json')));
  const app = { getPath: name => name === 'temp' ? appData : appData }, snapshot = createSnapshot(app);
  assert.deepEqual(fs.readFileSync(path.join(snapshot, 'soundcloud-session.json')), fs.readFileSync(path.join(original, 'soundcloud-session.json')));
  assert.equal(fs.existsSync(path.join(snapshot, 'Network/Cookies')), false); cleanSnapshot(app, snapshot);
  assert.equal(fs.existsSync(original), true); assert.equal(fs.existsSync(snapshot), false);
});
