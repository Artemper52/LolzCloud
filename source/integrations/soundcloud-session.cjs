'use strict';
const { storageAvailable } = require('./secure-storage.cjs');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { writeJson } = require('./durable-json.cjs');
const { cookieDetails } = require('./session-import.cjs');
const AUTH = new Set(['oauth_token', 'oauth_refresh_token', 'sc_session', 'connectId']);
const MAX_AGE = 30 * 86400000;
function authCookie(cookie, now = Date.now()) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  return (domain === 'soundcloud.com' || domain.endsWith('.soundcloud.com')) && AUTH.has(cookie.name)
    && typeof cookie.value === 'string' && cookie.value.length > 0
    && (cookie.session || !Number.isFinite(cookie.expirationDate) || cookie.expirationDate * 1000 > now);
}
class SoundCloudSession {
  constructor({ session, safeStorage, filename, now = Date.now, onRestored = () => {}, onCleared = () => {} }) {
    Object.assign(this, { session, safeStorage, filename, now, onRestored, onCleared });
    this.closed = false; this.restoring = false; this.pendingRestore = false; this.busy = null; this.changedAt = 0; this.signature = '';
    this.status = { saved: false, restored: false, recovering: false, error: '' };
    this.changed = (_event, cookie, cause, removed) => {
      if (this.restoring || !authCookie({ ...cookie, value: 'scope-check', session: true }, this.now())) return;
      if (cookie.name === 'oauth_token' && (removed && ['explicit', 'expired', 'expired-overwrite'].includes(cause) || !removed && !authCookie(cookie, this.now()))) {
        this.changedAt++; this.signature = ''; this.pendingRestore = false; this.status = { saved: false, restored: false, recovering: false, error: '' };
        try { writeJson(this.filename, { version: 1, cleared: true, expires: 0, encryptedCookies: '' }); } catch { this.status.error = 'Не удалось сохранить выход из SoundCloud.'; }
        this.onCleared();
      } else this.schedule();
    };
  }
  state() { return { ...this.status }; }
  async start() {
    this.session.cookies.on('changed', this.changed);
    await this.restore();
    if (!this.pendingRestore) await this.flush();
    this.timer = setInterval(() => { if (this.pendingRestore) void this.restore().then(() => { if (!this.pendingRestore) return this.flush(); }); else void this.flush(); }, 30000); this.timer.unref?.();
  }
  async restore() {
    if (this.closed || this.restoring) return;
    this.restoring = true;
    try {
      const existing = (await this.session.cookies.get({ domain: 'soundcloud.com' })).filter(cookie => authCookie(cookie, this.now()));
      if (existing.some(cookie => cookie.name === 'oauth_token')) { this.pendingRestore = false; this.status.recovering = false; this.status.error = ''; return; }
      if (!fs.existsSync(this.filename)) { this.pendingRestore = false; this.status.recovering = false; this.status.error = ''; return; }
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (saved.version !== 1) throw new Error();
      if (saved.cleared || saved.expires <= this.now() || !saved.encryptedCookies) { this.pendingRestore = false; this.status = { saved: false, restored: false, recovering: false, error: '' }; return; }
      if (!storageAvailable(this.safeStorage)) throw new Error();
      const cookies = JSON.parse(this.safeStorage.decryptString(Buffer.from(saved.encryptedCookies, 'base64')));
      const rows = (Array.isArray(cookies) ? cookies : []).filter(cookie => authCookie(cookie, this.now()));
      if (!rows.some(cookie => cookie.name === 'oauth_token')) { this.pendingRestore = false; this.status = { saved: false, restored: false, recovering: false, error: '' }; return; }
      for (const cookie of rows) await this.session.cookies.set(cookieDetails(cookie));
      await this.session.cookies.flushStore();
      this.session.flushStorageData();
      this.pendingRestore = false; this.status = { saved: true, restored: true, recovering: false, error: '' };
      this.onRestored();
    } catch {
      this.pendingRestore = true; this.status.recovering = true;
      this.status.error = 'Повторяем чтение сохранённого входа SoundCloud. Данные не сброшены.';
    } finally { this.restoring = false; }
  }
  schedule() { clearTimeout(this.debounce); this.debounce = setTimeout(() => { void this.flush(); }, 500); this.debounce.unref?.(); }
  flush() {
    if (this.busy) return this.busy;
    this.busy = this.save().catch(() => { this.status.error = 'Не удалось сохранить вход SoundCloud. Повторим автоматически.'; }).finally(() => { this.busy = null; });
    return this.busy;
  }
  async save() {
    if (this.pendingRestore || this.restoring) return;
    const revision = this.changedAt;
    const rows = (await this.session.cookies.get({ domain: 'soundcloud.com' })).filter(cookie => authCookie(cookie, this.now()));
    if (revision !== this.changedAt) return;
    if (rows.some(cookie => cookie.name === 'oauth_token')) {
      const payload = JSON.stringify(rows), signature = createHash('sha256').update(payload).digest('hex');
      if (signature !== this.signature) {
        if (!storageAvailable(this.safeStorage)) throw new Error();
        const encryptedCookies = this.safeStorage.encryptString(payload).toString('base64');
        if (revision !== this.changedAt) return;
        writeJson(this.filename, { version: 1, expires: this.now() + MAX_AGE, encryptedCookies });
        this.signature = signature;
      }
      this.status.saved = true; this.status.error = ''; this.status.recovering = false;
    }
    this.session.flushStorageData();
    await this.session.cookies.flushStore();
  }
  async dispose() {
    this.closed = true; clearInterval(this.timer); clearTimeout(this.debounce);
    this.session.cookies.removeListener('changed', this.changed);
    await this.busy; await this.flush();
  }
}
module.exports = { SoundCloudSession, authCookie };
