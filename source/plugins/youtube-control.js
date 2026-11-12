(() => {
  'use strict';
  if (window.__lolzcloudYouTube?.version >= 2) return;
  let previous = null, repeat = 'off';
  const video = () => document.querySelector('#movie_player video') || [...document.querySelectorAll('video,audio')].find(item => !item.paused && item.duration > 1) || document.querySelector('video,audio');
  const canonical = value => { try { const u = new URL(value, location.href);if(!['music.youtube.com','www.youtube.com','youtube.com'].includes(u.hostname))return '';const id = u.searchParams.get('v'); return /^[\w-]{11}$/.test(id || '') ? 'https://music.youtube.com/watch?v=' + id : ''; } catch { return ''; } };
  const button = selector => { const node = document.querySelector(selector); return node?.querySelector('button') || node; };
  function snapshot() {
    const bar = document.querySelector('ytmusic-player-bar'), metadata = navigator.mediaSession?.metadata, media = video();
    const title = (bar?.querySelector('.title')?.textContent || metadata?.title || '').trim();
    const artist = (metadata?.artist || bar?.querySelector('.byline')?.textContent?.split('•')[0] || '').trim();
    const link = bar?.querySelector('a[href*="watch?v="]')?.href;
    let playerUrl='';try{playerUrl=document.getElementById('movie_player')?.getVideoUrl?.() || '';}catch{/* The native player is changing songs. */}
    let url = canonical(playerUrl) || canonical(link) || canonical(location.href);
    if (!url && previous?.title === title) url = previous.url;
    if (url && title) previous = { title, url };
    const ad = !!document.querySelector('.ad-showing,.ad-interrupting');
    if (media) media.loop = repeat === 'one' && !ad;
    return { title, artist, url, cover: metadata?.artwork?.at(-1)?.src || bar?.querySelector('img')?.src || '', duration: Number.isFinite(media?.duration) ? media.duration : 0, position: Number(media?.currentTime) || 0, playing: !!media && !media.paused && !media.ended && !ad, ended: media?.ended === true, rate: media?.playbackRate || 1, repeat, liked: !!document.querySelector('ytmusic-like-button-renderer[like-status="LIKE"],ytmusic-like-button-renderer #like-button[aria-pressed="true"]'), ad, volume: media?.volume ?? 1 };
  }
  window.__lolzcloudCurrentTrackUrl = () => snapshot().url;
  async function command(type, value) {
    const media = video(); if (!media) return false;
    if (type === 'pause') media.pause();
    else if (type === 'play') await media.play();
    else if (type === 'playPause') { if (media.paused) await media.play(); else media.pause(); }
    else if (type === 'seek') media.currentTime = Math.max(0, Math.min(media.duration || Infinity, value));
    else if (type === 'volume' || type === 'volumeUp' || type === 'volumeDown') media.volume = Math.max(0, Math.min(1, type === 'volume' ? value : media.volume + (type === 'volumeUp' ? .05 : -.05)));
    else if (type === 'repeat') {
      repeat = ['off','all','one'].includes(value) ? value : ({off:'all',all:'one',one:'off'})[repeat]; media.loop = repeat === 'one';
      const native = button('ytmusic-player-bar #repeat-button,ytmusic-player-bar .repeat');
      if (native && repeat !== 'one') {
        const mode = native.getAttribute('repeat-mode') || native.closest('[repeat-mode]')?.getAttribute('repeat-mode');
        if (mode && mode !== (repeat === 'all' ? 'ALL' : 'NONE')) for (let i=0;i<3;i++) { native.click(); await new Promise(resolve=>setTimeout(resolve,50)); if ((native.getAttribute('repeat-mode') || native.closest('[repeat-mode]')?.getAttribute('repeat-mode')) === (repeat === 'all' ? 'ALL' : 'NONE')) break; }
      }
    } else {
      const node = button(type === 'next' ? 'ytmusic-player-bar .next-button' : type === 'previous' ? 'ytmusic-player-bar .previous-button' : type === 'like' ? 'ytmusic-player-bar ytmusic-like-button-renderer #button-shape-like,ytmusic-player-bar ytmusic-like-button-renderer #like-button' : ':not(*)');
      if (!node || node.disabled) return false; node.click();
    }
    return true;
  }
  window.__lolzcloudYouTube = { version:2, snapshot, command };
})();
