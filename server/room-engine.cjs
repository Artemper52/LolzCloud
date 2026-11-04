'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { HttpError, profile, playback } = require('./core.cjs');
const LEASE_MS = 15000;
const clean = (value, limit = 180) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, limit) : '';
const controllerId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
function positionAt(track, sampledAt, now) { return Math.max(0, Math.min(track.duration || 14400, track.position + (track.playing ? Math.max(0, now - sampledAt) / 1000 : 0))); }
class RoomEngine {
  constructor(store) {
    this.store = store; this.listeners = new Map(); this.filename = store.filename ? path.join(path.dirname(store.filename), 'rooms-state.json') : null; this.saveTimer = null;
    try { const data = JSON.parse(fs.readFileSync(this.filename, 'utf8')); for (const row of (data.rooms || []).slice(0, 1000)) if (/^[a-f0-9]{32}$/.test(row.id) && store.now() - row.savedAt < 86400000) { const room = { id: row.id, owner: profile(row.owner), createdAt: store.now(), updatedAt: store.now(), members: new Map(), playback: { ...playback({ fresh: true, playback: row.playback }), playing: false }, revision: (Number(row.revision) || 0) + 1, epoch: (Number(row.epoch) || 0) + 1, settings: row.settings, roles: new Map(row.roles || []), bans: new Set(row.bans || []), queue: (row.queue || []).slice(0, 50).map(item => ({ ...item, votes: new Set(item.votes || []) })) }; store.rooms.set(room.id, room); } } catch { /* First launch; corrupt data is not trusted. */ }
    const view = store.viewRoom.bind(store), update = store.updateRoom.bind(store), close = store.closeRoom.bind(store);
    store.viewRoom = (room, user) => {
      this.initialize(room); if (room.bans.has(user.id) && room.owner.id !== user.id) throw new HttpError(403, 'Доступ в комнату закрыт ведущим.');
      const base = view(room, user), controller = this.controller(room), stale = !controller && room.modern === true;
      const source = room.playback, now = store.now(), target = positionAt(source, room.updatedAt, stale ? Math.min(now, room.controller?.expires || room.updatedAt) : now);
      return { ...base, playback: { ...source, position: target, playing: source.playing && !stale }, sampledAt: now, serverTime: now, epoch: room.epoch, protocol: 2, settings: { ...room.settings }, controller: controller ? { user: controller.user, connection: controller.connection, name: controller.name, expires: controller.expires } : null, canControl: this.canControl(room, user), reconnecting: stale, participants: base.participants.map(person => ({ ...person, role: person.id === room.owner.id ? 'owner' : room.roles.get(person.id) || 'listener', sync: room.health.get(person.id) || null })), chat: room.chat.slice(-100), reactions: room.reactions.filter(row => now - row.at < 6000), history: room.history.slice(-30) };
    };
    store.updateRoom = (id, user, value) => {
      const room = store.room(id); this.initialize(room);
      if (!value.lease && !room.modern) { const result = update(id, user, value); this.changed(id); return result; }
      const lease = this.requireLease(room, user, value);
      if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) throw new HttpError(400, 'Нет номера обновления воспроизведения.');
      if (value.sequence <= lease.sequence) return store.viewRoom(room, user);
      const next = playback(value); if (next.url && Math.abs(next.rate - 1) > .001) throw new HttpError(422, 'В общей комнате используется обычная скорость воспроизведения.');
      const age = Math.max(0, Math.min(3000, Number(value.sampleAgeMs) || 0)); next.position = positionAt(next, store.now() - age, store.now()); next.rate = 1;
      if (room.playback.url && room.playback.url !== next.url) room.history.push({ ...room.playback, at: store.now() }); room.history = room.history.slice(-30);
      room.playback = next; room.updatedAt = store.now(); lease.expires = store.now() + LEASE_MS; lease.sequence = value.sequence; room.revision++; this.changed(id); return store.viewRoom(room, user);
    };
    store.closeRoom = (id, user) => { close(id, user); this.changed(id); };
  }
  initialize(room) { room.roles ||= new Map(); room.bans ||= new Set(); room.health ||= new Map(); room.settings ||= { name: 'Комната ' + room.owner.name, description: '', public: false, capacity: 50, autoNext: true, chat: true }; room.chat ||= []; room.reactions ||= []; room.history ||= []; room.epoch ||= 0; }
  controller(room) { return room.controller && room.controller.expires > this.store.now() ? room.controller : null; }
  canControl(room, user) { this.initialize(room); return room.owner.id === user.id || !room.bans.has(user.id) && room.roles.get(user.id) === 'dj'; }
  requireLease(room, user, value) { const controller = this.controller(room); if (!controller || controller.user.id !== user.id || typeof value.lease !== 'string' || controller.secret !== value.lease || controller.connection !== value.connection) throw new HttpError(409, 'Управление передано на другое устройство. Нажми «Вести здесь», чтобы вернуть его.'); return controller; }
  control(id, user, value) {
    const room = this.store.room(id); this.initialize(room);
    if (value.type === 'claim') {
      if (!this.canControl(room, user) || !controllerId(value.connection)) throw new HttpError(403, 'Управление доступно владельцу и назначенному диджею.');
      const existing = this.controller(room);
      if (existing && existing.connection !== value.connection && !(value.force === true && room.owner.id === user.id)) throw new HttpError(409, 'У комнаты уже есть ведущий. Владелец может передать управление.');
      if (room.playback.playing) room.playback.position = positionAt(room.playback, room.updatedAt, !existing && room.modern ? Math.min(this.store.now(), room.controller?.expires || room.updatedAt) : this.store.now());
      room.playback.playing = false; room.updatedAt = this.store.now(); room.modern = true; room.epoch++; room.revision++;
      room.controller = { secret: crypto.randomBytes(32).toString('base64url'), user: { id: user.id, name: user.name }, connection: value.connection, name: clean(value.name, 80) || 'Браузер', expires: this.store.now() + LEASE_MS, sequence: 0 };
      this.changed(id); return { room: this.store.viewRoom(room, user), lease: room.controller.secret };
    }
    if (value.type === 'release') { const controller = this.requireLease(room, user, value); room.playback.position = positionAt(room.playback, room.updatedAt, this.store.now()); room.playback.playing = false; room.updatedAt = this.store.now(); controller.expires = 0; room.revision++; this.changed(id); return { room: this.store.viewRoom(room, user) }; }
    if (room.owner.id !== user.id) throw new HttpError(403, 'Настройки меняет владелец комнаты.');
    if (value.type === 'settings') { const settings = value.settings || {}; room.settings = { ...room.settings, ...(typeof settings.name === 'string' ? { name: clean(settings.name, 80) || 'Музыка вместе' } : {}), ...(typeof settings.description === 'string' ? { description: clean(settings.description, 240) } : {}) }; for (const key of ['public', 'autoNext', 'chat']) if (typeof settings[key] === 'boolean') room.settings[key] = settings[key]; if (Number.isInteger(settings.capacity)) room.settings.capacity = Math.max(2, Math.min(200, settings.capacity)); }
    else if (value.type === 'role') { const target = Number(value.userId); if (!Number.isSafeInteger(target) || target === room.owner.id || ![...room.members.values()].some(row => row.user.id === target)) throw new HttpError(400, 'Выбери участника комнаты.'); if (!['dj', 'listener'].includes(value.role)) throw new HttpError(400, 'Неизвестная роль.'); room.roles.set(target, value.role); if (room.controller?.user.id === target && value.role !== 'dj') room.controller.expires = 0; }
    else if (value.type === 'kick') { const target = Number(value.userId); if (!Number.isSafeInteger(target) || target === room.owner.id) throw new HttpError(400, 'Нельзя исключить владельца.'); if (room.bans.size >= 500) throw new HttpError(429, 'Список ограничений заполнен.'); room.bans.add(target); for (const [key, row] of room.members) if (row.user.id === target) room.members.delete(key); if (room.controller?.user.id === target) room.controller.expires = 0; }
    else if (value.type === 'unban') room.bans.delete(Number(value.userId));
    else throw new HttpError(400, 'Неизвестное действие комнаты.');
    room.revision++; this.changed(id); return { room: this.store.viewRoom(room, user) };
  }
  join(id, user, value) {
    const room = this.store.room(id); this.initialize(room); if (room.bans.has(user.id) && user.id !== room.owner.id) throw new HttpError(403, 'Доступ в комнату закрыт ведущим.');
    const users = new Set([room.owner.id, ...[...room.members.values()].filter(row => this.store.now() - row.seenAt < 25000).map(row => row.user.id)]);
    if (!users.has(user.id) && users.size >= room.settings.capacity) throw new HttpError(429, 'В комнате сейчас нет свободных мест.');
    if (value.health && ['ready', 'buffering', 'autoplay', 'error'].includes(value.health.status)) room.health.set(user.id, { status: value.health.status, driftMs: Number.isFinite(value.health.driftMs) ? Math.round(Math.max(-10000, Math.min(10000, value.health.driftMs)) / 100) * 100 : null });
    const result = this.store.joinRoom(id, user, value.connection), signature = JSON.stringify(result.participants);
    if (signature !== room.presenceSignature) { room.presenceSignature = signature; this.changed(id, false); }
    return result;
  }
  message(id, user, value) { const room = this.store.room(id); this.initialize(room); if (room.bans.has(user.id) || user.id !== room.owner.id && ![...room.members.values()].some(row => row.user.id === user.id && this.store.now() - row.seenAt < 25000)) throw new HttpError(403, 'Сначала подключись к комнате.'); if (value.type === 'reaction') { if (!['🔥', '❤️', '👏', '🎵', '💀', '✨'].includes(value.emoji)) throw new HttpError(400, 'Неизвестная реакция.'); room.reactions = room.reactions.filter(row => this.store.now() - row.at < 6000).slice(-30); room.reactions.push({ id: crypto.randomUUID(), user: { id: user.id, name: user.name }, emoji: value.emoji, at: this.store.now() }); }
    else { if (!room.settings.chat) throw new HttpError(403, 'Чат выключен владельцем.'); const body = clean(value.text, 400); if (!body) throw new HttpError(400, 'Напиши сообщение.'); room.chat.push({ id: crypto.randomUUID(), user: { id: user.id, name: user.name }, text: body, at: this.store.now() }); room.chat = room.chat.slice(-100); } room.revision++; this.changed(id, false); return this.store.viewRoom(room, user); }
  subscribe(id, listener) { if ([...this.listeners.values()].reduce((sum, set) => sum + set.size, 0) >= 2000) throw new HttpError(503, 'Слишком много подключений.'); const listeners = this.listeners.get(id) || new Set(); listeners.add(listener); this.listeners.set(id, listeners); return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); }; }
  changed(id, persist = true) { for (const listener of this.listeners.get(id) || []) listener(); if (persist && !this.saveTimer) { this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 500); this.saveTimer.unref(); } }
  save() { if (!this.filename) return; const rooms = [...this.store.rooms.values()].map(room => { this.initialize(room); return { id: room.id, owner: room.owner, savedAt: this.store.now(), playback: { ...room.playback, position: positionAt(room.playback, room.updatedAt, this.store.now()), playing: false }, revision: room.revision, epoch: room.epoch, settings: room.settings, roles: [...room.roles], bans: [...room.bans], queue: (room.queue || []).map(row => ({ ...row, votes: [...row.votes] })) }; }); try { fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 }); fs.writeFileSync(this.filename + '.tmp', JSON.stringify({ rooms }), { mode: 0o600 }); fs.renameSync(this.filename + '.tmp', this.filename); } catch { /* A transient storage failure does not stop music. */ } }
  dispose() { clearTimeout(this.saveTimer); this.save(); this.listeners.clear(); }
}
module.exports = { RoomEngine, positionAt, LEASE_MS };
