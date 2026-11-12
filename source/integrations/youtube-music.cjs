'use strict';
const YOUTUBE_PARTITION = 'persist:lolzcloud-youtube-music';
function youtubeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ['music.youtube.com', 'accounts.google.com', 'consent.youtube.com', 'consent.google.com'].includes(url.hostname) ? url.href : ''; }
  catch { return ''; }
}
function youtubeGuestPreferences(event, preferences, params) {
  if (params.partition !== YOUTUBE_PARTITION) return false;
  if (!youtubeUrl(params.src)) { event.preventDefault(); return true; }
  preferences.preload = require('node:path').join(__dirname, '../youtube-preload.cjs');
  Object.assign(preferences, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false });
  return true;
}
function protectYouTubeGuest(contents) {
  function guard(event, url, _inPlace, isMainFrame = true) { if ((event.isMainFrame ?? isMainFrame) && !youtubeUrl(event.url || url)) event.preventDefault(); }
  contents.on('will-navigate', guard); contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => { if (youtubeUrl(url)) void contents.loadURL(url); return { action: 'deny' }; });
}
module.exports = { YOUTUBE_PARTITION, youtubeUrl, youtubeGuestPreferences, protectYouTubeGuest };
