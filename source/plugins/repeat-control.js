(() => {
  'use strict';
  if (window.__lolzcloudRepeat) return;
  const button = () => document.querySelector('.playControls .repeatControl, .playControls__repeat');
  function read(node = button()) {
    if (!node) return 'off';
    const explicit = node.getAttribute('data-repeat-mode');
    if (['off', 'all', 'one'].includes(explicit)) return explicit;
    if (node.classList.contains('m-one') || node.classList.contains('m-single')) return 'one';
    return node.classList.contains('m-all') || node.classList.contains('m-active') || node.getAttribute('aria-pressed') === 'true' ? 'all' : 'off';
  }
  const next = mode => ({ off: 'all', all: 'one', one: 'off' }[mode] || 'all');
  let desired = 'off', running = null, revision = 0;
  async function drive() {
    let attempt = 0, lastRevision = revision;
    while (attempt < 6) {
      if (lastRevision !== revision) { attempt = 0; lastRevision = revision; }
      const node = button(), before = read(node), target = desired, version = revision;
      if (!node || before === target) break;
      node.click(); attempt++;
      let changed = false;
      for (let wait = 0; wait < 35; wait++) {
        if (read() !== before) { changed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      window.__lolzcloudSnapshot?.();
      if (!changed && version === revision) break;
    }
    window.__lolzcloudSnapshot?.(); return { mode: read(), applied: read() === desired };
  }
  function set(mode) {
    if (!['off', 'all', 'one'].includes(mode)) mode = next(read());
    desired = mode; revision++;
    // Defer the first read so several commands from the same event turn coalesce.
    // In particular, an already-satisfied first command must not swallow the next.
    if (!running) running = Promise.resolve().then(drive).finally(() => { running = null; });
    return running;
  }
  window.__lolzcloudRepeat = { read, next, set };
})();
