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

function socialUrl(value, origin = ROOM_ORIGIN) {
  try {
    if (typeof value !== 'string' || /%(?:2e|2f|5c)/i.test(value.split(/[?#]/)[0]) || /\/\.{1,2}(?:\/|$)/.test(value.split(/[?#]/)[0])) return '';
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || !/^\/social\/?$/.test(url.pathname)) return '';
    const tab = url.searchParams.get('tab') || 'profile';
    if (!['profile', 'friends', 'notifications'].includes(tab)) return '';
    const target = new URL('/social', origin); target.searchParams.set('tab', tab);
    if (url.searchParams.has('user')) {
      const user = url.searchParams.get('user');
      if (!/^[1-9]\d{0,14}$/.test(user) || !Number.isSafeInteger(Number(user))) return '';
      target.searchParams.set('user', user);
    }
    return target.href;
  } catch { return ''; }
}

function appGuestUrl(value, origin = ROOM_ORIGIN) {
  if (typeof value !== 'string' || /%(?:2e|2f|5c)/i.test(value.split(/[?#]/)[0]) || /\/\.{1,2}(?:\/|$)/.test(value.split(/[?#]/)[0])) return '';
  const room = roomUrl(value, origin), social = socialUrl(value, origin);
  if (room || social) return room || social;
  try {
    const url = new URL(value);
    if (url.origin === origin && !url.username && !url.password && url.pathname === '/rooms') return origin + '/rooms';
  } catch { /* Untrusted page. */ }
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
  if (!appGuestUrl(params.src)) { event.preventDefault(); return true; }
  preferences.preload = require('node:path').join(__dirname, '../room-preload.cjs');
  Object.assign(preferences, {
    nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true,
    sandbox: true, webSecurity: true, backgroundThrottling: false,
  });
  return true;
}

function protectRoomGuest(contents, { openExternal = () => {} } = {}) {
  function guard(event, url, _inPlace, isMainFrame = true) {
    if (!(event.isMainFrame ?? isMainFrame)) return;
    const target = event.url || url, current = contents.getURL?.() || '';
    // Profile drawers stay in the room document; standalone social pages may
    // not turn into a room controller by navigating their own webview.
    if (!appGuestUrl(target) || socialUrl(current) && !socialUrl(target) || roomUrl(current) && !roomUrl(target)) event.preventDefault();
  }
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && !target.username && !target.password && ['lolz.live', 'lolz.team', 'zelenka.guru'].includes(target.hostname)) Promise.resolve(openExternal(target.href)).catch(() => {});
    } catch { /* Not an external profile. */ }
    return { action: 'deny' };
  });
}

module.exports = { ROOM_ORIGIN, ROOM_PARTITION, ROOM_COOKIE, roomUrl, socialUrl, appGuestUrl, roomCard, roomGuestPreferences, protectRoomGuest };
