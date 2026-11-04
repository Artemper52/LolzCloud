'use strict';
const { soundcloudProfile } = require('./profiles.cjs');
function profileFromHtml(html) {
  const marker = '__sc_hydration'; const start = html.indexOf(marker);
  if (start < 0) return null;
  const begin = html.indexOf('[', start); if (begin < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = begin; index < html.length; index++) {
    const char = html[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) {
      try {
        const hydration = JSON.parse(html.slice(begin, index + 1));
        const data = hydration.find(row => ['me', 'currentUser', 'current_user'].includes(row.hydratable))?.data;
        const me = data?.user || data?.me || data;
        return soundcloudProfile(me ? { id: me.id, name: me.username, url: me.permalink_url || (me.permalink && 'https://soundcloud.com/' + me.permalink) } : null);
      } catch { return null; }
    }
  }
  return null;
}
async function readSessionProfile(session) {
  let response;
  try { response = await session.fetch('https://soundcloud.com/you', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) }); } catch { /* The API can still work when the web login page does not. */ }
  if (response?.ok) {
    const profile = profileFromHtml(await response.text()); if (profile) return profile;
  }
  const tokens = await session.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' });
  if (!tokens[0]?.value) return null;
  // Reuse only the SoundCloud authorization already present in this app's session.
  const me = await session.fetch('https://api.soundcloud.com/me', { cache: 'no-store', headers: { Authorization: 'OAuth ' + tokens[0].value }, signal: AbortSignal.timeout(12_000) });
  if (!me.ok) return null;
  const user = await me.json();
  return soundcloudProfile({ id: user.id, name: user.username, url: user.permalink_url });
}
module.exports = { profileFromHtml, readSessionProfile };
