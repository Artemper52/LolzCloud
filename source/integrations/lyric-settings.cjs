'use strict';
const { storageAvailable } = require('./secure-storage.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./durable-json.cjs');
const PROVIDERS = [
  { id: 'spicy', name: 'Spicy Lyrics', key: 'spicy', url: 'https://developers.spicylyrics.org/docs/keys' },
  { id: 'bini', name: 'BiniLyrics', url: 'https://lyrics.binimum.org' },
  { id: 'better', name: 'Better Lyrics', url: 'https://docs.betterlyrics.org' },
  { id: 'musixmatch', name: 'Musixmatch', key: 'musixmatch', url: 'https://developer.musixmatch.com' },
  { id: 'unison', name: 'Unison', url: 'https://unison.boidu.dev' },
  { id: 'netease', name: 'NetEase', url: 'https://music.163.com' },
  { id: 'lrclib', name: 'LRCLIB', url: 'https://lrclib.net' },
  { id: 'qq', name: 'QQ Music', url: 'https://y.qq.com' },
  { id: 'kugou', name: 'KuGou', url: 'https://www.kugou.com' },
];
const KEY_NAMES = ['spicy', 'musixmatch', 'spotifyId', 'spotifySecret'];
class LyricSettings {
  constructor(filename = null, safeStorage = null) {
    this.filename = filename; this.safeStorage = safeStorage; this.keys = {};
    this.order = PROVIDERS.map(provider => provider.id); this.disabled = []; this.merge = true; this.error = '';
    this.locked = false; this.retryAt = 0;
    this.load();
  }
  load() {
    const { filename, safeStorage } = this;
    if (!filename || !fs.existsSync(filename)) return;
    try {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      this.order = this.validOrder(data.order); this.disabled = (data.disabled || []).filter(id => this.order.includes(id)); this.merge = data.merge !== false;
      if (data.encryptedKeys) {
        if (!storageAvailable(safeStorage)) throw new Error('System keyring unavailable');
        const keys = JSON.parse(safeStorage.decryptString(Buffer.from(data.encryptedKeys, 'base64')));
        for (const key of KEY_NAMES) if (typeof keys[key] === 'string') this.keys[key] = keys[key];
      }
      this.locked = false; this.error = '';
    } catch { this.locked = true; this.retryAt = Date.now() + 5000; this.error = 'Хранилище системы пока не открыло сохранённые ключи. Повторяем автоматически; ключи не сброшены.'; }
  }
  retry() {
    if (!this.locked || Date.now() < this.retryAt) return false;
    this.load(); return !this.locked;
  }
  validOrder(value) {
    const ids = PROVIDERS.map(provider => provider.id);
    return [...new Set([...(Array.isArray(value) ? value.filter(id => ids.includes(id)) : []), ...ids])];
  }
  state() {
    return { order: [...this.order], disabled: [...this.disabled], merge: this.merge, error: this.error, locked: this.locked, configured: Object.fromEntries(KEY_NAMES.map(key => [key, !!this.keys[key]])), providers: PROVIDERS };
  }
  configure(patch = {}) {
    if (this.locked) { this.load(); if (this.locked) throw new Error(this.error); }
    const keys = { ...this.keys };
    for (const key of KEY_NAMES) {
      if (patch.remove?.includes(key)) delete keys[key];
      const value = patch.keys?.[key]; if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || value.length > 600 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Неверный формат ключа.');
      if (key === 'spicy' && !/^sl_pk_[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Для LolzCloud нужен клиентский ключ Spicy Lyrics вида sl_pk_…');
      keys[key] = value;
    }
    const next = { order: this.validOrder(patch.order || this.order), disabled: Array.isArray(patch.disabled) ? patch.disabled.filter(id => PROVIDERS.some(provider => provider.id === id)) : this.disabled, merge: typeof patch.merge === 'boolean' ? patch.merge : this.merge };
    if (this.filename) {
      if (Object.keys(keys).length && !storageAvailable(this.safeStorage)) throw new Error('Защищённое хранилище системы недоступно. Ключи не сохранены.');
      const encryptedKeys = Object.keys(keys).length ? this.safeStorage.encryptString(JSON.stringify(keys)).toString('base64') : '';
      writeJson(this.filename, { version: 1, ...next, encryptedKeys });
    }
    Object.assign(this, next, { keys, error: '' }); return this.state();
  }
}
module.exports = { LyricSettings, PROVIDERS };
