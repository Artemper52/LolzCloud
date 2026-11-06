'use strict';
const { app, session, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { EncryptedStore } = require('../source/integrations/lolzteam/store.cjs');
const { SoundCloudSession } = require('../source/integrations/soundcloud-session.cjs');
const { MusicFeatures } = require('../source/integrations/music.cjs');
const { PlayerTools } = require('../source/integrations/player-tools.cjs');
const { PersonalWave } = require('../source/integrations/wave.cjs');
const { ListeningRoom } = require('../source/integrations/room.cjs');
const directory = process.env.LOLZCLOUD_SETUP_TEST_PROFILE, phase = process.env.LOLZCLOUD_SETUP_TEST_PHASE;
if (!directory || !path.basename(path.dirname(directory)).startsWith('LolzCloud-setup-check-') || path.dirname(path.dirname(directory)) !== path.resolve(os.tmpdir()) || !['save', 'restore'].includes(phase)) throw Error('An isolated Setup fixture is required.');
app.setPath('userData', directory); app.setPath('sessionData', directory); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let keeper, room, wave;
  try {
    const at = name => path.join(directory, name);
    const forum = new EncryptedStore(at('lolzteam.json'), safeStorage);
    const music = new MusicFeatures(at('music-library.json')), tools = new PlayerTools(at('player-tools.json'));
    wave = new PersonalWave({ filename: at('wave-library.json'), provider: {}, getSnapshot: () => ({}), getHistory: () => [], play: () => {} });
    room = new ListeningRoom(() => ({}), { filename: at('cloud-session.json'), safeStorage });
    clearInterval(room.timer);
    if (phase === 'save') {
      forum.save({ token: 'fixture-forum-token', settings: { discordEnabled: true, discordSoundcloud: false }, user: { id: 123, name: 'Fixture' } });
      music.addCollection({ url: 'https://soundcloud.com/fixture/sets/favorites', title: 'Fixture collection' });
      music.configurePreferences({ windowStyle: 'windows', density: 'compact', startupView: 'wave' });
      music.configurePlayer({ volume: .42 }); music.configureMini({ lyrics: true, fontScale: 1.2 });
      music.observe({ fresh: true, private: false, playback: { url: 'https://soundcloud.com/fixture/song', title: 'Fixture song', artist: 'Fixture', duration: 120, position: 12, playing: true } }); music.save(true);
      tools.addBookmark({ url: 'https://soundcloud.com/fixture/song', title: 'Fixture song', position: 12.34 });
      wave.configure({ adventurous: .87, mood: 'calm' });
      room.token = 't'.repeat(43); room.expires = Date.now() + 3600000; room.user = { id: 123, name: 'Fixture' }; room.persist();
      await session.defaultSession.cookies.set({ url: 'https://soundcloud.com/', name: 'oauth_token', value: 'fixture-soundcloud-cookie', secure: true, httpOnly: true, sameSite: 'lax' });
    } else {
      assert.equal(forum.load().token, 'fixture-forum-token');
      assert.equal(forum.load().settings.discordSoundcloud, false);
      assert.equal(music.data.collections[0].title, 'Fixture collection');
      assert.equal(music.data.history[0].title, 'Fixture song');
      assert.equal(music.data.preferences.windowStyle, 'windows');
      assert.equal(music.data.player.volume, .42); assert.equal(music.data.mini.fontScale, 1.2);
      assert.equal(tools.state().bookmarks[0].position, 12.34);
      assert.equal(wave.data.adventurous, .87); assert.equal(wave.data.preferences.mood, 'calm');
      assert.equal(room.token, 't'.repeat(43));
      await session.defaultSession.cookies.remove('https://soundcloud.com/', 'oauth_token');
    }
    keeper = new SoundCloudSession({ session: session.defaultSession, safeStorage, filename: at('soundcloud-session.json') }); await keeper.start();
    assert.equal((await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' }))[0]?.value, 'fixture-soundcloud-cookie');
    assert.ok(!fs.readFileSync(at('soundcloud-session.json'), 'utf8').includes('fixture-soundcloud-cookie'));
    await keeper.dispose(); keeper = null;
    console.log('Setup profile ' + phase + ' passed: settings, collections, history, bookmarks, wave, encrypted SoundCloud/forum/room sessions.');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { if (keeper) await keeper.dispose(); if (room) await room.dispose(); wave?.dispose(); app.exit(process.exitCode || 0); }
});
