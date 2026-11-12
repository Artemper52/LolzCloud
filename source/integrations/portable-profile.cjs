'use strict';
const crypto = require('node:crypto'), { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const { MusicFeatures, scUrl, WINDOW_STYLES, STARTUP_VIEWS } = require('./music.cjs');
const { normalizeSound } = require('./sound-settings.cjs');
const { normalizePreferences } = require('./wave-preferences.cjs');
const { normalizeTrack } = require('./discovery.cjs');
const { normalizeTools, text } = require('./player-tools.cjs');
const { prunePlayed } = require('./wave-history.cjs');
const { mediaUrl } = require('../app/lib/js/media-source.js');
const MAX_BYTES = 750000;
function normalizeProfile(value) {
  if (!value || value.format !== 'lolzcloud-profile' || value.version !== 1) throw new Error('Это не профиль LolzCloud поддерживаемой версии.');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('Профиль слишком большой.');
  const input = value.music || {}, defaults = new MusicFeatures(null).data;
  const preferences = { ...defaults.preferences };
  for (const key of ['autoFollow', 'reduceMotion']) if (typeof input.preferences?.[key] === 'boolean') preferences[key] = input.preferences[key];
  if (['comfortable', 'compact'].includes(input.preferences?.density)) preferences.density = input.preferences.density;
  if (STARTUP_VIEWS.includes(input.preferences?.startupView)) preferences.startupView = input.preferences.startupView;
  if (WINDOW_STYLES.includes(input.preferences?.windowStyle)) preferences.windowStyle = input.preferences.windowStyle;
  if (Number.isFinite(input.preferences?.lyricsFontScale)) preferences.lyricsFontScale = Math.max(.7, Math.min(2, input.preferences.lyricsFontScale));
  if (Number.isFinite(input.preferences?.uiScale)) preferences.uiScale = Math.max(.85, Math.min(1.5, input.preferences.uiScale));
  const collections = (Array.isArray(input.collections) ? input.collections : []).slice(0, 100).map(row => ({ id: crypto.randomUUID(), title: text(row.title, 100), url: mediaUrl(row.url) || scUrl(row.url), addedAt: Date.now() })).filter(row => row.url);
  const customEffects = Object.create(null); for (const [name, sound] of Object.entries(input.customEffects || {}).slice(0, 100)) if (name && !['__proto__', 'constructor', 'prototype'].includes(name)) customEffects[text(name, 32)] = normalizeSound(sound);
  const wave = value.wave || {}, feedback = Object.create(null);
  for (const [url, row] of Object.entries(wave.feedback || {}).slice(0, 2000)) { const track = normalizeTrack(row?.track); if (track && track.url === url) feedback[url] = { track, skips: Math.max(0, Math.min(20, Number(row.skips) || 0)), loves: Math.max(0, Math.min(10, Number(row.loves) || 0)), banned: row.banned === true, lastSkippedAt: Math.min(Date.now(), Math.max(0, Number(row.lastSkippedAt) || 0)) }; }
  const tools = normalizeTools(value.tools); tools.bookmarks = tools.bookmarks.filter(row => mediaUrl(row.url)); tools.gains = {};
  return { format: 'lolzcloud-profile', version: 1, exportedAt: Date.now(), music: { preferences, collections, dsp: normalizeSound(input.dsp), customEffects }, wave: { likes: (Array.isArray(wave.likes) ? wave.likes : []).slice(0, 2000).map(normalizeTrack).filter(Boolean), feedback, adventurous: Math.max(0, Math.min(1, Number(wave.adventurous) || 0)), preferences: normalizePreferences(wave.preferences), blockedArtists: (Array.isArray(wave.blockedArtists) ? wave.blockedArtists : []).slice(0, 100).map(name => text(name, 100)).filter(Boolean), played24h: prunePlayed(wave.played24h, Date.now()) }, tools };
}
function exportProfile(music, wave, tools) { return normalizeProfile({ format: 'lolzcloud-profile', version: 1, music: music.data, wave: wave.data, tools: tools.data }); }
function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 256) throw new Error('Для облачной копии нужна парольная фраза от 10 до 256 символов.'); return value; }
async function encryptProfile(value, passphrase) {
  const profile = normalizeProfile(value), salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = await scrypt(password(passphrase), salt, 32);
  try { const cipher = crypto.createCipheriv('aes-256-gcm', key, iv), ciphertext = Buffer.concat([cipher.update(JSON.stringify(profile)), cipher.final()]); return { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }; } finally { key.fill(0); }
}
async function decryptProfile(value, passphrase) {
  if (value?.version !== 1 || !['salt', 'iv', 'tag', 'ciphertext'].every(key => typeof value[key] === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value[key]))) throw new Error('Облачная копия имеет неверный формат.');
  const salt = Buffer.from(value.salt, 'base64'), iv = Buffer.from(value.iv, 'base64'), tag = Buffer.from(value.tag, 'base64'), ciphertext = Buffer.from(value.ciphertext, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_BYTES) throw new Error('Облачная копия имеет неверный размер.');
  const key = await scrypt(password(passphrase), salt, 32);
  try { const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]); return normalizeProfile(JSON.parse(plain.toString('utf8'))); } catch { throw new Error('Не удалось открыть копию. Проверь парольную фразу и файл.'); } finally { key.fill(0); }
}
module.exports = { normalizeProfile, exportProfile, encryptProfile, decryptProfile, MAX_BYTES };
