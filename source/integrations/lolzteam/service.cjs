'use strict';

const {
  INTERVAL_MS, STALE_MS, DEFAULT_SETTINGS, clean, normalizePlayback,
  validateSettings, formatStatus,
} = require('./status.cjs');
const { soundcloudProfile, profileLinks } = require('../profiles.cjs');

function validateUser(user) {
  if (!user || !Number.isSafeInteger(user.user_id) || user.user_id <= 0 || typeof user.username !== 'string'
      || typeof user.custom_title !== 'string' || user.user_is_visitor === false) {
    throw new Error('Lolzteam не подтвердил владельца токена или исходный статус.');
  }
  return {
    id: user.user_id,
    name: clean(user.username, 100),
    // Lolzteam can report edit_permissions.user_title=false while PUT user_title
    // successfully updates custom_title. Determine this capability from real writes.
    canEditStatus: null,
  };
}

class LolzteamService {
  constructor({ api, store, now = Date.now }) {
    this.api = api;
    this.store = store;
    this.now = now;
    this.token = '';
    this.user = null;
    this.soundcloudProfile = null;
    this.soundcloudProfileSource = 'session';
    this.settings = { ...DEFAULT_SETTINGS };
    this.originalTitle = '';
    this.ownedTitle = '';
    this.ownsStatus = false;
    this.pendingWrite = null;
    this.lastPublished = '';
    this.lastSyncedAt = 0;
    this.nextWriteAt = 0;
    this.retryAt = 0;
    this.failures = 0;
    this.error = '';
    this.playback = normalizePlayback(null);
    this.lastPlayback = null;
    this.pendingPlayback = null;
    this.receivedAt = null;
    this.busy = 0;
    this.tail = Promise.resolve();
    this.closing = false;
    this.storagePending = false;
    this.storageRetryAt = 0;
    this.restoreSaved();
  }

  restoreSaved() {
    try {
      const saved = this.store.load();
      if (saved) {
        const { discordApplicationId: legacyApplicationId, ...settings } = saved.settings || {};
        this.settings = validateSettings(settings);
        this.soundcloudProfile = soundcloudProfile(saved.soundcloudProfile);
        this.soundcloudProfileSource = saved.soundcloudProfileSource === 'manual' ? 'manual' : 'session';
        this.token = typeof saved.token === 'string' ? saved.token : '';
        this.user = saved.user && Number.isSafeInteger(saved.user.id) && typeof saved.user.name === 'string' ? saved.user : null;
        if (this.user && saved.capabilityVersion !== 1) this.user.canEditStatus = null;
        this.originalTitle = typeof saved.originalTitle === 'string' ? saved.originalTitle : '';
        this.ownedTitle = typeof saved.ownedTitle === 'string' ? saved.ownedTitle : '';
        this.ownsStatus = saved.ownsStatus === true;
        this.pendingWrite = saved.pendingWrite && typeof saved.pendingWrite.before === 'string'
          && typeof saved.pendingWrite.after === 'string' ? saved.pendingWrite : null;
        this.lastPublished = typeof saved.lastPublished === 'string' ? saved.lastPublished : '';
        this.lastSyncedAt = Number(saved.lastSyncedAt) || 0;
        this.nextWriteAt = Number(saved.nextWriteAt) || 0;
        this.retryAt = Number(saved.retryAt) || 0;
        if (!this.token || !this.user) {
          this.settings.enabled = false;
          this.token = '';
          this.user = null;
          this.ownsStatus = false;
          this.pendingWrite = null;
        }
      }
      if (this.storagePending) this.error = '';
      this.storagePending = false;
      return true;
    } catch {
      this.storagePending = true;
      this.storageRetryAt = this.now() + 5000;
      this.error = 'Хранилище системы пока не открыло сохранённую привязку. Повторяем автоматически; данные не сброшены.';
      return false;
    }
  }

  persist({ replaceUnreadable = false } = {}) {
    if (this.storagePending && !replaceUnreadable) return false;
    this.store.save({
      token: this.token, user: this.user, settings: this.settings,
      capabilityVersion: 1,
      soundcloudProfile: this.soundcloudProfile,
      soundcloudProfileSource: this.soundcloudProfileSource,
      originalTitle: this.originalTitle, ownedTitle: this.ownedTitle, ownsStatus: this.ownsStatus,
      pendingWrite: this.pendingWrite,
      lastPublished: this.lastPublished, lastSyncedAt: this.lastSyncedAt,
      nextWriteAt: this.nextWriteAt, retryAt: this.retryAt,
    }, { replaceUnreadable });
    return true;
  }

  exclusive(work) {
    this.busy++;
    const result = this.tail.then(work);
    this.tail = result.catch(() => {}).finally(() => { this.busy--; });
    return result;
  }

  setPlayback(value) {
    this.playback = normalizePlayback(value);
    if (this.playback.title && this.playback.url) {
      this.lastPlayback = { ...this.playback };
      if (this.pendingPlayback?.track.url === this.playback.url) this.pendingPlayback = null;
    }
    this.receivedAt = this.now();
  }

