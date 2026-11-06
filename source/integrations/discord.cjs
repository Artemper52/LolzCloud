'use strict';
const { clean, truncate } = require('./lolzteam/status.cjs');
const { profileLinks } = require('./profiles.cjs');
const { discordApplicationId, validApplicationId } = require('./app-config.cjs');

const UPDATE_MS = 15_000;

function buildActivity(snapshot, now = Date.now()) {
  const track = snapshot.playback;
  if (snapshot.private) return null;
  const hasTrack = snapshot.fresh && !!track?.title;
  const playing = hasTrack && track.playing;
  const profiles = profileLinks(
    snapshot.settings?.discordLolzteam === false ? null : snapshot.user,
    snapshot.settings?.discordSoundcloud === false ? null : snapshot.soundcloudProfile,
  );
  const buttons = [];
  if (profiles.lolzteam) buttons.push({ label: 'Lolzteam', url: profiles.lolzteam.url });
  if (profiles.soundcloud) buttons.push({ label: 'SoundCloud', url: profiles.soundcloud.url });
  const activity = {
    type: playing ? 2 : 0,
    status_display_type: hasTrack ? 2 : 0,
    details: hasTrack ? truncate(clean(track.title), 128) : 'В LolzCloud',
    state: playing ? truncate(clean(track.artist), 128) || 'SoundCloud'
      : truncate([hasTrack ? 'На паузе' : 'Выбирает музыку', hasTrack ? clean(track.artist) : profiles.lolzteam?.name].filter(Boolean).join(' · '), 128),
    assets: {
      ...(hasTrack && track.cover ? { large_image: track.cover } : {}),
      large_text: hasTrack ? truncate(clean(track.artist) || 'SoundCloud', 128) : 'LolzCloud',
      small_text: profiles.lolzteam ? `Lolzteam · ${profiles.lolzteam.name}`.slice(0, 128) : 'LolzCloud',
    },
    instance: false,
  };
  if (hasTrack && track.url) activity.details_url = track.url;
  if (profiles.soundcloud) activity.state_url = profiles.soundcloud.url;
  if (profiles.lolzteam) activity.assets.small_url = profiles.lolzteam.url;
  if (profiles.soundcloud) activity.assets.large_url = profiles.soundcloud.url;
  if (buttons.length) activity.buttons = buttons;
  if (playing) {
    const rate = Number.isFinite(track.rate) && track.rate >= .65 && track.rate <= 1.5 ? track.rate : 1;
    const start = Math.floor(now / 1000 - track.position / rate);
    activity.timestamps = { start };
    if (track.duration > 0) activity.timestamps.end = start + Math.ceil(track.duration / rate);
  }
  return activity;
}

function deadline(promise, milliseconds = 8000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Discord не ответил.')), milliseconds); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
}

class DiscordPresence {
  constructor({ getSnapshot, now = Date.now, clientFactory, applicationId = discordApplicationId() } = {}) {
    this.getSnapshot = getSnapshot;
    this.applicationId = applicationId;
    this.now = now;
    this.clientFactory = clientFactory || (() => new (require('discord-rpc').Client)({ transport: 'ipc' }));
    this.client = null;
    this.clientId = '';
    this.connected = false;
    this.busy = false;
    this.closing = false;
    this.retryAt = 0;
    this.nextUpdateAt = 0;
    this.lastPublishedAt = 0;
    this.activity = null;
    this.error = '';
    this.acknowledgedButtons = null;
  }

  getState() {
    return {
      connected: this.connected,
      lastPublishedAt: this.lastPublishedAt,
      activity: this.activity ? structuredClone(this.activity) : null,
      error: this.error,
      acknowledgedButtons: this.acknowledgedButtons,
    };
  }

  drop() {
    const client = this.client;
    this.client = null;
    this.clientId = '';
    this.connected = false;
    this.activity = null;
    this.acknowledgedButtons = null;
    this.nextUpdateAt = 0;
    try { client?.transport?.socket?.destroy(); } catch { /* Already closed. */ }
  }

  async tick() {
    if (this.busy || this.closing || this.now() < this.retryAt) return;
    this.busy = true;
    try {
      const snapshot = this.getSnapshot();
      const enabled = snapshot.settings.discordEnabled;
      if (!enabled) {
        if (this.connected && this.activity) await deadline(this.client.clearActivity());
        this.activity = null;
        this.acknowledgedButtons = null;
        this.error = '';
        return;
      }
      const clientId = this.applicationId;
      if (this.connected && this.clientId !== clientId) {
        if (this.activity) await deadline(this.client.clearActivity());
        this.drop();
      }
      if (!validApplicationId(clientId)) {
        this.error = 'Discord ещё не настроен в этой сборке LolzCloud.';
        return;
      }
      if (!this.connected) {
        const client = this.client = this.clientFactory();
        client.on('error', () => { this.error = 'Соединение с Discord прервано.'; });
        client.on('disconnected', () => {
          if (this.client !== client) return;
          this.drop();
          this.retryAt = this.now() + 10_000;
        });
        // Local RPC needs no Discord token and does not request OAuth permissions.
        await deadline(client.login({ clientId }), 12_000);
        if (this.closing || this.client !== client) return;
        this.connected = true;
        this.clientId = clientId;
        this.error = '';
      }
      const latest = this.getSnapshot();
      if (!latest.settings.discordEnabled || this.closing) return;
      const activity = buildActivity(latest, this.now());
      if (!activity) {
        if (this.activity) await deadline(this.client.clearActivity());
        this.activity = null;
        this.acknowledgedButtons = null;
        return;
      }
      const modeChanged = activity.type !== this.activity?.type;
      const profileVisibility = [latest.settings.discordSoundcloud !== false, latest.settings.discordLolzteam !== false].join(':');
      const profilesChanged = this.profileVisibility !== undefined && profileVisibility !== this.profileVisibility;
      if (this.now() < this.nextUpdateAt && !profilesChanged && !(modeChanged && this.now() - this.lastPublishedAt >= 5000)) return;
      this.nextUpdateAt = this.now() + UPDATE_MS;
      // discord-rpc v4's setActivity omits type and URL fields. Send the documented RPC payload.
      const reply = await deadline(this.client.request('SET_ACTIVITY', { pid: process.pid, activity }));
      this.acknowledgedButtons = Array.isArray(reply?.buttons) ? reply.buttons.map((button, index) => ({
        label: typeof button === 'string' ? button : button.label,
        url: typeof button === 'string' ? reply.metadata?.button_urls?.[index] || null : button.url,
      })) : null;
      this.activity = activity;
      this.profileVisibility = profileVisibility;
      this.lastPublishedAt = this.now();
      this.error = '';
    } catch {
      this.error = 'Discord недоступен. Подключимся автоматически, когда он будет открыт.';
      this.drop();
      this.retryAt = this.now() + 15_000;
    } finally { this.busy = false; }
  }

  async shutdown() {
    this.closing = true;
    try {
      if (this.connected && this.activity) await deadline(this.client.clearActivity(), 2000);
    } catch { /* Closing the connection also removes this process's presence. */ }
    this.drop();
  }
}

module.exports = { validApplicationId, UPDATE_MS, buildActivity, DiscordPresence };
