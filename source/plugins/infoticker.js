// One atomic snapshot avoids mixing titles, positions and durations from two tracks.
(() => {
  if (window.__lolzcloudInfoTicker) clearInterval(window.__lolzcloudInfoTicker);
  const text = element => element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
  function timeline(selector) {
    const element = document.querySelector(selector);
    if (!element) return '';
    const spans = element.querySelectorAll('span');
    return text(element.querySelector('[aria-hidden="true"]') || spans[1] || spans[0] || element);
  }
  function account() {
    // Read only the signed-in listener, never the uploader of the current track.
    const hydration = Array.isArray(window.__sc_hydration) ? window.__sc_hydration : [];
    const payload = hydration.find(item => ['me', 'currentUser', 'current_user'].includes(item.hydratable))?.data;
    const me = payload?.user || payload?.me || payload;
    if (me && typeof me === 'object' && me.id && (me.permalink_url || me.permalink)) {
      return { id: me.id, name: me.username || me.full_name || me.permalink, url: me.permalink_url || 'https://soundcloud.com/' + me.permalink };
    }
    for (const node of document.querySelectorAll('a.header__userNavButton, .header__userNavAvatar, .header__userNavUsername, a.header__userNavItem--profile')) {
      const link = node.closest('a[href]') || node.querySelector('a[href]');
      if (!link?.href) continue;
      try {
        const url = new URL(link.href);
        const parts = url.pathname.split('/').filter(Boolean);
        const reserved = ['you', 'discover', 'stream', 'feed', 'search', 'upload', 'settings', 'messages', 'notifications', 'logout', 'login', 'signin'];
        if (url.hostname === 'soundcloud.com' && parts.length === 1 && !reserved.includes(parts[0])) return { name: link.getAttribute('title') || text(link), url: url.origin + url.pathname };
      } catch { /* The user menu can still be rendering. */ }
    }
    const login = document.querySelector('.header__loginButton, .header__login');
    if (login && login.getClientRects().length && getComputedStyle(login).visibility !== 'hidden') return null;
    return undefined;
  }
  function upcoming(current) {
    const canonical = value => { try { const url = new URL(value); const parts = url.pathname.split('/').filter(Boolean); return url.hostname === 'soundcloud.com' && parts.length === 2 && parts[0] !== 'sets' ? url.origin + url.pathname.replace(/\/$/, '') : ''; } catch { return ''; } };
    const wanted = canonical(current); if (!wanted) return [];
    const shuffle = document.querySelector('.shuffleControl');
    if (shuffle?.classList?.contains('m-shuffling') || shuffle?.classList?.contains('m-active') || shuffle?.getAttribute?.('aria-pressed') === 'true') return [];
    const hydration = Array.isArray(window.__sc_hydration) ? window.__sc_hydration : [];
    for (const payload of hydration.filter(item => item.hydratable === 'playlist')) {
      const urls = (payload.data?.tracks || []).map(track => canonical(track.permalink_url)).filter(Boolean), at = urls.indexOf(wanted);
      if (at >= 0) return [...new Set(urls.slice(at + 1))].slice(0, 2);
    }
    for (const selector of ['.queue__items .queueItemView', '.listenTrackList .trackItem', '.soundList__item']) {
      const urls = [...document.querySelectorAll(selector)].map(row => canonical(row.querySelector?.('a.queueItemView__title,a.trackItem__trackTitle,a.soundTitle__title,a[href*="soundcloud.com/"]')?.href || row.href)).filter(Boolean), at = urls.indexOf(wanted);
      if (at >= 0) return [...new Set(urls.slice(at + 1))].slice(0, 2);
    }
    return [];
  }
  function snapshot() {
    const metadata = navigator.mediaSession?.metadata;
    const link = document.querySelector('.playbackSoundBadge__titleLink');
    const artist = document.querySelector('.playbackSoundBadge__lightLink');
    const play = document.querySelector('.playControls__elements .playControl');
    const cover = document.querySelector('.playControls__soundBadge .image__lightOutline span, .playbackSoundBadge .sc-artwork span');
    const repeat = document.querySelector('.playControls .repeatControl, .playControls__repeat');
    const artwork = cover ? getComputedStyle(cover).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] : '';
    const data = {
      title: link ? text(link.querySelector('[aria-hidden="true"]') || link) : (metadata?.title || ''),
      artist: text(artist) || metadata?.artist || '',
      url: link?.href || '',
      cover: (artwork || metadata?.artwork?.[0]?.src || '').replace(/(?:t50x50|t120x120)/g, 't500x500'),
      position: timeline('.playbackTimeline__timePassed'),
      duration: timeline('.playbackTimeline__duration'),
      playing: play ? play.classList.contains('playing') : navigator.mediaSession?.playbackState === 'playing',
      liked: !!document.querySelector('.playbackSoundBadge__like.sc-button-selected'),
      repeat: window.__lolzcloudRepeat?.read(repeat) || (repeat?.classList.contains('m-one') || repeat?.classList.contains('m-single') ? 'one' : repeat?.classList.contains('m-all') || repeat?.classList.contains('m-active') || repeat?.getAttribute('aria-pressed') === 'true' ? 'all' : 'off'),
    };
    const listener = account();
    const current = window.__sc_hydration?.find?.(item => item.hydratable === 'sound' && item.data?.permalink_url?.replace(/\/$/, '') === data.url.replace(/\/$/, ''))?.data;
    if (Number(current?.bpm) >= 30 && Number(current.bpm) <= 300) data.bpm = Number(current.bpm);
    const mediaState = window.__lolzcloudAudioFX;
    const expectedDuration = String(data.duration).split(':').reduce((total, value) => total * 60 + (Number(value) || 0), 0);
    const matches = media => media && Number.isFinite(media.duration) && media.duration > 0 && (!expectedDuration || Math.abs(media.duration - expectedDuration) < 3);
    const activeMedia = window.__lolzcloudPlayback?.media(data.url, expectedDuration) || (mediaState?.audio ? [...mediaState.audio].find(media => !media.paused && matches(media)) || (matches(mediaState.currentMedia) ? mediaState.currentMedia : null) : null);
    if (activeMedia && Number.isFinite(activeMedia.currentTime)) { data.position = activeMedia.currentTime; data.duration = activeMedia.duration; data.playing = !activeMedia.paused && !activeMedia.ended; data.ended = activeMedia.ended === true; }
    data.rate = window.__lolzcloudAudioFX?.rate || 1;
    data.upNext = upcoming(data.url);
    if (listener !== undefined) data.account = listener;
    // Preserve the original custom-background plugin's shared variable.
    window.songinfocursongcoverurl = data.cover;
    console.log('LolzCloudReceive|Playback|' + JSON.stringify(data));
  }
  snapshot();
  window.__lolzcloudSnapshot = snapshot;
  window.__lolzcloudInfoTicker = setInterval(snapshot, 250);
})();
