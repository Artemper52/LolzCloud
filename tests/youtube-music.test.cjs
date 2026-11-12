'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { youtubeUrl, youtubeGuestPreferences, YOUTUBE_PARTITION } = require('../source/integrations/youtube-music.cjs');
test('YouTube Music uses its own sandbox and never inherits the SoundCloud preload', () => {
  let blocked = false; const event = { preventDefault() { blocked = true; } }, preferences = { preload: 'soundcloud.cjs', nodeIntegration: true };
  assert.equal(youtubeGuestPreferences(event, preferences, { partition: YOUTUBE_PARTITION, src: 'https://music.youtube.com/search?q=test' }), true);
  assert.match(preferences.preload, /youtube-preload\.cjs$/); assert.equal(preferences.sandbox, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(blocked, false);
  youtubeGuestPreferences(event, {}, { partition: YOUTUBE_PARTITION, src: 'https://example.com/' }); assert.equal(blocked, true);
  for (const url of ['http://music.youtube.com', 'https://music.youtube.com.evil.test', 'https://me@music.youtube.com', 'file:///test']) assert.equal(youtubeUrl(url), '');
  assert.ok(youtubeUrl('https://accounts.google.com/ServiceLogin'));
});
