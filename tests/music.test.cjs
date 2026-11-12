'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { MusicFeatures, shareText, parseLrc, lyricIndex, scUrl, validateKey } = require('../source/integrations/music.cjs');
const { ListeningRoom } = require('../source/integrations/room.cjs');
const { profileFromHtml } = require('../source/integrations/sc-profile.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-music-test-'));
  const filename = path.join(directory, 'music.json'); let time = 1700000000000;
  t.after(() => { if (fs.existsSync(filename)) fs.unlinkSync(filename); if (fs.existsSync(filename + '.tmp')) fs.unlinkSync(filename + '.tmp'); fs.rmdirSync(directory); });
  return { model: new MusicFeatures(filename, () => time), filename, advance: seconds => { time += seconds * 1000; } };
}
function snapshot(patch = {}) {
  return { fresh: true, private: false, user: { id: 123, name: 'Listener' }, soundcloudProfile: { name: 'Listener SC', url: 'https://soundcloud.com/listener' }, playback: { title: 'Song [test]', artist: 'Artist', position: 0, duration: 200, playing: true, url: 'https://soundcloud.com/artist/song', cover: 'https://i1.sndcdn.com/cover.jpg' }, ...patch };
}
test('YouTube history, saved links and bookmarks survive reopening and portable export',t=>{
  const {model,filename}=fixture(t),url='https://music.youtube.com/watch?v=p-LBiCtzXu0';
  model.addCollection({title:'YouTube favourite',url});
  model.observe(snapshot({playback:{title:'YouTube song',artist:'Artist',url,duration:200,position:12,playing:true}}));model.save(true);
  const reopened=new MusicFeatures(filename);assert.equal(reopened.data.collections[0].url,url);assert.equal(reopened.data.history[0].url,url);
  const {normalizeProfile}=require('../source/integrations/portable-profile.cjs');
  const exported=normalizeProfile({format:'lolzcloud-profile',version:1,music:reopened.data,tools:{bookmarks:[{id:'a'.repeat(36),url,title:'YouTube song',position:12}]}});
  assert.equal(exported.music.collections[0].url,url);
});
test('forum BBCode includes the actual profiles, time and cover and neutralizes injected tags', () => {
  const result = shareText(snapshot());
  assert.ok(result.includes('Song ［test］')); assert.ok(!result.includes('Song [test]'));
  assert.ok(result.includes('https://lolz.live/members/123/')); assert.ok(result.includes('https://soundcloud.com/listener'));
  assert.ok(result.includes('0:00 / 3:20')); assert.ok(result.includes('[IMG]https://i1.sndcdn.com/cover.jpg[/IMG]'));
});
test('listening history measures actual progression, ignores seeks, and persists', t => {
  const f = fixture(t), state = snapshot(); f.model.observe(state);
  for (let index = 1; index <= 5; index++) { f.advance(1); state.playback.position = index; f.model.observe(state); }
  assert.equal(f.model.getState().stats.seconds, 5);
  f.advance(1); state.playback.position = 100; f.model.observe(state); assert.equal(f.model.getState().stats.seconds, 5);
  f.model.save(true); const restored = new MusicFeatures(f.filename); assert.equal(restored.getState().stats.seconds, 5); assert.equal(restored.getState().history.length, 1);
});
test('private and stale tracks never enter history', t => {
  const f = fixture(t); f.model.observe(snapshot({ private: true })); f.advance(3); f.model.observe(snapshot({ fresh: false }));
  assert.equal(f.model.getState().history.length, 0);
});
test('collection sharing validates destinations and can round-trip user playlists', t => {
  const f = fixture(t); f.model.addCollection({ title: 'Форумная подборка', url: 'https://soundcloud.com/artist/sets/playlist', source: 'https://lolz.live/threads/123/' });
  f.model.importCollections(JSON.stringify([{ title: 'Другой трек', url: 'https://soundcloud.com/another/song' }]));
  assert.equal(f.model.getState().collections.length, 2);
  assert.throws(() => f.model.addCollection({ url: 'javascript:alert(1)' }));
  assert.throws(() => f.model.addCollection({ url: 'https://soundcloud.com/a/b', source: 'https://evil.example/' }));
  assert.equal(scUrl('https://soundcloud.com/artist/sets/playlist?token=private'), 'https://soundcloud.com/artist/sets/playlist');
});
test('DSP presets are bounded and custom presets survive a restart', t => {
  const f = fixture(t); f.model.configureDsp({ enabled: true, preset: 'Бас' });
  assert.deepEqual(f.model.getState().dsp.gains, [6, 3, 0, -1, 0]);
  f.model.configureDsp({ gains: [1, 2, 3, 2, 1], saveAs: 'Мой звук' });
  assert.deepEqual(new MusicFeatures(f.filename).getState().presets['Мой звук'], [1, 2, 3, 2, 1]);
  assert.throws(() => f.model.configureDsp({ gains: [20, 0, 0, 0, 0] }));
});
test('hotkeys reject duplicates and invalid accelerators', t => {
  const f = fixture(t); assert.equal(validateKey('Control+Alt+M'), true); assert.equal(validateKey('Control+Control+M'), false);
  assert.throws(() => f.model.setHotkeys({ next: f.model.data.hotkeys.playPause }));
  f.model.setHotkeys({ next: 'Control+Shift+N' }); assert.equal(f.model.getState().hotkeys.next, 'Control+Shift+N');
});