  beginPlayback(value) {
    const track = normalizePlayback({ ...value, playing: false, position: 0, ended: null });
    if (!track.url) return;
    this.pendingPlayback = { track, until: this.now() + 30000 };
  }

  displayPlayback() {
    if (this.pendingPlayback && this.pendingPlayback.until <= this.now()) this.pendingPlayback = null;
    if (this.pendingPlayback?.track.title) return { ...this.pendingPlayback.track };
    if (this.playback.title && !this.pendingPlayback) return { ...this.playback, playing: this.isFresh() && this.playback.playing };
    return this.lastPlayback ? { ...this.lastPlayback, playing: false, ended: null } : { ...this.playback };
  }

  setProfile(value, { manual = false, replaceManual = false } = {}) {
    const profile = soundcloudProfile(value);
    if (value !== null && !profile) return;
    if (this.soundcloudProfileSource === 'manual' && !manual && !replaceManual) return;
    const source = manual ? 'manual' : 'session';
    if (JSON.stringify(profile) === JSON.stringify(this.soundcloudProfile) && this.soundcloudProfileSource === source) return;
    this.soundcloudProfile = profile;
    this.soundcloudProfileSource = source;
    this.persist();
  }

  isFresh() {
    return this.receivedAt !== null && this.now() - this.receivedAt < STALE_MS;
  }

  getState() {
    const track = this.isFresh() ? this.playback : { ...this.playback, playing: false };
    return {
      connected: !!this.token && !!this.user,
      storagePending: this.storagePending,
      user: this.user ? { ...this.user } : null,
      soundcloudProfile: this.soundcloudProfile ? { ...this.soundcloudProfile } : null,
      soundcloudProfileSource: this.soundcloudProfileSource,
      profiles: profileLinks(this.user, this.soundcloudProfile),
      settings: { ...this.settings },
      originalTitle: this.originalTitle,
      lastPublished: this.lastPublished,
      lastSyncedAt: this.lastSyncedAt,
      nextUpdateAt: Math.max(this.nextWriteAt, this.retryAt),
      preview: formatStatus(track, this.settings),
      playback: { ...track },
      displayPlayback: this.displayPlayback(),
      transitioning: !!this.pendingPlayback || !track.title && !!this.lastPlayback,
      fresh: this.isFresh(),
      sampledAt: this.receivedAt,
      private: this.isPrivate(),
      restorePending: (this.ownsStatus || !!this.pendingWrite) && (!this.settings.enabled || this.closing),
      busy: this.busy > 0,
      error: this.error,
    };
  }

  connect(rawToken) {
    return this.exclusive(async () => {
      if (this.storagePending && !this.restoreSaved()) throw new Error(this.error);
      if (this.token) throw new Error('Сначала отвяжи текущий аккаунт.');
      if (typeof rawToken !== 'string') throw new Error('Вставь API-токен Lolzteam.');
      const token = rawToken.trim().replace(/^Bearer\s+/i, '');
      if (token.length < 16 || token.length > 8192 || /[^\x21-\x7e]/.test(token)) throw new Error('Проверь API-токен: он должен быть одной строкой.');
      const data = await this.api.getUser(token);
      const user = validateUser(data);
      this.token = token;
      this.user = user;
      this.originalTitle = data.custom_title;
      this.settings.enabled = false;
      this.error = '';
      try { this.persist(); } catch (error) {
        this.token = '';
        this.user = null;
        throw error;
      }
      return this.getState();
    });
  }

  isPrivate() {
    return this.localPlaybackActive === true || this.settings.privateMode || this.settings.excludedTracks.includes(this.playback.url);
  }

  configure(patch) {
    return this.exclusive(async () => {
      if (this.storagePending) throw new Error(this.error);
      if (this.closing) throw new Error('Приложение закрывается.');
      const next = validateSettings(patch, this.settings);
      if (next.enabled && !this.token) throw new Error('Сначала привяжи аккаунт Lolzteam.');
      if (next.enabled && !this.settings.enabled) {
        const data = await this.api.getUser(this.token);
        const user = validateUser(data);
        if (user.id !== this.user.id) throw new Error('Владелец токена изменился. Привяжи аккаунт заново.');
        this.user = user;
        if (!this.ownsStatus) this.originalTitle = data.custom_title;
      }
      const disabling = this.settings.enabled && !next.enabled;
      const hideNow = !this.isPrivate() && (next.privateMode || next.excludedTracks.includes(this.playback.url));
      this.settings = next;
      this.error = '';
      this.persist();
      await this.publish({ force: disabling || hideNow });
      return this.getState();
    });
  }

  desired(restore = false) {
    if (!restore && !this.closing && !this.isPrivate() && this.settings.enabled && this.isFresh() && this.playback.title) {
      if (this.playback.playing || this.settings.pauseBehavior === 'paused') {
        return { text: formatStatus(this.playback, this.settings), kind: 'music' };
      }
      if (this.settings.pauseBehavior === 'keep') return null;
    }
    return this.ownsStatus ? { text: this.originalTitle, kind: 'restore' } : null;
  }

