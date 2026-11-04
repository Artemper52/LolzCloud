'use strict';
const { app, safeStorage, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { SoundCloudSession } = require('../source/integrations/soundcloud-session.cjs');
const { EncryptedStore } = require('../source/integrations/lolzteam/store.cjs');
const directory = process.env.LOLZCLOUD_PERSISTENCE_TEST_PROFILE, phase = process.env.LOLZCLOUD_PERSISTENCE_TEST_PHASE;
if (!directory || !['save', 'restore'].includes(phase)) throw new Error('Use npm run test:persistence.');
app.setPath('userData', directory); app.setPath('sessionData', directory); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const store = new EncryptedStore(path.join(directory, 'forum.json'), safeStorage), filename = path.join(directory, 'soundcloud-session.json');
    if (phase === 'save') {
      store.save({ token: 'fixture-native-encrypted-token', user: { id: 123, name: 'Fixture' }, settings: {} });
      await session.defaultSession.cookies.set({ url: 'https://soundcloud.com/', name: 'oauth_token', value: 'fixture-native-session-cookie', secure: true, httpOnly: true, sameSite: 'lax' });
    } else {
      assert.equal(store.load().token, 'fixture-native-encrypted-token');
      // Simulate a cold restart where Chromium no longer has session cookies.
      await session.defaultSession.cookies.remove('https://soundcloud.com/', 'oauth_token');
    }
    const keeper = new SoundCloudSession({ session: session.defaultSession, safeStorage, filename }); await keeper.start();
    const cookies = await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' }); assert.equal(cookies[0]?.value, 'fixture-native-session-cookie');
    assert.ok(!fs.readFileSync(filename, 'utf8').includes('fixture-native-session-cookie'));
    assert.equal(session.defaultSession.getStoragePath().toLowerCase(), directory.toLowerCase());
    await keeper.dispose(); console.log('Native profile phase passed: ' + phase); app.exit(0);
  } catch (error) { console.error(error.message); app.exit(1); }
});
