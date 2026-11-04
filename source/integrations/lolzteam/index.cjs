'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { ipcMain, safeStorage, shell, session } = require('electron');
const { createApi } = require('./api.cjs');
const { EncryptedStore } = require('./store.cjs');
const { LolzteamService } = require('./service.cjs');
const { DiscordPresence } = require('../discord.cjs');
const { importFromInstalled } = require('../session-import.cjs');
const { createStudio } = require('../studio.cjs');
const { readSessionProfile } = require('../sc-profile.cjs');
const { soundcloudProfile } = require('../profiles.cjs');
const { SoundCloudSession } = require('../soundcloud-session.cjs');

function registerLolzteam(app, getWindow) {
  const service = new LolzteamService({
    api: createApi(),
    store: new EncryptedStore(path.join(app.getPath('userData'), 'lolzteam.json'), safeStorage),
  });
  const discord = new DiscordPresence({ getSnapshot: () => service.getState() });
  const studio = createStudio({ app, service, getWindow, trusted, onStateChange: notifyState });
  const soundcloudSession = new SoundCloudSession({ session: session.defaultSession, safeStorage, filename: path.join(app.getPath('userData'), 'soundcloud-session.json'), onRestored: () => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('soundcloud:session-imported'); }, onCleared: () => { service.setProfile(null); notifyState(); } });
  const ready = soundcloudSession.start();
  let loginImport = null;
  let importing = false;
  const getState = () => ({ ...studio.snapshot(service.getState()), soundcloudSession: soundcloudSession.state(), discord: discord.getState(), features: studio.getState(), loginImport, importing });
  function notifyState() { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('lolzcloud:state', getState()); }
  const expected = pathToFileURL(path.resolve(__dirname, '../../app/index.html')).href;
  function trusted(event) {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return event.senderFrame.url.split(/[?#]/)[0] === expected;
  }
  ready.then(() => readSessionProfile(session.defaultSession)).then(profile => { if (profile) service.setProfile(profile); }).catch(() => {});
  ipcMain.handle('lolzteam:action', async (event, action) => {
    if (!trusted(event)) return { ok: false, error: 'Запрос из недоверенного окна отклонён.' };
    try {
      let state;
      switch (action?.type) {
        case 'state': state = getState(); break;
        case 'connect': state = await service.connect(action.token); break;
        case 'configure': state = await service.configure(action.settings); break;
        case 'disconnect': state = await service.disconnect(); break;
        case 'forget': state = await service.disconnect(true); break;
        case 'open-token': await shell.openExternal('https://lolz.live/account/api'); break;
        case 'open-artist-pro': await shell.openExternal('https://artists.soundcloud.com/pro'); break;
        case 'open-profile':
          if (service.user) await shell.openExternal(`https://lolz.live/members/${service.user.id}/`);
          break;
        case 'open-soundcloud':
          if (service.soundcloudProfile) await shell.openExternal(service.soundcloudProfile.url);
          break;
        case 'set-soundcloud-profile': {
          const profile = soundcloudProfile({ url: action.url });
          if (!profile) throw new Error('Нужна ссылка на профиль SoundCloud: https://soundcloud.com/имя.');
          service.setProfile(profile, { manual: true });
          break;
        }
        case 'refresh-soundcloud-profile': {
          const profile = await readSessionProfile(session.defaultSession);
          if (!profile) throw new Error('Профиль пока не определён. Можно сохранить ссылку вручную без входа.');
          service.setProfile(profile, { replaceManual: true });
          break;
        }
        case 'import-soundcloud':
          if (importing) throw new Error('Перенос входа уже выполняется.');
          importing = true;
          try {
            loginImport = await importFromInstalled(app, session.defaultSession);
            const profile = await readSessionProfile(session.defaultSession).catch(() => null);
            if (profile) service.setProfile(profile);
            getWindow().webContents.send('soundcloud:session-imported');
          } finally { importing = false; }
          break;
        default: throw new Error('Неизвестное действие.');
      }
      return { ok: true, state: { ...(state || getState()), discord: discord.getState() } };
    } catch (error) {
      // Never serialize request objects, token values, or the full private API response.
      return { ok: false, error: error.message || 'Не удалось выполнить действие.', state: getState() };
    }
  });
  ipcMain.on('lolzteam:playback', (event, playback) => {
    if (!trusted(event)) return;
    studio.acceptSoundCloud(playback);
    service.setPlayback(playback);
    studio.setUpcoming(playback?.upNext);
    if (playback && Object.hasOwn(playback, 'account') && (playback.account !== null || !soundcloudSession.state().saved && !soundcloudSession.state().recovering)) service.setProfile(playback.account);
    notifyState();
  });
  const diagnosticFile = process.argv.includes('--diagnostics') ? path.join(app.getPath('userData'), 'integration-state.json') : null;
  const timer = setInterval(() => {
    service.tick().catch(() => {});
    discord.tick().catch(() => {});
    studio.observe();
    if (diagnosticFile) fs.writeFile(diagnosticFile, JSON.stringify(getState(), null, 2), () => {});
  }, 1000);
  timer.unref();
  return {
    ready,
    flushSession: () => soundcloudSession.flush(),
    configure: settings => service.configure(settings),
    act: action => studio.act(action),
    async shutdown() {
      clearInterval(timer);
      await Promise.allSettled([service.shutdown(), discord.shutdown(), studio.shutdown(), soundcloudSession.dispose()]);
      if (diagnosticFile) { try { fs.unlinkSync(diagnosticFile); } catch { /* Already removed. */ } }
    },
  };
}

module.exports = { registerLolzteam };
