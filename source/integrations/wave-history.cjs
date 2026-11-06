'use strict';
const { createHash } = require('node:crypto');
const { scUrl } = require('./music.cjs');
const DAY = 24 * 60 * 60 * 1000;
function recordingKey(track) {
  const artist = String(track?.artist || track?.user?.username || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const title = String(track?.title || '').normalize('NFKC').toLowerCase()
    .replace(/\b(?:official|audio|video|lyrics?|visualizer|hd|hq)\b/giu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return artist && title ? 'recording:' + artist + ':' + title : '';
}
function fingerprints(track) {
  const values = [], url = scUrl(track?.url || track?.permalink_url), id = Number(track?.id);
  if (url) values.push('url:' + url);
  if (Number.isSafeInteger(id) && id > 0) values.push('id:' + id);
  const recording = recordingKey(track);
  if (recording) values.push(recording);
  return values.map(value => createHash('sha256').update(value).digest('hex'));
}
function prunePlayed(value, now) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key, at]) => /^[a-f0-9]{64}$/.test(key) && Number.isFinite(at) && at > now - DAY && at <= now + DAY));
}
function playedRecently(track, cache, now) { return fingerprints(track).some(key => Number.isFinite(cache[key]) && cache[key] > now - DAY); }
function markPlayed(track, cache, now) { for (const key of fingerprints(track)) cache[key] = now; }
module.exports = { DAY, fingerprints, prunePlayed, playedRecently, markPlayed };
