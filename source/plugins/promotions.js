(() => {
  if (window.__lolzcloudPromotions) return;
  const state = window.__lolzcloudPromotions = { hidden: 0 };
  const hide = node => { if (!node || node.dataset.lolzPromotion) return; node.hidden = true; node.style.setProperty('display', 'none', 'important'); node.dataset.lolzPromotion = 'hidden'; state.hidden++; };
  const protectedMusic = node => node.matches('body,main,#app,#app__root') || !!node.querySelector('.soundList,.soundTitle,.playButton,.mixedSelectionModule,.userRecommendations,.userList');
  function moduleFor(node, kind) {
    const known = node.closest(kind === 'banner' ? '[class*="banner" i],[role="alert"],[data-testid*="banner" i]' : '.sidebarModule,[class*="artistTools" i],[data-testid*="artist-tools" i]');
    if (known && !protectedMusic(known)) return known;
    let target = node;
    for (let parent = node.parentElement, depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
      const content = parent.textContent.replace(/\s+/g, ' ').trim();
      if (protectedMusic(parent) || content.length > 1600 || /artists you should follow|recently played|more of what you like/i.test(content)) break;
      target = parent;
      if (kind === 'tools' && /unlock artist tools/i.test(content) && /amplify|distribute|master|replace/i.test(content)) break;
      if (kind === 'banner' && parent.querySelector('button,[role="button"]')) break;
    }
    return target;
  }
  function scan() {
    document.querySelectorAll('.playControls,#playControls,[data-testid="play-controls"],[data-testid="playback-controls"]').forEach(node => { node.style.setProperty('display', 'none', 'important'); });
    document.querySelectorAll('[class*="upsell" i],[class*="proPromo" i],[class*="artistProBanner" i],[data-testid*="upsell" i],[data-testid*="artist-pro" i]').forEach(node => {
      if (!node.closest('.soundList__item,.soundBadge,.playbackSoundBadge')) hide(node);
    });
    for (const link of document.querySelectorAll('a[href*="artists.soundcloud.com"],a[href*="/for-artists"],a[href*="/pro?"]')) {
      if (!/artist\s*pro|try.*pro|get.*pro|upgrade|подпис|попроб|для авторов/i.test(link.textContent)) continue;
      let target = link.closest('.sidebarModule,[class*="Banner"],[class*="Promo"],[class*="promotion" i]') || link;
      if (target === link) for (let parent = link.parentElement, depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
        if (parent.querySelector('.soundList,.soundTitle,.playButton') || parent.querySelectorAll('a').length > 6 || parent.textContent.length > 1800) break;
        if (parent.textContent.length > 60 && parent.textContent.length < 1500) target = parent;
      }
      hide(target);
    }
    // Creator widgets are not consistently labelled "Pro" in SoundCloud's current markup.
    for (const node of document.querySelectorAll('h2,h3,h4,p,a,button,[role="heading"],[class*="title" i],[class*="banner" i]')) {
      if (node.closest('[data-lolz-promotion],.soundList,.soundBadge,.playbackSoundBadge')) continue;
      const content = node.textContent.replace(/\s+/g, ' ').trim();
      if (/^artist tools\s*$/i.test(content) || /^unlock artist tools\b/i.test(content)) hide(moduleFor(node, 'tools'));
      else if (content.length < 1200 && /uploading tracks just got (?:way )?easier|upload, get heard, and get paid/i.test(content)) hide(moduleFor(node, 'banner'));
      else if (/^artist studio\s*$/i.test(content) && node.closest('header,.header,[role="banner"]')) hide(node.closest('a,button') || node);
    }
  }
  let pending = false;
  const observer = new MutationObserver(records => { if (records.some(record => record.type === 'characterData' || record.addedNodes.length) && !pending) { pending = true; queueMicrotask(() => { pending = false; scan(); }); } });
  const ready = () => {
    const style = document.createElement('style'); style.id = 'lolzcloud-clean-player'; style.textContent = '.playControls,#playControls,[data-testid="play-controls"],[data-testid="playback-controls"]{display:none!important}'; document.documentElement.append(style);
    scan(); observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  };
  if (document.documentElement) ready(); else document.addEventListener('DOMContentLoaded', ready, { once: true });
})();
