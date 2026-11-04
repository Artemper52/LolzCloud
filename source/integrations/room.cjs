'use strict';
const { storageAvailable } = require('./secure-storage.cjs');
const fs = require('node:fs'), path = require('node:path');
const { writeJson } = require('./durable-json.cjs');
const { randomUUID } = require('node:crypto');
class ListeningRoom {
  constructor(getSnapshot, { filename = null, safeStorage = null, fetcher = fetch, openExternal = async () => {}, onControlLost = () => {}, origin = 'https://lolzcloud.com' } = {}) {
    if (origin !== 'https://lolzcloud.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Недоверенный сервер комнат.');
    Object.assign(this, { getSnapshot, filename, safeStorage, fetcher, openExternal, onControlLost, origin });
    this.connection = randomUUID(); this.lease = ''; this.sequence = 0;
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
    return { active: !!this.room, hosting: !!this.lease || !!this.room && this.room.protocol !== 2, controller: this.room?.controller || null, settings: this.room?.settings || {}, url: this.room?.url || '', viewers: this.room?.viewers || 0, participants: this.room?.participants || [], queue: this.room?.queue || [], authenticated: !!this.token && this.expires > Date.now(), user: this.user, connecting: !!this.pair, recovering: this.storagePending, code: this.pair?.code || '', spicyAvailable: !!this.token && this.spicyAvailable, error: this.error, localNetwork: false };
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
    this.room = room; this.error = ''; if (room.protocol === 2) await this.claim(); await this.publish(); return this.getState();
  }
  async claim() { if (!this.room) throw new Error('Сначала создай комнату.'); const result = await this.request('/api/rooms/' + this.room.id + '/control', { method: 'POST', body: { type: 'claim', connection: this.connection, force: true, name: 'Приложение · основной плеер' } }); this.lease = result.lease; this.sequence = 0; this.room = result.room; }
  async release() { const lease = this.lease; this.lease = ''; if (this.room && lease) { const result = await this.request('/api/rooms/' + this.room.id + '/control', { method: 'POST', body: { type: 'release', connection: this.connection, lease } }); this.room = result.room; } }
  observePlayback(value) {
    const previous = this.observed, now = Date.now(), track = value || {};
    const position = Number(track.position) || 0, playing = track.playing === true, expected = previous ? previous.position + (previous.playing ? (now - previous.at) / 1000 : 0) : position;
    this.observed = { url: track.url, playing, position, at: now };
    if (!previous || previous.url !== track.url || previous.playing !== playing || Math.abs(position - expected) > .5) this.queuePublish();
  }
  queuePublish() {
    if (this.eventPublish || this.closed || !this.room || !this.lease) return;
    this.eventPublish = setTimeout(() => { this.eventPublish = null; if (this.closed || !this.room || !this.lease) return; if (this.busy) this.queuePublish(); else void this.tick(); }, 50); this.eventPublish.unref?.();
  }
  async publish() {
    if (!this.room) return;
    const id = this.room.id, version = this.version, source = this.getSnapshot(), current = source.playback || {};
    if (this.room.protocol === 2 && !this.lease) { this.room = await this.request('/api/rooms/' + id); return; }
    const playback = source.fresh && !source.private ? Object.fromEntries(['url', 'title', 'artist', 'duration', 'position', 'playing', 'rate'].map(key => [key, current[key]])) : {};
    if (playback.url && Math.abs((playback.rate || 1) - 1) > .001) throw new Error('Для общей комнаты верни обычную скорость 1×.');
    let value;
    try { value = await this.request('/api/rooms/' + id + '/state', { method: 'PUT', body: { fresh: source.fresh === true, private: source.private === true, playback, ...(this.room.protocol === 2 ? { lease: this.lease, connection: this.connection, sequence: ++this.sequence, sampleAgeMs: source.sampledAt ? Math.max(0, Math.min(3000, Date.now() - source.sampledAt)) : 0 } : {}) } }); }
    catch (error) { if (error.status === 409) { this.lease = ''; this.room = await this.request('/api/rooms/' + id); this.onControlLost(); return; } throw error; }
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
  async stop({ close = true } = {}) {
    clearTimeout(this.eventPublish); this.eventPublish = null;
    if (!close) await this.release().catch(() => {});
    this.version++; this.wantStart = false; this.pair = null;
    const room = this.room; this.room = null;
    if (close && room && this.token) await this.request('/api/rooms/' + room.id, { method: 'DELETE' });
  }
  async logout() { await this.stop().catch(() => {}); if (this.token) await this.request('/api/logout', { method: 'POST', body: {} }).catch(() => {}); this.token = ''; this.user = null; this.expires = 0; this.spicyAvailable = false; this.storagePending = false; this.persist(); }
  async getSpicy(id, signal) { if (!this.getState().authenticated) return null; try { return await this.request('/api/lyrics/' + id, { signal }); } catch (error) { if (error.status === 404) return null; throw error; } }
  async queueAction(action) { if (!this.room) throw new Error('Сначала создай комнату.'); const result = await this.request('/api/rooms/' + this.room.id + '/queue', { method: 'POST', body: { ...action, lease: this.lease, connection: this.connection } }); if (result.room?.id === this.room?.id) this.room = result.room; return result; }
  async dispose() { this.closed = true; clearInterval(this.timer); await this.stop({ close: false }).catch(() => {}); }
}
module.exports = { ListeningRoom };
