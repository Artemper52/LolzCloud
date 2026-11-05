'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { findLegacyProfile } = require('./profile-migration.cjs');
const AUTH_COOKIES = new Set(['oauth_token', 'oauth_refresh_token', 'sc_session', 'connectId', 'sc_tracking_user_id', 'datadome', 'OptanonConsent', 'OptanonAlertBoxClosed']);

function transferable(cookie) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  return (domain === 'soundcloud.com' || domain.endsWith('.soundcloud.com'))
    && AUTH_COOKIES.has(cookie.name) && typeof cookie.value === 'string' && cookie.value.length > 0;
}

function cookieDetails(cookie) {
  if (!transferable(cookie)) throw new Error('Unexpected cookie in SoundCloud session import.');
  const details = {
    url: 'https://' + cookie.domain.replace(/^\./, '') + (cookie.path || '/'),
    name: cookie.name, value: cookie.value, path: cookie.path || '/',
    secure: cookie.secure === true, httpOnly: cookie.httpOnly === true,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (!cookie.session && Number.isFinite(cookie.expirationDate)) details.expirationDate = cookie.expirationDate;
  if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) details.sameSite = cookie.sameSite;
  return details;
}

function createSnapshot(app) {
  const original = findLegacyProfile(app.getPath('appData'));
  if (!original) throw new Error('Сохранённый вход в прежней версии не найден.');
  const database = path.join(original, 'Network/Cookies');
  if (!fs.existsSync(database) && !fs.existsSync(path.join(original, 'soundcloud-session.json'))) throw new Error('Сохранённый вход в прежней версии не найден.');
  const base = path.join(app.getPath('temp'), 'LolzCloud-session-import');
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'session-'));
  fs.mkdirSync(path.join(directory, 'Network'));
  for (const name of ['Local State', 'soundcloud-session.json', 'Network/Cookies', 'Network/Cookies-journal', 'Network/Cookies-wal', 'Network/Cookies-shm']) {
    const source = path.join(original, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(directory, name));
  }
  return directory;
}

function cleanSnapshot(app, directory) {
  const base = path.resolve(app.getPath('temp'), 'LolzCloud-session-import');
  const target = path.resolve(directory);
  if (!target.startsWith(base + path.sep) || !path.basename(target).startsWith('session-')) {
    throw new Error('Unexpected session snapshot path.');
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function importFromInstalled(app, targetSession) {
  const snapshot = createSnapshot(app);
  try {
    const cookies = await new Promise((resolve, reject) => {
      const args = app.isPackaged ? ['--import-soundcloud-session'] : [app.getAppPath(), '--import-soundcloud-session'];
      execFile(process.execPath, args, {
        windowsHide: true, timeout: 25_000, maxBuffer: 262_144,
        env: { ...process.env, LOLZCLOUD_SESSION_IMPORT_PATH: snapshot },
      }, (error, stdout) => {
        // Cookie values travel only through this parent/child pipe, never through logs or the renderer.
        if (error) return reject(new Error('Не удалось прочитать сохранённый вход. Закрой прежнюю версию и попробуй ещё раз.'));
        try {
          const result = JSON.parse(stdout);
          if (!Array.isArray(result.cookies)) throw new Error();
          resolve(result.cookies.filter(transferable));
        } catch { reject(new Error('Сохранённый вход LolzCloud недоступен.')); }
      });
    });
    if (!cookies.some(cookie => cookie.name === 'oauth_token')) throw new Error('В прежней версии нет сохранённого входа SoundCloud.');
    for (const cookie of cookies) await targetSession.cookies.set(cookieDetails(cookie));
    await targetSession.cookies.flushStore();
    return { imported: true, source: 'LolzCloud', count: cookies.length };
  } finally {
    try { cleanSnapshot(app, snapshot); } catch { /* Windows can briefly keep Chromium's files open. */ }
  }
}

function runImportChild(app, { preview = false } = {}) {
  const directory = path.resolve(process.env.LOLZCLOUD_SESSION_IMPORT_PATH || '');
  const base = path.resolve(app.getPath('temp'), 'LolzCloud-session-import');
  if (!directory.startsWith(base + path.sep) || !path.basename(directory).startsWith('session-')) {
    app.exit(1);
    return;
  }
  app.setPath('userData', directory);
  app.whenReady().then(async () => {
    try {
      const { session, safeStorage } = require('electron');
      let cookies = (await session.defaultSession.cookies.get({ domain: 'soundcloud.com' })).filter(transferable);
      if (!cookies.some(cookie => cookie.name === 'oauth_token')) {
        const saved = new (require('./soundcloud-session.cjs').SoundCloudSession)({ session: session.defaultSession, safeStorage, filename: path.join(directory, 'soundcloud-session.json') });
        await saved.restore(); cookies = (await session.defaultSession.cookies.get({ domain: 'soundcloud.com' })).filter(transferable);
      }
      if (preview) process.stdout.write(JSON.stringify({ count: cookies.length, hasLogin: cookies.some(cookie => cookie.name === 'oauth_token') }));
      else { process.stdout.write(JSON.stringify({ cookies }), () => app.exit(0)); return; }
      app.exit(0);
    } catch { app.exit(1); }
  });
}

module.exports = { transferable, cookieDetails, createSnapshot, cleanSnapshot, importFromInstalled, runImportChild };
