'use strict';
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const profile = process.env.LOLZCLOUD_DIAGNOSTIC_PROFILE;
const temporary = process.env.LOLZCLOUD_DIAGNOSTIC_SESSION;
if (!profile || !temporary) throw new Error('Use npm run diagnose.');
// The parent supplies a temporary copy of the encryption key, without cookies or account data.
app.setPath('userData', temporary);
app.setPath('sessionData', temporary);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const { EncryptedStore } = require('../source/integrations/lolzteam/store.cjs');
    const { createApi } = require('../source/integrations/lolzteam/api.cjs');
    const saved = new EncryptedStore(path.join(profile, 'lolzteam.json'), safeStorage).load();
    if (!saved?.token) throw new Error('Аккаунт Lolzteam пока не привязан.');
    const user = await createApi().getUser(saved.token);
    let live = null;
    const snapshot = path.join(profile, 'integration-state.json');
    if (fs.existsSync(snapshot)) {
      const state = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
      live = { profiles: state.profiles, fresh: state.fresh, broadcasting: state.settings.enabled,
        discordConnected: state.discord?.connected, discordButtons: state.discord?.acknowledgedButtons, error: state.error };
    }
    console.log(JSON.stringify({ ok: true, user: { id: user.user_id, name: user.username, status: user.custom_title }, live }, null, 2));
    app.exit(0);
  } catch (error) { console.error(error.message); app.exit(1); }
});
