'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { HttpError, playback } = require('./core.cjs');
const { mediaUrl } = require('./public/media-source.js');
const clean = (value, length = 180) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, length) : '';
function track(value) { const url = mediaUrl(value?.url); if (!url) throw new HttpError(400, 'Нужна ссылка на трек SoundCloud или YouTube Music.'); return { url, title: clean(value.title) || (url.includes('youtube.com') ? 'YouTube Music' : url.split('/').pop()), artist: clean(value.artist,100) }; }
class PlayerServices {
  constructor(store, rooms = null) {
    this.rooms = rooms;
    this.store = store; this.remotes = new Map(); this.profiles = new Map(); this.profileFile = store.filename ? path.join(path.dirname(store.filename), 'player-profiles.json') : null;
    try { for (const row of JSON.parse(fs.readFileSync(this.profileFile, 'utf8')).profiles || []) if (Number.isSafeInteger(row.userId) && row.envelope) this.profiles.set(row.userId, row); } catch { /* First launch. */ }
    const original = store.viewRoom.bind(store);
    store.viewRoom = (room, user) => ({ ...original(room, user), queue: this.queueView(room, user) });
  }
  queueView(room, user) { return (room.queue || []).map(row => ({ id: row.id, track: row.track, proposedBy: row.user, votes: row.votes.size, voted: row.votes.has(user.id), approved: row.approved, createdAt: row.createdAt })).sort((a, b) => Number(b.approved) - Number(a.approved) || b.votes - a.votes || a.createdAt - b.createdAt); }
  queue(id, user, action) {
    const room = this.store.room(id), host = this.rooms ? this.rooms.canControl(room, user) : room.owner.id === user.id;
    if (!host && ![...room.members.values()].some(row => row.user.id === user.id && this.store.now() - row.seenAt < 25000)) throw new HttpError(403, 'Сначала подключись к комнате.');
    room.queue ||= [];
    if (action.type === 'add') {
      if (room.queue.length >= 50 || !host && room.queue.filter(row => row.user.id === user.id).length >= 3) throw new HttpError(429, 'Очередь заполнена: до трёх заявок на участника.');
      const value = track(action.track); if (room.queue.some(row => row.track.url === value.url)) throw new HttpError(409, 'Этот трек уже в очереди.');
      room.queue.push({ id: crypto.randomBytes(12).toString('hex'), track: value, user: { id: user.id, name: user.name }, votes: new Set(), approved: host, createdAt: this.store.now() });
    } else if (action.type === 'next') {
      if (!host) throw new HttpError(403, 'Следующий трек выбирает ведущий.');
      if (room.modern && this.rooms) this.rooms.requireLease(room, user, action);
      const row = this.queueView(room, user).find(row => row.approved); if (!row) return { room: this.store.viewRoom(room, user), track: null };
      room.queue = room.queue.filter(value => value.id !== row.id); room.revision++; return { room: this.store.viewRoom(room, user), track: row.track };
    } else {
      const row = room.queue.find(row => row.id === action.id); if (!row) throw new HttpError(404, 'Заявка уже обработана.');
      if (action.type === 'vote') { if (row.votes.has(user.id)) row.votes.delete(user.id); else row.votes.add(user.id); }
      else if (action.type === 'approve') { if (!host) throw new HttpError(403, 'Подтвердить трек может ведущий.'); row.approved = !row.approved; }
      else if (action.type === 'remove') { if (!host && row.user.id !== user.id) throw new HttpError(403, 'Можно убрать только свою заявку.'); room.queue = room.queue.filter(value => value !== row); }
      else throw new HttpError(400, 'Неизвестное действие очереди.');
    }
    room.revision++; return { room: this.store.viewRoom(room, user) };
  }
  pruneRemotes() { for (const [id, row] of this.remotes) if (this.store.now() - row.updatedAt > 90000) this.remotes.delete(id); }
  remote(id, user) { this.pruneRemotes(); const row = this.remotes.get(id); if (!row || row.owner !== user.id) throw new HttpError(404, 'Пульт отключён или принадлежит другому аккаунту.'); return row; }
  createRemote(user, name) { this.pruneRemotes(); if (this.remotes.size >= 2000 || [...this.remotes.values()].filter(row => row.owner === user.id).length >= 3) throw new HttpError(429, 'Уже подключено три пульта.'); const id = crypto.randomBytes(16).toString('hex'); this.remotes.set(id, { owner: user.id, name: clean(name, 80) || 'LolzCloud на компьютере', updatedAt: this.store.now(), commands: [], sequence: 0, ack: 0, state: { playback: playback(null), volume: 1 } }); return { id, url: this.store.origin + '/remote/' + id, name: this.remotes.get(id).name }; }
  remoteView(id, user) { const row = this.remote(id, user); return { id, name: row.name, ...row.state, updatedAt: row.updatedAt }; }
  updateRemote(id, user, data) { const row = this.remote(id, user); const ack = Number(data.ack); if (!Number.isSafeInteger(ack) || ack < row.ack || ack > row.sequence) throw new HttpError(400, 'Неверный номер команды.'); row.ack = ack; row.commands = row.commands.filter(value => value.id > ack); row.updatedAt = this.store.now(); row.state = { playback: playback(data), private: data.private === true, volume: Math.max(0, Math.min(1, Number(data.volume) || 0)) }; return { commands: row.commands.map(value => ({ ...value })) }; }
  command(id, user, value) { const row = this.remote(id, user); if (!['playPause', 'next', 'previous', 'play', 'pause', 'seek', 'volume'].includes(value.command)) throw new HttpError(400, 'Неизвестная команда пульта.'); if (row.commands.length >= 30) throw new HttpError(429, 'Компьютер ещё выполняет предыдущие команды.'); let number = 0; if (['seek', 'volume'].includes(value.command)) { number = Number(value.value); if (!Number.isFinite(number) || number < 0 || number > (value.command === 'volume' ? 1 : 14400)) throw new HttpError(400, 'Некорректное значение команды.'); } row.commands.push({ id: ++row.sequence, command: value.command, value: number }); return { ok: true }; }
  saveProfile(user, value) {
    if (!Number.isSafeInteger(value.revision) || value.revision !== (this.profiles.get(user.id)?.revision || 0)) throw new HttpError(409, 'Облачная копия изменена на другом устройстве. Сначала загрузи её.');
    const envelope = value.envelope;
    if (envelope?.version !== 1 || !['salt', 'iv', 'tag', 'ciphertext'].every(key => typeof envelope[key] === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(envelope[key])) || envelope.ciphertext.length > 1000000 || Buffer.from(envelope.salt, 'base64').length !== 16 || Buffer.from(envelope.iv, 'base64').length !== 12 || Buffer.from(envelope.tag, 'base64').length !== 16) throw new HttpError(400, 'Неверный формат зашифрованной копии.');
    if (this.profiles.size >= 1000 && !this.profiles.has(user.id)) throw new HttpError(503, 'Хранилище копий временно заполнено.');
    const row = { userId: user.id, revision: value.revision + 1, updatedAt: this.store.now(), envelope: Object.fromEntries(['version', 'salt', 'iv', 'tag', 'ciphertext'].map(key => [key, envelope[key]])) };
    const previous = this.profiles.get(user.id); this.profiles.set(user.id, row);
    try { if (this.profileFile) { fs.mkdirSync(path.dirname(this.profileFile), { recursive: true, mode: 0o700 }); fs.writeFileSync(this.profileFile + '.tmp', JSON.stringify({ profiles: [...this.profiles.values()] }), { mode: 0o600 }); fs.renameSync(this.profileFile + '.tmp', this.profileFile); } } catch (error) { if (previous) this.profiles.set(user.id, previous); else this.profiles.delete(user.id); throw error; }
    return { revision: row.revision, updatedAt: row.updatedAt };
  }
  getProfile(user) { const row = this.profiles.get(user.id); return row ? { revision: row.revision, updatedAt: row.updatedAt, envelope: row.envelope } : { revision: 0, updatedAt: null, envelope: null }; }
}
module.exports = { PlayerServices, track };
