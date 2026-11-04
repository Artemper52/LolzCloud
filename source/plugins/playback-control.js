(() => {
  'use strict';
  if (window.__lolzcloudPlayback) return;
  function canonical(value) {
    try { const url = new URL(value); if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) return ''; const path = url.pathname.replace(/^\/n\//, '/').replace(/\/$/, ''); return /^\/[\w-]+\/[\w-]+$/.test(path) ? 'https://soundcloud.com' + path : ''; } catch { return ''; }
  }
  function documents() {
    const rows = [document];
    for (let index = 0; index < rows.length && rows.length < 12; index++) for (const frame of rows[index].querySelectorAll('iframe')) {
      try { const child = frame.contentDocument; if (child && child.location.origin === location.origin && !rows.includes(child)) rows.push(child); } catch { /* Cross-origin embeds are not controlled. */ }
    }
    return rows;
  }
  function visible(node) { return !!node && !node.disabled && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0; }
  function find(root, selectors) { return [...root.querySelectorAll(selectors)].find(visible); }
  function play(value) {
    const target = canonical(value); if (!target) return 'waiting';
    const badge = document.querySelector('.playbackSoundBadge__titleLink'), control = document.querySelector('.playControls__elements .playControl, .playControls__play');
    if (canonical(badge?.href) === target && control?.classList.contains('playing')) return 'playing';
    for (const root of documents()) {
      if (canonical(root.location.href) !== target) continue;
      const pause = find(root, 'button[aria-label="Pause"], button[title="Pause"], [aria-label="Pause"] button, .fullHero__playerArea .sc-button-pause, .soundTitle__playButton .sc-button-pause');
      if (pause) return 'started';
      const button = find(root, '.fullHero__playerArea .playButton, .soundTitle__playButton .playButton, .listenEngagement__playButton, main button[aria-label="Play"], main button[title="Play"], main [aria-label="Play"] button, main button[data-testid="play-button"], main button[aria-label="Воспроизвести"]');
      if (button) { button.click(); return 'started'; }
    }
    if (canonical(badge?.href) === target && control) { control.click(); return 'started'; }
    return 'waiting';
  }
  function media(value, duration) {
    const target = canonical(value);
    const rows = documents().filter(root => canonical(root.location.href) === target).flatMap(root => [...root.querySelectorAll('audio')])
      .filter(node => Number.isFinite(node.duration) && node.duration > 1 && (!duration || Math.abs(node.duration - duration) < 3));
    return rows.find(node => !node.paused && !node.ended) || (rows.length === 1 ? rows[0] : null);
  }
  function seek(value) {
    const link = document.querySelector('.playbackSoundBadge__titleLink'), duration = document.querySelector('.playbackTimeline__duration');
    const seconds = String(duration?.textContent || '').trim().split(':').reduce((total, value) => total * 60 + (Number(value) || 0), 0);
    const node = media(link?.href || location.href, seconds);
    if (!node || !Number.isFinite(value)) return false;
    node.currentTime = Math.max(0, Math.min(node.duration, value)); window.__lolzcloudSnapshot?.(); return true;
  }
  window.__lolzcloudPlayback = { canonical, documents, play, media, seek };
})();
