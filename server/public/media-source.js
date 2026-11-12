(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LolzCloudMedia = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  function mediaUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return '';
      if (['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) && /^\/[\w-]+\/[\w-]+\/?$/.test(url.pathname)) return 'https://soundcloud.com' + url.pathname.replace(/\/$/, '');
      let id = '';
      if (['music.youtube.com', 'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})\/?$/)?.[1];
      if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
      return /^[\w-]{11}$/.test(id || '') ? 'https://music.youtube.com/watch?v=' + id : '';
    } catch { return ''; }
  }
  const provider = value => { const url = mediaUrl(value); return url ? url.startsWith('https://music.youtube.com/') ? 'youtube' : 'soundcloud' : ''; };
  const youtubeId = value => provider(value) === 'youtube' ? new URL(mediaUrl(value)).searchParams.get('v') : '';
  return { mediaUrl, provider, youtubeId, label: value => provider(value) === 'youtube' ? 'YouTube Music' : 'SoundCloud' };
});
