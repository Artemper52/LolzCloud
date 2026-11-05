'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { ipcMain, safeStorage, shell, session, dialog, clipboard } = require('electron');
const { createApi } = require('./api.cjs');
const { EncryptedStore } = require('./store.cjs');
const { LolzteamService } = require('./service.cjs');
const { DiscordPresence } = require('../discord.cjs');
const { importFromInstalled } = require('../session-import.cjs');
const { createStudio } = require('../studio.cjs');
const { readSessionProfile, previewSessionProfile } = require('../sc-profile.cjs');
const { soundcloudProfile } = require('../profiles.cjs');
const { SoundCloudSession } = require('../soundcloud-session.cjs');
const { BrowserSessionTransfer, MAX_BYTES } = require('../browser-session.cjs');
const { createBrowserIdentity } = require('../browser-session-identity.cjs');
const { BrowserProfiles } = require('../browser-profiles.cjs');
const { recoverPreviousSession } = require('../session-recovery.cjs');

function registerLolzteam(app, getWindow) {
  const service = new LolzteamService({
    api: createApi(),
    store: new EncryptedStore(path.join(app.getPath('userData'), 'lolzteam.json'), safeStorage),
  });
  const discord = new DiscordPresence({ getSnapshot: () => service.getState() });
  const studio = createStudio({ app, service, getWindow, trusted, onStateChange: notifyState });
  let sessionRevision = 0;
  const soundcloudSession = new SoundCloudSession({ session: session.defaultSession, safeStorage, filename: path.join(app.getPath('userData'), 'soundcloud-session.json'), onRestored: () => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('soundcloud:session-imported'); }, onCleared: () => { sessionRevision++; service.setProfile(null); notifyState(); } });
  const ready = recoverPreviousSession({ app, target: session.defaultSession, saved: soundcloudSession });
  let loginImport = null;
  let importing = false;
  let pendingSessionFile = '';
  async function finishSessionImport(result) {
    const revision = ++sessionRevision;
    await soundcloudSession.acceptImported(); loginImport = { ...result, verified: false };
    service.setProfile(result.profile || null, { replaceManual: true });
    const window = getWindow(); if (window && !window.isDestroyed()) { window.webContents.send('soundcloud:session-imported'); window.show(); window.focus(); }
    void readSessionProfile(session.defaultSession).then(profile => { if (revision !== sessionRevision) return; if (profile) service.setProfile(profile, { replaceManual: true }); loginImport = { ...result, verified: !!profile, verification: profile ? 'confirmed' : 'unconfirmed' }; notifyState(); }).catch(() => { if (revision === sessionRevision) { loginImport = { ...result, verified: false, verification: 'offline' }; notifyState(); } });
  }
  const browserProfiles = new BrowserProfiles(); let profileList = [], firstSignIn = false;
  const browserSession = new BrowserSessionTransfer({ target: session.defaultSession, identity: createBrowserIdentity({ filename: path.join(app.getPath('userData'), 'browser-pairing.json'), safeStorage }), onChange: notifyState, onImported: finishSessionImport, onPreview: cookies => previewSessionProfile(session.defaultSession, cookies) });
  const getState = () => ({ ...studio.snapshot(service.getState()), soundcloudSession: soundcloudSession.state(), browserSession: browserSession.state(), browserProfiles: profileList, firstSignIn, discord: discord.getState(), features: studio.getState(), loginImport, importing });
  function notifyState() { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('lolzcloud:state', getState()); }
  const expected = pathToFileURL(path.resolve(__dirname, '../../app/index.html')).href;
  function trusted(event) {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return event.senderFrame.url.split(/[?#]/)[0] === expected;
  }
  ready.then(async () => {
    const marker = path.join(app.getPath('userData'), 'soundcloud-onboarding.json');
    firstSignIn = !fs.existsSync(marker) && !soundcloudSession.state().hasLogin && !soundcloudSession.state().recovering && !soundcloudSession.state().explicitlyCleared;
    fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, '{"version":1}'); notifyState();
    const revision = sessionRevision, profile = await readSessionProfile(session.defaultSession); if (profile && revision === sessionRevision) service.setProfile(profile);
  }).catch(() => {});
  ipcMain.handle('soundcloud:action', async (event, action) => {
    if (!trusted(event)) return { ok: false, error: 'Запрос из недоверенного окна отклонён.' };
    try {
      await ready;
      if (action?.type === 'start') { firstSignIn = false; profileList = browserProfiles.list(); await shell.openExternal(await browserSession.start({ choose: true })); }
      else if (action?.type === 'browser-list') profileList = browserProfiles.list(true);
      else if (action?.type === 'start-browser') { firstSignIn = false; if (!profileList.length) profileList = browserProfiles.list(); await browserProfiles.open(action.id, await browserSession.start({ choose: true })); }
      else if (action?.type === 'choose-account') { firstSignIn = false; await browserSession.select(action.id); }
      else if (action?.type === 'copy-link') clipboard.writeText(await browserSession.start({ choose: true }));
      else if (action?.type === 'open-browser') await shell.openExternal('https://soundcloud.com/you');
      else if (action?.type === 'cancel') { if (browserSession.state().busy) throw new Error('Сначала дождись завершения переноса.'); browserSession.stop(); pendingSessionFile = ''; }
      else if (action?.type === 'import-file' || action?.type === 'unlock-file') {
        if (action.type === 'import-file') {
          const selected = await dialog.showOpenDialog(getWindow(), { title: 'Перенести вход SoundCloud', properties: ['openFile'], filters: [{ name: 'Сессия SoundCloud', extensions: ['lolzcloud-session', 'json', 'txt'] }] });
          pendingSessionFile = selected.canceled ? '' : selected.filePaths[0] || '';
        }
        if (pendingSessionFile) {
          if (fs.statSync(pendingSessionFile).size > MAX_BYTES) throw new Error('Файл сессии слишком большой.');
          await browserSession.importFile(fs.readFileSync(pendingSessionFile, 'utf8'), action.password); pendingSessionFile = '';
        }
      } else if (action?.type !== 'state') throw new Error('Неизвестная команда входа.');
      return { ok: true, state: getState(), needsPassword: !!pendingSessionFile };
    } catch (error) { return { ok: false, error: error.message || 'Не удалось перенести вход.', needsPassword: !!pendingSessionFile, state: getState() }; }
  });
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
            await finishSessionImport(await importFromInstalled(app, session.defaultSession));
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
    if (studio.acceptSoundCloud(playback) === false) return;
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
      await browserSession.dispose();
      await Promise.allSettled([service.shutdown(), discord.shutdown(), studio.shutdown(), soundcloudSession.dispose()]);
      if (diagnosticFile) { try { fs.unlinkSync(diagnosticFile); } catch { /* Already removed. */ } }
    },
  };
}

module.exports = { registerLolzteam };
