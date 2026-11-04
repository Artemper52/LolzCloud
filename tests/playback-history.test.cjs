'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PlaybackHistory } = require('../source/integrations/playback-history.cjs');
const song = id => ({ url: 'https://soundcloud.com/fixture/song-' + id, title: 'Song ' + id, artist: 'Artist', duration: 100, position: 70, playing: true });
test('previous goes to the preceding recording even in the middle of a song and next returns forward', () => {
  const history = new PlaybackHistory(); [1, 2, 3].forEach(id => history.observe(song(id)));
  const previous = history.step(-1); assert.equal(previous.url, song(2).url); assert.equal(previous.position, 0);
  assert.equal(history.observe(song(3)), false, 'Late snapshots cannot undo a requested previous song');
  assert.equal(history.observe(song(2)), true); assert.equal(history.step(1).url, song(3).url); assert.equal(history.entries.length, 3);
});
test('rapid previous clicks advance the cursor immediately and ignore intermediate navigation results', () => {
  const history = new PlaybackHistory(); [1, 2, 3, 4].forEach(id => history.observe(song(id)));
  assert.equal(history.step(-1).url, song(3).url); assert.equal(history.step(-1).url, song(2).url);
  assert.equal(history.observe(song(3)), false); assert.equal(history.observe(song(4)), false); assert.equal(history.observe(song(2)), true);
  assert.equal(history.step(-1).url, song(1).url); assert.equal(history.step(-1), null);
});
test('manual choices replace forward history; failed navigation can recover after timeout', () => {
  let now = 0; const history = new PlaybackHistory(() => now); [1, 2].forEach(id => history.observe(song(id)));
  history.step(-1); history.observe(song(1)); history.request(song(4)); assert.equal(history.observe(song(2)), false); history.observe(song(4)); assert.equal(history.state().canForward, false);
  history.step(-1); now = 31000; assert.equal(history.observe(song(4)), true);
});
