'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { mediaUrl } = require('./public/media-source.js');
const DAY = 86400000, hash = value => crypto.createHash('sha256').update(String(value)).digest('hex'), token = () => crypto.randomBytes(32).toString('base64url');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const text = (value, length = 180) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, length) : '';
function profile(value) {
  const id = Number(value?.user_id || value?.id), name = text(value?.username || value?.name, 100);
  if (!Number.isSafeInteger(id) || id <= 0 || !name) throw new HttpError(401, 'Lolzteam не подтвердил аккаунт.');
  const avatar = value.links?.avatar_big || value.links?.avatar || value.lolzAvatar || value.avatar || '';
  const safeAvatar = typeof avatar === 'string' && /^https:\/\/[^/@]+(?:\/|$)/.test(avatar) ? avatar.slice(0, 1000) : '';
  // Membership labels come only from /users/me, never from the editable custom_title.
  // Keep the normalized form across session/device persistence as well.
  const titles = [], seen = new Set();
  for (const group of (Array.isArray(value.user_groups) ? value.user_groups : Array.isArray(value.titles) ? value.titles : []).slice(0, 40)) {
    const groupId = Number(group.user_group_id ?? group.id), label = text(String(group.user_group_title || group.user_group_banner_text || group.label || '').replace(/<[^>]*>/g, ''), 80);
    if (!Number.isSafeInteger(groupId) || groupId < 1 || !label || seen.has(groupId)) continue;
    seen.add(groupId); titles.push({ id: groupId, label, source: 'lolzteam' });
  }
  const curatorTitles = (Array.isArray(value.curator_titles) ? value.curator_titles : Array.isArray(value.curatorTitles) ? value.curatorTitles : []).slice(0, 20).map(title => text(title, 80)).filter(Boolean);
  if (curatorTitles.length && !titles.some(title => /куратор|curator/i.test(title.label))) titles.push({ id: 0, label: 'Куратор', source: 'lolzteam' });
  return { id, name, url: 'https://lolz.live/members/' + id + '/', avatar: safeAvatar, lolzAvatar: safeAvatar, titles, curatorTitles };
}
function playback(value) {
  const hidden = !value?.fresh || value.private;
  const url = mediaUrl(value?.playback?.url);
  const track = value?.playback || {}, duration = Math.max(0, Math.min(4 * 3600, Number(track.duration) || 0));
  return hidden || !url ? { title: 'Музыка пока не передаётся', artist: '', url: '', playing: false, position: 0, duration: 0, rate: 1 } : {
    title: text(track.title), artist: text(track.artist, 100), url, playing: track.playing === true, duration,
    position: Math.max(0, Math.min(duration || 14400, Number(track.position) || 0)), rate: Math.max(.5, Math.min(2, Number(track.rate) || 1)),
  };
}
class CloudStore {
  constructor({ filename, origin = 'https://lolzcloud.com', now = Date.now } = {}) {
    Object.assign(this, { filename, origin, now }); this.sessions = new Map(); this.states = new Map(); this.devices = new Map(); this.rooms = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      for (const row of saved.sessions || []) if (/^[a-f0-9]{64}$/.test(row.hash) && row.expires > this.now()) {
        this.sessions.set(row.hash, { user: profile(row.user), expires: Math.min(row.expires, this.now() + 7 * DAY), verifiedAt: Number(row.verifiedAt) || row.expires - 7 * DAY, csrf: /^[\w-]{43}$/.test(row.csrf || '') ? row.csrf : token() });
      }
    } catch { /* First launch. */ }
  }
  save() {
    if (!this.filename) return;
    this.prune(); fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filename + '.tmp', JSON.stringify({ sessions: [...this.sessions].map(([key, row]) => ({ hash: key, user: row.user, expires: row.expires, verifiedAt: row.verifiedAt, csrf: row.csrf })) }), { mode: 0o600 });
    fs.renameSync(this.filename + '.tmp', this.filename);
  }
  prune() {
    const now = this.now();
    for (const [key, row] of this.sessions) if (row.expires <= now) this.sessions.delete(key);
    for (const [key, row] of this.states) if (row.expires <= now) this.states.delete(key);
    for (const [key, row] of this.devices) if (row.expires <= now) this.devices.delete(key);
    for (const [key, row] of this.rooms) if (now - row.updatedAt > 3600000 || now - row.createdAt > DAY) this.rooms.delete(key);
  }
  session(secret) { const row = typeof secret === 'string' && secret.length <= 200 ? this.sessions.get(hash(secret)) : null; if (!row || row.expires <= this.now()) return null; return row; }
  login(user) {
    this.prune(); if (this.sessions.size >= 20000) throw new HttpError(503, 'Вход временно занят.');
    const secret = token(), row = { user: profile(user), expires: this.now() + 7 * DAY, verifiedAt: this.now(), csrf: token() }; this.sessions.set(hash(secret), row); this.save(); return { secret, ...row };
  }
  logout(secret) { if (secret) this.sessions.delete(hash(secret)); this.save(); }
  beginLogin(next) {
    this.prune(); if (this.states.size >= 1000) throw new HttpError(429, 'Слишком много попыток входа.');
    const state = token(); this.states.set(hash(state), { next: safeNext(next), expires: this.now() + 600000 }); return state;
  }
  consumeLogin(state, cookie) {
    if (typeof state !== 'string' || typeof cookie !== 'string' || !/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(cookie) || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) throw new HttpError(403, 'Проверка входа не пройдена. Открой вход заново.');
    const row = this.states.get(hash(state)); this.states.delete(hash(state));
    if (!row || row.expires <= this.now()) throw new HttpError(403, 'Ссылка входа истекла. Открой вход заново.');
    return row.next;
  }
  beginDevice() {
    this.prune(); if (this.devices.size >= 1000) throw new HttpError(429, 'Слишком много подключений.');
    const secret = token(), code = crypto.randomBytes(9).toString('base64url');
    this.devices.set(hash(secret), { code, expires: this.now() + 600000, user: null });
    return { deviceCode: secret, code, verificationUrl: this.origin + '/connect?code=' + code, expiresIn: 600 };
  }
  approveDevice(code, user) {
    const row = [...this.devices.values()].find(value => value.code === code && value.expires > this.now());
    if (!row || row.user && row.user.id !== user.id) throw new HttpError(404, 'Код подключения истёк или уже использован. Запусти вход в приложении ещё раз.');
    row.user ||= user;
    return true;
  }
  pollDevice(secret) {
    const key = hash(secret), row = this.devices.get(key);
    if (!row || row.expires <= this.now()) throw new HttpError(410, 'Подключение истекло. Открой вход заново.');
    if (row.grant) {
      if (!this.session(row.grant.token)) throw new HttpError(410, 'Подключение истекло. Открой вход заново.');
      return row.grant;
    }
    if (!row.user) return { pending: true };
    const session = this.login(row.user);
    // A lost HTTP response can be retried with the same device secret, briefly.
    row.expires = Math.min(row.expires, this.now() + 60000);
    row.grant = { pending: false, token: session.secret, user: session.user, expires: session.expires };
    return row.grant;
  }
  createRoom(user) {
    this.prune();
    const existing = [...this.rooms.values()].find(room => room.owner.id === user.id); if (existing) return this.viewRoom(existing, user);
    if (this.rooms.size >= 1000) throw new HttpError(503, 'Сейчас слишком много комнат. Попробуй позже.');
    const room = { id: crypto.randomBytes(16).toString('hex'), owner: user, createdAt: this.now(), updatedAt: this.now(), members: new Map(), playback: playback(null), revision: 0 };
    this.rooms.set(room.id, room); return this.viewRoom(room, user);
  }
  room(id) { this.prune(); const room = this.rooms.get(id); if (!room) throw new HttpError(404, 'Комната закрыта или не найдена.'); return room; }
  updateRoom(id, user, value) {
    const room = this.room(id); if (room.owner.id !== user.id) throw new HttpError(403, 'Музыкой управляет ведущий комнаты.');
    room.playback = playback(value); room.updatedAt = this.now(); room.revision++; return this.viewRoom(room, user);
  }
  closeRoom(id, user) { const room = this.room(id); if (room.owner.id !== user.id) throw new HttpError(403, 'Закрыть комнату может только ведущий.'); this.rooms.delete(id); }
  joinRoom(id, user, connection) {
    const room = this.room(id); if (!/^[a-zA-Z0-9_-]{8,80}$/.test(connection || '')) throw new HttpError(400, 'Некорректное подключение.');
    if (room.members.size >= 200 && !room.members.has(user.id + ':' + connection)) throw new HttpError(429, 'Комната заполнена.');
    room.members.set(user.id + ':' + connection, { user, seenAt: this.now() }); return this.viewRoom(room, user);
  }
  leaveRoom(id, user, connection) { this.room(id).members.delete(user.id + ':' + connection); }
  viewRoom(room, user) {
    const people = new Map([[room.owner.id, { ...room.owner, host: true, online: this.now() - room.updatedAt < 20000 }]]);
    for (const [key, row] of room.members) { if (this.now() - row.seenAt > 25000) { room.members.delete(key); continue; } if (row.user.id !== room.owner.id) people.set(row.user.id, { ...row.user, host: false, online: true }); }
    const fresh = this.now() - room.updatedAt < 20000;
    return { id: room.id, url: this.origin + '/room/' + room.id + '/', owner: room.owner, host: room.owner.id === user.id, participants: [...people.values()], viewers: Math.max(0, people.size - 1), playback: fresh ? room.playback : playback(null), updatedAt: room.updatedAt, revision: room.revision, serverTime: this.now() };
  }
}
function safeNext(value) {
  if (typeof value !== 'string' || value.length > 300) return '/rooms';
  if (/^(?:\/room\/[a-f0-9]{32}\/?|\/remote\/[a-f0-9]{32}|\/connect\?code=[a-zA-Z0-9_-]{12}|\/rooms|\/app\/?)$/.test(value)) return value;
  try { const url = new URL(value, 'https://lolzcloud.com'); if (!value.startsWith('/social') || url.origin !== 'https://lolzcloud.com' || url.pathname !== '/social' || url.hash) return '/rooms';
    for (const [key, entry] of url.searchParams) if (key === 'tab' ? !['profile', 'friends', 'notifications'].includes(entry) : key === 'user' ? !/^[1-9]\d{0,14}$/.test(entry) : true) return '/rooms';
    return url.pathname + url.search;
  } catch { return '/rooms'; }
}
module.exports = { CloudStore, HttpError, profile, playback, safeNext, hash, token };
