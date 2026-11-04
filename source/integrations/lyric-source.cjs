'use strict';
const { parseLrc, lyricIndex } = require('./lyric-formats.cjs');
const { sameRecording } = require('./lyric-match.cjs');
const { LyricsEngine } = require('./lyric-providers.cjs');
const engine = new LyricsEngine();
function selectLyrics(rows, track, syncedOnly = true) {
  if (!Array.isArray(rows)) return null;
  return rows.filter(row => sameRecording({ title: row.trackName, artist: row.artistName, duration: row.duration }, track) && (!syncedOnly || parseLrc(row.syncedLyrics).length))
    .sort((a, b) => Math.abs((a.duration || 0) - (track.duration || 0)) - Math.abs((b.duration || 0) - (track.duration || 0)) || (Number(b.id) || 0) - (Number(a.id) || 0))[0] || null;
}
module.exports = { parseLrc, lyricIndex, selectLyrics, getLyrics: (track, options) => engine.search(track, options) };