  recordError(error) {
    this.failures++;
    this.error = error.message || 'Не удалось обновить статус Lolzteam.';
    if ([400, 401, 403, 422].includes(error.status)) this.settings.enabled = false;
    if (error.status === 403 && this.user) this.user.canEditStatus = false;
    const backoff = error.retryMs || Math.min(INTERVAL_MS * 2 ** Math.min(this.failures - 1, 4), 900_000);
    this.retryAt = this.now() + backoff;
    this.persist();
  }

  async publish({ force = false, restore = false } = {}) {
    if (!this.token || !this.user || this.now() < this.retryAt) return;
    let target = this.desired(restore);
    if ((!target && !this.pendingWrite) || (!force && this.now() < this.nextWriteAt)) return;
    if (!this.pendingWrite && target?.kind === 'music' && this.ownsStatus && target.text === this.ownedTitle) return;
    // Reserve a slot before the first await. UI changes and timer ticks share the same queue.
    this.nextWriteAt = this.now() + INTERVAL_MS;
    this.persist();
    try {
      const data = await this.api.getUser(this.token);
      const user = validateUser(data);
      if (user.id !== this.user.id) throw new Error('Владелец токена изменился. Привяжи аккаунт заново.');
      this.user = user;
      if (this.pendingWrite) {
        const intent = this.pendingWrite;
        if (data.custom_title === intent.after) {
          this.ownedTitle = intent.after;
          this.ownsStatus = intent.kind === 'music';
          this.lastPublished = intent.after;
          this.lastSyncedAt = this.now();
        } else if (data.custom_title === intent.before) {
          this.ownedTitle = intent.previousOwnedTitle;
          this.ownsStatus = intent.previouslyOwned;
        } else {
          // A third value belongs to a manual edit, not a lost API response.
          this.ownedTitle = intent.after;
          this.ownsStatus = true;
        }
        this.pendingWrite = null;
        this.persist();
      }
      if (this.ownsStatus && data.custom_title !== this.ownedTitle) {
        this.ownsStatus = false;
        this.originalTitle = data.custom_title;
        this.settings.enabled = false;
        this.error = 'Статус изменён на форуме. Включи трансляцию снова, чтобы использовать новый статус как исходный.';
        this.persist();
        return;
      }
      // The track may have changed or paused while the preflight request was in flight.
      target = this.desired(restore);
      if (!target) return;
      if (target.kind === 'music' && !this.ownsStatus) this.originalTitle = data.custom_title;
      if (data.custom_title !== target.text) {
        // Persist intent so an interrupted PUT can be recovered on the next launch.
        this.pendingWrite = {
          before: data.custom_title, after: target.text, kind: target.kind,
          previousOwnedTitle: this.ownedTitle, previouslyOwned: this.ownsStatus,
        };
        this.persist();
        try { await this.api.setTitle(this.token, target.text); }
        catch (error) {
          // Definitive rejections did not mutate the remote title.
          if (error.status >= 400 && error.status < 500) {
            this.pendingWrite = null;
          }
          throw error;
        }
      }
      this.ownedTitle = target.text;
      this.ownsStatus = target.kind === 'music';
      this.pendingWrite = null;
      this.lastPublished = target.text;
      this.user.canEditStatus = true;
      this.lastSyncedAt = this.now();
      this.nextWriteAt = this.now() + INTERVAL_MS;
      this.error = '';
      this.failures = 0;
      this.retryAt = 0;
      this.persist();
    } catch (error) { this.recordError(error); }
  }

  tick() {
    if (this.busy || this.closing) return Promise.resolve();
    if (this.storagePending && (this.now() < this.storageRetryAt || !this.restoreSaved())) return Promise.resolve();
    return this.exclusive(() => this.publish());
  }

  disconnect(forget = false) {
    return this.exclusive(async () => {
      if (this.storagePending && !forget) throw new Error(this.error);
      if (!forget && (this.ownsStatus || this.pendingWrite)) {
        await this.publish({ force: true, restore: true });
        if (this.ownsStatus || this.pendingWrite) throw new Error(this.error || 'Сначала нужно восстановить прежний статус. Повтори после паузы.');
      }
      this.token = '';
      this.user = null;
      this.settings.enabled = false;
      this.originalTitle = '';
      this.ownedTitle = '';
      this.ownsStatus = false;
      this.pendingWrite = null;
      this.error = '';
      this.lastPublished = '';
      this.lastSyncedAt = 0;
      this.retryAt = 0;
      this.persist({ replaceUnreadable: forget });
      this.storagePending = false;
      return this.getState();
    });
  }

  shutdown() {
    this.closing = true;
    return this.exclusive(() => this.publish({ force: true, restore: true }));
  }
}

module.exports = { LolzteamService, validateUser };
