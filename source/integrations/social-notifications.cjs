'use strict';
const fs = require('node:fs');
const { writeJson } = require('./durable-json.cjs');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const TYPES = new Set(['room_invite', 'friend_request', 'friend_accept']);
const clean = (value, max = 100) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function notificationText(item) {
  const name = clean(item.actor?.name) || 'Пользователь LolzCloud';
  if (item.type === 'room_invite') return { title: 'Приглашение в комнату', body: name + ' приглашает в «' + (clean(item.room?.name) || 'Комната LolzCloud') + '»' };
  if (item.type === 'friend_accept') return { title: 'Теперь вы друзья', body: name + ' принял запрос в друзья' };
  return { title: 'Запрос в друзья', body: name + ' хочет добавить тебя в друзья' };
}

class SocialNotifications {
  constructor({ filename = null, getSession, request, createNotification, isSupported = () => true, getWindow = () => null, onOpen = () => {}, onState = () => {}, now = Date.now, intervalMs = 15000 }) {
    Object.assign(this, { filename, getSession, request, createNotification, isSupported, getWindow, onOpen, onState, now });
    this.users = Object.create(null); this.currentUser = ''; this.unread = 0; this.revision = ''; this.available = false; this.enabled = false;
    this.closed = false; this.pending = null; this.visible = new Set();
    if (filename) {
      try {
        const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
        for (const [id, state] of Object.entries(value.users || {})) if (/^[1-9]\d{0,14}$/.test(id) && state.initialized === true && Array.isArray(state.seen)) this.users[id] = { initialized: true, seen: state.seen.filter(id => typeof id === 'string' && UUID.test(id)).map(id => id.toLowerCase()).slice(-2000) };
      } catch { /* First launch or an unavailable local cache; establish a quiet baseline. */ }
    }
    if (intervalMs > 0) { this.timer = setInterval(() => { void this.poll(); }, Math.max(1000, intervalMs)); this.timer.unref?.(); }
  }
  state() { return { unread: this.unread, revision: this.revision, available: this.available, enabled: this.enabled, userId: this.currentUser ? Number(this.currentUser) : null }; }
  publish() { this.onState(this.state()); }
  clearVisible() { for (const notice of this.visible) { try { notice.close(); } catch { /* Already closed. */ } } this.visible.clear(); }
  save() {
    if (!this.filename) return;
    try { writeJson(this.filename, { version: 1, users: this.users }); }
    catch { /* An unwritable cache must not interrupt music or the inbox. */ }
  }
  poll() {
    if (this.closed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.pollOnce().catch(() => {}).finally(() => { this.pending = null; });
    return this.pending;
  }
  async pollOnce() {
    const session = this.getSession(), userId = session?.authenticated ? String(session.user?.id || '') : '';
    if (!/^[1-9]\d{0,14}$/.test(userId)) {
      if (this.currentUser || this.available || this.unread) { this.clearVisible(); this.currentUser = ''; this.unread = 0; this.available = false; this.enabled = false; this.revision = ''; this.publish(); }
      return;
    }
    const response = await this.request('/api/social/notifications');
    if (this.closed || !this.getSession()?.authenticated || String(this.getSession().user?.id) !== userId || String(response?.userId) !== userId || !Array.isArray(response.notifications)) return;
    const first = !this.users[userId]?.initialized, record = this.users[userId] || { initialized: true, seen: [] }, seen = new Set(record.seen);
    const previous = JSON.stringify(this.state());
    if (this.currentUser && this.currentUser !== userId) this.clearVisible();
    this.currentUser = userId; this.available = true;
    this.enabled = response.enabled === true;
    if (!this.enabled) this.clearVisible();
    this.unread = Math.max(0, Math.min(999999, Math.floor(Number(response.unread) || 0)));
    this.revision = clean(response.revision, 100);
    const fresh = []; let changed = first;
    for (const item of response.notifications.slice(0, 1000)) {
      if (!item || typeof item.id !== 'string' || !UUID.test(item.id) || seen.has(item.id.toLowerCase())) continue;
      seen.add(item.id.toLowerCase()); changed = true;
      if (!first && TYPES.has(item.type) && item.readAt == null && (!item.expiresAt || Number(item.expiresAt) > this.now())
          && (item.type === 'friend_accept' ? item.status === 'accepted' || item.status === 'pending' : item.status === 'pending')) fresh.push(item);
    }
    record.seen = [...seen].slice(-2000); this.users[userId] = record;
    // Save every newly observed id, including read/expired items, so an updated
    // server snapshot cannot later reintroduce it as a system notification.
    if (changed) this.save();
    if (JSON.stringify(this.state()) !== previous) this.publish();
    const window = this.getWindow();
    if (!fresh.length || !this.enabled || window && !window.isDestroyed?.() && window.isFocused?.() && !window.isMinimized?.() || !this.isSupported()) return;
    for (const item of fresh.sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).slice(-3)) this.show(item, userId);
  }
  show(item, userId) {
    if (this.closed) return;
    try {
      const notice = this.createNotification(notificationText(item));
      this.visible.add(notice);
      notice.on('close', () => this.visible.delete(notice));
      notice.on('failed', () => this.visible.delete(notice));
      notice.on('click', () => {
        if (this.closed || !this.getSession()?.authenticated || String(this.getSession().user?.id) !== userId) return;
        const window = this.getWindow();
        if (!window || window.isDestroyed?.()) return;
        if (window.isMinimized?.()) window.restore();
        window.show(); window.focus(); this.onOpen({ tab: 'notifications' });
      });
      notice.show();
    } catch { /* Unsupported desktop notification service; inbox remains available. */ }
  }
  dispose() {
    this.closed = true; clearInterval(this.timer);
    this.clearVisible();
  }
}
module.exports = { SocialNotifications, notificationText };
