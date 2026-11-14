(() => {
  'use strict';
  const C = window.LolzCloudAppCore, DB = window.LolzCloudOffline, $ = id => document.getElementById(id), origin = location.origin;
  const native = !!window.webkit?.messageHandlers?.lolzcloud;
  // A native snapshot may have been queued before a newer UI choice. Document
  // identity also prevents a previous page from winning after a WebView reload.
  const nativeClientId = native ? crypto.randomUUID().toLowerCase() : '';
  let nativeRequestId = 1, nativeHandshake = true;
  const sendNative = (action, value = {}) => window.webkit.messageHandlers.lolzcloud.postMessage({ action, ...value, clientId: nativeClientId, requestId: nativeRequestId });
  const currentNativeIntent = value => value?.clientId === nativeClientId && value.requestId === nativeRequestId;
  function beginNativeIntent() { if (native) nativeRequestId++; }
  let saved = {}, queue = [], index = -1, current = null, shuffle = false, repeat = 'off', liked = new Set(), collection = new Map();
  try { saved = JSON.parse(localStorage.getItem('LolzCloud-app-v1') || '{}'); } catch { /* An invalid local draft starts cleanly. */ }
  if (Array.isArray(saved.queue)) queue = saved.queue.slice(0, 200).map(row => C.savedTrack(row, origin)).filter(Boolean);
  if (Array.isArray(saved.collection)) for (const value of saved.collection.slice(0, 500)) { const item = C.savedTrack(value, origin); if (item) collection.set(item.id, item); }
  if (Array.isArray(saved.liked)) liked = new Set(saved.liked.filter(C.trackID).slice(0, 500));
  index = Number.isInteger(saved.index) && saved.index >= 0 && saved.index < queue.length ? saved.index : -1; current = queue[index] || null;
  shuffle = saved.shuffle === true; repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
  let view = 'search', phase = 'paused', elapsed = current && Number.isFinite(saved.position) ? Math.min(current.duration, Math.max(0, saved.position)) : 0, duration = current?.duration || 0, loaded = false, activeBlobURL = '', playerError = '';
  let searchVersion = 0, searchController, results = [], searchedQuery = '', nextOffset = '', searching = false;
  let playVersion = 0, preparationController, history = [], offline = new Map(), downloads = new Set(), libraryFilter = 'all', actionTrack;
  let lyricsVersion = 0, lyricsController, lyricsTrack = '', syncedLyrics = [], activeLyric = -1, roomLyricsVersion = 0;
  const lyricsMetadata = new Map();
  try { for (const [id, value] of Object.entries(JSON.parse(localStorage.getItem('LolzCloud-lyrics-metadata-v1') || '{}')).slice(0, 500)) if (C.trackID(id) && value && typeof value.title === 'string' && value.title.length <= 300 && typeof value.artist === 'string' && value.artist.length <= 300 && C.lyricsIdentity(value.title) && C.lyricsIdentity(value.artist)) lyricsMetadata.set(id, { title: value.title, artist: value.artist }); } catch { /* Bad metadata never blocks music. */ }
  let account = null, accountPending, accountVersion = 0, frameRoomURL = '', roomAudible = false, noticeTimer, persistTimer, installPrompt, lastSavedTime = 0;
  let loginVersion = 0, loginController, loginCommitting = false;
  let nativeQueueSignature = '', nativeQueueOwned = false;
  let rate = Number.isFinite(saved.rate) && saved.rate >= 0.5 && saved.rate <= 2 ? saved.rate : 1;
  let sleepDeadline = Number.isFinite(saved.sleepDeadline) && saved.sleepDeadline > 0 && saved.sleepDeadline <= Date.now() + 86400000 ? saved.sleepDeadline : 0, sleepInterval;
  const bookmarks = new Map();
  if (saved.bookmarks && typeof saved.bookmarks === 'object') for (const [id, rows] of Object.entries(saved.bookmarks).slice(0, 100)) if (C.trackID(id) && Array.isArray(rows)) bookmarks.set(id, rows.filter(row => row && Number.isFinite(row.position) && row.position >= 0 && row.position <= 86400 && Number.isFinite(row.createdAt)).slice(0, 100).map(row => ({ position: row.position, createdAt: row.createdAt })));
  let importingAudio = false, nativeImportCount = 0, nativeImportErrors = 0;
  const audio = $('audio');
  const node = (tag, text, className) => { const result = document.createElement(tag); if (text != null) result.textContent = text; if (className) result.className = className; return result; };
  const button = (label, handler, className = '') => { const result = node('button', label, className); result.type = 'button'; result.onclick = () => { try { Promise.resolve(handler()).catch(noticeError); } catch (error) { noticeError(error); } }; return result; };
  function notice(text) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = !text; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
  function noticeError(error) { notice(error instanceof Error ? error.message : String(error || 'Не удалось выполнить действие.')); }
  function savedState() { return { queue, index, shuffle, repeat, liked: [...liked], collection: [...collection.values()].slice(-500), position: elapsed, rate, sleepDeadline, bookmarks: Object.fromEntries(bookmarks) }; }
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { localStorage.setItem('LolzCloud-app-v1', JSON.stringify(savedState())); }
      catch { notice('Настройки не сохранены. Проверь свободное место и разрешение на данные сайта.'); }
    }, 100);
  }
  async function json(url, { signal, timeout = 22000, limit = 512 * 1024, ...options } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...options.headers } });
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || +(response.headers.get('content-length') || 0) > limit) throw new Error('Сервис вернул неверный ответ. Попробуй ещё раз.');
      const reader = response.body.getReader(), parts = []; let bytes = 0;
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error('Ответ сервиса слишком большой.'); } parts.push(part.value); }
      const text = await new Blob(parts).text();
      let body; try { body = JSON.parse(text); } catch { throw new Error('Не удалось прочитать ответ сервиса.'); }
      if (!response.ok && response.status !== 202) { const error = new Error(typeof body.error === 'string' ? body.error.slice(0, 300) : 'Сервис временно недоступен (HTTP ' + response.status + ').'); error.status = response.status; throw error; }
      return { response, body };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (controller.signal.aborted) throw new Error('Сервис долго отвечает. Проверь сеть и повтори.');
      if (error instanceof TypeError) throw new Error('Нет связи с LolzCloud. Проверь интернет и повтори.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  function wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
      const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, milliseconds);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  async function prepare(track, signal) {
    const endpoint = C.preparationURL(track.audioUrl, origin); if (!endpoint) throw new Error('Недопустимый адрес аудио.');
    const deadline = Date.now() + 130000;
    while (Date.now() < deadline) {
      const { response, body } = await json(endpoint, { signal, timeout: Math.min(20000, deadline - Date.now()), limit: 16384 });
      if (response.status === 200 && body.state === 'ready' && body.audioUrl === track.audioUrl) return;
      if (response.status !== 202 || body.state !== 'preparing' || !Number.isFinite(body.retryAfterMs)) throw new Error('Аудиосервис вернул неверную запись. Повтори попытку.');
      await wait(Math.max(700, Math.min(4000, body.retryAfterMs)), signal);
    }
    throw new Error('Подготовка затянулась. Нажми «Повторить» или выбери другую запись.');
  }
  function image(track, size = 52) {
    const result = node('img'); result.src = track.cover || '/app/icon.svg'; result.width = result.height = size; result.alt = ''; result.loading = 'lazy'; result.referrerPolicy = 'no-referrer'; result.onerror = () => { result.onerror = null; result.src = '/app/icon.svg'; }; return result;
  }
  function trackRow(track, source, position, queueRow = false) {
    const row = node('article', null, 'track-row'); row.dataset.trackId = track.id; row.dataset.current = String(current?.id === track.id);
    const play = button('', () => playFrom(track, source, position), 'track-play');
    const info = node('span', null, 'track-meta'); info.append(node('strong', track.title), node('small', [track.artist || (track.local ? 'Локальный файл' : 'Без исполнителя'), offline.has(track.id) ? track.local ? '' : 'На устройстве' : track.local ? 'Файл не найден' : ''].filter(Boolean).join(' · ')));
    play.append(image(track), info); play.setAttribute('aria-label', 'Слушать: ' + track.title + (track.artist ? ' — ' + track.artist : ''));
    row.append(play, node('span', C.formatTime(track.duration), 'track-duration'));
    if (queueRow) {
      const remove = button('×', () => removeQueue(position), 'icon-button row-remove'); remove.setAttribute('aria-label', 'Убрать из очереди: ' + track.title); remove.disabled = position === index; row.append(remove);
    } else {
      const add = button('+', () => enqueue(track), 'icon-button'); add.setAttribute('aria-label', 'Добавить в очередь: ' + track.title);
      const more = button('···', () => openActions(track), 'icon-button'); more.setAttribute('aria-label', 'Действия с треком: ' + track.title); row.append(add, more);
    }
    return row;
  }
  function renderSearch() { $('search-results').replaceChildren(...results.map((track, i) => trackRow(track, results, i))); $('search-more').hidden = !nextOffset; $('search-more').disabled = searching; }
  async function search(more = false) {
    const query = $('search-query').value.trim();
    if (query.length < 2 || query.length > 140 || /[\u0000-\u001f]/.test(query)) { $('search-query').focus(); $('search-status').textContent = 'Введи от 2 до 140 символов.'; return; }
    if (more && (searching || !nextOffset || query !== searchedQuery)) return;
    const token = ++searchVersion; searchController?.abort(); searchController = new AbortController(); const signal = searchController.signal;
    searching = true; $('search-submit').disabled = true; $('search-more').disabled = true; $('search-status').dataset.error = 'false'; $('search-status').textContent = more ? 'Ищем ещё…' : 'Ищем музыку…';
    $('search-state').hidden = true;
    if (!more) { results = []; nextOffset = ''; renderSearch(); }
    try {
      const offset = more ? nextOffset : '0';
      const { body } = await json('/music/search?q=' + encodeURIComponent(query) + '&offset=' + offset, { signal });
      const page = C.page(body, origin, offset); if (token !== searchVersion) return;
      const seen = new Set(more ? results.map(track => track.id) : []);
      results = [...(more ? results : []), ...page.tracks.filter(track => !seen.has(track.id) && seen.add(track.id))]; nextOffset = page.nextOffset; searchedQuery = query;
      $('search-status').textContent = results.length ? 'Найдено: ' + results.length : 'Ничего не нашли. Попробуй другое название или исполнителя.'; renderSearch();
    } catch (error) {
      if (token !== searchVersion || error.name === 'AbortError') return;
      $('search-status').dataset.error = 'true'; $('search-status').textContent = error.message;
    } finally { if (token === searchVersion) { searching = false; $('search-submit').disabled = false; $('search-more').disabled = false; } }
  }
  function libraryTracks() {
    const combined = new Map(collection); for (const [id, row] of offline) combined.set(id, row);
    return [...combined.values()].reverse().filter(track => libraryFilter !== 'liked' || liked.has(track.id)).filter(track => libraryFilter !== 'offline' || offline.has(track.id)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
  function renderLibrary() {
    const tracks = libraryTracks(); $('library-results').replaceChildren(...tracks.map((track, i) => trackRow(track, tracks, i)));
    if (!tracks.length) {
      const empty = node('div', null, 'empty-state'); empty.append(node('h2', libraryFilter === 'offline' ? 'Музыка без сети' : libraryFilter === 'liked' ? 'Твои любимые' : 'Собери свою коллекцию'), node('p', libraryFilter === 'offline' ? 'Открой действия с треком и сохрани его на устройство.' : 'Нажми на три точки рядом с треком, чтобы добавить его в любимое или сохранить.'));
      $('library-results').append(empty);
    }
    const bytes = [...offline.values()].reduce((sum, track) => sum + (track.bytes || 0), 0);
    $('storage-status').textContent = offline.size ? 'На устройстве: ' + offline.size + (native ? ' треков' : ' · ' + (bytes / 1024 / 1024).toFixed(1) + ' МБ из 256 МБ') : '';
  }
  async function refreshOffline() {
    if (native) { sendNative('downloads'); return; }
    try { const rows = await DB.list(); offline = new Map(rows.map(row => { const item = C.savedTrack(row, origin); return item ? [item.id, { ...item, bytes: row.bytes, savedAt: Number.isFinite(row.savedAt) ? row.savedAt : 0 }] : null; }).filter(Boolean)); renderLibrary(); renderDownload(); }
    catch (error) { $('storage-status').textContent = error.message; }
  }
  function toggleLike(track) {
    if (!track) return;
    if (liked.has(track.id)) liked.delete(track.id); else { liked.add(track.id); collection.set(track.id, track); }
    if (!liked.has(track.id) && !offline.has(track.id) && !bookmarks.get(track.id)?.length) collection.delete(track.id);
    persist(); renderLibrary(); renderLike(); if (actionTrack?.id === track.id) renderActions();
  }
  function renderLike() { const active = !!current && liked.has(current.id); $('player-like').textContent = active ? '♥' : '♡'; $('player-like').setAttribute('aria-pressed', String(active)); $('player-like').setAttribute('aria-label', active ? 'Убрать из любимого' : 'Добавить в любимое'); }
  function enqueue(track) { if (queue.length >= 200) return notice('В очереди уже 200 треков. Убери несколько.'); queue.push(track); persist(); renderQueue(); notice('Добавлено в очередь'); }
  function syncNativeQueue() {
    if (!native) return;
    const value = { tracks: queue, index, repeat, shuffle }, signature = JSON.stringify({ ...value, clientId: nativeClientId, requestId: nativeRequestId });
    if (signature === nativeQueueSignature) return;
    const handshake = nativeHandshake; nativeHandshake = false;
    nativeQueueSignature = signature; sendNative('queue', handshake ? { ...value, handshake: true } : value);
  }
  function renderQueue() { $('queue-count').textContent = queue.length; $('queue-list').replaceChildren(...queue.map((track, i) => trackRow(track, queue, i, true))); $('queue-clear').disabled = !queue.length; syncNativeQueue(); }
  function removeQueue(position) { if (position === index) return; queue.splice(position, 1); if (position < index) index--; history = []; persist(); renderQueue(); }
  function playFrom(track, source, position) {
    if (source === queue) { playAt(position); return; }
    queue = source.slice(0, 200); const selected = queue.findIndex(row => row.id === track.id); history = []; playAt(Math.max(0, selected));
  }
  function pauseRoom() { roomAudible = false; $('rooms-frame').contentWindow?.postMessage({ type: 'lolzcloud:app-audio', action: 'pause' }, origin); }
  // The same audio element survives every route and track change. The first
  // gesture calls load/play immediately; WebKit may still require a second
  // explicit Play after cold preparation, which remains a visible state.
  function primeAudio() {
    if (native || loaded) return;
    const bytes = new Uint8Array(46), data = new DataView(bytes.buffer);
    for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
    data.setUint32(4, 38, true); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, 8000, true); data.setUint32(28, 16000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); data.setUint32(40, 2, true);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio.src = url; audio.load(); audio.play().catch(() => {}); audio.pause(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function stopSource() { audio.pause(); audio.removeAttribute('src'); audio.load(); if (activeBlobURL) URL.revokeObjectURL(activeBlobURL); activeBlobURL = ''; loaded = false; }
  async function playAt(position, { automatic = false, seek = 0, remember = true } = {}) {
    const track = queue[position]; if (!track) return;
    beginNativeIntent();
    const previousIndex = index; preparationController?.abort(); preparationController = new AbortController(); const signal = preparationController.signal, token = ++playVersion;
    if (remember && previousIndex >= 0 && previousIndex !== position) history.push(previousIndex);
    if (history.length > 200) history.shift();
    index = position; current = track; phase = 'loading'; playerError = ''; elapsed = seek; duration = track.duration; loaded = false; pauseRoom();
    if (native) sendNative('stop'); else { stopSource(); if (!automatic) primeAudio(); }
    renderPlayer(); renderQueue(); renderSearch(); renderLibrary(); persist();
    if ($('tab-lyrics').getAttribute('aria-selected') === 'true') void loadLyrics();
    try {
      let source;
      if (native && (track.local || offline.has(track.id))) { if (track.local && !offline.has(track.id)) throw new Error('Локальный файл не найден. Добавь его заново в «Моя музыка».'); source = track.local ? 'native-local' : track.audioUrl; }
      else if (!native) { const stored = await DB.get(track.id).catch(() => null); if (token !== playVersion) return; if (stored?.blob instanceof Blob) source = activeBlobURL = URL.createObjectURL(stored.blob); }
      if (track.local && !source) throw new Error('Локальный файл не найден. Добавь его заново в «Моя музыка».');
      if (!source) { await prepare(track, signal); source = track.audioUrl; }
      if (token !== playVersion || signal.aborted) return;
      loaded = true;
      if (native) sendNative('play', { ...track, position: seek, queueIndex: index });
      else {
        audio.src = source; audio.load();
        audio.defaultPlaybackRate = audio.playbackRate = rate;
        if (seek > 0) audio.addEventListener('loadedmetadata', () => { if (token === playVersion) audio.currentTime = Math.min(seek, Math.max(0, audio.duration - 0.1)); }, { once: true });
        await audio.play();
      }
      if (token !== playVersion) return;
      if (!native) { phase = 'playing'; renderPlayback(); }
      updateMediaSession();
    } catch (error) {
      if (token !== playVersion || error.name === 'AbortError') return;
      phase = error.name === 'NotAllowedError' ? 'blocked' : 'error';
      playerError = phase === 'blocked' ? 'Аудио готово. Нажми Play, чтобы разрешить звук.' : error.message || 'Не удалось включить запись. Проверь сеть и повтори.';
      renderPlayback();
    }
  }
  function pause() {
    beginNativeIntent();
    ++playVersion; preparationController?.abort(); phase = 'paused';
    if (native) sendNative('pause'); else audio.pause(); renderPlayback(); persist();
  }
  function resume() {
    if (!current) { if (queue.length) void playAt(0); return; }
    pauseRoom();
    if (!loaded || phase === 'error' || phase === 'ended') { void playAt(index, { seek: phase === 'ended' ? 0 : elapsed, remember: false }); return; }
    beginNativeIntent();
    playerError = ''; phase = 'loading'; renderPlayback();
    if (native) sendNative('resume');
    else { const token = playVersion; audio.play().then(() => { if (token !== playVersion) return; phase = 'playing'; renderPlayback(); }).catch(error => { if (token !== playVersion) return; phase = 'blocked'; playerError = error.name === 'NotAllowedError' ? 'Нажми Play ещё раз, чтобы разрешить звук.' : 'Не удалось включить запись. Нажми «Повторить».'; renderPlayback(); }); }
  }
  function togglePlayback() { if (phase === 'playing' || phase === 'loading') pause(); else resume(); }
  function next(automatic = false) {
    const target = C.nextIndex(queue.length, index, { shuffle, repeat, automatic });
    if (target < 0) { phase = 'ended'; if (native) sendNative('pause'); else audio.pause(); renderPlayback(); persist(); return; }
    void playAt(target, { automatic });
  }
  function previous() { if (elapsed > 3 && loaded) { seek(0); return; } const prior = history.pop(); void playAt(prior ?? Math.max(0, index - 1), { remember: false }); }
  function seek(value) { if (!loaded || !current) return; elapsed = Math.max(0, Math.min(duration || 1200, Number(value) || 0)); if (native) sendNative('seek', { position: elapsed }); else audio.currentTime = elapsed; renderTime(); persist(); }
  function renderPlayer() {
    document.body.classList.toggle('has-mini', !!current); $('mini-player').hidden = !current;
    if (!current) return;
    $('mini-title').textContent = $('player-title').textContent = current.title; $('mini-artist').textContent = $('player-artist').textContent = current.artist || (current.local ? 'Локальный файл' : 'Без исполнителя');
    for (const id of ['mini-cover', 'player-cover']) { const element = $(id); element.src = current.cover || '/app/icon.svg'; element.onerror = () => { element.onerror = null; element.src = '/app/icon.svg'; }; }
    renderLike(); renderDownload(); renderPlayback();
    $('player-shuffle').setAttribute('aria-pressed', String(shuffle)); $('player-repeat').setAttribute('aria-pressed', String(repeat !== 'off')); $('player-repeat').textContent = repeat === 'one' ? '↻1' : '↻'; $('player-repeat').setAttribute('aria-label', repeat === 'one' ? 'Повтор одного трека' : repeat === 'all' ? 'Повтор всей очереди' : 'Повтор выключен');
    syncNativeQueue();
    renderComfort(); renderBookmarks();
  }
  function renderPlayback() {
    const playing = phase === 'playing', loading = phase === 'loading', label = playing ? 'Пауза' : loading ? 'Отменить загрузку' : 'Воспроизвести';
    for (const id of ['mini-play', 'player-play']) { $(id).textContent = playing ? 'Ⅱ' : loading ? '·' : '▶'; $(id).setAttribute('aria-label', label); }
    $('player-state').textContent = playerError || (loading ? 'Готовим аудио…' : current ? current.local ? offline.has(current.id) ? 'На устройстве' : 'Локальный файл не найден' : offline.has(current.id) ? 'На устройстве' : 'SoundCloud · аудио LolzCloud' : '');
    $('player-state').dataset.error = String(phase === 'error'); $('player-retry').hidden = !['error', 'blocked'].includes(phase);
    $('player-seek').disabled = !loaded || !duration; renderTime(); updateMediaSession();
  }
  function renderTime() {
    $('player-time').textContent = C.formatTime(elapsed); $('player-duration').textContent = C.formatTime(duration);
    $('player-seek').max = duration || 1; if (document.activeElement !== $('player-seek')) $('player-seek').value = Math.min(elapsed, duration || 1);
    if (syncedLyrics.length) {
      let found = -1; for (let i = 0; i < syncedLyrics.length && syncedLyrics[i].time <= elapsed + 0.1; i++) found = i;
      if (found !== activeLyric) { $('lyrics-text').querySelector('[data-active=true]')?.removeAttribute('data-active'); const line = $('lyrics-text').children[found]; if (line) line.dataset.active = 'true'; activeLyric = found; }
    }
  }
  function updateMediaSession() {
    if (native || !('mediaSession' in navigator) || !current) return;
    try {
      if (navigator.mediaSession.metadata?.title !== current.title) navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: 'LolzCloud', artwork: [{ src: current.cover || origin + '/app/icon-512.png', sizes: '512x512', type: current.cover ? 'image/jpeg' : 'image/png' }] });
      navigator.mediaSession.playbackState = phase === 'playing' ? 'playing' : 'paused';
      if (duration > 0 && Number.isFinite(elapsed)) navigator.mediaSession.setPositionState?.({ duration, playbackRate: rate, position: Math.min(duration, Math.max(0, elapsed)) });
    } catch { /* MediaSession availability varies by browser. */ }
  }
  function openActions(track) { actionTrack = track; renderActions(); $('track-dialog').showModal(); }
  const downloadLabel = track => downloads.has(track.id) ? 'Сохраняем…' : offline.has(track.id) ? track.local ? 'Удалить файл из приложения' : 'Удалить загрузку' : track.local ? 'Добавить файл заново' : 'Сохранить офлайн';
  function renderActions() { if (!actionTrack) return; $('track-action-title').textContent = actionTrack.title; $('track-like').textContent = liked.has(actionTrack.id) ? 'Убрать из любимого' : 'Добавить в любимое'; $('track-download').textContent = downloadLabel(actionTrack); $('track-download').disabled = downloads.has(actionTrack.id); }
  function renderDownload() { if (current) { $('player-download').textContent = downloadLabel(current); $('player-download').disabled = downloads.has(current.id); } if (actionTrack) renderActions(); }
  async function download(track) {
    if (!track || downloads.has(track.id)) return;
    if (offline.has(track.id)) {
      if (native) sendNative('removeDownload', { id: track.id });
      else { await DB.remove(track.id); offline.delete(track.id); if (!liked.has(track.id) && !bookmarks.get(track.id)?.length) collection.delete(track.id); renderLibrary(); renderDownload(); renderSearch(); persist(); notice('Загрузка удалена'); }
      return;
    }
    if (track.local) { showView('library'); if (native) sendNative('importAudio'); else $('audio-import').click(); return; }
    downloads.add(track.id); renderDownload();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 170000); let handedToNative = false;
    try {
      await prepare(track, controller.signal);
      if (native) { sendNative('download', { track }); handedToNative = true; return; }
      const response = await fetch(track.audioUrl, { credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (!response.ok || !/^audio\/mpeg(?:;|$)/i.test(response.headers.get('content-type') || '') || +(response.headers.get('content-length') || 0) > DB.MAX_FILE) throw new Error('Не удалось получить полный MP3. Повтори загрузку.');
      const reader = response.body.getReader(), parts = []; let bytes = 0;
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > DB.MAX_FILE) { await reader.cancel(); throw new Error('Запись больше 20 МБ. Выбери другой трек.'); } parts.push(part.value); }
      const expected = +(response.headers.get('content-length') || 0); if (expected && expected !== bytes) throw new Error('Файл получен не полностью. Повтори загрузку.');
      const blob = new Blob(parts, { type: 'audio/mpeg' });
      await verifyDuration(blob, track.duration);
      await DB.save(track, blob); collection.set(track.id, track); await refreshOffline(); persist(); notice('Сохранено на устройстве');
      void navigator.storage?.persist?.().catch(() => {});
    } catch (error) { noticeError(error.name === 'AbortError' ? new Error('Загрузка прервана. Проверь сеть и повтори.') : error); }
    finally { clearTimeout(timeout); if (!handedToNative) downloads.delete(track.id); renderDownload(); renderSearch(); }
  }
  function verifyDuration(blob, expected) {
    return new Promise((resolve, reject) => {
      const probe = new Audio(), url = URL.createObjectURL(blob); let done = false;
      const finish = error => { if (done) return; done = true; clearTimeout(timeout); probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url); error ? reject(error) : resolve(); };
      const timeout = setTimeout(() => finish(new Error('Не удалось проверить загруженное аудио. Файл не сохранён.')), 12000);
      probe.preload = 'metadata'; probe.onloadedmetadata = () => finish(!Number.isFinite(probe.duration) || probe.duration <= 0 || expected > 20 && probe.duration < expected * 0.8 ? new Error('Сервис вернул только отрывок. Загрузка не сохранена.') : null); probe.onerror = () => finish(new Error('Аудиофайл повреждён. Попробуй другую запись.')); probe.src = url;
    });
  }
  async function lyricsFor(track, signal) {
    const imported = await DB.userLyrics(track.id).catch(() => null);
    if (imported?.imported === true && (typeof imported.plain === 'string' && imported.plain.trim() || typeof imported.synced === 'string' && imported.synced.trim())) return imported;
    const metadata = lyricsMetadata.get(track.id) || track, identity = C.lyricsIdentity(metadata.title) + '|' + C.lyricsIdentity(metadata.artist) + '|' + track.duration;
    if (!C.lyricsIdentity(metadata.title) || !C.lyricsIdentity(metadata.artist)) throw new Error('Уточни название и исполнителя или импортируй свой TXT / LRC.');
    const cached = await DB.lyrics(track.id).catch(() => null); if (cached?.policy === 2 && cached.identity === identity && (cached.plain || cached.synced || cached.instrumental)) return cached;
    const params = new URLSearchParams({ track_name: metadata.title, artist_name: metadata.artist, duration: String(Math.round(track.duration)) });
    let result, notFound = false;
    try {
      const { body } = await json('https://lrclib.net/api/get?' + params, { signal, timeout: 15000, limit: 256 * 1024, credentials: 'omit' });
      notFound = body?.name === 'TrackNotFound' || body?.code === 'TRACK_NOT_FOUND';
      if (!notFound) result = C.lyricsCandidate(body, metadata.title, metadata.artist, track.duration);
    } catch (error) { if (error.status !== 404) throw error; notFound = true; }
    if (notFound) {
      const search = new URLSearchParams({ track_name: metadata.title, artist_name: metadata.artist });
      const { body } = await json('https://lrclib.net/api/search?' + search, { signal, timeout: 15000, limit: 1024 * 1024, credentials: 'omit' });
      if (!Array.isArray(body) || body.length > 100) throw new Error('Сервис текстов вернул неверный список записей.');
      const candidates = body.map(row => C.lyricsCandidate(row, metadata.title, metadata.artist, track.duration)).filter(Boolean);
      result = candidates.find(row => row.synced) || candidates[0];
    }
    if (!result) throw new Error('Текст этой записи пока не найден. Уточни название и исполнителя.');
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const value = { ...result, policy: 2, identity }; void DB.saveLyrics(track.id, value).catch(() => {}); return value;
  }
  async function loadLyrics(force = false) {
    if (!current) return;
    if (!force && lyricsTrack === current.id && $('lyrics-text').childNodes.length) return;
    const track = current, token = ++lyricsVersion; lyricsController?.abort(); lyricsController = new AbortController();
    lyricsTrack = track.id; syncedLyrics = []; activeLyric = -1; $('lyrics-text').replaceChildren(); $('lyrics-retry').hidden = true; $('lyrics-edit').hidden = true; $('lyrics-metadata-form').hidden = true; $('lyrics-import-remove').hidden = true; $('lyrics-import-status').textContent = ''; document.querySelector('#panel-lyrics .attribution').hidden = false; $('lyrics-status').textContent = 'Ищем текст этой записи…';
    try {
      const value = await lyricsFor(track, lyricsController.signal); if (token !== lyricsVersion || current?.id !== track.id) return;
      $('lyrics-import-remove').hidden = !value.imported; document.querySelector('#panel-lyrics .attribution').hidden = !!value.imported;
      syncedLyrics = C.parseLyrics(value.synced);
      if (syncedLyrics.length) { $('lyrics-text').append(...syncedLyrics.map(line => { const item = button(line.text || '♪', () => seek(line.time), 'lyric-line'); item.setAttribute('aria-label', line.text + ', ' + C.formatTime(line.time)); return item; })); $('lyrics-status').textContent = (value.imported ? 'Твой LRC · ' : '') + 'Нажми на строку, чтобы перейти к ней.'; renderTime(); }
      else { $('lyrics-text').textContent = value.instrumental ? 'Инструментальная запись' : value.plain; $('lyrics-status').textContent = value.imported ? 'Твой текст · без синхронизации' : value.instrumental ? '' : value.durationMatched ? 'Текст без синхронизации' : 'Текст без синхронизации · длительность отличается'; }
    } catch (error) { if (token !== lyricsVersion || error.name === 'AbortError') return; $('lyrics-status').textContent = error.status === 404 ? 'Текст этой записи пока не найден.' : error.message; $('lyrics-retry').hidden = false; $('lyrics-edit').hidden = false; }
  }
  function playerTab(tab) { const lyrics = tab === 'lyrics'; for (const name of ['queue', 'lyrics']) { $('tab-' + name).setAttribute('aria-selected', String(name === tab)); $('tab-' + name).tabIndex = name === tab ? 0 : -1; $('panel-' + name).hidden = name !== tab; } if (lyrics) void loadLyrics(); if (matchMedia('(max-width:759px)').matches) $('player-tabs').scrollIntoView({ block: 'start' }); }
  function renderComfort() {
    $('player-rate').value = rate; $('player-rate-value').textContent = Number(rate.toFixed(2)) + '×';
    for (const control of $('rate-presets').children) control.setAttribute('aria-pressed', String(Math.abs(+control.dataset.rate - rate) < 0.001));
    $('sleep-status').textContent = sleepDeadline > 0 && !native ? 'Веб-таймер проверяется при воспроизведении и возврате. В фоне iOS может приостановить его.' : '';
    $('sleep-active').hidden = !sleepDeadline; $('sleep-active').textContent = 'Осталось ' + Math.max(1, Math.ceil((sleepDeadline - Date.now()) / 60000)) + ' мин.';
    if (document.activeElement !== $('sleep-select')) $('sleep-select').value = sleepDeadline ? 'active' : '0';
  }
  function setRate(value) {
    const nextRate = Number(value); if (!Number.isFinite(nextRate) || nextRate < 0.5 || nextRate > 2) return;
    rate = nextRate; if (native) sendNative('rate', { value: rate }); else audio.defaultPlaybackRate = audio.playbackRate = rate;
    renderComfort(); updateMediaSession(); persist();
  }
  function checkSleep() {
    if (!sleepDeadline || Date.now() < sleepDeadline) return false;
    sleepDeadline = 0; clearInterval(sleepInterval); pause(); if (roomAudible) pauseRoom(); if (native) sendNative('sleep', { minutes: 0 }); renderComfort(); persist(); notice('Таймер сна остановил музыку'); return true;
  }
  function scheduleSleep() { clearInterval(sleepInterval); if (sleepDeadline > 0) sleepInterval = setInterval(() => { checkSleep(); renderComfort(); }, 1000); renderComfort(); }
  function setSleep(minutes) {
    if (![0, 15, 30, 45, 60].includes(minutes)) return;
    sleepDeadline = minutes ? Date.now() + minutes * 60000 : 0; if (native) sendNative('sleep', { minutes }); scheduleSleep(); persist();
  }
  function renderBookmarks() {
    const rows = current ? bookmarks.get(current.id) || [] : []; $('bookmark-add').disabled = !current;
    $('bookmark-list').replaceChildren(...rows.map(row => {
      const item = node('div', null, 'bookmark-row'), jump = button(C.formatTime(row.position), () => { if (loaded) seek(row.position); else { elapsed = row.position; renderTime(); persist(); notice('Момент выбран. Нажми Play.'); } }, 'bookmark-jump'); jump.setAttribute('aria-label', 'Перейти к ' + C.formatTime(row.position));
      const remove = button('×', () => { const remaining = rows.filter(value => value !== row); if (remaining.length) bookmarks.set(current.id, remaining); else bookmarks.delete(current.id); renderBookmarks(); persist(); }, 'icon-button'); remove.setAttribute('aria-label', 'Удалить момент ' + C.formatTime(row.position)); item.append(jump, remove); return item;
    }));
    if (!rows.length) $('bookmark-list').append(node('p', 'Сохрани место, к которому хочется вернуться.', 'bookmark-empty'));
  }
  function addBookmark() {
    if (!current) return; const rows = bookmarks.get(current.id) || [];
    if (rows.length >= 100) return notice('У этого трека уже 100 сохранённых моментов.');
    if (!bookmarks.has(current.id) && bookmarks.size >= 100) return notice('Моменты сохранены для 100 треков. Удали ненужные.');
    const position = Math.round(elapsed * 10) / 10; if (rows.some(row => Math.abs(row.position - position) < 1)) return notice('Этот момент уже сохранён');
    rows.push({ position, createdAt: Date.now() }); rows.sort((a, b) => a.position - b.position); bookmarks.set(current.id, rows); collection.set(current.id, current); renderBookmarks(); renderLibrary(); persist(); notice('Момент ' + C.formatTime(position) + ' сохранён');
  }
  async function roomLyrics() {
    const doc = $('rooms-frame').contentDocument, title = doc?.getElementById('track-title')?.textContent?.trim(), artist = doc?.getElementById('track-artist')?.textContent?.trim();
    if (!title || !artist) return notice('В комнате пока нет сведений о текущей записи.');
    const token = ++roomLyricsVersion; $('room-lyrics-title').textContent = title; $('room-lyrics-text').textContent = ''; $('room-lyrics-status').textContent = 'Ищем текст…'; $('room-lyrics-dialog').showModal();
    try {
      const params = new URLSearchParams({ track_name: title, artist_name: artist }); const { body } = await json('https://lrclib.net/api/get?' + params, { timeout: 15000, limit: 256 * 1024 });
      if (token !== roomLyricsVersion) return;
      $('room-lyrics-text').textContent = body.instrumental ? 'Инструментальная запись' : typeof body.plainLyrics === 'string' ? body.plainLyrics.slice(0, 200000) : '';
      $('room-lyrics-status').textContent = $('room-lyrics-text').textContent ? 'Для записи: ' + artist : 'Текст этой записи пока не найден.';
    } catch { if (token === roomLyricsVersion) $('room-lyrics-status').textContent = 'Текст не найден или нет связи с LRCLIB. Комната продолжает играть.'; }
  }
  function showView(name, focus = false) {
    if (!['search', 'library', 'rooms', 'profile'].includes(name)) return;
    view = name; for (const tab of ['search', 'library', 'rooms', 'profile']) { $('view-' + tab).hidden = tab !== name; const control = document.querySelector('[data-view="' + tab + '"]'); if (tab === name) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current'); }
    if (name === 'library') { renderLibrary(); void refreshOffline(); }
    if (name === 'rooms' || name === 'profile') void loadAccount();
    if (focus) $('main').focus({ preventScroll: true });
  }
  function cancelLogin() { if (loginCommitting) return; ++loginVersion; loginController?.abort(); $('login-dialog').close(); $('login-code').textContent = ''; $('login-browser').removeAttribute('href'); }
  function validAccount(value) { return value && Number.isSafeInteger(value.id) && value.id > 0 && String(value.id).length <= 15 && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 300; }
  async function login() {
    if (native) { sendNative('login'); return; }
    if (loginCommitting) return;
    loginController?.abort(); loginController = new AbortController(); const signal = loginController.signal, ticket = ++loginVersion;
    let deviceCode = ''; $('login-status').textContent = 'Готовим подключение…'; $('login-code').textContent = ''; $('login-browser').hidden = true; $('login-browser').removeAttribute('href'); $('login-retry').hidden = true; $('login-cancel').disabled = false;
    if (!$('login-dialog').open) $('login-dialog').showModal();
    const post = value => ({ method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), limit: 128 * 1024, timeout: 12000 });
    try {
      const { body: start } = await json('/api/desktop/start', post({}));
      if (ticket !== loginVersion) return;
      if (!/^[a-zA-Z0-9_-]{43}$/.test(start.deviceCode) || !/^[a-zA-Z0-9_-]{12}$/.test(start.code) || !Number.isFinite(start.expiresIn) || start.expiresIn < 1 || start.expiresIn > 600) throw new Error('Сервис входа вернул неверный код. Начни заново.');
      const destination = new URL(start.verificationUrl);
      if (destination.origin !== origin || destination.username || destination.password || destination.pathname !== '/connect' || destination.hash || destination.search !== '?code=' + start.code) throw new Error('Не удалось проверить страницу подключения. Начни вход заново.');
      deviceCode = start.deviceCode; const deadline = Date.now() + start.expiresIn * 1000;
      $('login-code').textContent = start.code; $('login-code').setAttribute('aria-label', 'Код подключения: ' + start.code); $('login-browser').href = destination.href; $('login-browser').hidden = false; $('login-status').textContent = 'Подтверди этот код в браузере и вернись в LolzCloud.';
      let failures = 0;
      while (Date.now() < deadline && ticket === loginVersion && !signal.aborted) {
        if (document.hidden) { await wait(1000, signal); continue; }
        let grant;
        try { ({ body: grant } = await json('/api/desktop/poll', post({ deviceCode }))); failures = 0; }
        catch (error) { if (signal.aborted) throw error; failures++; if (failures >= 6 || Date.now() >= deadline) throw error; $('login-status').textContent = 'Нет связи с сервисом входа. Проверим ещё раз…'; await wait(Math.min(10000, 1500 * 2 ** failures), signal); continue; }
        if (ticket !== loginVersion || signal.aborted) return;
        if (grant.pending === true) { await wait(2500, signal); continue; }
        if (grant.pending !== false || !/^[a-zA-Z0-9_-]{43}$/.test(grant.token) || !validAccount(grant.user) || !Number.isFinite(grant.expires) || grant.expires <= Date.now()) throw new Error('Вход не подтверждён. Начни подключение заново.');
        loginCommitting = true; $('login-cancel').disabled = true; $('login-browser').hidden = true; $('login-status').textContent = 'Подключаем аккаунт…';
        // The bearer exists only in this stack. The server commits a secure,
        // HttpOnly session to this app's cookie jar, isolated from Safari.
        await json('/api/desktop/session', { ...post({}), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + grant.token } });
        const { body: verified } = await json('/api/session', { signal, timeout: 12000, limit: 128 * 1024 });
        if (ticket !== loginVersion || verified.authenticated !== true || !validAccount(verified.user) || verified.user.id !== grant.user.id || !/^[a-zA-Z0-9_-]{43}$/.test(verified.csrf)) throw new Error('Не удалось подтвердить аккаунт в приложении. Нажми «Обновить» или начни вход заново.');
        account = verified.user; deviceCode = ''; $('login-code').textContent = ''; $('login-browser').removeAttribute('href'); $('login-dialog').close();
        for (const id of ['rooms-frame', 'social-frame']) $(id).removeAttribute('src');
        await loadAccount(true); notice('Аккаунт подключён'); return;
      }
      if (ticket === loginVersion && !signal.aborted) throw new Error('Код истёк. Начни вход заново.');
    } catch (error) { if (ticket === loginVersion && error.name !== 'AbortError') { $('login-status').textContent = error.message; $('login-retry').hidden = false; $('login-browser').hidden = true; } }
    finally { deviceCode = ''; if (ticket === loginVersion) { loginCommitting = false; $('login-cancel').disabled = false; } }
  }
  function renderGate(id, kind) {
    const gate = $(id); gate.replaceChildren(); if (account) { gate.hidden = true; return; } gate.hidden = false;
    gate.append(node('h2', kind === 'rooms' ? 'Музыка объединяет' : 'Твоя компания'), node('p', 'Войди через Lolzteam, чтобы слушать вместе, общаться, добавлять друзей и менять профиль. Музыка и загрузки доступны без входа.'));
    gate.append(button('Войти через Lolzteam', login, 'primary'), button('Я уже вошёл · обновить', () => loadAccount(true), 'text-button'));
  }
  async function loadAccount(force = false) {
    if (accountPending && !force) return accountPending;
    const token = ++accountVersion;
    accountPending = (async () => {
      try {
        const { body } = await json('/api/session', { timeout: 10000, limit: 128 * 1024 }); if (token !== accountVersion) return; account = body.authenticated === true && body.user?.id ? body.user : null;
        renderGate('rooms-gate', 'rooms'); renderGate('profile-gate', 'profile');
        if (account) {
          if (view === 'rooms' && !$('rooms-frame').getAttribute('src')) $('rooms-frame').src = '/rooms';
          if (view === 'profile' && !$('social-frame').getAttribute('src')) $('social-frame').src = '/social?tab=profile';
          $('rooms-frame').hidden = !$('rooms-frame').getAttribute('src'); $('social-frame').hidden = !$('social-frame').getAttribute('src');
        } else { $('rooms-frame').hidden = $('social-frame').hidden = true; }
      } catch (error) {
        if (token === accountVersion && !account) { renderGate('rooms-gate', 'rooms'); renderGate('profile-gate', 'profile'); for (const id of ['rooms-gate', 'profile-gate']) $(id).append(node('p', error.message, 'status')); }
      } finally { if (token === accountVersion) accountPending = null; }
    })(); return accountPending;
  }
  function openRoom(address) { const url = C.roomURL(address, origin); if (!url) return notice('Приглашение не похоже на ссылку комнаты LolzCloud.'); if ($('rooms-frame').contentWindow?.location.href !== url) $('rooms-frame').src = url; showView('rooms'); }
  function frameLoaded(frame) {
    let doc, win; try { doc = frame.contentDocument; win = frame.contentWindow; if (!doc || win.location.origin !== origin) return; } catch { return; }
    const path = win.location.pathname;
    if (path === '/login' || path.startsWith('/auth/')) { login(); return; }
    if (frame.id === 'rooms-frame') { frameRoomURL = C.roomURL(win.location.href, origin); $('rooms-directory').hidden = $('room-lyrics').hidden = !frameRoomURL; }
    doc.addEventListener('click', event => {
      const anchor = event.target.closest('a[href]'); if (!anchor || event.defaultPrevented) return;
      let url; try { url = new URL(anchor.href, origin); } catch { return; }
      if (url.origin !== origin) return;
      if (url.pathname === '/login' || url.pathname.startsWith('/auth/')) { event.preventDefault(); login(); }
      else if (C.roomURL(url.href, origin) && frame.id === 'social-frame') { event.preventDefault(); openRoom(url.href); }
      else if (url.pathname === '/' || url.pathname === '/app/') { event.preventDefault(); showView('search', true); }
      else if (url.pathname === '/rooms' && frame.id === 'social-frame') { event.preventDefault(); showView('rooms', true); }
    });
    doc.addEventListener('lolzcloud:social-room-open', event => { if (C.roomURL(event.detail?.url, origin)) { event.preventDefault(); openRoom(event.detail.url); } });
  }
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== $('rooms-frame').contentWindow || event.data?.type !== 'lolzcloud:room-audio' || event.data.playing !== true) return;
    roomAudible = true; pause();
  });
  $('search-form').onsubmit = event => { event.preventDefault(); $('search-query').blur(); void search(); };
  $('search-query').oninput = () => { if (searching) { ++searchVersion; searchController?.abort(); searching = false; $('search-submit').disabled = false; $('search-status').textContent = 'Нажми «Найти», чтобы выполнить новый поиск.'; } $('search-more').hidden = $('search-query').value.trim() !== searchedQuery || !nextOffset; };
  $('search-more').onclick = () => { void search(true); };
  $('navigation').onclick = event => { const name = event.target.closest('[data-view]')?.dataset.view; if (name) showView(name, true); };
  document.querySelector('.brand').onclick = event => { event.preventDefault(); showView('search', true); };
  $('library-filters').onclick = event => { const filter = event.target.closest('[data-filter]')?.dataset.filter; if (!filter) return; libraryFilter = filter; for (const button of $('library-filters').children) button.setAttribute('aria-pressed', String(button.dataset.filter === filter)); renderLibrary(); };
  $('audio-import').onchange = async () => {
    const input = $('audio-import'), files = [...input.files]; input.value = '';
    if (!files.length || importingAudio) return;
    if (files.length > 20) { $('audio-import-status').textContent = 'Выбери до 20 файлов за один раз.'; return; }
    importingAudio = true; input.disabled = true; let added = 0; const errors = [];
    try {
      for (const file of files) {
        $('audio-import-status').textContent = 'Проверяем: ' + file.name.slice(0, 300);
        try { const item = await window.LolzCloudImports.audio(file); collection.set(item.id, item); added++; }
        catch (error) { errors.push(file.name.slice(0, 300) + ': ' + error.message); }
      }
      await refreshOffline(); persist(); renderLibrary();
      $('audio-import-status').textContent = 'Добавлено: ' + added + (errors.length ? '. Не удалось: ' + errors.length + '.\n' + errors.slice(0, 3).join('\n') : '.');
      if (added) void navigator.storage?.persist?.().catch(() => {});
    } finally { importingAudio = false; input.disabled = false; }
  };
  $('native-audio-import').onclick = () => { $('native-audio-import').disabled = true; $('audio-import-status').textContent = 'Выбери аудиофайлы на устройстве.'; sendNative('importAudio'); };
  $('mini-open').onclick = () => { $('player-dialog').showModal(); renderQueue(); };
  for (const id of ['mini-play', 'player-play']) $(id).onclick = togglePlayback;
  for (const id of ['mini-next', 'player-next']) $(id).onclick = () => next();
  $('player-previous').onclick = previous; $('player-retry').onclick = () => resume();
  $('player-shuffle').onclick = () => { shuffle = !shuffle; persist(); renderPlayer(); };
  $('player-repeat').onclick = () => { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; persist(); renderPlayer(); notice(repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор всей очереди' : 'Повтор одного трека'); };
  $('player-like').onclick = () => toggleLike(current); $('player-download').onclick = () => { void download(current); };
  $('player-seek').oninput = () => { $('player-time').textContent = C.formatTime($('player-seek').value); }; $('player-seek').onchange = () => seek($('player-seek').value);
  $('player-volume').oninput = () => { const value = +$('player-volume').value; if (native) sendNative('volume', { value }); else audio.volume = value; };
  $('player-rate').oninput = () => setRate($('player-rate').value); $('rate-presets').onclick = event => { const control = event.target.closest('[data-rate]'); if (control) setRate(control.dataset.rate); };
  $('sleep-select').onchange = () => setSleep(+$('sleep-select').value); $('bookmark-add').onclick = addBookmark;
  $('queue-clear').onclick = () => { queue = current ? [current] : []; index = current ? 0 : -1; history = []; persist(); renderQueue(); notice('В очереди остался текущий трек'); };
  $('player-tabs').onclick = event => { const tab = event.target.closest('[data-player-tab]')?.dataset.playerTab; if (tab) playerTab(tab); };
  $('player-tabs').onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const tab = event.key === 'Home' ? 'queue' : event.key === 'End' ? 'lyrics' : $('tab-queue').getAttribute('aria-selected') === 'true' ? 'lyrics' : 'queue'; playerTab(tab); $('tab-' + tab).focus(); } };
  $('lyrics-retry').onclick = () => { void loadLyrics(true); };
  $('lyrics-import').onchange = async () => {
    const input = $('lyrics-import'), file = input.files[0], target = current; input.value = '';
    if (!file || !target) return; input.disabled = true; $('lyrics-import-status').textContent = 'Проверяем текст…';
    try {
      const value = await window.LolzCloudImports.lyrics(file); await DB.saveUserLyrics(target.id, value);
      if (current?.id === target.id) { await loadLyrics(true); $('lyrics-import-status').textContent = 'Свой текст сохранён: ' + value.filename; } else notice('Текст сохранён для «' + target.title + '»');
    } catch (error) { if (current?.id === target.id) $('lyrics-import-status').textContent = error.message; }
    finally { input.disabled = false; }
  };
  $('lyrics-import-remove').onclick = async () => { const target = current; if (!target) return; try { await DB.removeUserLyrics(target.id); if (current?.id === target.id) await loadLyrics(true); } catch (error) { $('lyrics-import-status').textContent = error.message; } };
  $('lyrics-edit').onclick = () => { if (!current) return; const metadata = lyricsMetadata.get(current.id) || current; $('lyrics-title-input').value = metadata.title; $('lyrics-artist-input').value = metadata.artist; $('lyrics-metadata-form').hidden = false; $('lyrics-edit').hidden = $('lyrics-retry').hidden = true; $('lyrics-title-input').focus(); };
  $('lyrics-metadata-cancel').onclick = () => { $('lyrics-metadata-form').hidden = true; $('lyrics-edit').hidden = $('lyrics-retry').hidden = false; };
  $('lyrics-metadata-form').onsubmit = event => {
    event.preventDefault(); if (!current) return; const title = $('lyrics-title-input').value.trim(), artist = $('lyrics-artist-input').value.trim();
    if (!C.lyricsIdentity(title) || !C.lyricsIdentity(artist) || title.length > 300 || artist.length > 300) { $('lyrics-status').textContent = 'Укажи название и исполнителя: до 300 символов в каждом поле.'; return; }
    const updated = new Map(lyricsMetadata); updated.set(current.id, { title, artist });
    if (updated.size > 500) { $('lyrics-status').textContent = 'Данные уже уточнены для 500 треков.'; return; }
    try { localStorage.setItem('LolzCloud-lyrics-metadata-v1', JSON.stringify(Object.fromEntries(updated))); } catch { $('lyrics-status').textContent = 'Не удалось сохранить уточнение. Проверь свободное место.'; return; }
    lyricsMetadata.set(current.id, { title, artist }); void loadLyrics(true);
  };
  $('track-like').onclick = () => { toggleLike(actionTrack); $('track-dialog').close(); }; $('track-queue').onclick = () => { enqueue(actionTrack); $('track-dialog').close(); }; $('track-download').onclick = () => { void download(actionTrack); $('track-dialog').close(); };
  for (const control of document.querySelectorAll('[data-close]')) control.onclick = () => $(control.dataset.close).close();
  $('room-lyrics-dialog').addEventListener('close', () => { ++roomLyricsVersion; });
  $('install-open').onclick = () => $('install-dialog').showModal();
  $('login-cancel').onclick = cancelLogin; $('login-retry').onclick = () => { void login(); };
  $('login-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelLogin(); });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install-confirm').hidden = false; });
  $('install-confirm').onclick = async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('install-confirm').hidden = true; };
  $('account-refresh').onclick = () => { void loadAccount(true).then(() => { if (account && $('social-frame').src) $('social-frame').contentWindow.location.reload(); }); };
  $('rooms-directory').onclick = () => { $('rooms-frame').src = '/rooms'; };
  $('room-lyrics').onclick = () => { void roomLyrics(); };
  for (const id of ['rooms-frame', 'social-frame']) $(id).onload = () => frameLoaded($(id));
  audio.addEventListener('playing', () => { if (native || !loaded) return; phase = 'playing'; playerError = ''; renderPlayback(); });
  audio.addEventListener('pause', () => { if (native || !loaded || ['loading', 'error', 'ended', 'blocked'].includes(phase)) return; phase = 'paused'; renderPlayback(); persist(); });
  audio.addEventListener('waiting', () => { if (native || !loaded || audio.paused) return; phase = 'loading'; renderPlayback(); });
  audio.addEventListener('loadedmetadata', () => { if (!loaded || native) return; if (Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration; renderTime(); });
  audio.addEventListener('timeupdate', () => { if (!loaded || native) return; elapsed = audio.currentTime; checkSleep(); renderTime(); updateMediaSession(); if (Date.now() - lastSavedTime > 5000) { lastSavedTime = Date.now(); persist(); } });
  audio.addEventListener('ended', () => { if (loaded && !native) next(true); });
  audio.addEventListener('error', () => { if (!loaded || native) return; phase = 'error'; playerError = 'Запись не загрузилась. Проверь сеть и нажми «Повторить».'; renderPlayback(); });
  window.addEventListener('lolzcloud:playback', event => {
    if (!native || !current) return; const value = event.detail;
    if (!currentNativeIntent(value) || typeof value.id === 'string' && value.id !== current.id || !['loading', 'playing', 'paused', 'ended', 'error'].includes(value.state)) return;
    if (!loaded && value.id !== current.id) return; loaded = true;
    if (Number.isFinite(value.rate) && value.rate >= 0.5 && value.rate <= 2) rate = value.rate;
    if (Number.isFinite(value.sleepDeadline) && value.sleepDeadline >= 0 && value.sleepDeadline !== sleepDeadline) { sleepDeadline = value.sleepDeadline; scheduleSleep(); persist(); }
    if (Number.isFinite(value.time)) elapsed = Math.max(0, value.time); if (Number.isFinite(value.duration) && value.duration > 0) duration = value.duration;
    if (typeof value.queue === 'boolean') nativeQueueOwned = value.queue;
    if (value.state === 'ended' && !nativeQueueOwned) { next(true); return; } phase = value.state; playerError = typeof value.error === 'string' ? value.error.slice(0, 300) : ''; renderPlayback(); renderComfort(); checkSleep();
  });
  window.addEventListener('lolzcloud:selection', event => {
    if (!native) return; const value = event.detail, position = value?.index;
    if (!currentNativeIntent(value) || !Number.isInteger(position) || position < 0 || position >= queue.length) return;
    const received = C.savedTrack(value.track, origin), expected = queue[position];
    if (!received || received.id !== expected.id || received.audioUrl !== expected.audioUrl) return;
    const changed = index !== position || current?.id !== expected.id;
    nativeQueueOwned = value.queue === true;
    if (!changed && loaded) return;
    if (changed) { if (index >= 0) history.push(index); if (history.length > 200) history.shift(); elapsed = 0; duration = expected.duration; }
    ++playVersion; preparationController?.abort(); index = position; current = expected; loaded = true; playerError = ''; nativeQueueOwned = value.queue === true; phase = 'loading';
    renderPlayer(); renderQueue(); persist();
    if (changed && $('tab-lyrics').getAttribute('aria-selected') === 'true') void loadLyrics();
  });
  window.addEventListener('lolzcloud:command', event => { if (!native) return; if (event.detail?.action === 'next') next(); else if (event.detail?.action === 'previous') previous(); });
  window.addEventListener('lolzcloud:download', event => {
    if (!native || !event.detail) return; const value = event.detail;
    if (Array.isArray(value.tracks)) { offline = new Map(value.tracks.slice(0, 500).map(row => { const item = C.savedTrack({ ...row, artist: row.artist || '' }, origin); return item ? [item.id, item] : null; }).filter(Boolean)); }
    if (value.import === true) {
      if (value.state === 'loading' && !value.id) { nativeImportCount = nativeImportErrors = 0; }
      if (value.state === 'ready') nativeImportCount++;
      if (value.state === 'error') nativeImportErrors++;
      $('native-audio-import').disabled = value.importing === true;
      $('audio-import-status').textContent = value.state === 'cancelled' ? 'Выбор файлов отменён.' : value.importing ? 'Добавляем файлы…' : 'Добавлено: ' + nativeImportCount + (nativeImportErrors ? '. Не удалось: ' + nativeImportErrors : '') + '.';
    }
    if (value.state === 'loading' && typeof value.id === 'string') downloads.add(value.id);
    if (value.state === 'ready' || value.state === 'error') { downloads.delete(value.id); if (value.state === 'error') notice(value.error || 'Не удалось сохранить трек.'); else if (!value.import) notice('Сохранено на устройстве'); }
    renderLibrary(); renderDownload(); renderSearch();
  });
  window.addEventListener('lolzcloud:account', event => { if (!native) return; if (event.detail?.state === 'ready') { account = null; $('rooms-frame').removeAttribute('src'); $('social-frame').removeAttribute('src'); void loadAccount(true); } else if (event.detail?.state === 'error') notice(event.detail.error || 'Не удалось войти. Попробуй ещё раз.'); });
  if ('mediaSession' in navigator && !native) for (const [action, handler] of Object.entries({ play: resume, pause, nexttrack: () => next(), previoustrack: previous, seekto: detail => seek(detail.seekTime), seekbackward: detail => seek(elapsed - (detail.seekOffset || 10)), seekforward: detail => seek(elapsed + (detail.seekOffset || 10)) })) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional platform command. */ } }
  function connectivity() { $('connection').hidden = navigator.onLine; }
  window.addEventListener('online', () => { connectivity(); if (['rooms', 'profile'].includes(view)) void loadAccount(true); }); window.addEventListener('offline', connectivity);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else { checkSleep(); connectivity(); if (['rooms', 'profile'].includes(view)) void loadAccount(); } });
  window.addEventListener('pagehide', () => { clearTimeout(persistTimer); try { localStorage.setItem('LolzCloud-app-v1', JSON.stringify(savedState())); } catch {} });
  renderPlayer(); renderQueue(); renderLibrary(); renderComfort(); renderBookmarks(); scheduleSleep(); checkSleep(); connectivity(); renderGate('rooms-gate', 'rooms'); renderGate('profile-gate', 'profile'); void refreshOffline(); if (native) sendNative('rate', { value: rate });
  if (native) $('install-open').hidden = true;
  if (native) { $('audio-import-control').hidden = true; $('native-audio-import').hidden = false; }
  if (!native && (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) { document.querySelector('.volume-label').hidden = true; document.querySelector('.player-actions').append(node('span', 'Громкость — кнопками устройства', 'hint')); }
  if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => { /* Streaming remains available when private browsing denies a worker. */ });
  // Read-only diagnostic surface is useful to the isolated regression harness.
  window.LolzCloudApp = Object.freeze({ snapshot: () => ({ view, phase, current: current?.id || '', queue: queue.map(track => track.id), index, liked: [...liked], offline: [...offline.keys()], elapsed, duration, roomAudible, native, rate, sleepDeadline, bookmarks: current ? (bookmarks.get(current.id) || []).map(row => row.position) : [] }), openRoom });
})();
