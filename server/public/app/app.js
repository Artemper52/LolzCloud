(() => {
  'use strict';
  const C = window.LolzCloudAppCore, DB = window.LolzCloudOffline, RT = window.LolzCloudRoomTransportPolicy, $ = id => document.getElementById(id), origin = location.origin;
  const native = !!window.webkit?.messageHandlers?.lolzcloud;
  // A native snapshot may have been queued before a newer UI choice. Document
  // identity also prevents a previous page from winning after a WebView reload.
  const nativeClientId = native ? crypto.randomUUID().toLowerCase() : '';
  let nativeRequestId = 1, nativeHandshake = true, effectsController;
  const sendNative = (action, value = {}) => {
    window.webkit.messageHandlers.lolzcloud.postMessage({ action, ...value, clientId: nativeClientId, requestId: nativeRequestId });
    // Playback owns this binding. An effects edit never selects a new intent.
    if (['queue', 'play', 'pause', 'resume', 'stop'].includes(action)) { effectsController?.syncNativeIntent(); syncNativeRate(); }
  };
  const currentNativeIntent = value => value?.clientId === nativeClientId && value.requestId === nativeRequestId;
  function beginNativeIntent() { if (native) nativeRequestId++; }
  let saved = {}, queue = [], index = -1, current = null, shuffle = false, repeat = 'off', liked = new Set(), collection = new Map();
  try { saved = JSON.parse(localStorage.getItem('LolzCloud-app-v1') || '{}'); } catch { /* An invalid local draft starts cleanly. */ }
  if (Array.isArray(saved.queue)) queue = saved.queue.slice(0, 200).map(row => C.savedTrack(row, origin)).filter(Boolean);
  if (Array.isArray(saved.collection)) for (const value of saved.collection.slice(0, 500)) { const item = C.savedTrack(value, origin); if (item) collection.set(item.id, item); }
  if (Array.isArray(saved.liked)) liked = new Set(saved.liked.filter(C.trackID).slice(0, 2000));
  index = Number.isInteger(saved.index) && saved.index >= 0 && saved.index < queue.length ? saved.index : -1; current = queue[index] || null;
  shuffle = saved.shuffle === true; repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
  let view = 'search', phase = 'paused', elapsed = current && Number.isFinite(saved.position) ? Math.min(current.duration, Math.max(0, saved.position)) : 0, duration = current?.duration || 0, loaded = false, activeBlobURL = '', playerError = '';
  let searchVersion = 0, searchController, results = [], searchedQuery = '', nextOffset = '', searching = false;
  let playVersion = 0, preparationController, history = [], offline = new Map(), downloads = new Set(), libraryFilter = 'all', libraryVisible = 300, bookmarkVisible = 100, bookmarkVisibleID = '', actionTrack;
  let lyricsVersion = 0, lyricsController, lyricsTrack = '', syncedLyrics = [], roomLyricsVersion = 0, lyricView, roomLyricView, roomLyricsController, roomLyricsKey = '', roomLyricsValue = null, roomLyricsSeekable = false;
  const lyricsMetadata = new Map();
  try { for (const [id, value] of Object.entries(JSON.parse(localStorage.getItem('LolzCloud-lyrics-metadata-v1') || '{}')).slice(0, 500)) if (C.trackID(id) && value && typeof value.title === 'string' && value.title.length <= 300 && typeof value.artist === 'string' && value.artist.length <= 300 && C.lyricsIdentity(value.title) && C.lyricsIdentity(value.artist)) lyricsMetadata.set(id, { title: value.title, artist: value.artist }); } catch { /* Bad metadata never blocks music. */ }
  let account = null, accountPending, accountVersion = 0, frameRoomURL = '', roomAudible = false, noticeTimer, persistTimer, installPrompt, lastSavedTime = 0;
  let activeRoom = null, roomDocument = '', roomRevision = 0, nativeRoomSupported = false, mediaMetadataKey = '', systemSoloAllowed = true;
  const roomCommands = new Map();
  let roomLyricClock = null;
  let loginVersion = 0, loginController, loginCommitting = false;
  let nativeQueueSignature = '', nativeQueueOwned = false, nativeCatalogReferences = false, nativeProfileExport = false, nativeQueuePositions = [], nativePitchSupported = false, nativeRateRevision = 1, nativeRateKey = '', nativeRateState = 'pending';
  const catalogAliases = new Map();
  let rate = Number.isFinite(saved.rate) && saved.rate >= 0.5 && saved.rate <= 2 ? saved.rate : 1;
  let preservesPitch = saved.preservesPitch === true;
  let sleepDeadline = Number.isFinite(saved.sleepDeadline) && saved.sleepDeadline > 0 && saved.sleepDeadline <= Date.now() + 86400000 ? saved.sleepDeadline : 0, sleepInterval;
  const bookmarks = new Map();
  if (saved.bookmarks && typeof saved.bookmarks === 'object') { let remaining = 2000; for (const [id, rows] of Object.entries(saved.bookmarks).slice(0, 2000)) if (C.trackID(id) && Array.isArray(rows)) { const valid = rows.filter(row => row && Number.isFinite(row.position) && row.position >= 0 && row.position <= 86400 && Number.isFinite(row.createdAt)).slice(0, remaining).map(row => ({ position: row.position, createdAt: row.createdAt })); if (valid.length) bookmarks.set(id, valid); remaining -= valid.length; } }
  let importingAudio = false, nativeImportCount = 0, nativeImportErrors = 0;
  const audio = $('audio');
  const webPitchProperties = ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch'].filter(name => name in audio);
  let webPitchApplied = false;
  applyWebPitch();
  effectsController = window.LolzCloudEffects.createController({ audio, native, sendNative,
    intent: () => ({ clientId: nativeClientId, requestId: nativeRequestId }),
    preservesPitch: () => preservesPitch, wantedPlayback: () => phase === 'playing' || phase === 'loading', onState: renderEffects,
    onInterrupted: () => { if (!native && loaded && !audio.paused && ['playing', 'loading'].includes(phase)) { phase = 'blocked'; playerError = 'Звук прерван. Нажми Play, чтобы продолжить.'; audio.pause(); renderPlayback(); persist(); } },
  });
  const portableController = window.LolzCloudProfile.create({ read: portableState, apply: applyPortable, lookup: lookupCatalog, onState: renderPortable });
  let portableFile, portableJSON = '', portableOperation = '', portableUndo = false, portableOpener, portableHistory = false;
  const cloud = window.LolzCloudProfileCloud.create({ owner: () => account?.id, crypto: window.LolzCloudProfileCrypto });
  let cloudSnapshot = null, cloudBusy = false, cloudController, cloudEpoch = 0, cloudMessage = '';
  const node = (tag, text, className) => { const result = document.createElement(tag); if (text != null) result.textContent = text; if (className) result.className = className; return result; };
  const button = (label, handler, className = '') => { const result = node('button', label, className); result.type = 'button'; result.onclick = () => { try { Promise.resolve(handler()).catch(noticeError); } catch (error) { noticeError(error); } }; return result; };
  let waveActive = false, waveResults = [], waveSession = 0, waveRefilling = false, waveWarmAt = 0, waveRowsSignature = '', waveAwaitNext = null;
  const wave = window.LolzCloudWave.create({ origin, read: () => ({ current, queue, liked: [...liked] }), readWave: () => portableController.waveState(), writeWave: patch => { portableController.updateWave(patch); portableFile = null; }, onState: renderWave });
  function renderWave(state = wave.snapshot()) {
    waveResults = state.tracks; const taste = wave.taste(), busy = state.phase === 'loading';
    $('wave-status').textContent = state.message; $('wave-status').dataset.error = String(state.phase === 'error'); $('wave-start').disabled = false; $('wave-start').textContent = busy ? 'Подобрать заново' : 'Включить волну'; $('wave-stop').hidden = !busy; $('wave-retry').hidden = state.phase !== 'error'; $('wave-more').hidden = !waveResults.length; $('wave-more').disabled = busy; $('wave-seed').hidden = !window.LolzCloudWave.track(current);
    $('wave-context-label').textContent = [state.context, state.request?.text ? 'По запросу: ' + state.request.text : '', state.request?.note || ''].filter(Boolean).join(' · ');
    for (const key of Object.keys(window.LolzCloudWave.OPTIONS)) if (document.activeElement !== $('wave-' + key)) $('wave-' + key).value = taste.preferences[key];
    if (document.activeElement !== $('wave-genre')) $('wave-genre').value = taste.preferences.genre; if (document.activeElement !== $('wave-novelty')) $('wave-novelty').value = Math.round(taste.adventurous * 100); $('wave-novelty-value').textContent = Math.round(taste.adventurous * 100) + '%'; $('wave-context').checked = taste.preferences.autoContext; $('wave-novelty').disabled = taste.preferences.character === 'familiar'; $('wave-novelty-hint').textContent = taste.preferences.character === 'familiar' ? 'В режиме «Любимое» выбираем знакомые песни. Баланс новизны сохраним для других режимов.' : 'На 100% — только ещё не знакомые тебе записи.';
    $('wave-current').hidden = !waveActive || !current; if (waveActive && current) { $('wave-current-title').textContent = current.title; $('wave-current-artist').textContent = current.artist; $('wave-love').setAttribute('aria-pressed', String(liked.has(canonicalID(current.id)))); $('wave-love').textContent = liked.has(canonicalID(current.id)) ? 'В любимом' : 'Нравится'; $('wave-ban-artist').hidden = !current.artist; } renderWavePlayback();
    const signature = JSON.stringify([waveResults, current?.id]); if (waveRowsSignature !== signature) { waveRowsSignature = signature; $('wave-results').replaceChildren(...waveResults.map((track, i) => { const row = trackRow(track, waveResults, i); if (track.reason) row.querySelector('.track-meta small').append(document.createTextNode(' · ' + track.reason)); return row; })); }
    $('wave-blocked').replaceChildren(...taste.blockedArtists.map(name => { const row = node('div', null, 'bookmark-row'); row.append(node('span', name), button('Вернуть', () => wave.unblock(name), 'text-button')); return row; }));
  }
  function leaveWave() { waveActive = false; waveSession++; wave.cancel(); waveRefilling = false; waveAwaitNext = null; renderWave(); }
  async function startWave(fromCurrent = false) {
    const token = ++waveSession, intent = playVersion, seed = fromCurrent ? current : null; waveActive = false; waveRefilling = false; waveWarmAt = 0; waveAwaitNext = null;
    if (!native && !loaded) { effectsController.prime(); primeAudio(); }
    if (fromCurrent) $('wave-prompt').value = '';
    const tracks = await wave.request({ seed, query: $('wave-prompt').value });
    if (token !== waveSession || intent !== playVersion || !tracks?.length) return;
    waveActive = true; queue = tracks; history = []; repeat = 'off'; shuffle = false; void playAt(0); renderWave();
  }
  async function moreWave({ advance = false, automatic = false } = {}) {
    if (advance) waveAwaitNext = { session: waveSession, intent: playVersion, id: current?.id, automatic };
    if (waveRefilling) return; const token = waveSession, targetQueue = queue; waveRefilling = true; waveWarmAt = Date.now() + 30000;
    try { const tracks = await wave.request({ append: true }); if (token !== waveSession || !tracks?.length) return; if (waveActive && queue === targetQueue) { const before = new Set(queue.map(row => row.id)), added = tracks.filter(row => !before.has(row.id)); const trim = Math.min(Math.max(0, queue.length + added.length - 200), Math.max(0, index)); if (trim) { queue.splice(0, trim); index -= trim; history = []; } queue.push(...added.slice(0, 200 - queue.length)); renderQueue(); persist(); const pending = waveAwaitNext; if (pending?.session === waveSession && pending.intent === playVersion && current?.id === pending.id && queue[index + 1]) { waveAwaitNext = null; void playAt(index + 1, { automatic: pending.automatic }); } } }
    finally { if (token === waveSession) waveRefilling = false; }
  }
  function observeWave() { if (current) wave.observe(current, { phase, position: elapsed }); if (waveActive && phase === 'playing' && queue.length - index <= 5 && !waveRefilling && wave.snapshot().phase !== 'loading' && Date.now() >= waveWarmAt) void moreWave(); }
  function renderWavePlayback() { $('wave-current-state').textContent = waveActive ? playerError || (phase === 'loading' ? 'Готовим аудио…' : phase === 'paused' ? 'На паузе' : '') : ''; $('wave-current-state').dataset.error = String(phase === 'error'); $('wave-retry-play').hidden = !waveActive || !['error', 'blocked'].includes(phase); }
  function pruneWaveQueue() { const taste = wave.taste(), blocked = new Set(taste.blockedArtists.map(value => value.normalize('NFKC').toLowerCase().trim())); for (let i = queue.length - 1; i > index; i--) if (taste.feedback[queue[i].url]?.banned || blocked.has(queue[i].artist.normalize('NFKC').toLowerCase().trim())) queue.splice(i, 1); renderQueue(); persist(); }
  function notice(text) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = !text; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
  function noticeError(error) { notice(error instanceof Error ? error.message : String(error || 'Не удалось выполнить действие.')); }
  function portableState() { return structuredClone({ liked: [...liked], bookmarks: Object.fromEntries(bookmarks), effects: effectsController.snapshot().config, rate, preservesPitch, tracks: [...collection.values(), ...offline.values(), ...queue], collection: [...collection.values()] }); }
  function applyPortable(next) {
    const replacement = next.restore ? new Map((next.collection || []).map(row => { const item = C.savedTrack(row, origin); return item ? [item.id, item] : null; }).filter(Boolean)) : new Map(collection), aliases = new Map();
    for (const raw of next.refs || []) { const ref = C.referenceTrack(raw); if (!ref) continue; const existing = [...replacement.values()].find(row => row.url === ref.url && !C.referenceTrack(row)); if (existing) aliases.set(ref.id, existing.id); else if (!replacement.has(ref.id)) replacement.set(ref.id, ref); }
    const targetLiked = new Set((next.liked || []).filter(C.trackID).map(id => aliases.get(id) || id)), targetMoments = new Map();
    for (const [rawID, rows] of Object.entries(next.bookmarks || {})) { const id = aliases.get(rawID) || rawID; if (!C.trackID(id) || !Array.isArray(rows)) continue; const valid = rows.filter(row => row && Number.isFinite(row.position) && row.position >= 0 && row.position <= 86400 && Number.isFinite(row.createdAt)).map(row => ({ position: row.position, createdAt: row.createdAt })), merged = targetMoments.get(id) || []; for (const row of valid) if (!merged.some(mark => Math.abs(mark.position - row.position) < .01)) merged.push(row); if (merged.length) targetMoments.set(id, merged); }
    const settings = next.effects ? window.LolzCloudEffectsPolicy.validate(next.effects) : null, nextRate = next.rate === undefined ? rate : Number(next.rate); if (!Number.isFinite(nextRate) || nextRate < .5 || nextRate > 2) throw Error('В профиле неверная скорость воспроизведения.');
    const nextPitch = next.preservesPitch === undefined ? preservesPitch : next.preservesPitch; if (typeof nextPitch !== 'boolean') throw Error('В профиле неверный параметр высоты звука.');
    const oldApp = localStorage.getItem('LolzCloud-app-v1'), oldEffects = localStorage.getItem('LolzCloud-effects-v1'); clearTimeout(persistTimer);
    try { localStorage.setItem('LolzCloud-app-v1', JSON.stringify({ ...savedState(), liked: [...targetLiked], bookmarks: Object.fromEntries(targetMoments), collection: [...replacement.values()].slice(-500), rate: nextRate, preservesPitch: nextPitch })); if (settings) localStorage.setItem('LolzCloud-effects-v1', JSON.stringify(settings)); }
    catch (error) { try { if (oldApp === null) localStorage.removeItem('LolzCloud-app-v1'); else localStorage.setItem('LolzCloud-app-v1', oldApp); if (oldEffects === null) localStorage.removeItem('LolzCloud-effects-v1'); else localStorage.setItem('LolzCloud-effects-v1', oldEffects); } catch {} throw Error('Не хватает места для переноса. Текущие данные сохранены; освободи место и повтори.'); }
    liked = targetLiked; bookmarks.clear(); for (const [id, rows] of targetMoments) bookmarks.set(id, rows); collection = replacement;
    const pitchChanged = nextPitch !== preservesPitch; if (pitchChanged) setPreservesPitch(nextPitch, { syncEffects: false }); if (settings) void effectsController.configure(settings).catch(noticeError); else if (pitchChanged) void effectsController.transport().catch(noticeError); if (nextRate !== rate) setRate(nextRate);
    renderLike(); renderBookmarks(); renderLibrary(); renderComfort(); renderWave();
  }
  async function lookupCatalog(row, signal) {
    const url = C.sourceURL(row.url), numeric = /^[1-9][0-9]{0,15}$/.test(row.id), endpoint = numeric ? '/music/track/' + row.id : url ? '/music/search?q=' + encodeURIComponent(url) + '&offset=0' : '';
    const cached = [...offline.values(), ...collection.values()].find(value => C.track(value, origin) && C.sourceURL(value.url) && (numeric ? value.id === row.id : url && value.url === url)); if (cached) return cached;
    if (!endpoint) throw Error('У песни нет переносимой ссылки SoundCloud. Найди её ещё раз.');
    const { body } = await json(endpoint, { signal, limit: 256 * 1024 }); let result;
    if (numeric) result = C.track(body.track, origin); else result = C.page(body, origin).tracks.find(track => track.url === url);
    if (!result || !result.url || numeric && result.id !== row.id || !numeric && url && result.url !== url) throw Error('Не удалось подтвердить эту песню. Найди её в поиске ещё раз.');
    portableController.remember(result); return result;
  }
  function canonicalID(id) { const seen = new Set(); while (catalogAliases.has(id) && !seen.has(id)) { seen.add(id); id = catalogAliases.get(id); } return id; }
  function adoptCatalog(previous, resolved, { selected = false } = {}) {
    const numeric = /^[1-9][0-9]{0,15}$/.test(previous.id); if (!C.track(resolved, origin) || !numeric && C.sourceURL(previous.url) && previous.url !== resolved.url || numeric && previous.id !== resolved.id) return false;
    const oldID = previous.id, id = resolved.id; if (oldID !== id) { catalogAliases.set(oldID, id); if (liked.delete(oldID)) liked.add(id); const merged = bookmarks.get(id) || []; for (const row of bookmarks.get(oldID) || []) if (!merged.some(mark => Math.abs(mark.position - row.position) < .01)) merged.push(row); if (merged.length) bookmarks.set(id, merged); bookmarks.delete(oldID); collection.delete(oldID); }
    collection.set(id, resolved); portableController.alias(previous, resolved);
    if (selected) { const expectedURL = C.sourceURL(previous.url); queue = queue.map(row => row.id === oldID && (!expectedURL || row.url === expectedURL) ? resolved : row); current = queue[index] || current; }
    persist(); renderLibrary(); renderLike(); renderBookmarks(); return true;
  }
  function renderPortable(state = portableController.snapshot()) {
    const busy = cloudBusy || ['reading', 'exporting', 'importing'].includes(state.phase); $('portable-status').textContent = cloudMessage || state.message; $('portable-import').disabled = $('portable-export').disabled = busy; $('portable-export').textContent = portableFile ? 'Сохранить файл профиля' : 'Подготовить файл профиля';
    $('portable-preview').hidden = !state.preview && !portableUndo; $('portable-cancel').hidden = !busy && !state.preview && !portableUndo; $('portable-undo').hidden = !state.backup || busy;
    $('portable-settings-label').hidden = portableUndo; $('portable-settings-note').hidden = portableUndo; $('portable-apply').disabled = busy;
    $('portable-apply').textContent = portableUndo ? 'Вернуть данные' : $('portable-settings').checked ? 'Добавить и применить настройки' : 'Добавить любимое и моменты';
    $('portable-summary').textContent = portableUndo ? 'Вернуть любимое, моменты и настройки до последнего импорта? Текущая песня и очередь сохранятся.' : state.preview ? 'Любимых: ' + state.preview.likes + ' · моментов: ' + state.preview.bookmarks + '. Перед переносом сохраним резервную копию на устройстве.' : '';
    $('cloud-read').disabled = $('cloud-save').disabled = busy || !account || !cloud.supported(); $('cloud-password').disabled = busy || !account || !cloud.supported(); $('cloud-replace-label').hidden = !cloudSnapshot || cloudSnapshot.empty || !cloud.current(cloudSnapshot);
    $('cloud-account-note').textContent = !account ? 'Для облака войди в аккаунт. Файлом можно пользоваться без входа.' : !cloud.supported() ? 'В этом браузере шифрование недоступно. Перенеси профиль файлом.' : cloudSnapshot && cloud.current(cloudSnapshot) ? cloudSnapshot.empty ? 'В аккаунте пока нет облачной копии.' : 'Открыта копия от ' + new Date(cloudSnapshot.updatedAt).toLocaleString('ru') + '.' : 'Копия привязана к твоему аккаунту LolzCloud.';
    if (state.phase === 'ready') renderLibrary();
  }
  function portableError(error) { if (error?.name !== 'AbortError') { cloudMessage = ''; portableController.fail(error); } }
  function cancelCloud() { cloudEpoch++; cloudController?.abort(); cloudController = null; cloud.cancel(); cloudBusy = false; cloudSnapshot = null; cloudMessage = ''; $('cloud-password').value = ''; $('cloud-replace').checked = false; }
  function updateAccount(value) { if (account?.id !== value?.id) { const hadCloud = cloudBusy || !!cloudSnapshot; cancelCloud(); if (hadCloud) portableController.cancel(); } account = value; renderPortable(); }
  async function transferCloud(action) {
    if (cloudBusy) return;
    if (action === 'save' && cloudSnapshot && !cloudSnapshot.empty && cloud.current(cloudSnapshot) && !$('cloud-replace').checked) { cloudMessage = 'Подтверди замену открытой копии. Если хочешь оставить её, закрой перенос.'; renderPortable(); $('cloud-replace').focus(); return; }
    const password = $('cloud-password').value; $('cloud-password').value = '';
    if (password.length < 10 || password.length > 256) { portableError(Error('Нужна парольная фраза от 10 до 256 символов.')); $('cloud-password').focus(); return; }
    const token = ++cloudEpoch, owner = new AbortController(); cloudController = owner; cloudBusy = true; portableFile = null; cloudMessage = action === 'read' ? 'Открываем защищённую копию…' : 'Шифруем и сохраняем копию…'; renderPortable();
    const options = { signal: owner.signal, onProgress: value => { if (token !== cloudEpoch) return; cloudMessage = (action === 'read' ? 'Открываем копию: ' : 'Шифруем копию: ') + Math.round(value * 100) + '%'; renderPortable(); } };
    try {
      if (action === 'read') { const snapshot = await cloud.read(password, options); if (token !== cloudEpoch || !cloud.current(snapshot)) return; cloudSnapshot = snapshot; portableUndo = false; $('portable-settings').checked = false; $('cloud-replace').checked = false; cloudMessage = ''; if (snapshot.empty) { portableController.cancel(); cloudMessage = 'В облаке пока нет копии. Можно сохранить текущий профиль.'; } else portableController.stage(snapshot.profile); }
      else { const profile = await portableController.exportProfile(); if (token !== cloudEpoch || owner.signal.aborted) return; const snapshot = await cloud.push(profile, password, { ...options, overwrite: cloudSnapshot }); if (token !== cloudEpoch || !cloud.current(snapshot)) return; cloudSnapshot = snapshot; $('cloud-replace').checked = false; cloudMessage = 'Зашифрованная копия сохранена. Для открытия на другом устройстве нужна та же парольная фраза.'; }
    } catch (error) { if (token === cloudEpoch) portableError(error); }
    finally { if (token === cloudEpoch) { cloudBusy = false; cloudController = null; renderPortable(); } }
  }
  async function applyPortablePreview() {
    portableFile = null;
    try { if (portableUndo) { await portableController.undo(); portableUndo = false; renderPortable(); } else if (cloudSnapshot && !cloudSnapshot.empty) { const snapshot = cloudSnapshot, token = cloudEpoch, owner = new AbortController(); cloudController = owner; cloudBusy = true; cloudMessage = 'Проверяем актуальность копии…'; renderPortable(); try { const profile = await cloud.validate(snapshot, { signal: owner.signal }); if (token !== cloudEpoch || !cloud.current(snapshot)) return; portableController.stage(profile); cloudMessage = ''; await portableController.merge({ settings: $('portable-settings').checked, guard: () => token === cloudEpoch && cloud.current(snapshot) }); } finally { if (token === cloudEpoch) { cloudBusy = false; cloudController = null; renderPortable(); } } } else await portableController.merge({ settings: $('portable-settings').checked }); } catch (error) { portableError(error); }
  }
  async function savePortable() {
    cloudMessage = '';
    if (!portableFile) { try { const value = await portableController.exportProfile(); portableJSON = JSON.stringify(value); portableFile = new File([portableJSON], 'LolzCloud-profile-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' }); if (portableFile.size > window.LolzCloudProfilePolicy.MAX_BYTES) { portableFile = null; throw Error('Профиль больше 750 КБ. Уменьши список для переноса.'); } renderPortable(); } catch (error) { portableError(error); } return; }
    try { if (native && nativeProfileExport) { portableOperation = crypto.randomUUID().toLowerCase(); sendNative('exportProfile', { filename: portableFile.name, json: portableJSON, operationId: portableOperation }); } else if (navigator.canShare?.({ files: [portableFile] })) await navigator.share({ files: [portableFile], title: 'Профиль LolzCloud' }); else if (native) throw Error('Для сохранения файла обнови iOS-клиент или открой LolzCloud в Safari.'); else { const url = URL.createObjectURL(portableFile), link = node('a'); link.href = url; link.download = portableFile.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); } } catch (error) { portableError(error); }
  }
  function learnNativeCapabilities(value) { if (!native || !currentNativeIntent(value)) return; effectsController.capabilities(value); if (value.roomTransport === 1 && !nativeRoomSupported) { nativeRoomSupported = true; if (activeRoom) queueMicrotask(() => { if (activeRoom) sendNative('roomOwner', activeRoom); }); } if (value.profileExport === 1) nativeProfileExport = true; if (value.preservesPitch === 1 && !nativePitchSupported) { nativePitchSupported = true; queueMicrotask(() => { syncNativeRate(); renderComfort(); }); } if (value.catalogReferences === 1 && !nativeCatalogReferences) { nativeCatalogReferences = true; nativeQueueSignature = ''; queueMicrotask(syncNativeQueue); } }
  function savedState() { return { queue, index, shuffle, repeat, liked: [...liked], collection: [...collection.values()].slice(-500), position: elapsed, rate, preservesPitch, sleepDeadline, bookmarks: Object.fromEntries(bookmarks) }; }
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
      const response = await fetch(url, { ...options, credentials: options.credentials ?? 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...options.headers } });
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || +(response.headers.get('content-length') || 0) > limit) throw new Error('Сервис вернул неверный ответ. Попробуй ещё раз.');
      const reader = response.body.getReader(), parts = []; let bytes = 0;
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error('Ответ сервиса слишком большой.'); } parts.push(part.value); }
      const text = await new Blob(parts).text();
      let body; try { body = JSON.parse(text); } catch { throw new Error('Не удалось прочитать ответ сервиса.'); }
      if (!response.ok && response.status !== 202) { const error = new Error(typeof body.error === 'string' ? body.error.slice(0, 300) : 'Сервис временно недоступен (HTTP ' + response.status + ').'); error.status = response.status; const retry = response.headers.get('retry-after'); if (response.status === 429 && retry) { const delay = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now(); if (Number.isFinite(delay) && delay > 0) error.retryAfterMs = delay; } throw error; }
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
    const row = node('article', null, 'track-row'); row.dataset.trackId = track.id; row.dataset.current = String(queueRow ? position === index : current?.id === track.id);
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
    const importedCollections = new Set(portableController.collections().map(row => row.url)), knownURLs = new Set([...combined.values()].map(row => row.url).filter(Boolean));
    for (const ref of portableController.refs()) if (!combined.has(ref.id) && (liked.has(canonicalID(ref.id)) || bookmarks.has(canonicalID(ref.id)) || importedCollections.has(ref.url)) && !knownURLs.has(ref.url)) { combined.set(ref.id, ref); knownURLs.add(ref.url); }
    return [...combined.values()].reverse().filter(track => libraryFilter !== 'liked' || liked.has(track.id)).filter(track => libraryFilter !== 'offline' || offline.has(track.id)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
  function renderLibrary() {
    const tracks = libraryTracks(); $('library-results').replaceChildren(...tracks.slice(0, libraryVisible).map((track, i) => trackRow(track, tracks, i))); $('library-more').hidden = tracks.length <= libraryVisible;
    if (!tracks.length) {
      const empty = node('div', null, 'empty-state'); empty.append(node('h2', libraryFilter === 'offline' ? 'Музыка без сети' : libraryFilter === 'liked' ? 'Твои любимые' : 'Собери свою коллекцию'), node('p', libraryFilter === 'offline' ? 'Открой действия с треком и сохрани его на устройство.' : 'Нажми на три точки рядом с треком, чтобы добавить его в любимое или сохранить.'));
      $('library-results').append(empty);
    }
    const bytes = [...offline.values()].reduce((sum, track) => sum + (track.bytes || 0), 0);
    $('storage-status').textContent = offline.size ? 'На устройстве: ' + offline.size + (native ? ' треков' : ' · ' + (bytes / 1024 / 1024).toFixed(1) + ' МБ из 256 МБ') : '';
  }
  async function refreshOffline() {
    if (native) { sendNative('downloads'); return; }
    try { const rows = await DB.list(); offline = new Map(rows.map(row => { const item = C.savedTrack(row, origin); return item ? [item.id, { ...item, bytes: row.bytes, savedAt: Number.isFinite(row.savedAt) ? row.savedAt : 0 }] : null; }).filter(Boolean)); renderLibrary(); renderDownload(); renderPlayback(); }
    catch (error) { $('storage-status').textContent = error.message; }
  }
  function toggleLike(track) {
    if (!track) return;
    const id = canonicalID(track.id); if (liked.has(id)) liked.delete(id); else { liked.add(id); collection.set(track.id, track); }
    if (!liked.has(id) && !offline.has(id) && !bookmarks.get(id)?.length) collection.delete(id);
    persist(); renderLibrary(); renderLike(); renderWave(); if (actionTrack?.id === track.id) renderActions();
  }
  function renderLike() { const active = !!current && liked.has(canonicalID(current.id)); $('player-like').textContent = active ? '♥' : '♡'; $('player-like').setAttribute('aria-pressed', String(active)); $('player-like').setAttribute('aria-label', active ? 'Убрать из любимого' : 'Добавить в любимое'); }
  function enqueue(track) { if (queue.length >= 200) return notice('В очереди уже 200 треков. Убери несколько.'); queue.push(track); persist(); renderQueue(); notice('Добавлено в очередь'); }
  function syncNativeQueue() {
    if (!native) return;
    const positions = queue.map((track, i) => nativeCatalogReferences || !C.referenceTrack(track) ? i : -1).filter(i => i >= 0), value = { tracks: positions.map(i => queue[i]), index: positions.indexOf(index), repeat, shuffle }, signature = JSON.stringify({ ...value, positions, clientId: nativeClientId, requestId: nativeRequestId }); nativeQueuePositions = positions;
    if (signature === nativeQueueSignature) return;
    const handshake = nativeHandshake; nativeHandshake = false;
    nativeQueueSignature = signature; sendNative('queue', handshake ? { ...value, handshake: true } : value);
  }
  function renderQueue() { $('queue-count').textContent = queue.length; $('queue-list').replaceChildren(...queue.map((track, i) => trackRow(track, queue, i, true))); $('queue-clear').disabled = !queue.length; syncNativeQueue(); }
  function removeQueue(position) { if (position === index) return; queue.splice(position, 1); if (position < index) index--; history = []; persist(); renderQueue(); }
  function playFrom(track, source, position) {
    if (source === queue) { playAt(position); return; }
    if (source === waveResults) { wave.cancel(); waveSession++; waveActive = true; waveWarmAt = 0; } else leaveWave();
    const selected = Number.isInteger(position) && source[position]?.id === track.id ? position : source.indexOf(track);
    if (selected < 0) { notice('Эта запись больше недоступна в списке. Выбери песню ещё раз.'); return; }
    // Keep the chosen occurrence and its neighbours when a list exceeds the
    // bounded queue. A contiguous window preserves next/previous source order.
    const start = Math.max(0, Math.min(selected - 100, source.length - 200));
    queue = source.slice(start, start + 200); history = []; playAt(selected - start);
  }
  function clearRoomOwner(expected = activeRoom) {
    if (!expected || RT.owner(expected) !== RT.owner(activeRoom)) return;
    activeRoom = null; roomAudible = false;
    for (const [id, command] of roomCommands) { clearTimeout(command.timer); roomCommands.delete(id); }
    if (native && nativeRoomSupported) sendNative('roomOwner', { ...expected, active: false, revision: expected.revision + (expected.active ? 1 : 0), playback: { ...expected.playback, playing: false } });
    mediaMetadataKey = ''; updateMediaSession();
  }
  function pauseRoom() {
    const expected = activeRoom, frame = $('rooms-frame');
    try { if (expected) frame.contentWindow?.LolzCloudRoomTransport?.release(expected); } catch { /* Navigation can replace the document during a handoff. */ }
    clearRoomOwner(expected); roomAudible = false;
    frame.contentWindow?.postMessage({ type: 'lolzcloud:app-audio', action: 'pause' }, origin);
  }
  function roomCommand(command, value, nativeValue) {
    const transport = activeRoom, frame = $('rooms-frame');
    if (!transport) return false;
    const id = nativeValue?.id || crypto.randomUUID().toLowerCase();
    const finish = (ok, error = '') => { if (nativeValue && native && nativeRoomSupported) sendNative('roomCommandResult', { ...transport, id, ok, error: error.slice(0, 300) }); else if (!ok && error) notice(error); };
    if (!transport.capabilities[command] || roomCommands.size >= 8) { finish(false, 'Эта команда сейчас недоступна в комнате.'); return true; }
    const timer = setTimeout(() => { const pending = roomCommands.get(id); if (!pending) return; roomCommands.delete(id); pending.finish(false, 'Комната не ответила. Открой её и повтори команду.'); }, 2500);
    roomCommands.set(id, { transport, finish, timer });
    frame.contentWindow?.postMessage({ type: 'lolzcloud:room-command', roomId: transport.roomId, documentId: transport.documentId, epoch: transport.epoch, id, command, ...(Number.isFinite(value) ? { value } : {}) }, origin);
    return true;
  }
  function systemCommand(command, value) {
    if (roomCommand(command, value) || !systemSoloAllowed) return;
    if (command === 'play') resume(); else if (command === 'pause') pause();
    else if (command === 'next') next(); else if (command === 'previous') previous(); else if (command === 'seek') seek(value);
  }
  function receiveRoomTransport(input) {
    const transport = RT.snapshot(input), frame = $('rooms-frame');
    if (!transport) return;
    let identity, live;
    try { const api = frame.contentWindow?.LolzCloudRoomTransport; identity = api?.identity; live = RT.snapshot(api?.snapshot()); if (!C.roomURL(frame.contentWindow.location.href, origin)) return; } catch { return; }
    if (identity?.documentId !== transport.documentId || identity.roomId !== transport.roomId) return;
    if (!live || RT.owner(live) !== RT.owner(transport) || transport.revision < live.revision || transport.active && !live.active) return;
    if (roomDocument === transport.documentId && transport.revision <= roomRevision) return;
    if (roomDocument !== transport.documentId) { clearRoomOwner(); roomDocument = transport.documentId; roomRevision = 0; }
    roomRevision = transport.revision;
    updateRoomLyrics(transport);
    if (!transport.active) { if (RT.owner(transport) === RT.owner(activeRoom)) clearRoomOwner(transport); return; }
    if (activeRoom && activeRoom.documentId === transport.documentId && transport.epoch < activeRoom.epoch) return;
    if (RT.owner(activeRoom) !== RT.owner(transport)) { systemSoloAllowed = false; pause(); clearRoomOwner(); }
    activeRoom = transport; roomAudible = true;
    if (native && nativeRoomSupported) sendNative('roomOwner', transport);
    updateMediaSession();
  }
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
    let track = queue[position]; if (!track) return;
    pauseRoom(); systemSoloAllowed = true; beginNativeIntent();
    const previousIndex = index; preparationController?.abort(); preparationController = new AbortController(); const signal = preparationController.signal, token = ++playVersion;
    if (remember && previousIndex >= 0 && previousIndex !== position) history.push(previousIndex);
    if (history.length > 200) history.shift();
    index = position; current = track; phase = 'loading'; playerError = ''; elapsed = seek; duration = track.duration; loaded = false;
    wave.begin(track, seek);
    effectsController.track(track.id);
    if (native) sendNative('stop'); else { stopSource(); effectsController.prime(); if (!automatic) primeAudio(); }
    renderPlayer(); renderQueue(); renderSearch(); renderLibrary(); persist();
    if ($('tab-lyrics').getAttribute('aria-selected') === 'true') void loadLyrics();
    try {
      if (C.referenceTrack(track)) { const previous = track, resolved = await lookupCatalog(track, signal); if (token !== playVersion || signal.aborted || queue[position]?.id !== previous.id || queue[position]?.url !== previous.url) return; adoptCatalog(previous, resolved, { selected: true }); track = queue[position]; duration = track.duration; effectsController.track(track.id); renderPlayer(); renderQueue(); }
      let source;
      if (native && (track.local || offline.has(track.id))) { if (track.local && !offline.has(track.id)) throw new Error('Локальный файл не найден. Добавь его заново в «Моя музыка».'); source = track.local ? 'native-local' : track.audioUrl; }
      else if (!native) { const stored = await DB.get(track.id).catch(() => null); if (token !== playVersion) return; if (stored?.blob instanceof Blob) source = activeBlobURL = URL.createObjectURL(stored.blob); }
      if (track.local && !source) throw new Error('Локальный файл не найден. Добавь его заново в «Моя музыка».');
      if (!source) { await prepare(track, signal); source = track.audioUrl; }
      if (token !== playVersion || signal.aborted) return;
      loaded = true;
      if (native) sendNative('play', { ...track, position: seek, queueIndex: nativeQueuePositions.indexOf(index) });
      else {
        audio.src = source; audio.load();
        audio.defaultPlaybackRate = audio.playbackRate = rate;
        applyWebPitch();
        if (seek > 0) audio.addEventListener('loadedmetadata', () => { if (token === playVersion) audio.currentTime = Math.min(seek, Math.max(0, audio.duration - 0.1)); }, { once: true });
        await effectsController.beforePlay();
        if (token !== playVersion || signal.aborted) return;
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
    wave.cancel(); waveSession++; waveRefilling = false; waveAwaitNext = null;
    beginNativeIntent();
    ++playVersion; preparationController?.abort(); phase = 'paused';
    if (native) sendNative('pause'); else audio.pause(); renderPlayback(); persist();
  }
  function resume() {
    if (!current) { if (queue.length) void playAt(0); return; }
    pauseRoom(); systemSoloAllowed = true;
    if (!loaded || phase === 'error' || phase === 'ended') { void playAt(index, { seek: phase === 'ended' ? 0 : elapsed, remember: false }); return; }
    beginNativeIntent();
    playerError = ''; phase = 'loading'; renderPlayback();
    if (native) sendNative('resume');
    else { const token = playVersion; effectsController.prime(); effectsController.beforePlay().then(() => { if (token === playVersion) return audio.play(); }).then(() => { if (token !== playVersion) return; phase = 'playing'; renderPlayback(); }).catch(error => { if (token !== playVersion) return; phase = 'blocked'; playerError = error.name === 'NotAllowedError' ? 'Нажми Play ещё раз, чтобы разрешить звук.' : 'Не удалось включить запись. Нажми «Повторить».'; renderPlayback(); }); }
  }
  function togglePlayback() { if (phase === 'playing' || phase === 'loading') pause(); else resume(); }
  function renderEffects(value = effectsController.snapshot()) {
    const cap = value.capabilities, config = value.config;
    $('effects-enabled').checked = config.enabled; $('effects-enabled').disabled = !cap.eq;
    $('effects-retry').hidden = native || value.state !== 'unsupported' || (!cap.eq && !cap.pitch) || !config.enabled && (!preservesPitch || config.pitch === 1);
    const db = n => (n > 0 ? '+' : '') + n + ' дБ';
    for (let i = 0; i < 5; i++) { const input = $('effects-gain-' + i); if (document.activeElement !== input) input.value = config.gains[i]; input.disabled = !cap.eq; input.setAttribute('aria-valuetext', db(config.gains[i])); $('effects-gain-' + i + '-value').textContent = db(config.gains[i]); }
    for (const [key, id, scale] of [['preampDb', 'preamp', 1], ['reverb', 'reverb', 100], ['echo', 'echo', 100]]) { const input = $('effects-' + id), amount = Math.round(config[key] * scale); if (document.activeElement !== input) input.value = amount; input.disabled = !cap[id]; $('effects-' + id + '-value').textContent = scale === 1 ? db(amount) : amount + '%'; }
    $('effects-normalization').checked = config.normalization; $('effects-normalization').disabled = !cap.normalization;
    for (const section of document.querySelectorAll('[data-effects-cap]')) section.hidden = native && !cap[section.dataset.effectsCap];
    const presets = $('effects-preset'), options = Object.entries(window.LolzCloudEffectsPolicy.PRESETS).filter(([key]) => !native || !(['lofi', 'reverb'].includes(key) && !cap.reverb || key === 'echo' && !cap.echo)), signature = options.map(([key]) => key).join(',');
    if (presets.dataset.options !== signature) { presets.replaceChildren(...options.map(([key, row]) => { const option = document.createElement('option'); option.value = key; option.textContent = row.label; return option; })); const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Свои настройки'; custom.disabled = true; presets.append(custom); presets.dataset.options = signature; }
    presets.value = window.LolzCloudEffectsPolicy.selectedPreset(config, native && value.effectsSchema < 2); presets.disabled = !cap.eq;
    let text = value.error || ({ bypassed: 'Обработка выключена. Исходный звук.', pending: 'Настройки применятся при воспроизведении.', applied: 'Обработка применяется к этому треку.', interrupted: 'Звук прерван. Нажми Play, чтобы продолжить.', unsupported: 'Обработка звука здесь недоступна.' })[value.state] || '';
    if (roomAudible) text += ' Настройки относятся к твоему плееру; звук комнаты остаётся общим.';
    if (native && value.effectsSchema < 2 && (config.echo || config.reverb || config.normalization)) text += ' Дополнительные эффекты сохранены для поддерживающего клиента.';
    if ($('effects-status').textContent !== text) $('effects-status').textContent = text;
    if (effectsController) renderComfort();
    const meter = value.normalization; $('effects-normalization-status').textContent = !config.normalization ? 'Для музыки в твоём плеере. Защита от пиков включается вместе с обработкой.' : meter?.measured ? 'Коррекция: ' + db(Math.round(meter.gainDb * 10) / 10) + '. Измерение продолжается во время музыки.' : 'Оцениваем громкость. Первые несколько секунд играют без коррекции.';
  }
  function configureEffects(patch) { portableController.editedSound(patch); portableFile = null; void effectsController.configure(patch).catch(noticeError); }
  let effectsOpener, effectsFromHistory = false;
  function openEffects(opener) { if ($('effects-dialog').open) return; effectsOpener = opener || document.activeElement; renderEffects(); $('effects-dialog').showModal(); window.history.pushState({ ...window.history.state, lolzcloudEffects: true }, '', location.href); }
  function closeEffects(fromHistory = false) { if (!$('effects-dialog').open) return; effectsFromHistory = fromHistory; $('effects-dialog').close(); }
  function next(automatic = false) {
    if (waveActive && current && !automatic && loaded && ['playing', 'paused'].includes(phase)) { wave.react('skip', current, elapsed); wave.skipped(); }
    const target = C.nextIndex(queue.length, index, { shuffle, repeat, automatic });
    if (target < 0) { phase = 'ended'; if (native) sendNative('pause'); else audio.pause(); renderPlayback(); persist(); if (waveActive && navigator.onLine) void moreWave({ advance: true, automatic }); return; }
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
    renderComfort(); renderBookmarks(); renderWave();
  }
  function renderPlayback() {
    observeWave(); renderWavePlayback();
    const playing = phase === 'playing', loading = phase === 'loading', label = playing ? 'Пауза' : loading ? 'Отменить загрузку' : 'Воспроизвести';
    for (const id of ['mini-play', 'player-play']) { $(id).textContent = playing ? 'Ⅱ' : loading ? '·' : '▶'; $(id).setAttribute('aria-label', label); }
    $('player-state').textContent = playerError || (loading ? 'Готовим аудио…' : current ? current.local ? offline.has(current.id) ? 'На устройстве' : 'Локальный файл не найден' : offline.has(current.id) ? 'На устройстве' : 'SoundCloud · аудио LolzCloud' : '');
    $('player-state').dataset.error = String(phase === 'error'); $('player-retry').hidden = !['error', 'blocked'].includes(phase);
    $('player-seek').disabled = !loaded || !duration; renderTime(); updateMediaSession();
  }
  function renderTime() {
    $('player-time').textContent = C.formatTime(elapsed); $('player-duration').textContent = C.formatTime(duration);
    $('player-seek').max = duration || 1; if (document.activeElement !== $('player-seek')) $('player-seek').value = Math.min(elapsed, duration || 1);
    lyricView?.update(elapsed);
  }
  function updateMediaSession() {
    if (native || !('mediaSession' in navigator) || !current && !activeRoom) return;
    try {
      if (!activeRoom && !systemSoloAllowed) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.setPositionState?.(); mediaMetadataKey = ''; return; }
      const row = activeRoom?.playback || current, key = JSON.stringify([activeRoom ? RT.owner(activeRoom) : current.id, row.url, row.title, row.artist, row.cover]);
      if (mediaMetadataKey !== key) { navigator.mediaSession.metadata = new MediaMetadata({ title: row.title, artist: row.artist, album: activeRoom ? 'Комната · LolzCloud' : 'LolzCloud', artwork: [{ src: row.cover || origin + '/app/icon-512.png', sizes: '512x512', type: row.cover ? 'image/jpeg' : 'image/png' }] }); mediaMetadataKey = key; }
      navigator.mediaSession.playbackState = (activeRoom ? row.playing : phase === 'playing') ? 'playing' : 'paused';
      const length = activeRoom ? row.duration : duration, position = activeRoom ? row.position : elapsed;
      if (length > 0 && Number.isFinite(position)) navigator.mediaSession.setPositionState?.({ duration: length, playbackRate: activeRoom ? 1 : rate, position: Math.min(length, Math.max(0, position)) });
      else navigator.mediaSession.setPositionState?.();
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
    const requestedID = track.id; downloads.add(requestedID); renderDownload();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 170000); let handedToNative = false;
    try {
      if (C.referenceTrack(track)) { const previous = track; track = await lookupCatalog(track, controller.signal); if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError'); adoptCatalog(previous, track); downloads.add(track.id); }
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
    finally { clearTimeout(timeout); downloads.delete(requestedID); if (!handedToNative) downloads.delete(track.id); renderDownload(); renderSearch(); }
  }
  function verifyDuration(blob, expected) {
    return new Promise((resolve, reject) => {
      const probe = new Audio(), url = URL.createObjectURL(blob); let done = false;
      const finish = error => { if (done) return; done = true; clearTimeout(timeout); probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url); error ? reject(error) : resolve(); };
      const timeout = setTimeout(() => finish(new Error('Не удалось проверить загруженное аудио. Файл не сохранён.')), 12000);
      probe.preload = 'metadata'; probe.onloadedmetadata = () => finish(!Number.isFinite(probe.duration) || probe.duration <= 0 || expected > 20 && probe.duration < expected * 0.8 ? new Error('Сервис вернул только отрывок. Загрузка не сохранена.') : null); probe.onerror = () => finish(new Error('Аудиофайл повреждён. Попробуй другую запись.')); probe.src = url;
    });
  }
  const lyricService = window.LolzCloudLyrics.create({ db: DB, fetchJSON: json });
  lyricView = window.LolzCloudLyricView.create($('lyrics-text'), { seek });
  roomLyricView = window.LolzCloudLyricView.create($('room-lyrics-text'), { seek: position => { roomCommand('seek', position); } });
  function lyricsFor(track, signal, refresh = false) { return lyricService.forTrack(track, { signal, metadata: lyricsMetadata.get(track.id), refresh }); }
  async function loadLyrics(force = false) {
    if (!current) return;
    if (!force && lyricsTrack === current.id && $('lyrics-text').childNodes.length) return;
    const track = current, token = ++lyricsVersion; lyricsController?.abort(); lyricsController = new AbortController();
    const metadata = lyricsMetadata.get(track.id) || track, renderedIdentity = track.id + '|' + C.lyricsIdentity(metadata.title) + '|' + C.lyricsIdentity(metadata.artist), keepReady = $('lyrics-text').dataset.identity === renderedIdentity && $('lyrics-text').childNodes.length;
    lyricsTrack = track.id; if (!keepReady) { syncedLyrics = []; lyricView.clear(); } $('lyrics-retry').hidden = true; $('lyrics-edit').hidden = true; $('lyrics-metadata-form').hidden = true; $('lyrics-import-remove').hidden = true; $('lyrics-import-status').textContent = ''; document.querySelector('#panel-lyrics .attribution').hidden = false; $('lyrics-status').textContent = 'Ищем текст этой записи…';
    try {
      const value = await lyricsFor(track, lyricsController.signal, force); if (token !== lyricsVersion || current?.id !== track.id) return;
      $('lyrics-import-remove').hidden = !value.imported; document.querySelector('#panel-lyrics .attribution').hidden = !!value.imported;
      $('lyrics-text').dataset.identity = renderedIdentity;
      syncedLyrics = Array.isArray(value.lines) ? value.lines : C.parseLyrics(value.synced);
      if (value.adapted && value.sourceDuration > 0 && current.duration > 0 && Math.abs(value.sourceDuration - current.duration) > 2.5) syncedLyrics = [];
      $('lyrics-edit').hidden = !!value.imported; $('lyrics-retry').hidden = !!value.imported || !value.versionMismatch;
      lyricView.render(syncedLyrics, { plain: value.plain || (value.lines || C.parseLyrics(value.synced)).map(line => line.text).join('\n'), instrumental: value.instrumental });
      if (syncedLyrics.length) { $('lyrics-status').textContent = (value.imported ? 'Твой LRC · ' : value.adapted ? 'Под версию · ' + Number(value.tempo.rate.toFixed(2)) + '× (по длительности) · ' : '') + 'Нажми на строку, чтобы перейти к ней.'; renderTime(); }
      else { $('lyrics-status').textContent = value.imported ? 'Твой текст · без синхронизации' : value.instrumental ? '' : value.durationMatched ? 'Текст без синхронизации' : 'Текст без синхронизации · длительность отличается'; }
    } catch (error) { if (token !== lyricsVersion || current?.id !== track.id || error.name === 'AbortError') return; $('lyrics-status').textContent = keepReady ? 'Сохранённый текст. Не удалось обновить — можно повторить.' : error.status === 404 ? 'Текст этой записи пока не найден.' : error.message; $('lyrics-retry').hidden = false; $('lyrics-edit').hidden = false; }
  }
  function playerTab(tab) { const lyrics = tab === 'lyrics'; for (const name of ['queue', 'lyrics']) { $('tab-' + name).setAttribute('aria-selected', String(name === tab)); $('tab-' + name).tabIndex = name === tab ? 0 : -1; $('panel-' + name).hidden = name !== tab; } if (lyrics) void loadLyrics(); if (matchMedia('(max-width:759px)').matches) $('player-tabs').scrollIntoView({ block: 'start' }); }
  function renderComfort() {
    $('player-rate').value = rate; $('player-rate-value').textContent = Number(rate.toFixed(2)) + '×';
    $('player-preserves-pitch').checked = preservesPitch;
    const tone = effectsController.snapshot(), amount = Math.round(12 * Math.log2(tone.config.pitch) * 10) / 10;
    if (document.activeElement !== $('player-tone')) $('player-tone').value = amount; $('player-tone-value').textContent = (amount > 0 ? '+' : '') + amount + ' полутона';
    $('player-tone-status').textContent = native && tone.effectsSchema < 3 ? 'Этот iOS-клиент не поддерживает отдельную высоту. Значение сохранится для переноса.' : !preservesPitch ? 'Сейчас высота следует за скоростью. Отдельная настройка сохранена.' : ['unsupported','error'].includes(tone.state) ? 'Обработка высоты сейчас недоступна. Значение сохранено.' : tone.config.pitch !== 1 && tone.state !== 'applied' ? 'Отдельная высота применится при воспроизведении.' : 'Высота меняется отдельно от скорости.';
    $('player-pitch-status').textContent = native && !nativePitchSupported ? 'Этот iOS-клиент не поддерживает переключение высоты. Значение сохранится для переноса.' : !native && !webPitchApplied ? 'Браузер не поддерживает переключение высоты. Значение сохранится для переноса.' : native && ['error', 'unsupported'].includes(nativeRateState) ? 'Сейчас настройка высоты недоступна. Значение сохранено для переноса.' : native && nativeRateState !== 'applied' ? 'Настройка применится при воспроизведении.' : preservesPitch ? 'При изменении скорости высота голоса сохраняется.' : 'Скорость и высота голоса меняются вместе.';
    for (const control of $('rate-presets').children) control.setAttribute('aria-pressed', String(Math.abs(+control.dataset.rate - rate) < 0.001));
    $('sleep-status').textContent = sleepDeadline > 0 && !native ? 'Веб-таймер проверяется при воспроизведении и возврате. В фоне iOS может приостановить его.' : '';
    $('sleep-active').hidden = !sleepDeadline; $('sleep-active').textContent = 'Осталось ' + Math.max(1, Math.ceil((sleepDeadline - Date.now()) / 60000)) + ' мин.';
    if (document.activeElement !== $('sleep-select')) $('sleep-select').value = sleepDeadline ? 'active' : '0';
  }
  function setRate(value, { edited = false } = {}) {
    const nextRate = Number(value); if (!Number.isFinite(nextRate) || nextRate < 0.5 || nextRate > 2) return;
    if (edited) { portableController.editedSound({ rate: nextRate }); portableFile = null; }
    rate = nextRate; if (native) { nativeRateRevision++; if (nativePitchSupported) syncNativeRate(); else sendNative('rate', { value: rate }); } else { audio.defaultPlaybackRate = audio.playbackRate = rate; applyWebPitch(); }
    renderComfort(); updateMediaSession(); persist();
  }
  function applyWebPitch() { if (native) return; webPitchApplied = false; for (const name of webPitchProperties) try { audio[name] = preservesPitch; if (audio[name] === preservesPitch) webPitchApplied = true; } catch { /* Store the desired portable flag even when a browser refuses it. */ } }
  function setPreservesPitch(value, { edited = false, syncEffects = true } = {}) {
    if (typeof value !== 'boolean') return; preservesPitch = value;
    if (edited) { portableController.editedSound({ preservesPitch }); portableFile = null; }
    if (native) { nativeRateRevision++; if (nativePitchSupported) syncNativeRate(); } else applyWebPitch();
    if (syncEffects) void effectsController.transport().catch(noticeError);
    renderComfort(); persist();
  }
  function setTone(value) {
    const semitones = Number(value); if (!Number.isFinite(semitones) || semitones < -12 || semitones > 12) return;
    const pitch = 2 ** (semitones / 12); portableController.editedSound({ pitch, preservesPitch: true, transportEnabled: true }); portableFile = null;
    if (!preservesPitch) setPreservesPitch(true, { syncEffects: false });
    void effectsController.configure({ pitch }).then(renderComfort).catch(noticeError); renderComfort();
  }
  function syncNativeRate() {
    if (!native || !nativePitchSupported) return;
    const key = nativeClientId + ':' + nativeRequestId + ':' + nativeRateRevision; if (key === nativeRateKey) return; nativeRateKey = key; nativeRateState = 'pending';
    sendNative('rate', { value: rate, preservesPitch, revision: nativeRateRevision });
  }
  function receiveNativeRate(value) {
    if (!nativePitchSupported || !currentNativeIntent(value) || value.rateRevision !== nativeRateRevision || value.rate !== rate || value.preservesPitch !== preservesPitch) return;
    if (value.rateState === 'applied' && value.rateAppliedRevision === nativeRateRevision) nativeRateState = 'applied';
    else if (['pending', 'unsupported', 'error'].includes(value.rateState)) nativeRateState = value.rateState;
    renderComfort();
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
    const id = current ? canonicalID(current.id) : '', rows = id ? bookmarks.get(id) || [] : []; $('bookmark-add').disabled = !current;
    if (bookmarkVisibleID !== id) { bookmarkVisibleID = id; bookmarkVisible = 100; }
    $('bookmark-list').replaceChildren(...rows.slice(0, bookmarkVisible).map(row => {
      const item = node('div', null, 'bookmark-row'), jump = button(C.formatTime(row.position), () => { if (loaded) seek(row.position); else { elapsed = row.position; renderTime(); persist(); notice('Момент выбран. Нажми Play.'); } }, 'bookmark-jump'); jump.setAttribute('aria-label', 'Перейти к ' + C.formatTime(row.position));
      const remove = button('×', () => { const remaining = rows.filter(value => value !== row); if (remaining.length) bookmarks.set(id, remaining); else bookmarks.delete(id); renderBookmarks(); persist(); }, 'icon-button'); remove.setAttribute('aria-label', 'Удалить момент ' + C.formatTime(row.position)); item.append(jump, remove); return item;
    }));
    if (rows.length > bookmarkVisible) $('bookmark-list').append(button('Показать ещё моменты', () => { bookmarkVisible += 100; renderBookmarks(); }, 'wide-button'));
    if (!rows.length) $('bookmark-list').append(node('p', 'Сохрани место, к которому хочется вернуться.', 'bookmark-empty'));
  }
  function addBookmark() {
    if (!current) return; const id = canonicalID(current.id), rows = bookmarks.get(id) || [];
    if ([...bookmarks.values()].reduce((sum, list) => sum + list.length, 0) >= 2000) return notice('Уже сохранено 2000 моментов. Удали ненужные.');
    const position = Math.round(elapsed * 10) / 10; if (rows.some(row => Math.abs(row.position - position) < 1)) return notice('Этот момент уже сохранён');
    rows.push({ position, createdAt: Date.now() }); rows.sort((a, b) => a.position - b.position); bookmarks.set(id, rows); collection.set(current.id, current); renderBookmarks(); renderLibrary(); persist(); notice('Момент ' + C.formatTime(position) + ' сохранён');
  }
  function roomLyricsSnapshot() {
    try { return RT.snapshot($('rooms-frame').contentWindow?.LolzCloudRoomTransport?.snapshot()); } catch { return null; }
  }
  function roomLyricIdentity(transport) { const row = transport.playback; return [transport.documentId, row.url, C.lyricsIdentity(row.title), C.lyricsIdentity(row.artist), row.duration].join('|'); }
  function renderRoomLyrics(transport) {
    if (!roomLyricsValue) return;
    const value = roomLyricsValue, lines = Array.isArray(value.lines) ? value.lines : C.parseLyrics(value.synced);
    roomLyricsSeekable = transport.capabilities.seek;
    roomLyricView.render(lines, { plain: value.plain || lines.map(line => line.text).join('\n'), instrumental: value.instrumental, seekable: roomLyricsSeekable });
    roomLyricView.update(transport.playback.position);
    $('room-lyrics-status').textContent = (value.adapted ? 'Под версию · ' + Number(value.tempo.rate.toFixed(2)) + '× (по длительности). ' : '') + (lines.length ? roomLyricsSeekable ? 'Нажми строку, чтобы перейти к ней в комнате.' : 'Текст следует за музыкой. Перемотка доступна ведущему.' : value.instrumental ? '' : 'Текст без синхронизации.');
  }
  function updateRoomLyrics(transport) {
    if (!$('room-lyrics-dialog').open) return;
    if (!transport.playback.url || !transport.playback.title || !transport.playback.artist) { ++roomLyricsVersion; roomLyricsController?.abort(); roomLyricsKey = ''; roomLyricsValue = null; roomLyricClock = null; roomLyricView.clear(); $('room-lyrics-status').textContent = 'Ждём сведения о следующей записи. Комната продолжает работать.'; return; }
    const key = roomLyricIdentity(transport);
    if (roomLyricsKey !== key) { void roomLyrics(transport); return; }
    roomLyricClock = { position: transport.playback.position, playing: transport.playback.playing, duration: transport.playback.duration, at: performance.now() };
    if (roomLyricsValue && roomLyricsSeekable !== transport.capabilities.seek) renderRoomLyrics(transport);
    roomLyricView.update(transport.playback.position);
  }
  async function roomLyrics(input) {
    const transport = input || roomLyricsSnapshot(), row = transport?.playback;
    if (!row?.url || !row.title || !row.artist) return notice('В комнате пока нет сведений о текущей записи.');
    const key = roomLyricIdentity(transport), token = ++roomLyricsVersion, target = { ...row, id: C.sourceURL(row.url) ? 'ref:' + C.sourceURL(row.url) : 'room:' + row.url };
    roomLyricsController?.abort(); roomLyricsController = new AbortController(); roomLyricsKey = key;
    const keepReady = $('room-lyrics-text').dataset.source === row.url && $('room-lyrics-text').childNodes.length;
    if (!keepReady) { roomLyricsValue = null; roomLyricView.clear(); }
    $('room-lyrics-title').textContent = row.title; $('room-lyrics-status').textContent = 'Ищем текст…'; if (!$('room-lyrics-dialog').open) $('room-lyrics-dialog').showModal();
    updateRoomLyrics(transport);
    try {
      const value = await lyricsFor(target, roomLyricsController.signal);
      if (token !== roomLyricsVersion || roomLyricIdentity(roomLyricsSnapshot() || transport) !== key) return;
      roomLyricsValue = value; $('room-lyrics-text').dataset.source = row.url; renderRoomLyrics(roomLyricsSnapshot() || transport);
    } catch (error) { if (token !== roomLyricsVersion || error.name === 'AbortError') return; $('room-lyrics-status').textContent = keepReady ? 'Сохранённый текст. Не удалось обновить — можно открыть его ещё раз.' : error.message || 'Текст пока не найден. Комната продолжает играть.'; }
  }
  function showView(name, focus = false) {
    if (!['search', 'wave', 'library', 'rooms', 'profile'].includes(name)) return;
    view = name; for (const tab of ['search', 'wave', 'library', 'rooms', 'profile']) { $('view-' + tab).hidden = tab !== name; const control = document.querySelector('[data-view="' + tab + '"]'); if (tab === name) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current'); }
    if (name === 'wave') renderWave();
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
        updateAccount(verified.user); deviceCode = ''; $('login-code').textContent = ''; $('login-browser').removeAttribute('href'); $('login-dialog').close();
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
        const { body } = await json('/api/session', { timeout: 10000, limit: 128 * 1024 }); if (token !== accountVersion) return; updateAccount(body.authenticated === true && body.user?.id ? body.user : null);
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
    if (frame.id === 'rooms-frame') { frameRoomURL = C.roomURL(win.location.href, origin); $('rooms-directory').hidden = $('room-lyrics').hidden = !frameRoomURL; const transport = win.LolzCloudRoomTransport?.snapshot(); if (!transport || activeRoom && transport.documentId !== activeRoom.documentId) clearRoomOwner(); if (transport) receiveRoomTransport(transport); }
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
    if (event.origin !== origin || event.source !== $('rooms-frame').contentWindow) return;
    if (event.data?.type === 'lolzcloud:room-transport') { receiveRoomTransport(event.data.transport); return; }
    if (event.data?.type === 'lolzcloud:room-command-result') {
      const pending = roomCommands.get(event.data.id);
      if (!pending || RT.owner(pending.transport) !== RT.owner(event.data) || RT.owner(pending.transport) !== RT.owner(activeRoom)) return;
      if (event.data.state === 'accepted') {
        if (!pending.accepted) {
          pending.accepted = true; clearTimeout(pending.timer);
          pending.timer = setTimeout(() => { if (roomCommands.get(event.data.id) !== pending) return; roomCommands.delete(event.data.id); pending.finish(false, 'Источник не завершил подготовку. Открой комнату и проверь выбранную запись.'); }, 60000);
          if (native && nativeRoomSupported) sendNative('roomCommandResult', { ...pending.transport, id: event.data.id, ok: true, pending: true, error: '' });
        }
        return;
      }
      clearTimeout(pending.timer); roomCommands.delete(event.data.id); pending.finish(event.data.ok === true, event.data.ok === true ? '' : 'Команда недоступна: проверь связь и право управления комнатой.');
      if (event.data.transport) receiveRoomTransport(event.data.transport); return;
    }
    // Compatibility with an older room document until its next navigation.
    if (event.data?.type === 'lolzcloud:room-audio' && event.data.playing === true && !$('rooms-frame').contentWindow?.LolzCloudRoomTransport) { roomAudible = true; pause(); }
  });
  $('search-form').onsubmit = event => { event.preventDefault(); $('search-query').blur(); void search(); };
  $('search-query').oninput = () => { if (searching) { ++searchVersion; searchController?.abort(); searching = false; $('search-submit').disabled = false; $('search-status').textContent = 'Нажми «Найти», чтобы выполнить новый поиск.'; } $('search-more').hidden = $('search-query').value.trim() !== searchedQuery || !nextOffset; };
  $('search-more').onclick = () => { void search(true); };
  for (const [key, rows] of Object.entries(window.LolzCloudWave.OPTIONS)) for (const [value, label] of rows) { const option = node('option', label); option.value = value; $('wave-' + key).append(option); }
  const waveAction = handler => { try { Promise.resolve(handler()).catch(noticeError); } catch (error) { noticeError(error); } };
  $('wave-form').onsubmit = event => { event.preventDefault(); $('wave-prompt').blur(); waveAction(() => startWave()); };
  $('wave-prompt').oninput = () => { wave.cancel(); waveSession++; waveRefilling = false; };
  $('wave-seed').onclick = () => waveAction(() => startWave(true)); $('wave-retry').onclick = () => waveAction(() => waveActive ? moreWave() : startWave()); $('wave-more').onclick = () => waveAction(() => moreWave()); $('wave-stop').onclick = () => { wave.cancel(); waveSession++; waveRefilling = false; };
  for (const key of Object.keys(window.LolzCloudWave.OPTIONS)) $('wave-' + key).onchange = () => waveAction(() => wave.configure({ preferences: { [key]: $('wave-' + key).value } }));
  $('wave-genre').onchange = () => waveAction(() => wave.configure({ preferences: { genre: $('wave-genre').value } })); $('wave-context').onchange = () => waveAction(() => wave.configure({ preferences: { autoContext: $('wave-context').checked } }));
  $('wave-novelty').oninput = () => { $('wave-novelty-value').textContent = $('wave-novelty').value + '%'; }; $('wave-novelty').onchange = () => waveAction(() => wave.configure({ adventurous: +$('wave-novelty').value / 100 }));
  $('wave-reset').onclick = () => waveAction(() => { wave.reset(); $('wave-prompt').value = ''; renderWave(); });
  $('wave-love').onclick = () => waveAction(() => { if (!waveActive || !current) return; const wasLiked = liked.has(canonicalID(current.id)); wave.react(wasLiked ? 'unlove' : 'love', current); toggleLike(current); });
  $('wave-next').onclick = () => next(); $('wave-ban').onclick = () => waveAction(() => { if (waveActive && current) { wave.react('ban', current); pruneWaveQueue(); next(); } });
  $('wave-retry-play').onclick = resume;
  $('wave-ban-artist').onclick = () => waveAction(() => { if (waveActive && current) { wave.react('artist-ban', current); pruneWaveQueue(); next(); } });
  $('navigation').onclick = event => { const name = event.target.closest('[data-view]')?.dataset.view; if (name) showView(name, true); };
  document.querySelector('.brand').onclick = event => { event.preventDefault(); showView('search', true); };
  $('library-filters').onclick = event => { const filter = event.target.closest('[data-filter]')?.dataset.filter; if (!filter) return; libraryFilter = filter; libraryVisible = 300; for (const button of $('library-filters').children) button.setAttribute('aria-pressed', String(button.dataset.filter === filter)); renderLibrary(); };
  $('library-more').onclick = () => { libraryVisible += 300; renderLibrary(); };
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
  $('player-volume').oninput = () => { const value = +$('player-volume').value; if (native) sendNative('volume', { value }); else effectsController.volume(value); };
  $('effects-open').onclick = event => openEffects(event.currentTarget); $('effects-close').onclick = () => closeEffects();
  $('effects-dialog').addEventListener('cancel', event => { event.preventDefault(); closeEffects(); });
  $('effects-dialog').addEventListener('close', () => { if (!effectsFromHistory && window.history.state?.lolzcloudEffects) window.history.back(); effectsFromHistory = false; if (effectsOpener?.isConnected) effectsOpener.focus(); });
  window.addEventListener('popstate', () => { if (!window.history.state?.lolzcloudEffects) closeEffects(true); });
  $('effects-enabled').onchange = () => configureEffects({ enabled: $('effects-enabled').checked });
  $('effects-preset').onchange = () => { if ($('effects-preset').value !== 'custom') configureEffects(window.LolzCloudEffectsPolicy.preset($('effects-preset').value)); };
  for (let i = 0; i < 5; i++) $('effects-gain-' + i).oninput = () => { const gains = effectsController.snapshot().config.gains; gains[i] = +$('effects-gain-' + i).value; configureEffects({ enabled: true, gains }); };
  $('effects-preamp').oninput = () => configureEffects({ enabled: true, preampDb: +$('effects-preamp').value });
  for (const name of ['echo', 'reverb']) $('effects-' + name).oninput = () => configureEffects({ enabled: true, [name]: +$('effects-' + name).value / 100 });
  $('effects-normalization').onchange = () => configureEffects({ enabled: true, normalization: $('effects-normalization').checked });
  $('effects-reset').onclick = () => configureEffects(window.LolzCloudEffectsPolicy.preset('original'));
  $('effects-retry').onclick = () => configureEffects({});
  $('player-rate').oninput = () => setRate($('player-rate').value, { edited: true }); $('rate-presets').onclick = event => { const control = event.target.closest('[data-rate]'); if (control) setRate(control.dataset.rate, { edited: true }); };
  $('player-tone').oninput = () => setTone($('player-tone').value); $('player-tone-reset').onclick = () => setTone(0);
  $('player-preserves-pitch').onchange = () => setPreservesPitch($('player-preserves-pitch').checked, { edited: true });
  $('sleep-select').onchange = () => setSleep(+$('sleep-select').value); $('bookmark-add').onclick = addBookmark;
  $('queue-clear').onclick = () => { leaveWave(); queue = current ? [current] : []; index = current ? 0 : -1; history = []; persist(); renderQueue(); notice('В очереди остался текущий трек'); };
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
  $('room-lyrics-dialog').addEventListener('close', () => { ++roomLyricsVersion; roomLyricsController?.abort(); roomLyricsKey = ''; roomLyricClock = null; });
  $('install-open').onclick = () => $('install-dialog').showModal();
  $('login-cancel').onclick = cancelLogin; $('login-retry').onclick = () => { void login(); };
  $('login-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelLogin(); });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install-confirm').hidden = false; });
  $('install-confirm').onclick = async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('install-confirm').hidden = true; };
  $('account-refresh').onclick = () => { void loadAccount(true).then(() => { if (account && $('social-frame').src) $('social-frame').contentWindow.location.reload(); }); };
  $('portable-open').onclick = event => { portableFile = null; portableJSON = ''; portableOpener = event.currentTarget; renderPortable(); $('portable-dialog').showModal(); window.history.pushState({ ...window.history.state, lolzcloudPortable: true }, '', location.href); };
  $('portable-close').onclick = () => $('portable-dialog').close();
  $('portable-dialog').addEventListener('cancel', event => { event.preventDefault(); $('portable-dialog').close(); });
  $('portable-dialog').addEventListener('close', () => { const hadCloud = cloudBusy || !!cloudSnapshot; cancelCloud(); if (hadCloud || ['reading', 'exporting'].includes(portableController.snapshot().phase)) portableController.cancel(); if (!portableHistory && window.history.state?.lolzcloudPortable) window.history.back(); portableHistory = false; portableOpener?.focus(); });
  window.addEventListener('popstate', () => { if (!window.history.state?.lolzcloudPortable && $('portable-dialog').open) { portableHistory = true; $('portable-dialog').close(); } });
  $('portable-export').onclick = () => { void savePortable(); };
  $('portable-import').onchange = async () => { const file = $('portable-import').files[0]; $('portable-import').value = ''; if (!file) return; cancelCloud(); portableFile = null; portableUndo = false; $('portable-settings').checked = false; try { await portableController.parseFile(file); } catch (error) { portableError(error); } };
  $('portable-settings').onchange = () => renderPortable();
  $('portable-apply').onclick = () => { void applyPortablePreview(); };
  $('portable-cancel').onclick = () => { cancelCloud(); portableUndo = false; portableController.cancel(); };
  $('portable-undo').onclick = () => { cancelCloud(); portableController.cancel(); portableUndo = true; renderPortable(); };
  $('cloud-read').onclick = () => { void transferCloud('read'); }; $('cloud-save').onclick = () => { void transferCloud('save'); };
  $('rooms-directory').onclick = () => { $('rooms-frame').src = '/rooms'; };
  $('room-lyrics').onclick = () => { void roomLyrics(); };
  for (const id of ['rooms-frame', 'social-frame']) $(id).onload = () => frameLoaded($(id));
  audio.addEventListener('playing', () => { if (native || !loaded) return; phase = 'playing'; playerError = ''; renderPlayback(); });
  audio.addEventListener('pause', () => { if (native || !loaded || ['loading', 'error', 'ended', 'blocked'].includes(phase)) return; phase = 'paused'; renderPlayback(); persist(); });
  audio.addEventListener('waiting', () => { if (native || !loaded || audio.paused) return; phase = 'loading'; renderPlayback(); });
  audio.addEventListener('loadedmetadata', () => { if (!loaded || native) return; if (Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration; renderTime(); });
  audio.addEventListener('timeupdate', () => { if (!loaded || native) return; elapsed = audio.currentTime; observeWave(); checkSleep(); renderTime(); updateMediaSession(); if (Date.now() - lastSavedTime > 5000) { lastSavedTime = Date.now(); wave.flush(); persist(); } });
  audio.addEventListener('ended', () => { if (loaded && !native) next(true); });
  audio.addEventListener('error', () => { if (!loaded || native) return; phase = 'error'; playerError = 'Запись не загрузилась. Проверь сеть и нажми «Повторить».'; renderPlayback(); });
  window.addEventListener('lolzcloud:capabilities', event => learnNativeCapabilities(event.detail));
  window.addEventListener('lolzcloud:profileExport', event => { const value = event.detail; if (!native || !currentNativeIntent(value) || value.operationId !== portableOperation) return; if (value.state === 'error') portableError(Error(typeof value.error === 'string' ? value.error.slice(0, 300) : 'Не удалось открыть отправку файла.')); else if (value.state === 'shared' || value.state === 'cancelled') $('portable-status').textContent = 'Панель отправки закрыта. Файл можно сохранить ещё раз.'; });
  window.addEventListener('lolzcloud:effects', event => { if (native) { learnNativeCapabilities(event.detail); effectsController.receiveNative(event.detail); } });
  window.addEventListener('lolzcloud:playback', event => {
    if (!native) return; const value = event.detail; learnNativeCapabilities(value); receiveNativeRate(value); if (!current) return;
    if (activeRoom || !systemSoloAllowed) { if (!nativeRoomSupported && value?.state === 'playing') sendNative('pause'); return; }
    if (!currentNativeIntent(value) || typeof value.id === 'string' && value.id !== current.id || !['loading', 'playing', 'paused', 'ended', 'error'].includes(value.state)) return;
    if (!loaded && value.id !== current.id) return; loaded = true;
    if (!nativePitchSupported && Number.isFinite(value.rate) && value.rate >= 0.5 && value.rate <= 2) rate = value.rate;
    if (Number.isFinite(value.sleepDeadline) && value.sleepDeadline >= 0 && value.sleepDeadline !== sleepDeadline) { sleepDeadline = value.sleepDeadline; scheduleSleep(); persist(); }
    if (Number.isFinite(value.time)) elapsed = Math.max(0, value.time); if (Number.isFinite(value.duration) && value.duration > 0) duration = value.duration;
    if (typeof value.queue === 'boolean') nativeQueueOwned = value.queue;
    if (value.state === 'ended' && !nativeQueueOwned) { next(true); return; } phase = value.state; playerError = typeof value.error === 'string' ? value.error.slice(0, 300) : ''; renderPlayback(); renderComfort(); checkSleep(); if (value.state === 'ended' && nativeQueueOwned && waveActive && index === queue.length - 1 && repeat !== 'one' && navigator.onLine) void moreWave({ advance: true, automatic: true });
  });
  window.addEventListener('lolzcloud:selection', event => {
    if (!native) return; const value = event.detail, position = nativeCatalogReferences ? value?.index : nativeQueuePositions[value?.index];
    if (activeRoom || !systemSoloAllowed) { if (!nativeRoomSupported) sendNative('pause'); return; }
    if (!currentNativeIntent(value) || !Number.isInteger(position) || position < 0 || position >= queue.length) return;
    const received = C.savedTrack(value.track, origin); let expected = queue[position];
    if (C.referenceTrack(expected) && C.track(received, origin) && value.previousId === expected.id && (/^[1-9][0-9]{0,15}$/.test(expected.id) ? received.id === expected.id : received.url === expected.url)) { if (!adoptCatalog(expected, received, { selected: false })) return; queue[position] = received; expected = received; }
    if (!received || received.id !== expected.id || received.audioUrl !== expected.audioUrl) return;
    const changed = index !== position || current?.id !== expected.id;
    nativeQueueOwned = value.queue === true;
    if (!changed && loaded) return;
    if (changed) { if (index >= 0) history.push(index); if (history.length > 200) history.shift(); elapsed = 0; duration = expected.duration; wave.begin(expected); }
    ++playVersion; preparationController?.abort(); index = position; current = expected; loaded = true; playerError = ''; nativeQueueOwned = value.queue === true; phase = 'loading'; effectsController.track(expected.id);
    renderPlayer(); renderQueue(); persist();
    if (changed && $('tab-lyrics').getAttribute('aria-selected') === 'true') void loadLyrics();
  });
  window.addEventListener('lolzcloud:command', event => { if (!native) return; if (['next', 'previous'].includes(event.detail?.action)) systemCommand(event.detail.action); });
  window.addEventListener('lolzcloud:room-command', event => {
    const value = event.detail;
    if (!native || !nativeRoomSupported || !currentNativeIntent(value) || RT.owner(value) !== RT.owner(activeRoom)) return;
    roomCommand(value.command, value.value, value);
  });
  window.addEventListener('lolzcloud:room-command-result', event => { const value = event.detail; if (native && currentNativeIntent(value) && RT.owner(value) === RT.owner(activeRoom) && ['expired', 'error'].includes(value.state)) notice(value.error || 'Открой комнату и повтори команду.'); });
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
    renderLibrary(); renderDownload(); renderSearch(); renderPlayback();
  });
  window.addEventListener('lolzcloud:account', event => { if (!native) return; if (event.detail?.state === 'ready') { updateAccount(null); $('rooms-frame').removeAttribute('src'); $('social-frame').removeAttribute('src'); void loadAccount(true); } else if (event.detail?.state === 'error') notice(event.detail.error || 'Не удалось войти. Попробуй ещё раз.'); });
  if ('mediaSession' in navigator && !native) for (const [action, handler] of Object.entries({ play: () => systemCommand('play'), pause: () => systemCommand('pause'), nexttrack: () => systemCommand('next'), previoustrack: () => systemCommand('previous'), seekto: detail => systemCommand('seek', detail.seekTime), seekbackward: detail => systemCommand('seek', Math.max(0, (activeRoom?.playback.position ?? elapsed) - (detail.seekOffset || 10))), seekforward: detail => systemCommand('seek', Math.min(activeRoom?.playback.duration || duration || 86400, (activeRoom?.playback.position ?? elapsed) + (detail.seekOffset || 10))) })) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional platform command. */ } }
  function connectivity() { $('connection').hidden = navigator.onLine; }
  window.addEventListener('online', () => { connectivity(); if (['rooms', 'profile'].includes(view)) void loadAccount(true); }); window.addEventListener('offline', connectivity);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else { checkSleep(); connectivity(); if (['rooms', 'profile'].includes(view)) void loadAccount(); } });
  window.addEventListener('pagehide', () => { wave.flush(); clearTimeout(persistTimer); try { localStorage.setItem('LolzCloud-app-v1', JSON.stringify(savedState())); } catch {} });
  setInterval(() => { if (!$('room-lyrics-dialog').open || !roomLyricClock) return; const clock = roomLyricClock; roomLyricView.update(Math.min(clock.duration || 86400, clock.position + (clock.playing ? Math.min(2, (performance.now() - clock.at) / 1000) : 0))); }, 100);
  renderPlayer(); renderQueue(); renderLibrary(); renderComfort(); renderBookmarks(); renderEffects(); renderPortable(); renderWave(); scheduleSleep(); checkSleep(); connectivity(); renderGate('rooms-gate', 'rooms'); renderGate('profile-gate', 'profile'); void refreshOffline(); if (native) { if (nativePitchSupported) syncNativeRate(); else sendNative('rate', { value: rate }); sendNative('capabilities'); }
  if (native) $('install-open').hidden = true;
  if (native) { $('audio-import-control').hidden = true; $('native-audio-import').hidden = false; }
  if (!native && (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) { document.querySelector('.volume-label').hidden = true; document.querySelector('.player-actions').append(node('span', 'Громкость — кнопками устройства', 'hint')); }
  if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => { /* Streaming remains available when private browsing denies a worker. */ });
  // Read-only diagnostic surface is useful to the isolated regression harness.
  window.LolzCloudApp = Object.freeze({ snapshot: () => ({ view, phase, current: current?.id || '', queue: queue.map(track => track.id), index, liked: [...liked], offline: [...offline.keys()], elapsed, duration, roomAudible, native, rate, preservesPitch, pitchSupported: native ? nativePitchSupported : webPitchApplied, nativeRateRevision, nativeRateState, sleepDeadline, effects: effectsController.snapshot(), wave: { active: waveActive, ...wave.snapshot(), tracks: wave.snapshot().tracks.map(row => row.id) }, bookmarks: current ? (bookmarks.get(current.id) || []).map(row => row.position) : [] }), openRoom });
})();
