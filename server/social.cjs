'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { HttpError, profile } = require('./core.cjs');
const DAY = 86400000;
const clean = (value, limit = 240) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const defaults = () => ({ bio: '', avatarUrl: '', backgroundUrl: '', backgroundPreset: 'forest', allowFriendRequests: true, allowRoomInvites: 'friends', notificationsEnabled: true });
const pair = (a, b) => [a, b].sort((x, y) => x - y).join(':');
const userId = value => { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Некорректный пользователь.'); return id; };
const APP_ROLES = Object.freeze({ owner: 'Владелец', tester: 'Тестер' });
const roleIds = value => Array.isArray(value) ? Object.keys(APP_ROLES).filter(id => value.includes(id)) : [];

/** Public community identity is separate from the encrypted player-profile backup. */
class SocialService {
  constructor(store, rooms, { plusUserIds = String(process.env.LOLZCLOUD_PLUS_USER_IDS || '').split(','), ownerUserIds = String(process.env.LOLZCLOUD_OWNER_USER_IDS || '').split(',') } = {}) {
    Object.assign(this, { store, rooms });
    this.filename = store.filename ? path.join(path.dirname(store.filename), 'social-state.json') : null;
    this.mediaDirectory = store.filename ? path.join(path.dirname(store.filename), 'profile-media') : null;
    this.plus = new Set(plusUserIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
    this.bootstrapOwnerIds = new Set(ownerUserIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
    this.listeners = new Map(); this.mediaMemory = new Map();
    this.load({});
    try { this.load(JSON.parse(fs.readFileSync(this.filename, 'utf8'))); } catch { /* Initial store. */ }
    for (const row of store.sessions.values()) this.observe(row.user, false, row.verifiedAt);
    for (const room of store.rooms.values()) if (!this.users.has(room.owner.id)) this.observe(room.owner, false, 0);
    this.bootstrapOwner();
    const login = store.login.bind(store);
    store.login = value => { const session = login(value); this.observe(session.user, true, session.verifiedAt); return { ...session, user: this.card(session.user, session.user) }; };
    const view = store.viewRoom.bind(store);
    store.viewRoom = (room, viewer) => {
      const value = view(room, viewer), decorate = person => this.card(person, viewer);
      return { ...value, owner: decorate(value.owner), participants: value.participants.map(person => ({ ...person, ...decorate(person) })),
        chat: value.chat.map(message => ({ ...message, user: decorate(message.user) })),
        controller: value.controller ? { ...value.controller, user: decorate(value.controller.user) } : null };
    };
  }
  load(saved) {
    this.users = new Map(); this.friends = new Set(); this.requests = new Map(); this.notifications = new Map();
    this.revision = Number.isSafeInteger(saved.revision) ? saved.revision : 0;
    for (const row of (saved.users || []).slice(0, 20000)) {
      try { const identity = profile(row.identity); this.users.set(identity.id, { identity, custom: { ...defaults(), ...row.custom }, appRoles: roleIds(row.appRoles), revision: Math.max(1, Number(row.revision) || 1), joinedAt: Number(row.joinedAt) || this.store.now(), verifiedAt: Number(row.verifiedAt) || 0 }); } catch { /* Invalid persisted identity. */ }
    }
    for (const key of saved.friends || []) if (/^\d+:\d+$/.test(key) && key.split(':').every(id => this.users.has(Number(id)))) this.friends.add(key);
    for (const row of saved.requests || []) if (this.users.has(row.from) && this.users.has(row.to) && row.from !== row.to && row.createdAt > this.store.now() - 90 * DAY) this.requests.set(row.from + ':' + row.to, row);
    for (const row of saved.notifications || []) if (this.users.has(row.to) && this.users.has(row.actorId) && ['friend_request', 'friend_accept', 'room_invite'].includes(row.type) && /^[a-f0-9-]{36}$/.test(row.id) && row.createdAt > this.store.now() - 30 * DAY) {
      const list = this.notifications.get(row.to) || []; list.push(row); this.notifications.set(row.to, list.slice(-100));
    }
  }
  data() { return { version: 1, revision: this.revision, users: [...this.users.values()], friends: [...this.friends], requests: [...this.requests.values()], notifications: [...this.notifications.values()].flat() }; }
  save() {
    if (!this.filename) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.data()), { mode: 0o600 });
    fs.renameSync(this.filename + '.tmp', this.filename);
  }
  mutate(ids, operation) {
    const previous = JSON.stringify(this.data()); let result;
    try { result = operation(); this.revision++; this.save(); }
    catch (error) { this.load(JSON.parse(previous)); throw error; }
    for (const id of new Set(ids)) for (const callback of this.listeners.get(id) || []) callback();
    return result;
  }
  observe(value, persist = true, verifiedAt = this.store.now()) {
    const identity = profile(value), old = this.users.get(identity.id);
    const stamp = Number(verifiedAt) || 0;
    if (old && (stamp < old.verifiedAt || stamp === old.verifiedAt && JSON.stringify(old.identity) === JSON.stringify(identity))) { this.bootstrapOwner(); return old; }
    if (!old && this.users.size >= 20000) throw new HttpError(503, 'Регистрация профилей временно занята.');
    const change = () => { const row = old ? { ...old, identity, verifiedAt: stamp } : { identity, custom: defaults(), appRoles: [], revision: 1, joinedAt: this.store.now(), verifiedAt: stamp }; this.users.set(identity.id, row); return row; };
    const result = persist ? this.mutate([identity.id], change) : change(); this.bootstrapOwner(); return result;
  }
  ownerCount() { return [...this.users.values()].filter(row => row.appRoles?.includes('owner')).length; }
  isOwner(user) { return !!this.users.get(Number(user?.id))?.appRoles?.includes('owner'); }
  bootstrapOwner() {
    // This allowlist is supplied by the server operator, never by a profile or HTTP body.
    // Once an owner exists, deployment configuration cannot silently promote more users.
    if (this.ownerCount()) return;
    for (const id of this.bootstrapOwnerIds) {
      const row = this.users.get(id); if (!row) continue;
      this.mutate([id], () => { row.appRoles = roleIds([...(row.appRoles || []), 'owner']); row.revision++; }); return;
    }
  }
  record(id) { const row = this.users.get(userId(id)); if (!row) throw new HttpError(404, 'Пользователь ещё не вошёл в LolzCloud.'); return row; }
  relationship(viewer, target) {
    if (!viewer) return 'none';
    const id = Number(viewer.id); if (id === target) return 'self';
    if (this.friends.has(pair(id, target))) return 'friends';
    if (this.requests.has(target + ':' + id)) return 'incoming';
    return this.requests.has(id + ':' + target) ? 'outgoing' : 'none';
  }
  card(value, viewer) {
    const row = this.users.get(Number(value.id));
    const identity = row?.identity || value, custom = row?.custom || defaults();
    const own = Number(viewer?.id) === identity.id;
    return { id: identity.id, name: identity.name, url: identity.url || 'https://lolz.live/members/' + identity.id + '/',
      avatar: custom.avatarUrl || identity.lolzAvatar || identity.avatar || '', lolzAvatar: identity.lolzAvatar || identity.avatar || '', avatarSource: custom.avatarUrl ? 'custom' : 'lolz',
      bio: custom.bio, background: { preset: custom.backgroundPreset, url: custom.backgroundUrl },
      titles: (identity.titles || []).map(title => ({ id: title.id, label: title.label, source: 'lolzteam' })),
      rank: this.plus.has(identity.id) ? { id: 'listener_plus', label: 'Слушатель+', source: 'lolzcloud' } : { id: 'listener', label: 'Слушатель', source: 'lolzcloud' },
      roles: roleIds(row?.appRoles).map(id => ({ id, label: APP_ROLES[id], source: 'lolzcloud' })), canManageRoles: !own && this.isOwner(viewer),
      relationship: this.relationship(viewer, identity.id), revision: row?.revision || 1, joinedAt: row?.joinedAt || null, lolzVerifiedAt: row?.verifiedAt || null, editable: own,
      ...(own ? { preferences: { allowFriendRequests: custom.allowFriendRequests, allowRoomInvites: custom.allowRoomInvites, notificationsEnabled: custom.notificationsEnabled } } : {}) };
  }
  get(id, viewer) { return this.card(this.record(id).identity, viewer); }
  search(query, viewer) {
    const q = clean(query, 100).toLocaleLowerCase('ru'); if (q.length < 2 && !/^\d+$/.test(q)) return [];
    return [...this.users.values()].filter(row => String(row.identity.id) === q || row.identity.name.toLocaleLowerCase('ru').includes(q)).slice(0, 20).map(row => this.card(row.identity, viewer));
  }
  ownMedia(value, id, kind) {
    if (value === '') return '';
    if (typeof value !== 'string' || value.length > 300) throw new HttpError(400, 'Выбери изображение профиля.');
    let url; try { url = new URL(value, this.store.origin); } catch { throw new HttpError(400, 'Некорректное изображение.'); }
    if (url.origin !== this.store.origin || url.username || url.password || url.search || url.hash || !new RegExp('^/media/profiles/' + id + '/' + kind + '-[a-f0-9]{24}\\.(?:png|jpg)$').test(url.pathname)) throw new HttpError(400, 'Используй своё загруженное изображение.');
    const name = url.pathname.split('/').pop(), exists = this.mediaDirectory ? fs.existsSync(path.join(this.mediaDirectory, String(id), name)) : this.mediaMemory.has(id + '/' + name);
    if (!exists) throw new HttpError(400, 'Изображение не найдено. Загрузи его ещё раз.');
    return this.store.origin + url.pathname;
  }
  update(user, value) {
    const row = this.record(user.id), allowed = ['revision', 'bio', 'avatarUrl', 'backgroundUrl', 'backgroundPreset', 'allowFriendRequests', 'allowRoomInvites', 'notificationsEnabled'];
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, 'Эти поля профиля нельзя изменить.');
    if (value.revision !== row.revision) throw new HttpError(409, 'Профиль изменён на другом устройстве. Обнови его перед сохранением.');
    const next = { ...row.custom };
    if ('bio' in value) { if (typeof value.bio !== 'string' || value.bio.length > 1000) throw new HttpError(400, 'Сократи описание профиля.'); next.bio = clean(value.bio); }
    for (const [key, kind] of [['avatarUrl', 'avatar'], ['backgroundUrl', 'background']]) if (key in value) next[key] = this.ownMedia(value[key], user.id, kind);
    if ('backgroundPreset' in value) { if (!['forest', 'paper', 'ink'].includes(value.backgroundPreset)) throw new HttpError(400, 'Неизвестный фон.'); next.backgroundPreset = value.backgroundPreset; }
    for (const key of ['allowFriendRequests', 'notificationsEnabled']) if (key in value) { if (typeof value[key] !== 'boolean') throw new HttpError(400, 'Некорректная настройка профиля.'); next[key] = value[key]; }
    if ('allowRoomInvites' in value) { if (!['friends', 'none', 'everyone'].includes(value.allowRoomInvites)) throw new HttpError(400, 'Некорректная настройка приглашений.'); next.allowRoomInvites = value.allowRoomInvites; }
    this.mutate([user.id], () => { row.custom = next; row.revision++; });
    for (const room of this.store.rooms.values()) if (room.owner.id === user.id || [...room.members.values()].some(member => member.user.id === user.id)) this.rooms.changed(room.id, false);
    return this.get(user.id, user);
  }
  updateRoles(actor, target, value) {
    if (!this.isOwner(actor)) throw new HttpError(403, 'Роли может менять только владелец LolzCloud.');
    target = userId(target); const row = this.record(target);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['revision', 'roles'].includes(key))
        || !Array.isArray(value.roles) || value.roles.length > 2 || value.roles.some(id => typeof id !== 'string' || !Object.hasOwn(APP_ROLES, id))
        || new Set(value.roles).size !== value.roles.length || !Number.isSafeInteger(value.revision)) throw new HttpError(400, 'Некорректный набор ролей LolzCloud.');
    const next = roleIds(value.roles), previous = roleIds(row.appRoles);
    if (previous.includes('owner') && !next.includes('owner') && this.ownerCount() <= 1) throw new HttpError(409, 'Нельзя снять роль последнего владельца LolzCloud.');
    if (Number(actor.id) === target) throw new HttpError(403, 'Собственные роли менять нельзя, чтобы не потерять доступ.');
    if (value.revision !== row.revision) throw new HttpError(409, 'Роли или профиль уже изменены. Загрузи свежий профиль.');
    if (JSON.stringify(previous) === JSON.stringify(next)) return this.get(target, actor);
    this.mutate([target, Number(actor.id)], () => { row.appRoles = next; row.revision++; });
    for (const room of this.store.rooms.values()) if (room.owner.id === target || room.controller?.user?.id === target || [...room.members.values()].some(member => member.user.id === target)) this.rooms.changed(room.id, false);
    return this.get(target, actor);
  }
  friendList(user) {
    const friends = [], incoming = [], outgoing = [];
    for (const row of this.users.values()) { const card = this.card(row.identity, user); if (card.relationship === 'friends') friends.push(card); else if (card.relationship === 'incoming') incoming.push(card); else if (card.relationship === 'outgoing') outgoing.push(card); }
    return { friends, incoming, outgoing };
  }
  notify(to, data) {
    const row = { id: crypto.randomUUID(), to, createdAt: this.store.now(), readAt: null, status: 'pending', ...data };
    this.notifications.set(to, [...(this.notifications.get(to) || []), row].slice(-100)); return row;
  }
  requestFriend(user, target) {
    target = userId(target); const recipient = this.record(target); if (target === user.id) throw new HttpError(400, 'Это твой профиль.');
    const relationship = this.relationship(user, target); if (relationship === 'friends' || relationship === 'outgoing') return { relationship };
    if (relationship === 'incoming') throw new HttpError(409, 'У тебя уже есть заявка этого пользователя. Прими её.');
    if (!recipient.custom.allowFriendRequests) throw new HttpError(403, 'Пользователь отключил заявки в друзья.');
    if ([...this.requests.values()].filter(row => row.from === user.id || row.to === target).length >= 200) throw new HttpError(429, 'Слишком много ожидающих заявок.');
    this.mutate([user.id, target], () => { this.requests.set(user.id + ':' + target, { from: user.id, to: target, createdAt: this.store.now() }); this.notify(target, { type: 'friend_request', actorId: user.id }); });
    return { relationship: 'outgoing' };
  }
  acceptFriend(user, target) {
    target = userId(target); this.record(target);
    if (this.friends.has(pair(user.id, target))) return { relationship: 'friends' };
    if (!this.requests.has(target + ':' + user.id)) throw new HttpError(404, 'Заявка уже отменена.');
    this.mutate([user.id, target], () => {
      this.requests.delete(target + ':' + user.id); this.friends.add(pair(user.id, target));
      for (const note of this.notifications.get(user.id) || []) if (note.type === 'friend_request' && note.actorId === target && note.status === 'pending') { note.status = 'accepted'; note.readAt = this.store.now(); }
      this.notify(target, { type: 'friend_accept', actorId: user.id, status: 'accepted' });
    }); return { relationship: 'friends' };
  }
  removeFriend(user, target) {
    target = userId(target); this.record(target);
    this.mutate([user.id, target], () => {
      this.friends.delete(pair(user.id, target)); this.requests.delete(user.id + ':' + target); this.requests.delete(target + ':' + user.id);
      for (const id of [user.id, target]) for (const note of this.notifications.get(id) || []) if (note.type === 'friend_request' && [user.id, target].includes(note.actorId) && note.status === 'pending') { note.status = 'declined'; note.readAt = this.store.now(); }
    }); return { ok: true, relationship: 'none' };
  }
  member(room, id) { return room.owner.id === id || [...room.members.values()].some(row => row.user.id === id && this.store.now() - row.seenAt < 25000); }
  invite(user, target, roomId) {
    target = userId(target); const recipient = this.record(target); if (target === user.id) throw new HttpError(400, 'Ты уже в этой комнате.');
    if (!/^[a-f0-9]{32}$/.test(roomId || '')) throw new HttpError(400, 'Выбери комнату.');
    const room = this.store.room(roomId); this.rooms.initialize(room);
    if (room.bans.has(user.id) || !this.member(room, user.id)) throw new HttpError(403, 'Приглашать можно из своей текущей комнаты.');
    if (room.bans.has(target)) throw new HttpError(403, 'Доступ пользователя в комнату закрыт.');
    if (recipient.custom.allowRoomInvites === 'none' || recipient.custom.allowRoomInvites === 'friends' && !this.friends.has(pair(user.id, target))) throw new HttpError(403, 'Пользователь принимает приглашения только от друзей.');
    const previous = (this.notifications.get(target) || []).find(note => note.type === 'room_invite' && note.actorId === user.id && note.roomId === roomId && note.status === 'pending' && note.expiresAt > this.store.now());
    if (previous) return this.notification(previous, { id: target });
    let note;
    this.mutate([target], () => { note = this.notify(target, { type: 'room_invite', actorId: user.id, roomId, roomName: room.settings.name, expiresAt: this.store.now() + 3600000 }); });
    return this.notification(note, { id: target });
  }
  notification(row, viewer) {
    const room = row.roomId && this.store.rooms.get(row.roomId), expired = row.expiresAt && (row.expiresAt <= this.store.now() || !room);
    const person = this.card(this.record(row.actorId).identity, viewer);
    const actor = { id: person.id, name: person.name, url: person.url, avatar: person.avatar, titles: person.titles.slice(0, 3), rank: person.rank, relationship: person.relationship };
    return { id: row.id, type: row.type, actor, createdAt: row.createdAt, readAt: row.readAt,
      status: expired && row.status === 'pending' ? 'expired' : row.status,
      ...(row.roomId ? { expiresAt: row.expiresAt, room: { id: row.roomId, name: room?.settings?.name || row.roomName, url: this.store.origin + '/room/' + row.roomId + '/' } } : {}) };
  }
  inbox(user) {
    const record = this.record(user.id), notifications = (this.notifications.get(user.id) || []).filter(row => row.createdAt > this.store.now() - 30 * DAY).map(row => this.notification(row, user)).reverse();
    return { userId: user.id, notifications, unread: notifications.filter(row => row.readAt === null && !['expired', 'declined'].includes(row.status)).length, revision: this.revision, enabled: record.custom.notificationsEnabled };
  }
  read(user, value) {
    if (!value || value.all !== true && (!Array.isArray(value.ids) || value.ids.length > 100 || value.ids.some(id => typeof id !== 'string'))) throw new HttpError(400, 'Некорректный список уведомлений.');
    const ids = new Set(value.ids || []);
    this.mutate([user.id], () => { for (const row of this.notifications.get(user.id) || []) if (value.all === true || ids.has(row.id)) row.readAt ||= this.store.now(); }); return { ok: true, ...this.inbox(user) };
  }
  respond(user, id, accept) {
    const note = (this.notifications.get(user.id) || []).find(row => row.id === id && row.type === 'room_invite');
    if (!note) throw new HttpError(404, 'Приглашение не найдено.');
    if (typeof accept !== 'boolean') throw new HttpError(400, 'Подтверди действие с приглашением.');
    if (accept && (!this.store.rooms.has(note.roomId) || note.expiresAt <= this.store.now())) throw new HttpError(410, 'Приглашение истекло или комната закрыта.');
    if (this.notification(note, user).status === 'expired') throw new HttpError(410, 'Приглашение истекло или комната закрыта.');
    if (note.status === 'accepted' && accept) { this.store.viewRoom(this.store.room(note.roomId), user); return { ok: true, url: this.store.origin + '/room/' + note.roomId + '/' }; }
    if (note.status !== 'pending') throw new HttpError(409, 'Приглашение уже обработано.');
    if (accept) { const room = this.store.room(note.roomId); this.store.viewRoom(room, user); const people = new Set([room.owner.id, ...[...room.members.values()].filter(row => this.store.now() - row.seenAt < 25000).map(row => row.user.id)]); if (!people.has(user.id) && people.size >= room.settings.capacity) throw new HttpError(409, 'В комнате пока нет свободных мест.'); }
    this.mutate([user.id], () => { note.status = accept ? 'accepted' : 'declined'; note.readAt = this.store.now(); });
    return { ok: true, ...(accept ? { url: this.store.origin + '/room/' + note.roomId + '/' } : {}) };
  }
  subscribe(user, callback) {
    const active = this.listeners.get(user.id) || new Set();
    if (active.size >= 5 || [...this.listeners.values()].reduce((n, set) => n + set.size, 0) >= 2000) throw new HttpError(429, 'Слишком много подключённых окон.');
    active.add(callback); this.listeners.set(user.id, active); return () => { active.delete(callback); if (!active.size) this.listeners.delete(user.id); };
  }
  upload(user, value) {
    this.record(user.id); const kind = value?.kind;
    if (!['avatar', 'background'].includes(kind) || typeof value.dataUrl !== 'string') throw new HttpError(400, 'Выбери изображение.');
    const match = value.dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new HttpError(400, 'Поддерживаются JPG и PNG.');
    const bytes = Buffer.from(match[2], 'base64'), maximum = kind === 'avatar' ? 400000 : 1000000;
    if (bytes.length > maximum || bytes.length < 24) throw new HttpError(413, 'Слишком большое изображение.');
    const dimensions = imageDimensions(bytes, match[1]);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > (kind === 'avatar' ? 2048 : 4096) || dimensions.height > (kind === 'avatar' ? 2048 : 4096) || dimensions.width * dimensions.height > 16_000_000) throw new HttpError(400, 'Некорректный размер изображения.');
    const name = kind + '-' + crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24) + (match[1] === 'png' ? '.png' : '.jpg');
    if (this.mediaDirectory) {
      const directory = path.join(this.mediaDirectory, String(user.id)); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const files = fs.readdirSync(directory).filter(file => /^(?:avatar|background)-[a-f0-9]{24}\.(?:png|jpg)$/.test(file));
      const record = this.record(user.id), keep = new Set([record.custom.avatarUrl.split('/').pop(), record.custom.backgroundUrl.split('/').pop(), name]);
      const unused = files.filter(file => !keep.has(file)).sort((a, b) => fs.statSync(path.join(directory, a)).mtimeMs - fs.statSync(path.join(directory, b)).mtimeMs);
      while (files.length >= 12 && unused.length) { const remove = unused.shift(); fs.unlinkSync(path.join(directory, remove)); files.splice(files.indexOf(remove), 1); }
      fs.writeFileSync(path.join(directory, name), bytes, { mode: 0o600 });
    } else {
      const record = this.record(user.id), keep = new Set([record.custom.avatarUrl.split('/').pop(), record.custom.backgroundUrl.split('/').pop(), name]);
      const owned = [...this.mediaMemory.keys()].filter(key => key.startsWith(user.id + '/'));
      while (owned.length >= 12) { const index = owned.findIndex(key => !keep.has(key.split('/').pop())); if (index < 0) break; this.mediaMemory.delete(owned[index]); owned.splice(index, 1); }
      this.mediaMemory.set(user.id + '/' + name, bytes);
    }
    return { url: this.store.origin + '/media/profiles/' + user.id + '/' + name };
  }
  media(id, name) {
    if (!/^(?:avatar|background)-[a-f0-9]{24}\.(?:png|jpg)$/.test(name)) throw new HttpError(404, 'Изображение не найдено.');
    let bytes; try { bytes = this.mediaDirectory ? fs.readFileSync(path.join(this.mediaDirectory, String(userId(id)), name)) : this.mediaMemory.get(userId(id) + '/' + name); } catch { /* Missing image. */ }
    if (!bytes) throw new HttpError(404, 'Изображение не найдено.'); return { bytes, type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
  dispose() { this.listeners.clear(); this.save(); }
}
function imageDimensions(bytes, type) {
  if (type === 'png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.length < 45 || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 255) return null; const marker = bytes[offset + 1]; offset += 2;
    if (marker === 0xd9 || marker === 0xda) return null;
    const size = bytes.readUInt16BE(offset); if (size < 2 || offset + size > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 7) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    offset += size;
  }
  return null;
}
module.exports = { SocialService, imageDimensions };