test('different modifier orders cannot register the same hotkey for two actions', t => {
  const f = fixture(t), before = f.model.getState().hotkeys;
  assert.throws(() => f.model.setHotkeys({ next: 'Alt+Control+Space' }), /повторяться/);
  assert.deepEqual(f.model.getState().hotkeys, before);
  f.model.setHotkeys({ next: 'Shift+Control+N' });
  assert.equal(f.model.getState().hotkeys.next, 'Control+Shift+N');
});

test('a rejected collection import cannot leave a partially imported library on disk', t => {
  const f = fixture(t);
  f.model.addCollection({ title: 'Existing collection', url: 'https://soundcloud.com/test/sets/existing' });
  const before = f.model.getState().collections, saved = fs.readFileSync(f.filename, 'utf8');
  assert.throws(() => f.model.importCollections(JSON.stringify([
    { title: 'Valid row', url: 'https://soundcloud.com/test/valid' },
    { title: 'Broken row', url: 'https://example.test/test/invalid' },
  ])));
  assert.deepEqual(f.model.getState().collections, before);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), saved);
});
test('synced lyrics handle multiple tags and binary-search the current line', () => {
  const lines = parseLrc('[00:01.50]One\n[00:03.00][00:07.25]Two\n[ar:Artist]');
  assert.deepEqual(lines.map(line => line.time), [1.5, 3, 7.25]);
  assert.equal(lyricIndex(lines, 0), -1); assert.equal(lyricIndex(lines, 3), 1); assert.equal(lyricIndex(lines, 7.5), 2);
});
test('profile detection uses only the authenticated listener and never evaluates embedded script', () => {
  const html = 'window.__sc_hydration = ' + JSON.stringify([{ hydratable: 'sound', data: { user: { permalink_url: 'https://soundcloud.com/uploader' } } }, { hydratable: 'me', data: { id: 33, username: 'Listener [x]', permalink_url: 'https://soundcloud.com/listener' } }]) + '; alert("do not evaluate");';
  assert.equal(profileFromHtml(html).url, 'https://soundcloud.com/listener');
  assert.equal(profileFromHtml('window.__sc_hydration = alert(1)'), null);
});
test('cloud rooms reject untrusted endpoints and never open a LAN listener', async t => {
  assert.throws(() => new ListeningRoom(() => ({}), { origin: 'https://evil.example' }), /Недоверенный/);
  const room = new ListeningRoom(() => snapshot()); t.after(() => room.dispose());
  assert.equal(room.getState().authenticated, false); assert.equal(room.getState().localNetwork, false); assert.equal(room.getState().url, '');
});
