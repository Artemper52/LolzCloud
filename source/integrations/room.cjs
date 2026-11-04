'use strict';
const { storageAvailable } = require('./secure-storage.cjs');
const fs = require('node:fs'), path = require('node:path');
const { writeJson } = require('./durable-json.cjs');
class ListeningRoom {
  constructor(getSnapshot, { filename = null, safeStorage = null, fetcher = fetch, openExternal = async () => {}, origin = 'https://lolzcloud.com' } = {}) {
    if (origin !== 'https://lolzcloud.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Недоверенный сервер комнат.');
    Object.assign(this, { getSnapshot, filename, safeStorage, fetcher, openExternal, origin });
    this.token = ''; this.user = null; this.room = null; this.pair = null; this.error = ''; this.expires = 0; this.busy = false; this.closed = false; this.wantStart = false; this.version = 0; this.spicyAvailable = false;
    this.storagePending = false; this.storageRetryAt = 0; this.needsSave = false;
    this.loadSession();
    this.timer = setInterval(() => { void this.tick(); }, 1500); this.timer.unref?.();
  }
  loadSession() {
    if (!this.filename || !fs.existsSync(this.filename)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (saved.expires > Date.now() && saved.encryptedToken) {
        if (!storageAvailable(this.safeStorage)) throw new Error();
        const token = this.safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'));
        if (!/^[\w-]{43}$/.test(token)) throw new Error();
        this.token = token; this.expires = saved.expires; this.user = saved.user;
      }
      this.storagePending = false; this.error = '';
    } catch { this.storagePending = true; this.storageRetryAt = Date.now() + 5000; this.error = 'Хранилище системы пока не открыло привязку комнат. Повторяем автоматически; данные не сброшены.'; }
  }
  persist() {
    if (!this.filename) return;
    this.needsSave = true;
    if (this.storagePending) throw new Error(this.error);
    if (this.token && !storageAvailable(this.safeStorage)) throw new Error('Хранилище системы пока не может сохранить подключение. Повторим автоматически.');
    const encryptedToken = this.token && storageAvailable(this.safeStorage) ? this.safeStorage.encryptString(this.token).toString('base64') : '';
    writeJson(this.filename, { encryptedToken, expires: this.expires, user: this.user });
    this.needsSave = false;
  }
  getState() {
    return { active: !!this.room, url: this.room?.url || '', viewers: this.room?.viewers || 0, participants: this.room?.participants || [], authenticated: !!this.token && this.expires > Date.now(), user: this.user, connecting: !!this.pair, recovering: this.storagePending, code: this.pair?.code || '', spicyAvailable: !!this.token && this.spicyAvailable, error: this.error, localNetwork: false };
  }
  async request(endpoint, { method = 'GET', body, signal } = {}) {
    const response = await this.fetcher(this.origin + endpoint, { method, redirect: 'error', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('Слишком большой ответ сервера.');
    const raw = await response.text(); if (raw.length > 2_000_000) throw new Error('Слишком большой ответ сервера.');
    let result; try { result = JSON.parse(raw); } catch { throw new Error('Сервер LolzCloud временно недоступен.'); }
    if (!response.ok) {
      if (response.status === 401 && this.token) { this.token = ''; this.user = null; this.room = null; this.spicyAvailable = false; this.persist(); }
      const error = new Error(result.error || 'Не удалось подключиться к LolzCloud.'); error.status = response.status; throw error;
    }
    return result;
  }
  async login() {
    if (this.storagePending) { this.loadSession(); if (this.storagePending) throw new Error(this.error); }
    if (this.token && this.expires > Date.now()) {
      try { const value = await this.request('/api/session'); if (value.authenticated) { this.user = value.user; this.spicyAvailable = value.spicyAvailable; return this.getState(); } } catch (error) { if (error.status !== 401) throw error; }
    }
    if (this.pair) return this.getState();
    const pair = await this.request('/api/desktop/start', { method: 'POST', body: {} });
    const url = new URL(pair.verificationUrl);
    if (url.origin !== this.origin || url.pathname !== '/connect' || !/^[\w-]{12}$/.test(pair.code || '') || !/^[\w-]{43}$/.test(pair.deviceCode || '')) throw new Error('Сервер вернул неверную ссылку входа.');
    this.error = ''; this.pair = { ...pair, expires: Date.now() + Math.min(600, pair.expiresIn) * 1000 }; this.version++;
    try { await this.openExternal(url.href); } catch { this.pair = null; throw new Error('Не удалось открыть браузер для входа.'); }
    return this.getState();
  }
  async start() {
    this.wantStart = true;
    if (!this.token || this.expires <= Date.now()) { await this.login(); return this.getState(); }
    if (this.room) return this.getState();
    const version = this.version, room = await this.request('/api/rooms', { method: 'POST', body: {} });
    if (version !== this.version || this.closed) { await this.request('/api/rooms/' + room.id, { method: 'DELETE' }).catch(() => {}); return this.getState(); }
    if (!/^[a-f0-9]{32}$/.test(room.id || '') || room.url !== this.origin + '/room/' + room.id + '/') throw new Error('Сервер вернул некорректную комнату.');
    this.room = room; this.error = ''; await this.publish(); return this.getState();
  }
  async publish() {
    if (!this.room) return;
    const id = this.room.id, version = this.version, source = this.getSnapshot(), current = source.playback || {};
    const playback = source.fresh && !source.private ? Object.fromEntries(['url', 'title', 'artist', 'duration', 'position', 'playing', 'rate'].map(key => [key, current[key]])) : {};
    const value = await this.request('/api/rooms/' + id + '/state', { method: 'PUT', body: { fresh: source.fresh === true, private: source.private === true, playback } });
    if (version === this.version && this.room?.id === id) this.room = value;
  }
  async tick() {
    if (this.closed || this.busy) return; this.busy = true;
    try {
      if (this.storagePending && Date.now() >= this.storageRetryAt) this.loadSession();
      if (this.storagePending) return;
      if (this.needsSave) this.persist();
      if (this.pair) {
        const pair = this.pair, version = this.version;
        if (Date.now() >= pair.expires) { this.pair = null; throw new Error('Время входа истекло. Нажми «Войти через Lolzteam» ещё раз.'); }
        const result = await this.request('/api/desktop/poll', { method: 'POST', body: { deviceCode: pair.deviceCode } });
        if (version !== this.version || this.closed) return;
        if (!result.pending) {
          if (!/^[\w-]{43}$/.test(result.token || '')) throw new Error('Сервер не подтвердил подключение.');
          this.pair = null; this.token = result.token; this.expires = result.expires; this.user = result.user; this.error = ''; this.persist();
          const session = await this.request('/api/session'); this.spicyAvailable = session.spicyAvailable === true;
          if (this.wantStart) await this.start();
        }
      } else if (this.room) { await this.publish(); this.error = ''; }
      else if (this.wantStart && this.token && this.expires > Date.now()) {
        // Pairing may have completed before a temporary save/session request
        // failure. Preserve the user's create-room intent and retry it here.
        const version = this.version, session = await this.request('/api/session');
        if (version !== this.version || this.closed || !this.wantStart) return;
        this.spicyAvailable = session.spicyAvailable === true;
        await this.start();
      }
    } catch (error) { this.error = error.message || 'Нет соединения с комнатой.'; if (error.status === 404) this.room = null; }
    finally { this.busy = false; }
  }
  async stop() {
    this.version++; this.wantStart = false; this.pair = null;
    const room = this.room; this.room = null;
    if (room && this.token) await this.request('/api/rooms/' + room.id, { method: 'DELETE' });
  }
  async logout() { await this.stop().catch(() => {}); if (this.token) await this.request('/api/logout', { method: 'POST', body: {} }).catch(() => {}); this.token = ''; this.user = null; this.expires = 0; this.spicyAvailable = false; this.storagePending = false; this.persist(); }
  async getSpicy(id, signal) { if (!this.getState().authenticated) return null; try { return await this.request('/api/lyrics/' + id, { signal }); } catch (error) { if (error.status === 404) return null; throw error; } }
  async dispose() { this.closed = true; clearInterval(this.timer); await this.stop().catch(() => {}); }
}
module.exports = { ListeningRoom };
