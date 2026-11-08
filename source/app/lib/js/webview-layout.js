(() => {
  'use strict';
  const surface = document.querySelector('.shell-browser');
  let banner = null;
  const measure = () => {
    const height = banner && !banner.hidden ? Math.ceil(banner.getBoundingClientRect().height) : 0;
    surface.style.setProperty('--verification-height', height + 'px');
  };
  const resize = new ResizeObserver(measure);
  const attach = () => {
    const next = document.getElementById('sc-verification');
    if (next !== banner) { if (banner) resize.unobserve(banner); banner = next; if (banner) resize.observe(banner); }
    measure();
  };
  new MutationObserver(attach).observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', measure); attach();
})();
