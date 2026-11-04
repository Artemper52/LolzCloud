'use strict';
const { clean } = require('./lolzteam/status.cjs');
const RESERVED = new Set(['you', 'discover', 'stream', 'feed', 'search', 'upload', 'settings', 'messages', 'notifications', 'charts', 'signin', 'logout', 'login', 'terms-of-use', 'pages', 'premium', 'subscriptions', 'stations']);

function soundcloudProfile(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    const url = new URL(value.url || value.permalink_url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)
      || url.username || url.password || parts.length !== 1 || RESERVED.has(parts[0].toLowerCase())
      || !/^[\w-]+$/.test(parts[0])) return null;
    return {
      id: Number.isSafeInteger(Number(value.id)) && Number(value.id) > 0 ? Number(value.id) : null,
      name: clean(value.name || value.username, 100) || parts[0],
      url: 'https://soundcloud.com/' + parts[0],
    };
  } catch { return null; }
}

function profileLinks(user, account) {
  const sc = soundcloudProfile(account);
  return {
    lolzteam: user && Number.isSafeInteger(user.id) && user.id > 0
      ? { name: clean(user.name, 100), url: `https://lolz.live/members/${user.id}/` } : null,
    soundcloud: sc,
  };
}
module.exports = { soundcloudProfile, profileLinks };
