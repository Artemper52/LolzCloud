'use strict';
const { storageAvailable } = require('../secure-storage.cjs');

const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('../durable-json.cjs');

class EncryptedStore {
  constructor(filename, safeStorage) {
    this.filename = filename;
    this.safeStorage = safeStorage;
    this.unreadable = false;
  }

  load() {
    try {
    if (!fs.existsSync(this.filename)) { this.unreadable = false; return null; }
    const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
    if (data.version !== 1) throw new Error('Неизвестная версия настроек Lolzteam.');
    let token = '';
    if (data.encryptedToken) {
      if (!storageAvailable(this.safeStorage)) throw new Error('Защищённое хранилище системы недоступно.');
      token = this.safeStorage.decryptString(Buffer.from(data.encryptedToken, 'base64'));
    }
    const { encryptedToken, version, ...state } = data;
    this.unreadable = false;
    return { ...state, token };
    } catch (error) { this.unreadable = true; throw error; }
  }

  save(state, { replaceUnreadable = false } = {}) {
    if (this.unreadable && !replaceUnreadable) throw new Error('Сохранённая привязка временно недоступна. Её данные оставлены без изменений.');
    const { token, ...publicState } = state;
    if (token && !storageAvailable(this.safeStorage)) {
      throw new Error('Не удалось зашифровать токен в хранилище системы. Привязка не сохранена.');
    }
    const data = {
      version: 1,
      ...publicState,
      encryptedToken: token ? this.safeStorage.encryptString(token).toString('base64') : '',
    };
    writeJson(this.filename, data);
    this.unreadable = false;
  }
}

module.exports = { EncryptedStore };
