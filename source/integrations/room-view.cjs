'use strict';

const ROOM_ORIGIN = 'https://lolzcloud.com';
const ROOM_PARTITION = 'lolzcloud-rooms';
const ROOM_COOKIE = '__Host-lc_session';

function roomUrl(value, origin = ROOM_ORIGIN) {
  try {
    const url = new URL(value);
    if (url.origin === origin && !url.username && !url.password && /^\/room\/[a-f0-9]{32}\/?$/.test(url.pathname)) {
      return origin + url.pathname.replace(/\/?$/, '/');
    }
  } catch { /* Invalid invitation. */ }
  return '';
}

function roomCard(room, origin) {
  const url = roomUrl(room?.url, origin);
  if (!url || typeof room.owner?.name !== 'string') return null;
  const people = Array.isArray(room.participants) ? room.participants : [];
  const count = people.filter(person => !person.host || person.online).length;
  return {
    url, name: room.settings?.name || 'Комната ' + room.owner.name,
    description: room.settings?.description || '', owner: room.owner.name, avatar: room.owner.avatar || '',
    own: room.host === true, public: room.settings?.public === true, listeners: count,
    title: room.playback?.title || '', artist: room.playback?.artist || '', live: room.playback?.playing === true,
  };
}

function roomGuestPreferences(event, preferences, params) {
  if (params.partition !== ROOM_PARTITION) return false;
  if (!roomUrl(params.src)) { event.preventDefault(); return true; }
  preferences.preload = require('node:path').join(__dirname, '../room-preload.cjs');
  Object.assign(preferences, {
    nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true,
    sandbox: true, webSecurity: true, backgroundThrottling: false,
  });
  return true;
}

function protectRoomGuest(contents) {
  function guard(event, url, _inPlace, isMainFrame = true) {
    if ((event.isMainFrame ?? isMainFrame) && !roomUrl(event.url || url)) event.preventDefault();
  }
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = { ROOM_PARTITION, ROOM_COOKIE, roomUrl, roomCard, roomGuestPreferences, protectRoomGuest };
