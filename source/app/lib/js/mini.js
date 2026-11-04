(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const { clock } = require('../integrations/lolzteam/status.cjs');
  const el = id => document.getElementById(id);
  let current = null, serial = 0, applied = 0, polling = false;
  const pending = new Set();
  const optimistic = new Map();
  function shown(key, actual, url) {
    const value = optimistic.get(key);
    if (value && value.value === actual) { value.confirmed ??= Date.now(); } else if (value) value.confirmed = null;
    if (value && (value.url !== url || value.until <= Date.now() || value.confirmed !== null && value.confirmed !== undefined && Date.now() - value.confirmed > 750)) optimistic.delete(key);
    return optimistic.get(key)?.value ?? actual;
  }
  const background = new window.LolzCloudWaveView(el('mini-gradient'), { ambient: true });
  const words = new window.LolzCloudLyricsView(el('lyrics'), {
    onSeek: value => refresh({ type: 'seek', value }),
    onFollowChange: value => el('follow').setAttribute('aria-pressed', String(value)),
    onCredit: url => refresh({ type: 'credit', url }),
  });
  function render(state) {
    current = state;
    const track = state.displayPlayback || state.playback, enabled = shown('lyrics', state.mini.lyrics, '@mini');
    window.LolzCloudVisuals.update({ ...state, playback: track });
    background.setState(true, track.playing && state.fresh !== false);
    el('mini-tempo').textContent = window.LolzCloudVisuals.caption(); el('mini-tempo').hidden = !el('mini-tempo').textContent;
    el('mini-tempo').title = window.LolzCloudVisuals.tempo.source === 'analysis' ? 'Примерный темп по звучанию' : 'Темп трека';
    words.setAutoFollow(state.preferences?.autoFollow !== false);
    document.documentElement.dataset.motion = state.preferences?.reduceMotion ? 'reduced' : 'full';
    document.body.classList.toggle('with-lyrics', enabled);
    el('lyricsToggle').setAttribute('aria-pressed', String(enabled));
    el('title').textContent = track.title || 'Включи любимый трек';
    el('artist').textContent = track.artist || 'SoundCloud';
    const wave = state.wave, inWave = wave?.active === true;
    document.body.classList.toggle('is-wave', inWave);
    const liked = inWave ? wave.reaction === 'love' : shown('like', track.liked === true, track.url);
    el('like').disabled = state.transitioning || pending.has('reaction') || (inWave ? !wave.canFeedback : !track.title || !state.soundcloudProfile?.url || state.fresh === false);
    el('like').setAttribute('aria-pressed', String(liked));
    el('like').setAttribute('aria-busy', String(pending.has('reaction')));
    el('like-label').textContent = liked && !inWave ? 'В любимых' : 'Нравится';
    el('like').setAttribute('aria-label', inWave ? liked ? 'Убрать отметку «Нравится» в Моей волне' : 'Больше такого в Моей волне' : liked ? 'Убрать из понравившихся SoundCloud' : 'Добавить в понравившиеся SoundCloud');
    el('like').title = inWave ? liked ? 'Волна учитывает твой выбор · нажми, чтобы отменить' : 'Больше похожей музыки в Моей волне' : !state.soundcloudProfile?.url ? 'Войди в SoundCloud, чтобы сохранять лайки' : liked ? 'Убрать из понравившихся SoundCloud' : 'Добавить в понравившиеся SoundCloud';
    el('dislike').hidden = !inWave; el('dislike').disabled = state.transitioning || pending.has('reaction') || !wave?.canFeedback;
    const repeat = shown('repeat', state.transport?.repeat?.mode || track.repeat || 'off', track.url);
    el('repeat').dataset.mode = repeat; el('repeat').disabled = !track.title || state.fresh === false || state.transitioning;
    el('repeat').setAttribute('aria-pressed', String(repeat !== 'off'));
    el('repeat').setAttribute('aria-busy', String(pending.has('repeat')));
    el('repeat').setAttribute('aria-label', { off: 'Повтор выключен', one: 'Повтор трека', all: 'Повтор очереди' }[repeat]);
    el('repeat').title = { off: 'Повтор выключен · нажми для повтора очереди', all: 'Повтор очереди · нажми для повтора трека', one: 'Повтор трека · нажми, чтобы выключить' }[repeat];
    window.lolzArtwork(el('cover'), track.cover);
    if (document.activeElement !== el('volume')) el('volume').value = Math.round((state.volume ?? 1) * 100);
    el('volume-label').textContent = el('volume').value + '%';
    el('play-icon').setAttribute('d', track.playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'm8 5 11 7-11 7z');
    el('playPause').setAttribute('aria-label', track.playing ? 'Пауза' : 'Продолжить');
    el('position').textContent = clock(track.position); el('duration').textContent = clock(track.duration);
    el('seek').max = track.duration || 1; el('seek').disabled = !track.duration;
    if (document.activeElement !== el('seek')) el('seek').value = track.position;
    el('volume-toggle').title = 'Громкость · ' + el('volume').value + '%';
    window.LolzCloudRanges.update();
    if (enabled) {
      const lyricData = state.lyrics || (words.data?.key === [track.artist || '', track.title || '', track.duration || 0].join('\n') ? words.data : null);
      words.setFontScale(state.mini.fontScale); words.setData(lyricData); words.setPlayback(track, state.fresh);
      el('follow').disabled = !lyricData?.lines?.length || state.preferences?.autoFollow === false;
      el('lyric-status').textContent = lyricData?.lines?.some(line => line.words?.length) ? 'ПОСЛОВНЫЙ ТЕКСТ' : lyricData?.lines?.length ? 'СИНХРОННЫЙ ТЕКСТ' : lyricData?.loading ? 'ИЩЕМ ТАЙМИНГИ…' : lyricData?.plain ? 'У ТЕКСТА НЕТ ТАЙМ-КОДОВ' : 'СЛОВА ТВОЕЙ МУЗЫКИ';
    }
  }
  async function refresh(action = 'state') {
    const request = ++serial;
    try {
      const state = await ipcRenderer.invoke('mini:action', action);
      if (state && request >= applied) { applied = request; render(state); }
    } catch { /* The main player is closing. */ }
  }
  for (const id of ['open', 'close', 'previous', 'next', 'playPause']) el(id).onclick = () => refresh(id);
  async function trackAction(type, group) {
    if (!current || current.transitioning || (group !== 'repeat' && pending.has(group))) return;
    if (type === 'like') optimistic.set('like', { url: current.playback.url, value: el('like').getAttribute('aria-pressed') !== 'true', until: Date.now() + 2000 });
    if (type === 'repeat') optimistic.set('repeat', { url: current.playback.url, value: { off: 'all', all: 'one', one: 'off' }[el('repeat').dataset.mode || 'off'], until: Date.now() + 5000, confirmed: null });
    pending.add(group); render(current);
    try { await refresh({ type, url: current.playback.url, ...(type === 'repeat' ? { mode: optimistic.get('repeat').value } : {}) }); }
    finally { pending.delete(group); if (current) render(current); }
  }
  el('like').onclick = () => trackAction(current?.wave?.active ? 'wave-love' : 'like', 'reaction');
  el('dislike').onclick = () => trackAction('wave-ban', 'reaction');
  el('repeat').onclick = () => trackAction('repeat', 'repeat');
  const volumeControl = el('mini-volume-control'), volumeToggle = el('volume-toggle');
  const closeVolume = () => { volumeControl.classList.remove('is-open'); volumeToggle.setAttribute('aria-expanded', 'false'); };
  volumeControl.addEventListener('pointerenter', () => volumeToggle.setAttribute('aria-expanded', 'true'));
  volumeControl.addEventListener('pointerleave', () => { if (!el('volume').matches(':focus-visible')) closeVolume(); });
  volumeToggle.onclick = event => {
    const open = event.detail ? (volumeControl.classList.add('is-open'), true) : volumeControl.classList.toggle('is-open'); volumeToggle.setAttribute('aria-expanded', String(open));
    if (open && !event.detail) el('volume').focus();
  };
  volumeControl.addEventListener('focusout', event => { if (!volumeControl.contains(event.relatedTarget)) closeVolume(); });
  volumeControl.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeVolume(); volumeToggle.focus(); } });
  document.addEventListener('pointerdown', event => { if (!volumeControl.contains(event.target)) closeVolume(); });
  let volumeFrame = null;
  el('volume').oninput = () => { el('volume-label').textContent = el('volume').value + '%'; if (volumeFrame) cancelAnimationFrame(volumeFrame); volumeFrame = requestAnimationFrame(() => refresh({ type: 'volume', value: Number(el('volume').value) / 100 })); };
  el('volume').onchange = () => refresh({ type: 'volume', value: Number(el('volume').value) / 100, commit: true });
  el('lyricsToggle').onclick = () => {
    if (!current) return;
    const enabled = !document.body.classList.contains('with-lyrics');
    optimistic.set('lyrics', { url: '@mini', value: enabled, until: Date.now() + 5000, confirmed: null });
    render(current); void refresh({ type: 'set-lyrics', enabled });
  };
  el('follow').onclick = () => words.setFollow(true);
  el('fontDown').onclick = () => refresh({ type: 'font', value: (current?.mini.fontScale || 1) - .1 });
  el('fontUp').onclick = () => refresh({ type: 'font', value: (current?.mini.fontScale || 1) + .1 });
  el('reloadLyrics').onclick = () => refresh('reload-lyrics');
  el('seek').oninput = () => { el('position').textContent = clock(Number(el('seek').value)); };
  el('seek').onchange = () => refresh({ type: 'seek', value: Number(el('seek').value) });
  setInterval(async () => { if (polling) return; polling = true; try { await refresh(); } finally { polling = false; } }, 250);
  void refresh();
})();
