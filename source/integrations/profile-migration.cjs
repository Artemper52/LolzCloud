'use strict';
const fs = require('node:fs');
const path = require('node:path');
const legacyNames = require('../legacy-profiles.json');
const PROFILE_ITEMS = [
  'Local State', 'Preferences', 'Network', 'Cookies', 'Cookies-journal',
  'Local Storage', 'Session Storage', 'IndexedDB', 'WebStorage',
  'lolzteam.json', 'music-library.json', 'soundcloud-session.json',
  'wave-library.json', 'player-tools.json', 'local-library.json',
  'lyric-sources.json', 'lyric-timing.json', 'downloads.json',
  'release-radar.json', 'mini-window.json', 'browser-pairing.json',
  'cloud-session.json', 'soundcloud-onboarding.json',
  'voicetags',
];

function findLegacyProfile(appData) {
  const folders = legacyNames.map(name => path.join(appData, name));
  return folders.find(folder => ['Network/Cookies', 'Cookies', 'soundcloud-session.json', 'lolzteam.json'].some(name => fs.existsSync(path.join(folder, name))))
    || folders.find(folder => PROFILE_ITEMS.filter(name => name.endsWith('.json')).some(name => fs.existsSync(path.join(folder, name)))) || null;
}

function migrateProfile(appData) {
  const target = path.join(appData, 'LolzCloud');
  if (fs.existsSync(target) && fs.readdirSync(target).length) return { path: target, migrated: false };
  const source = findLegacyProfile(appData);
  if (!source) return { path: target, migrated: false };
  const temporary = fs.mkdtempSync(path.join(appData, 'LolzCloud-migration-'));
  try {
    for (const name of PROFILE_ITEMS) {
      const file = path.join(source, name);
      if (fs.existsSync(file)) fs.cpSync(file, path.join(temporary, name), { recursive: true, errorOnExist: true, force: false });
    }
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.renameSync(temporary, target);
    return { path: target, migrated: true };
  } finally {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) === path.resolve(appData) && path.basename(resolved).startsWith('LolzCloud-migration-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

function configureProfile(app) {
  if (Number(process.versions.electron?.split('.')[0] || 99) < 23) {
    app.setName('LolzCloud Legacy'); app.setAppUserModelId?.('app.lolzcloud.desktop.legacy');
    const directory = path.join(app.getPath('appData'), 'LolzCloud Legacy'); fs.mkdirSync(directory, { recursive: true }); app.setPath('userData', directory); app.setPath('sessionData', directory); return { path: directory, migrated: false };
  }
  app.setName('LolzCloud');
  app.setAppUserModelId?.('app.lolzcloud.desktop');
  const result = migrateProfile(app.getPath('appData'));
  app.setPath('userData', result.path);
  app.setPath('sessionData', result.path);
  return result;
}
module.exports = { PROFILE_ITEMS, findLegacyProfile, migrateProfile, configureProfile };
