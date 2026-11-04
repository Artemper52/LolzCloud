'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { soundcloudProfile, profileLinks } = require('../source/integrations/profiles.cjs');
const { buildActivity, DiscordPresence, validApplicationId } = require('../source/integrations/discord.cjs');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');

function snapshot() {
  return {
    fresh: true, user: { id: 123, name: 'Listener' }, settings: { discordEnabled: true, discordApplicationId: '123456789012345678' },
    soundcloudProfile: { id: 45, name: 'My account', url: 'https://soundcloud.com/my-account' },
    playback: { title: 'Track | live', artist: 'Artist', position: 83, duration: 225, playing: true, url: 'https://soundcloud.com/artist/track', cover: '' },
  };
}

test('Discord sends the listener profiles instead of the artist or project links', () => {
  const activity = buildActivity(snapshot(), 1_700_000_000_000);
  assert.equal(activity.type, 2);
  assert.equal(activity.details, 'Track | live');
  assert.deepEqual(activity.buttons, [
    { label: 'Lolzteam', url: 'https://lolz.live/members/123/' },
    { label: 'SoundCloud', url: 'https://soundcloud.com/my-account' },
  ]);
  assert.equal(activity.timestamps.end - activity.timestamps.start, 225);
  assert.equal(activity.timestamps.start, 1_700_000_000 - 83);
  assert.equal(activity.state_url, 'https://soundcloud.com/my-account');
  assert.equal(activity.details_url, 'https://soundcloud.com/artist/track');
});

test('Discord timestamps account for speed changes', () => {
  const state = snapshot(); state.playback.rate = 1.25;
  const activity = buildActivity(state, 1_700_000_000_000);
  assert.equal(activity.timestamps.end - activity.timestamps.start, 180);
  assert.equal(activity.timestamps.start, Math.floor(1_700_000_000 - 83 / 1.25));
});

test('unknown SoundCloud accounts do not fall back to a track uploader', () => {
  const state = snapshot();
  state.soundcloudProfile = null;
  assert.deepEqual(buildActivity(state).buttons, [{ label: 'Lolzteam', url: 'https://lolz.live/members/123/' }]);
  for (const url of ['javascript:alert(1)', 'https://soundcloud.com/artist/track', 'https://soundcloud.com/you', 'https://evil.example/user', 'https://token@soundcloud.com/user']) {
    assert.equal(soundcloudProfile({ url }), null);
  }
  assert.equal(profileLinks({ id: 0 }, null).lolzteam, null);
});

test('pause and idle keep LolzCloud visible without a running timer', () => {
  const state = snapshot();
  state.fresh = false;
  assert.equal(buildActivity(state).type, 0);
  assert.equal(buildActivity(state).details, 'В LolzCloud');
  assert.equal(buildActivity(state).timestamps, undefined);
  state.fresh = true;
  state.playback.playing = false;
  const paused = buildActivity(state);
  assert.equal(paused.type, 0); assert.match(paused.state, /На паузе/);
  assert.equal(paused.details, state.playback.title); assert.equal(paused.timestamps, undefined);
  assert.deepEqual(paused.buttons.map(button => button.label), ['Lolzteam', 'SoundCloud']);
  state.private = true; assert.equal(buildActivity(state), null);
});

test('a discovered listener profile persists and an explicit logout clears it', () => {
  let saved;
  const service = new LolzteamService({ api: {}, store: { load: () => null, save: value => { saved = value; } } });
  service.setProfile(snapshot().soundcloudProfile);
  assert.equal(saved.soundcloudProfile.url, 'https://soundcloud.com/my-account');
  service.setProfile({ url: 'https://evil.example/wrong' });
  assert.equal(service.getState().profiles.soundcloud.name, 'My account');
  service.setProfile(null);
  assert.equal(service.getState().profiles.soundcloud, null);
});

