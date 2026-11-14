'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../server/public/app/core.js'), origin = 'https://lolzcloud.com';
const row = (id = '123') => ({ id, title: 'Песня', artist: 'Артист', duration: 123, audioUrl: origin + '/music/audio/' + id + '/' + 'a'.repeat(24) + '.mp3', cover: 'https://i1.sndcdn.com/art.jpg' });
test('PWA accepts only matching signed same-origin MP3 sources', () => {
  assert.equal(C.track(row(), origin).id, '123');
  for (const address of ['https://evil.test/music/audio/123/' + 'a'.repeat(24) + '.mp3', 'data:audio/mpeg;base64,x', 'https://lolzcloud.com@evil.test/a', row().audioUrl + '?token=x', row().audioUrl + '#x', row('124').audioUrl, 'https://lolzcloud.com/music/audio/123/' + 'a'.repeat(23) + '.mp3']) assert.equal(C.track({ ...row(), audioUrl: address }, origin), null);
  assert.equal(C.preparationURL(row().audioUrl, origin), origin + '/music/prepare/123/' + 'a'.repeat(24));
});
test('PWA validates pages, deduplicates IDs, rejects cursor loops and malformed rows', () => {
  assert.deepEqual(C.page({ tracks: [row(), row()], nextOffset: '20' }, origin).tracks.map(t => t.id), ['123']);
  for (const nextOffset of ['0', '1', '20', '999', 40, '040']) assert.throws(() => C.page({ tracks: [row()], nextOffset }, origin, '20'));
  assert.throws(() => C.page({ tracks: [{ ...row(), duration: Infinity }] }, origin));
  assert.throws(() => C.page({ tracks: Array(21).fill(row()) }, origin));
  assert.equal(C.page({ tracks: [], nextOffset: null }, origin).nextOffset, '');
});
test('PWA queue end, repeat-one automatic only, and shuffle avoid the current track', () => {
  assert.equal(C.nextIndex(0, 0), -1); assert.equal(C.nextIndex(2, 1), -1);
  assert.equal(C.nextIndex(2, 1, { repeat: 'all' }), 0);
  assert.equal(C.nextIndex(2, 0, { repeat: 'one', automatic: true }), 0);
  assert.equal(C.nextIndex(2, 0, { repeat: 'one' }), 1);
  for (const random of [() => 0, () => 0.5, () => 1]) for (let index = 0; index < 5; index++) assert.notEqual(C.nextIndex(5, index, { shuffle: true, random }), index);
});
test('PWA room routing refuses external, credential, query and non-room navigation', () => {
  const path = '/room/' + 'a'.repeat(32) + '/'; assert.equal(C.roomURL(path, origin), origin + path);
  for (const address of [origin + path + '?x=1', 'https://evil.test' + path, '/rooms', 'https://lolzcloud.com@evil.test' + path, path + '#x']) assert.equal(C.roomURL(address, origin), '');
});
test('PWA lyrics parse repeated timestamps in time order and keep text inert', () => {
  assert.deepEqual(C.parseLyrics('[00:02.50][00:01.1]Привет\n[00:70.00]invalid\n[ar:someone]\n[00:03] <img>'), [{ time: 1.1, text: 'Привет' }, { time: 2.5, text: 'Привет' }, { time: 3, text: '<img>' }]);
  assert.equal(C.formatTime(125.9), '2:05'); assert.equal(C.formatTime(-5), '0:00');
});
test('PWA lyric identity normalizes Unicode and case while preserving recording versions', () => {
  assert.equal(C.lyricsIdentity('ＰＥＳＮＡ (Slowed)'), C.lyricsIdentity('pesna (slowed)'));
  assert.equal(C.lyricsIdentity('Песня (Official Audio)'), C.lyricsIdentity('ПЕСНЯ'));
  assert.notEqual(C.lyricsIdentity('Песня (slowed)'), C.lyricsIdentity('Песня'));
  assert.notEqual(C.lyricsIdentity('Песня (remix)'), C.lyricsIdentity('Песня (live)'));
});
test('PWA timed lyrics require exact own identity and duration within two seconds', () => {
  const row = { trackName: 'Песня', artistName: 'Артист', duration: 62, plainLyrics: 'Слова', syncedLyrics: '[00:01]Слова' };
  assert.equal(C.lyricsCandidate(row, 'Песня', 'Артист', 60).synced, row.syncedLyrics);
  assert.equal(C.lyricsCandidate({ ...row, duration: 62.01 }, 'Песня', 'Артист', 60).synced, '');
  assert.equal(C.lyricsCandidate({ ...row, duration: 65, plainLyrics: null }, 'Песня', 'Артист', 60).plain, 'Слова');
  assert.equal(C.lyricsCandidate({ ...row, artistName: 'Другой артист' }, 'Песня', 'Артист', 60), null);
  assert.equal(C.lyricsCandidate(row, 'Песня (slowed)', 'Артист', 60), null);
});
test('local track parsing cannot weaken signed network catalogue policy', () => {
  const local = { id: 'local:12345678-1234-4567-89ab-123456789abc', source: 'local', local: true, audioUrl: '', title: 'Мой файл', artist: '', duration: 3600 };
  assert.equal(C.savedTrack(local, origin).local, true); assert.equal(C.track(local, origin), null);
  assert.throws(() => C.page({ tracks: [local], nextOffset: null }, origin));
  assert.throws(() => C.page({ tracks: [{ ...row(), local: true }], nextOffset: null }, origin));
  assert.equal(C.savedTrack({ ...local, audioUrl: 'https://evil.test/song.mp3' }, origin), null);
  assert.equal(C.savedTrack({ ...local, id: 'local:../file' }, origin), null);
  assert.equal(C.trackID(local.id), true); assert.equal(C.preparationURL('', origin), '');
});
test('local audio sniffing requires a supported extension and matching container header', () => {
  const bytes = value => new TextEncoder().encode(value);
  assert.equal(C.audioFileType('song.wav', bytes('RIFF1234WAVE')), 'audio/wav');
  assert.equal(C.audioFileType('song.flac', bytes('fLaC1234')), 'audio/flac');
  assert.equal(C.audioFileType('song.m4a', bytes('1234ftypM4A ')), 'audio/mp4');
  assert.equal(C.audioFileType('song.mp3', bytes('ID3audio')), 'audio/mpeg');
  assert.equal(C.audioFileType('song.mp3', bytes('RIFF1234WAVE')), ''); assert.equal(C.audioFileType('song.exe', bytes('ID3audio')), '');
});
test('imported lyrics enforce UTF8/size/extension and preserve text inertly', () => {
  const bytes = value => new TextEncoder().encode(value);
  assert.equal(C.importedLyrics('song.txt', bytes('<b>Слова</b>')).plain, '<b>Слова</b>');
  assert.equal(C.importedLyrics('song.lrc', bytes('[00:02.0]Припев')).synced, '[00:02.0]Припев');
  assert.throws(() => C.importedLyrics('song.lrc', bytes('Нет времени')));
  assert.throws(() => C.importedLyrics('song.txt', new Uint8Array([255, 254])));
  assert.throws(() => C.importedLyrics('song.txt', new Uint8Array(512 * 1024 + 1)));
  assert.throws(() => C.importedLyrics('song.html', bytes('Слова')));
});
