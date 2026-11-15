/* Room media commands carry a document/ownership lease. A delayed command from
   a previous room or from before a solo handoff cannot select another player. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LolzCloudRoomTransportPolicy = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const uuid = value => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
  const roomID = value => typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
  const integer = value => Number.isSafeInteger(value) && value >= 1;
  const text = value => typeof value === 'string' ? value.slice(0, 300) : '';
  const seconds = value => Number.isFinite(value) && value >= 0 && value <= 86400;
  function mediaURL(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      if (['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname) && /^\/[\w-]+\/[\w-]+\/?$/.test(url.pathname) && !url.search && !url.hash) return url.href;
      if (['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname) && url.pathname === '/watch' && /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') || '') && [...url.searchParams.keys()].every(key => key === 'v') && !url.hash) return url.href;
      return '';
    } catch { return ''; }
  }
  function artwork(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && /^(?:[a-z0-9-]+\.sndcdn\.com|i\.ytimg\.com|lh3\.googleusercontent\.com)$/.test(url.hostname) ? url.href.slice(0, 2048) : '';
    } catch { return ''; }
  }
  function owner(value) {
    return value && roomID(value.roomId) && uuid(value.documentId) && integer(value.epoch)
      ? value.roomId + '/' + value.documentId + '/' + value.epoch : '';
  }
  function snapshot(value) {
    if (!owner(value) || !integer(value.revision) || typeof value.active !== 'boolean' || !value.playback || !value.capabilities) return null;
    const row = value.playback, url = mediaURL(row.url);
    if (row.url && !url || !seconds(row.duration) || !seconds(row.position) || typeof row.playing !== 'boolean') return null;
    const capabilities = {};
    for (const key of ['play', 'pause', 'next', 'previous', 'seek']) capabilities[key] = value.active && value.capabilities[key] === true;
    return Object.freeze({
      version: 1, roomId: value.roomId, documentId: value.documentId, epoch: value.epoch,
      revision: value.revision, active: value.active,
      playback: Object.freeze({ url, title: text(row.title), artist: text(row.artist), cover: artwork(row.cover), duration: row.duration, position: Math.min(row.position, row.duration || 86400), playing: value.active && row.playing }),
      capabilities: Object.freeze(capabilities)
    });
  }
  function create({ roomId, documentId, read, perform, notify = () => {} }) {
    if (!roomID(roomId) || !uuid(documentId) || typeof read !== 'function' || typeof perform !== 'function') throw Error('Invalid room transport');
    const identity = Object.freeze({ roomId, documentId });
    let active = false, epoch = 1, revision = 0, acquired = false, current, pending = 0, tail = Promise.resolve();
    const completed = new Map();
    function update() {
      current = snapshot({ ...read(), ...identity, active, epoch, revision: ++revision });
      if (!current) throw Error('Invalid room playback snapshot');
      notify(current); return current;
    }
    function acquire() {
      if (!active) { if (acquired) epoch++; acquired = true; active = true; completed.clear(); }
      return update();
    }
    function release(expected) {
      if (expected && owner(expected) !== owner({ ...identity, epoch })) return false;
      active = false; update(); return true;
    }
    function command(value) {
      const key = owner({ ...identity, epoch });
      if (!value || owner(value) !== key || !uuid(value.id)) return Promise.resolve({ ok: false, reason: 'stale-owner' });
      if (completed.has(value.id)) return completed.get(value.id);
      const type = value.command, requestedValue = value.value;
      if (!['play', 'pause', 'next', 'previous', 'seek', 'release'].includes(type) || type === 'seek' && !seconds(requestedValue)) return Promise.resolve({ ok: false, reason: 'invalid-command' });
      if (type === 'release') {
        if (!active) return Promise.resolve({ ok: false, reason: 'stale-owner' });
        // A handoff must not wait behind a slow provider/Next request.
        release(value); const released = current;
        let result;
        try { result = perform('release'); } catch { result = Promise.reject(Error('Release failed')); }
        const task = Promise.resolve(result).then(() => ({ ok: true, transport: released }), () => ({ ok: false, reason: 'failed' }));
        completed.set(value.id, task); return task;
      }
      if (pending >= 4) return Promise.resolve({ ok: false, reason: 'busy' });
      pending++;
      const task = tail.catch(() => {}).then(async () => {
        if (key !== owner({ ...identity, epoch }) || !active) return { ok: false, reason: 'stale-owner' };
        const state = update();
        if (type !== 'release' && !state.capabilities[type]) return { ok: false, reason: 'unavailable' };
        const result = await perform(type, requestedValue);
        if (key !== owner({ ...identity, epoch })) return { ok: false, reason: 'stale-owner' };
        if (type === 'release' && result !== false) release(value);
        const transport = update();
        return { ok: result !== false, ...(result === false ? { reason: 'unavailable' } : {}), transport };
      }).catch(() => ({ ok: false, reason: 'failed' })).finally(() => { pending--; });
      completed.set(value.id, task);
      while (completed.size > 64) completed.delete(completed.keys().next().value);
      tail = task; return task;
    }
    update();
    return { identity, acquire, release, update, command, snapshot: () => current };
  }
  return { create, snapshot, owner, mediaURL, artwork };
});