test('a manually supplied SoundCloud profile works while logged out and survives anonymous snapshots', () => {
  let saved;
  const service = new LolzteamService({ api: {}, store: { load: () => null, save: value => { saved = value; } } });
  service.setProfile({ url: 'https://soundcloud.com/my-account' }, { manual: true });
  service.setProfile(null);
  assert.equal(service.getState().profiles.soundcloud.url, 'https://soundcloud.com/my-account');
  assert.equal(saved.soundcloudProfileSource, 'manual');
  service.setProfile({ id: 66, name: 'Signed in account', url: 'https://soundcloud.com/signed-in' }, { replaceManual: true });
  assert.equal(service.getState().profiles.soundcloud.url, 'https://soundcloud.com/signed-in');
  assert.equal(service.getState().soundcloudProfileSource, 'session');
});

function discordFixture() {
  let time = 1_700_000_000_000;
  const state = snapshot();
  const calls = [];
  let clients = 0;
  let shouldFail = false;
  const factory = () => {
    clients++;
    const client = new EventEmitter();
    client.login = async options => { assert.deepEqual(options, { clientId: state.settings.discordApplicationId }); };
    client.request = async (command, value) => {
      if (shouldFail) throw new Error('Closed');
      calls.push({ command, value });
      return value.activity;
    };
    client.clearActivity = async () => { calls.push({ clear: true }); };
    client.transport = { socket: { destroy() {} } };
    return client;
  };
  return {
    presence: new DiscordPresence({ getSnapshot: () => state, clientFactory: factory, now: () => time, applicationId: state.settings.discordApplicationId }),
    state, calls, clients: () => clients,
    advance: amount => { time += amount; }, fail: value => { shouldFail = value; },
  };
}

test('Discord throttles updates and switches to paused presence with the profile buttons', async () => {
  const f = discordFixture();
  await f.presence.tick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.presence.getState().acknowledgedButtons.map(button => button.label), ['Lolzteam', 'SoundCloud']);
  f.state.playback.title = 'Second song';
  f.advance(14_999);
  await f.presence.tick();
  assert.equal(f.calls.length, 1);
  f.advance(1);
  await f.presence.tick();
  assert.equal(f.calls[1].value.activity.details, 'Second song');
  f.state.playback.playing = false;
  f.advance(5000);
  await f.presence.tick();
  assert.equal(f.calls[2].value.activity.type, 0);
  assert.equal(f.calls[2].value.activity.timestamps, undefined);
  assert.equal(f.presence.getState().activity.buttons.length, 2);
});

test('Discord reconnects after failure and disabling does not send more activity', async () => {
  const f = discordFixture();
  f.fail(true);
  await f.presence.tick();
  assert.equal(f.presence.getState().connected, false);
  assert.ok(f.presence.getState().error);
  f.fail(false);
  f.advance(15_000);
  await f.presence.tick();
  assert.equal(f.clients(), 2);
  assert.equal(f.presence.getState().connected, true);
  f.state.settings.discordEnabled = false;
  await f.presence.tick();
  assert.deepEqual(f.calls.at(-1), { clear: true });
  assert.equal(f.presence.getState().activity, null);
});

test('an unset application ID does not publish under another application name', async () => {
  const f = discordFixture();
  f.state.settings.discordApplicationId = '';
  f.presence.applicationId = '';
  await f.presence.tick();
  assert.equal(f.clients(), 0);
  assert.equal(f.calls.length, 0);
  assert.match(f.presence.getState().error, /сборке/);
  assert.equal(validApplicationId('123456789012345678'), true);
  assert.equal(validApplicationId('discord-token.example'), false);
});

test('changing or removing the application ID clears the previous Discord activity', async () => {
  const f = discordFixture();
  await f.presence.tick();
  f.state.settings.discordApplicationId = '234567890123456789';
  f.presence.applicationId = f.state.settings.discordApplicationId;
  await f.presence.tick();
  assert.equal(f.clients(), 2);
  assert.deepEqual(f.calls[1], { clear: true });
  f.state.settings.discordApplicationId = '';
  f.presence.applicationId = '';
  await f.presence.tick();
  assert.equal(f.presence.getState().activity, null);
  assert.equal(f.presence.getState().connected, false);
});
