'use strict';
const fs = require('node:fs');
const path = require('node:path');
const legacyNames = require('../legacy-profiles.json');
const PROFILE_ITEMS = ['Local State', 'Preferences', 'lolzteam.json', 'music-library.json', 'Network', 'Local Storage', 'Session Storage', 'IndexedDB', 'WebStorage'];

function findLegacyProfile(appData) {
  return legacyNames.map(name => path.join(appData, name))
    .find(folder => fs.existsSync(path.join(folder, 'Network/Cookies')) || fs.existsSync(path.join(folder, 'lolzteam.json'))) || null;
}

function migrateProfile(appData) {
  const target = path.join(appData, 'LolzCloud');
  if (fs.existsSync(target)) return { path: target, migrated: false };
  const source = findLegacyProfile(appData);
  if (!source) return { path: target, migrated: false };
  const temporary = fs.mkdtempSync(path.join(appData, 'LolzCloud-migration-'));
  try {
    for (const name of PROFILE_ITEMS) {
      const file = path.join(source, name);
      if (fs.existsSync(file)) fs.cpSync(file, path.join(temporary, name), { recursive: true, errorOnExist: true, force: false });
    }
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
module.exports = { findLegacyProfile, migrateProfile, configureProfile };
