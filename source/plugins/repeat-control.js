(() => {
  'use strict';
  if (window.__lolzcloudRepeat) return;
  const button = () => {
    const node = document.querySelector('.repeatControl, .playControls__repeat, [data-testid="repeat-button"], [data-testid="repeat-control"]');
    return node?.querySelector?.('button') || node;
  };
  function nativeMode(node = button()) {
    if (!node) return 'off';
    const explicit = node.getAttribute('data-repeat-mode');
    if (['off', 'all', 'one'].includes(explicit)) return explicit;
    const mode = node.getAttribute('data-mode');
    if (['off', 'all', 'one'].includes(mode)) return mode;
    if (node.classList.contains('m-one') || node.classList.contains('m-single')) return 'one';
    return node.classList.contains('m-all') || node.classList.contains('m-active') || node.getAttribute('aria-pressed') === 'true' ? 'all' : 'off';
  }
  const next = mode => ({ off: 'all', all: 'one', one: 'off' }[mode] || 'all');
  let desired = null, appliedMode = null, running = null, revision = 0;
  const media = new Set();
  function syncMedia() {
    const mode = desired ?? nativeMode();
    const current = window.__lolzcloudAudioFX?.currentMedia;
    for (const item of media) item.loop = mode === 'one' && (!current || item === current);
  }
  function bind(item) {
    if (media.has(item)) return;
    media.add(item);
    item.addEventListener('playing', () => queueMicrotask(syncMedia));
    item.addEventListener('loadedmetadata', syncMedia);
    syncMedia();
  }
  function read(node) { return appliedMode ?? nativeMode(node); }
  async function drive() {
    let attempt = 0, lastRevision = revision;
    while (attempt < 6) {
      if (lastRevision !== revision) { attempt = 0; lastRevision = revision; }
      const node = button(), before = nativeMode(node), target = desired, version = revision;
      if (!node || before === target) break;
      node.click(); attempt++;
      let changed = false;
      for (let wait = 0; wait < 35; wait++) {
        if (nativeMode() !== before) { changed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      window.__lolzcloudSnapshot?.();
      if (!changed && version === revision) break;
    }
    syncMedia();
    const applied = nativeMode() === desired || desired === 'one' && [...media].some(item => item.loop);
    appliedMode = applied ? desired : null;
    window.__lolzcloudSnapshot?.(); return { mode: read(), applied };
  }
  function set(mode) {
    if (!['off', 'all', 'one'].includes(mode)) mode = next(read());
    desired = mode; revision++; syncMedia();
    // Defer the first read so several commands from the same event turn coalesce.
    // In particular, an already-satisfied first command must not swallow the next.
    if (!running) running = Promise.resolve().then(drive).finally(() => { running = null; });
    return running;
  }
  window.__lolzcloudRepeat = { read, next, set, bind };
})();
