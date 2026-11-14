'use strict';
// Ship the room presentation with the app; authenticated APIs stay on the service.
const fs = require('node:fs');
const path = require('node:path');
const { ROOM_ORIGIN } = require('./room-view.cjs');
const DIRECTORY = path.join(__dirname, '../app/lib/room-client');
const FILES = Object.freeze({
  '/cloud/room.css': 'room.css', '/cloud/site.js': 'site.js', '/cloud/room-sync.js': 'room-sync.js',
  '/cloud/media-source.js': 'media-source.js', '/cloud/room-players.js': 'room-players.js',
  '/cloud/room.js': 'room.js', '/cloud/social.js': 'social.js', '/cloud/social.css': 'social.css', '/assets/logo.svg': 'logo.svg',
});
const CSP = "default-src 'none'; script-src 'self' https://w.soundcloud.com https://www.youtube.com https://s.ytimg.com; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-src https://w.soundcloud.com https://www.youtube.com https://www.youtube-nocookie.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
function roomAsset(url, method = 'GET') {
  if (method !== 'GET') return '';
  try {
    if (typeof url !== 'string' || /%(?:2e|2f|5c)/i.test(url.split(/[?#]/)[0]) || /\/\.{1,2}(?:\/|$)/.test(url.split(/[?#]/)[0])) return '';
    const value = new URL(url);
    if (value.origin !== ROOM_ORIGIN || value.username || value.password || /%(?:2e|2f|5c)/i.test(value.pathname)) return '';
    if (/^\/room\/[a-f0-9]{32}\/?$/.test(value.pathname)) return 'room.html';
    if (value.pathname === '/social') return 'social.html';
    if (value.pathname === '/rooms') return 'rooms.html';
    return FILES[value.pathname] || '';
  } catch { return ''; }
}
function roomClientResponse(request, directory = DIRECTORY) {
  const name = roomAsset(request.url, request.method);
  if (!name) return null;
  const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript';
  return new Response(fs.readFileSync(path.join(directory, name)), { headers: {
    'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}
const installed = new WeakSet();
async function installRoomClient(roomSession) {
  // Older Electron runtimes continue to use the service's own presentation.
  if (!roomSession?.protocol?.handle || !roomSession.fetch || typeof Response !== 'function') return false;
  if (installed.has(roomSession)) return true;
  await roomSession.protocol.handle('https', request => roomClientResponse(request)
    || roomSession.fetch(request, { bypassCustomProtocolHandlers: true }));
  installed.add(roomSession);
  return true;
}
module.exports = { roomAsset, roomClientResponse, installRoomClient, FILES, CSP };
