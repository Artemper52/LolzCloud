(() => {
  'use strict';
  const { request, avatar } = window.LolzCloudSite, { RoomClock, DriftCorrection, RoomAdvanceGate } = window.LolzCloudRoomSync, el = id => document.getElementById(id), id = location.pathname.match(/\/room\/([a-f0-9]{32})/)?.[1];
  const desktop = window.LolzCloudDesktopRoom, media = window.LolzCloudMedia;
  let desktopState = null, playerKind = '', nativeRevision=0;
  const nativeHost = () => desktopState?.hosting && state?.controller?.connection === desktopState.connection;
  const connection = crypto.randomUUID(), clock = new RoomClock(), correction = new DriftCorrection(), advanceGate = new RoomAdvanceGate();
  let state = null, widget = null, widgetScript = null, playerTimeout, loaded = '', ready = false, started = false, stopped = false, lease = '', sequence = 0, publishing = null, pendingPublish = null, lastApplied = 0, lastHeartbeat = 0, busyJoin = false, eventStream = null, lastStateAt = 0, queueSignature = '', peopleSignature = '', chatSignature = '', historySignature = '', reactionSignature = '', generation = 0, settingsFilled = false;
  const health = { status: 'autoplay', driftMs: null }, isController = () => nativeHost() || !!lease && state?.controller?.connection === connection, target = () => clock.position(state) * 1000;
  const playbackKey = () => [state?.epoch || 0, state?.controller?.connection || '', generation, loaded].join('|');
  const activeLease = () => !state?.reconnecting && (!Number.isFinite(state?.controller?.expires) || state.controller.expires > clock.time());
  const atEnd = (position, tolerance = 150) => Number.isFinite(position) && state?.playback.duration > 0 && position >= state.playback.duration * 1000 - tolerance;
  let autoplayBlocked = false, autoplayTimer;
  let selectingTrack = false, selectionCommitted = false, requestedPlaybackUrl = '', searchTracks = [], searchActionsSignature = '';
  let chatSending = false, chatUnread = 0, chatInitialized = false;
  const chatRows = new Map();
  const pendingToggles=new Set();
  const appAudioPlaying=()=>{if(window.parent!==window)window.parent.postMessage({type:'lolzcloud:room-audio',playing:true},location.origin);};
  window.addEventListener('message',event=>{
    if(window.parent===window||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='lolzcloud:app-audio'||event.data.action!=='pause')return;
    started=false;lastApplied=performance.now();widget?.pause();updateControls();updateBadge();
  });
  const message = error => { const text = error instanceof Error ? error.message : String(error || ''); el('status').textContent = text; if (el('room-sheet-status')) el('room-sheet-status').textContent = text; };
  const node = (tag, value, className) => { const result = document.createElement(tag); result.textContent = value; if (className) result.className = className; return result; };
  const button = (label, handler) => { const result = node('button', label); result.type = 'button'; result.onclick = () => Promise.resolve(handler()).catch(message); return result; };
  async function call(action, data, method = 'POST') {
    const sent = performance.now(), value = await request('/api/rooms/' + id + '/' + action, data, method);
    const room = value.room || value;
    if (Number.isFinite(room.serverTime)) clock.sample(room.serverTime, sent);
    return value;
  }
  function badge(text, waiting = false) {
    const label = el('connection-status');
    if (label.textContent !== text) label.textContent = text;
    label.dataset.state = waiting ? 'waiting' : 'ready';
  }
  function updateBadge() {
    if (stopped) return badge('Комната недоступна', true);
    if (!navigator.onLine || lastStateAt && performance.now() - lastStateAt > 13000) return badge('Восстанавливаем связь…', true);
    if (!state) return badge('Подключаемся', true);
    if (state.reconnecting) return badge('Ведущий переподключается', true);
    if (!loaded) return badge('В комнате');
    if (health.status === 'error') return badge('Звук недоступен', true);
    if (!ready) return badge('Загружаем трек', true);
    if (autoplayBlocked) return badge('Нажми Play в плеере', true);
    if (!started) return badge('Звук выключен у тебя');
    const drift = Math.abs(health.driftMs || 0);
    badge(drift < 350 ? 'Вместе · синхронно' : 'Выравниваем · ' + (drift / 1000).toFixed(1) + ' с', drift >= 350);
  }
  async function calibrate() { for (let attempt = 0; attempt < 3; attempt++) { const sent = performance.now(); try { const value = await request('/api/clock'); clock.sample(value.serverTime, sent); } catch { break; } } }
  function seekNow(position) { if (!widget || !ready) return; lastApplied = performance.now(); widget.seekTo(position); }
  function playHere() {
    if (!widget || !ready || stopped) return;
    const player = widget, token = generation, url = loaded;
    player.play();
    if (autoplayTimer) return;
    autoplayTimer = setTimeout(() => {
      autoplayTimer = null;
      if (stopped || !started || !ready || player !== widget || token !== generation || state?.playback.url !== url || !state.playback.playing) return;
      player.isPaused(paused => {
        if (!paused || stopped || !started || player !== widget || token !== generation || !state?.playback.playing) return;
        autoplayBlocked = true; health.status = 'autoplay'; updateBadge(); updateControls();
        message('Браузер ждёт разрешения звука. Нажми «Разрешить звук здесь» или Play внутри плеера.');
      });
    }, 1200);
  }
  function samplePlayer(callback) {
    if (stopped || !ready || !widget) return;
    const player = widget, token = generation, url = loaded;
    const current = () => !stopped && ready && player === widget && token === generation && url === loaded && state?.playback.url === url;
    player.getPosition(position => {
      if (!current()) return;
      player.isPaused(paused => { if (current()) callback(position, paused); });
    });
  }
  function sync(force = false, scheduled = false) {
    if (stopped || !widget || !ready || !state || !loaded) return;
    if (nativeHost()) { health.status = 'ready'; health.driftMs = 0; updateBadge(); return; }
    if (!activeLease() || lastStateAt && performance.now() - lastStateAt > 15000) { lastApplied = performance.now(); widget.pause(); health.status = 'buffering'; updateBadge(); return; }
    if (isController() && (advanceGate.pending || selectingTrack)) { lastApplied = performance.now(); widget.pause(); return; }
    if (!started) { lastApplied = performance.now(); widget.pause(); health.status = 'autoplay'; health.driftMs = null; updateBadge(); return; }
    const source = loaded, token = generation, player = widget;
    const current = () => !stopped && started && ready && player === widget && token === generation && source === loaded && state?.playback.url === source && activeLease();
    player.isPaused(paused => { if (!current()) return; if (state.playback.playing === paused) { lastApplied = performance.now(); if (state.playback.playing) { if (!autoplayBlocked) playHere(); } else player.pause(); } });
    player.getPosition(position => { if (!current()) return; const decision = correction.decide(position, target(), performance.now(), playbackKey(), force, scheduled); health.driftMs = Number.isFinite(decision.drift) ? Math.round(decision.drift) : null; if (decision.seek) seekNow(Math.max(0, decision.position)); health.status = autoplayBlocked ? 'autoplay' : 'ready'; updateBadge(); });
  }
  function widgetReady(token) {
    if (token !== generation || stopped || health.status === 'error') return;
    clearTimeout(playerTimeout);
    ready = true; health.status = started ? 'ready' : 'autoplay';
    el('player').parentElement.classList.add('has-track');
    widget.setVolume(Number(el('volume').value));
    widget.getCurrentSound(sound => {
      const artwork = sound?.artwork_url || sound?.user?.avatar_url;
      if (token !== generation || stopped || !/^https:\/\/(?:[a-z0-9-]+\.sndcdn\.com|i\.ytimg\.com|lh3\.googleusercontent\.com)\//i.test(artwork || '')) return;
      const image = el('track-art');
      image.onload = () => { if (token === generation) image.hidden = false; };
      image.onerror = () => { image.hidden = true; };
      image.src = artwork;
    });
    updateBadge(); sync(true);
  }
  function nativeUpdate() {
    if (!started || !isController() || !activeLease() || advanceGate.pending || selectingTrack || performance.now() - lastApplied < 800 || !ready) return;
    const key = playbackKey();
    samplePlayer((position, paused) => {
      if (!started || key !== playbackKey() || !isController() || !activeLease() || advanceGate.pending) return;
      if (atEnd(position)) void finishTrack().catch(message);
      else { advanceGate.rearm(key); void publish({ position: position / 1000, playing: !paused }); }
    });
  }
  function sourceEnded(token) {
    if (token !== generation || !ready || stopped || selectingTrack || !isController() || !activeLease() || !state.playback.playing) return;
    const key = playbackKey();
    const finish = () => { if (key === playbackKey()) void finishTrack().catch(message); };
    if (atEnd(target(), 1500)) finish();
    else widget.getPosition(position => { if (atEnd(position, 1500)) finish(); });
  }
  async function finishTrack(explicit = false) {
    if (stopped || selectingTrack || !isController() || !activeLease() || !explicit && !ready) return false;
    lastApplied = performance.now(); widget?.pause();
    if (state.settings.autoNext) return nextTrack(!explicit);
    return publish({ position: state.playback.duration || clock.position(state), playing: false });
  }
  function seekRoom(value) {
    if (!isController() || !activeLease()) return Promise.resolve(false);
    const position = Math.max(0, Math.min(state.playback.duration || 14400, Number(value) || 0));
    if (atEnd(position * 1000, 50)) return finishTrack(true);
    advanceGate.rearm(playbackKey());
    return publish({ position });
  }
  function soundCloudWidget() {
    if (window.SC?.Widget) return Promise.resolve(window.SC.Widget);
    if (!widgetScript) widgetScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(failed, 10000);
      function failed() { clearTimeout(timeout); script.remove(); reject(new Error()); }
      script.src = 'https://w.soundcloud.com/player/api.js';
      script.onload = () => { if (!window.SC?.Widget) return failed(); clearTimeout(timeout); resolve(window.SC.Widget); };
      script.onerror = failed;
      document.head.append(script);
    }).catch(error => { widgetScript = null; throw error; });
    return widgetScript;
  }
  function playerFailed(token) {
    if (token !== generation || stopped || !loaded) return;
    clearTimeout(playerTimeout);
    ready = false; health.status = 'error';
    widget?.pause();
    el('player').parentElement.classList.remove('has-track');
    el('player-placeholder').textContent = 'Источник не открыл трек. Попробуй другую запись; чат и очередь доступны.';
    el('retry-player').hidden = false;
    updateBadge();
  }
  async function load(track, retry = false) {
    const url = track.url, kind = nativeHost() ? 'desktop' : media.provider(url);
    if (url === loaded && kind === playerKind && !retry) return;
    // SDK pause/destroy can synchronously emit state changes. Invalidate the
    // outgoing recording before teardown so it cannot publish into the new one.
    const token = ++generation;
    clearTimeout(autoplayTimer); autoplayTimer = null;
    ready = false; lastApplied = performance.now();
    if (widget && (kind !== playerKind || kind === 'youtube')) { const old=el('player'), parent=old?.parentElement;widget.pause();widget.destroy?.();widget=null;const replacement=document.createElement('iframe');replacement.id='player';replacement.title='Плеер комнаты';replacement.allow='autoplay; encrypted-media; fullscreen';if(old?.isConnected)old.replaceWith(replacement);else parent?.append(replacement); }
    playerKind = kind;
    loaded = url; ready = false; autoplayBlocked = false; health.status = url ? 'buffering' : 'autoplay'; health.driftMs = null;
    clearTimeout(playerTimeout);
    const frame = el('player');
    frame.parentElement.dataset.provider=kind;
    el('track-art').hidden = true;
    el('track-art').removeAttribute('src');
    frame.parentElement.classList.remove('has-track');
    el('retry-player').hidden = true;
    el('player-placeholder').textContent = url ? 'Загружаем звук ' + media.label(url) + '…' : 'Ведущий скоро включит музыку';
    updateBadge();
    if (!url) { widget?.pause(); return; }
    try {
      if (kind === 'desktop') { frame.hidden = true; widget = window.LolzCloudRoomPlayers.desktop(desktop,{ready:()=>widgetReady(token)}); return; }
      frame.hidden = false;
      if (kind === 'youtube') {
        widget?.destroy?.();
        playerTimeout = setTimeout(()=>playerFailed(token),18000);
        const next = await window.LolzCloudRoomPlayers.youtube(frame,track,{ready:()=>widgetReady(token),changed:playing=>{if(token!==generation)return;if(playing){autoplayBlocked=false;if(started)appAudioPlaying();updateControls();}nativeUpdate();},ended:()=>sourceEnded(token),error:()=>playerFailed(token),blocked:()=>{if(token!==generation)return;autoplayBlocked=true;health.status='autoplay';updateBadge();updateControls();message('Нажми «Разрешить звук здесь» или Play в плеере YouTube.');}});
        if(token!==generation){next.destroy?.();return;} widget=next;
        if(token!==generation)widget.destroy?.(); return;
      }
      const Widget = await soundCloudWidget();
      if (token !== generation || stopped) return;
      playerTimeout = setTimeout(() => playerFailed(token), 12000);
      if (widget) {
        widget.load(url, { auto_play: false, show_comments: false, show_reposts: false, callback: () => widgetReady(token) });
      } else {
        frame.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) + '&auto_play=false&show_comments=false&show_reposts=false';
        widget = Widget(frame);
        widget.bind(Widget.Events.READY, () => widgetReady(token));
        widget.bind(Widget.Events.PLAY,()=>{autoplayBlocked=false;if(started)appAudioPlaying();updateControls();nativeUpdate();});
        for (const name of ['PAUSE', 'SEEK']) widget.bind(Widget.Events[name], nativeUpdate);
        widget.bind(Widget.Events.FINISH, () => sourceEnded(generation));
        widget.bind(Widget.Events.ERROR, () => playerFailed(generation));
      }
    } catch { playerFailed(token); }
  }
  function renderQueue() {
    const signature = JSON.stringify([state.queue, state.canControl, isController(), selectingTrack]); if (signature === queueSignature) return; queueSignature = signature; el('queue-list').replaceChildren(); el('queue-count').textContent = state.queue.length + ' / 50';
    if (!state.queue.length) el('queue-list').append(node('p', 'Предложи первую песню — выберем следующую вместе.', 'empty-state'));
    for (const row of state.queue) {
      const item = node('article', '', 'queue-item'), info = node('div', '', 'queue-info'), actions = node('div', '', 'room-track-actions'); item.dataset.queueId = row.id;
      info.append(node('strong', row.track.title), node('small', row.proposedBy.name + ' · ' + (row.approved ? 'В очереди' : 'Ждёт одобрения')));
      if (state.canControl) actions.append(playNowButton(row.track, row.id));
      actions.append(button((row.voted ? '♥ ' : '♡ ') + row.votes, () => queue({ type: 'vote', id: row.id })));
      if (state.canControl) actions.append(button(row.approved ? 'Отложить' : 'Одобрить', () => queue({ type: 'approve', id: row.id })));
      if (state.canControl || row.proposedBy.id === window.LolzCloudSession?.user.id) actions.append(button('Убрать', () => queue({ type: 'remove', id: row.id })));
      item.append(info, actions); el('queue-list').append(item);
    }
  }
  function playNowButton(track, queueId) {
    const result = button('Включить сейчас', () => chooseTrack(track, queueId)); result.dataset.roomPlay = queueId || track.url;
    result.disabled = selectingTrack || stopped; result.className = 'button primary';
    if (!isController()) result.title = state.host ? 'Взять пульт на этом устройстве и включить трек' : 'Взять свободный пульт и включить трек';
    return result;
  }
  function renderSearchActions() {
    if (!state) return;
    const signature = JSON.stringify([state.canControl, isController(), selectingTrack, stopped, searchTracks]);
    if (signature === searchActionsSignature) return; searchActionsSignature = signature;
    if (el('room-search-status').dataset.results === 'true') el('room-search-status').textContent = state.canControl ? 'Включи сейчас или добавь в общую очередь.' : 'Предложи песню в общую очередь.';
    for (const [position, row] of [...el('room-search-results').children].entries()) {
      const track = searchTracks[position]; if (!track) continue;
      const actions = row.querySelector('.room-track-actions'); if (!actions) continue;
      actions.replaceChildren(); if (state.canControl) actions.append(playNowButton(track));
      actions.append(button(state.canControl ? 'В очередь' : 'Предложить', () => queue({ type: 'add', track })));
    }
  }
  function renderPeople() {
    const signature = JSON.stringify(state.participants); if (signature === peopleSignature) return; peopleSignature = signature; el('participants').replaceChildren(); el('people-count').textContent = state.participants.length;
    for (const user of state.participants) {
      const row = node('div', '', 'person'), info = node('span', '', 'person-info');
      if (window.LolzCloudSocial) info.append(window.LolzCloudSocial.userButton(user, { avatar: false }));
      else { const link = node('a', user.name); link.href = user.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; info.append(link); }
      info.append(node('small', (user.role === 'owner' ? 'Владелец' : user.role === 'dj' ? 'Диджей' : 'Слушатель') + (user.sync?.status === 'buffering' ? ' · загружает трек' : user.sync?.status === 'autoplay' ? ' · ждёт нажатия Play' : user.sync?.status === 'error' ? ' · ошибка трека' : user.online ? ' · в сети' : ' · не в сети')));
      row.append(profileAvatar(user), info);
      if (state.host && user.id !== state.owner.id) { const actions = node('div', '', 'person-actions'); actions.append(button(user.role === 'dj' ? 'Снять DJ' : 'Дать DJ', () => control({ type: 'role', userId: user.id, role: user.role === 'dj' ? 'listener' : 'dj' })), button('Исключить', () => control({ type: 'kick', userId: user.id }))); row.append(actions); }
      el('participants').append(row);
    }
  }
  function profileAvatar(user) {
    const control = button('', () => window.LolzCloudSocial?.open('profile', { userId: user.id })); control.className = 'person-avatar'; control.setAttribute('aria-label', 'Профиль ' + user.name); control.append(avatar(user)); return control;
  }
  function updateChatUnread() {
    const control = el('chat-unread'); if (!control) return;
    control.hidden = !chatUnread; control.textContent = 'Новые сообщения' + (chatUnread ? ' · ' + chatUnread : '') + ' ↓';
  }
  function renderChat() {
    const log = el('chat-messages'), bottom = !chatInitialized || log.scrollHeight - log.scrollTop - log.clientHeight < 70;
    const anchor = [...log.querySelectorAll('[data-message-id]')].find(row => row.offsetTop + row.offsetHeight > log.scrollTop);
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - log.getBoundingClientRect().top : 0, oldScroll = log.scrollTop;
    const ids = new Set(), nodes = []; let previous = null, added = 0;
    for (const entry of state.chat) {
      ids.add(entry.id); let line = chatRows.get(entry.id);
      if (!line) { line = node('article', '', 'chat-message'); line.dataset.messageId = entry.id; chatRows.set(entry.id, line); if (chatInitialized) added++; }
      const grouped = previous && previous.user.id === entry.user.id && entry.at - previous.at < 180000, signature = JSON.stringify([entry, !!grouped]);
      if (line.dataset.signature !== signature) {
        line.dataset.signature = signature; line.classList.toggle('is-grouped', !!grouped); line.classList.toggle('is-own', entry.user.id === window.LolzCloudSession?.user.id);
        const body = node('div', '', 'chat-message-body'), meta = node('div', '', 'chat-meta'), text = node('span', entry.text, 'chat-text'), date = new Date(entry.at), time = node('time', date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
        time.dateTime = Number.isNaN(date.getTime()) ? '' : date.toISOString(); time.title = date.toLocaleString('ru-RU');
        if (window.LolzCloudSocial) meta.append(window.LolzCloudSocial.userButton(entry.user, { avatar: false, badges: false }), window.LolzCloudSocial.titleLine(entry.user, true)); else meta.append(node('strong', entry.user.name));
        meta.append(time); body.append(meta, text); line.replaceChildren(profileAvatar(entry.user), body);
      }
      nodes.push(line); previous = entry;
    }
    for (const key of chatRows.keys()) if (!ids.has(key)) chatRows.delete(key);
    if (!nodes.length) nodes.push(node('p', state.settings.chat ? 'Здесь пока тихо. Поздоровайся с компанией!' : 'Ведущий выключил чат.', 'empty-state'));
    // Existing nodes retain their identity; the input lives outside the log.
    const current = [...log.children]; if (current.length !== nodes.length || current.some((item, index) => item !== nodes[index])) log.replaceChildren(...nodes);
    if (bottom) { log.scrollTop = log.scrollHeight; chatUnread = 0; }
    else { if (anchor?.isConnected) log.scrollTop += anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - anchorOffset; else log.scrollTop = oldScroll; chatUnread += added; }
    chatInitialized = true; updateChatUnread();
  }
  function renderConversation() {
    const signature = JSON.stringify([state.chat, state.settings.chat]); if (signature !== chatSignature) { chatSignature = signature; renderChat(); }
    el('chat-input').disabled = !state.settings.chat; el('chat-form').querySelector('button').disabled = !state.settings.chat || chatSending;
    const reactions = JSON.stringify(state.reactions);
    if (reactions !== reactionSignature) { reactionSignature = reactions; el('reactions').replaceChildren(...state.reactions.slice(-5).map(row => node('span', row.emoji + ' ' + row.user.name, 'reaction-chip'))); }
    const history = JSON.stringify(state.history); if (history !== historySignature) { historySignature = history; el('room-history').replaceChildren(...[...state.history].reverse().map(row => { const line = node('p', '', 'history-track'), link = node('a', row.artist + ' — ' + row.title); link.href = row.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; line.append(link, button('В очередь', () => queue({ type: 'add', track: row }))); return line; })); }
  }
  function render(value) {
    if (stopped || state && (value.epoch < state.epoch || value.epoch === state.epoch && value.revision < state.revision)) return; state = value;
    if(nativeHost())started=true;
    if (lease && value.controller?.connection !== connection) { lease = ''; pendingPublish = null; if (value.controller) message('Ведущий теперь на другом устройстве. Здесь можно продолжить слушать.'); }
    el('room-name').textContent = value.settings.name; el('room-description').textContent = value.settings.description; document.title = value.settings.name + ' · LolzCloud';
    window.LolzCloudSocial?.setRoom({ id, name: value.settings.name, url: value.url });
    el('track-title').textContent = value.playback.url ? value.playback.title || 'Трек SoundCloud' : 'Выбираем первую песню'; el('track-artist').textContent = value.playback.artist;
    el('playback-label').textContent = !value.playback.url ? 'СЦЕНА' : value.playback.playing ? 'СЕЙЧАС ИГРАЕТ' : 'НА ПАУЗЕ';
    el('room-status').textContent = value.reconnecting ? 'Ведущий переподключается. Позиция сохранена.' : value.playback.url && !value.playback.playing ? 'Общая пауза' : '';
    el('claim-host').hidden = !value.canControl || isController(); el('release-host').hidden = !isController(); el('host-controls').hidden = !isController(); el('host-track-form').hidden = !value.canControl; el('controller-info').textContent = value.controller ? value.controller.user.name + ' · ' + value.controller.name : 'Пульт свободен. Владелец или диджей может продолжить.';
    updateControls();
    el('host-seek').max = value.playback.duration || 1; if (document.activeElement !== el('host-seek')) el('host-seek').value = clock.position(value); el('room-settings').hidden = !value.host;
    if (!settingsFilled && value.host) { settingsFilled = true; el('settings-name').value = value.settings.name; el('settings-description').value = value.settings.description; el('settings-public').checked = value.settings.public; el('settings-chat').checked = value.settings.chat; el('settings-auto').checked = value.settings.autoNext; el('settings-capacity').value = value.settings.capacity; }
    for(const [key,id]of [['public','settings-public'],['chat','settings-chat'],['autoNext','settings-auto']])if(!pendingToggles.has(key))el(id).checked=value.settings[key]===true;
    void load(value.playback); renderQueue(); renderSearchActions(); renderPeople(); renderConversation(); updateBadge(); sync();
  }
  function updateControls() {
    const controller = isController();
    el('join').hidden = controller;
    el('join').textContent = autoplayBlocked ? 'Разрешить звук здесь' : started ? 'Выключить звук у меня' : 'Слушать вместе';
    el('host-play').textContent = autoplayBlocked && state?.playback.playing ? 'Разрешить звук здесь' : state?.playback.playing ? 'Пауза у всех' : 'Включить всем';
    el('host-play').disabled = el('host-next').disabled = selectingTrack || stopped;
    el('player').parentElement.dataset.autoplayBlocked = String(autoplayBlocked);
    el('join').disabled = el('resync').disabled = stopped || !state?.playback.url;
    el('queue-url').disabled = el('queue-form').querySelector('button').disabled = stopped || !state;
    document.querySelectorAll('[data-reaction]').forEach(button => { button.disabled = stopped || !state; });
  }
  async function control(data) { if(desktop && ['claim','release'].includes(data.type)){if(data.type==='claim'&&!nativeHost())widget?.pause();desktopState=await desktop[data.type]();await poll();return {room:state};} const result = await call('control', data); if (result.lease) { lease = result.lease; sequence = 0; started = true; appAudioPlaying(); } render(result.room); return result; }
  function publish(patch) {
    if (nativeHost()) { const revision=++nativeRevision;
      if(typeof patch.playing==='boolean'){state.playback={...state.playback,playing:patch.playing};updateControls();}
      return (async()=>{
      if(patch.url)desktopState=await desktop.play(patch.url);
      else {if(Number.isFinite(patch.position))desktopState=await desktop.media('seek',patch.position);if(typeof patch.playing==='boolean')desktopState=await desktop.media(patch.playing?'play':'pause');}
      if(revision===nativeRevision&&desktopState?.room)render(desktopState.room);return true;
    })().catch(error=>{message(error);return false;}); }
    if (stopped || !isController()) return Promise.resolve(false);
    pendingPublish = { ...pendingPublish, ...patch };
    if (!publishing) publishing = (async () => {
      try {
        while (pendingPublish && isController() && !stopped) {
          const update = pendingPublish; pendingPublish = null;
          const playback = { ...state.playback, position: clock.position(state), ...update, rate: 1 };
          const value = await call('state', { lease, connection, sequence: ++sequence, fresh: true, private: false, playback }, 'PUT');
          render(value);
        }
        return !stopped && isController();
      } catch (error) {
        pendingPublish = null;
        if (error.status === 409) { lease = ''; void poll(); }
        message(error);
        return false;
      }
    })().finally(() => { publishing = null; });
    return publishing;
  }
  async function queue(data) { const value = await call('queue', { ...data, lease, connection }); render(value.room); return value; }
  async function chooseTrack(track, queueId) {
    if (selectingTrack || stopped) return false;
    if (!state?.canControl) throw new Error('Слушатель может предложить песню в общую очередь.');
    if (!media.mediaUrl(track?.url)) throw new Error('Нужна ссылка SoundCloud или YouTube Music.');
    selectingTrack = true; selectionCommitted = false; autoplayBlocked = false; lastApplied = performance.now();
    // Stop local audio without playing the outgoing recording to unlock media.
    widget?.pause(); updateControls(); renderQueue(); renderSearchActions();
    try {
      message(isController() ? 'Готовим выбранный трек…' : state.host ? 'Переносим пульт на это устройство…' : 'Подключаем свободный пульт…');
      if (publishing) await publishing;
      if (!isController()) await control({ type: 'claim', connection, force: state.host === true, name: /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Телефон' : 'Браузер' });
      if (!isController() || !activeLease()) throw new Error('Не удалось взять пульт. Обнови состояние и повтори выбор.');
      started = true; appAudioPlaying();
      let result;
      if (queueId && nativeHost()) {
        if (typeof desktop.playQueued !== 'function') throw new Error('Обнови приложение, чтобы включать конкретный трек очереди.');
        desktopState = await desktop.playQueued(queueId); if (desktopState?.room) render(desktopState.room); result = true;
      } else if (queueId) {
        const selected = await control({ type: 'play-queue', id: queueId, connection, lease, sequence: ++sequence });
        selectionCommitted = true; result = await openTrack(selected.track.url, selected.track, true);
      } else {
        selectionCommitted = true; result = await openTrack(track.url, track);
      }
      if (result !== false) { message(''); closeRoomSheet(); }
      return result;
    } finally {
      selectingTrack = false; selectionCommitted = false; updateControls(); renderQueue(); renderSearchActions(); sync(true);
    }
  }
  function nextTrack(automatic = false) {
    if (stopped || selectingTrack || !isController() || !activeLease()) return Promise.resolve(false);
    const key = playbackKey();
    return advanceGate.run(key, automatic, async () => {
      if (key !== playbackKey() || stopped || !isController() || !activeLease()) return false;
      lastApplied = performance.now(); widget?.pause();
      if (nativeHost()) {
        const value = await desktop.next({ automatic, expectedUrl: loaded, expectedEpoch: state.epoch, expectedController: state.controller?.connection });
        if (key !== playbackKey() || !nativeHost() || !activeLease()) return false;
        desktopState = value; if (value?.room) render(value.room); return true;
      }
      const value = await queue({ type: 'next' });
      if (key !== playbackKey() || stopped || !isController() || !activeLease()) return false;
      if (value.track) return openTrack(value.track.url, value.track);
      return publish({ playing: false, ...(automatic && state.playback.duration > 0 ? { position: state.playback.duration } : {}) });
    }).finally(() => { if (!stopped && isController()) sync(true); });
  }
  async function openTrack(url, selected = {}, alreadySelected = false) {
    if (!isController()) throw new Error('Сначала нажми «Вести здесь».');
    url = media.mediaUrl(url); if(!url)throw new Error('Нужна ссылка SoundCloud или YouTube Music.');
    requestedPlaybackUrl = url;
    if(nativeHost()){desktopState=await desktop.play(url);if(desktopState?.room)render(desktopState.room);requestedPlaybackUrl='';return true;}
    const sameRecording = loaded === url && (ready || health.status === 'error');
    if (!alreadySelected && !await publish({ url, title: selected.title || url.split('/').pop(), artist: selected.artist || '', duration: selected.duration || 0, position: 0, playing: false }) || state.playback.url !== url) return false;
    if (sameRecording) await load(state.playback, true);
    const token = generation, deadline = performance.now() + 23000;
    await new Promise((resolve, reject) => { const timer = setInterval(() => { if (token !== generation || stopped || !isController()) { clearInterval(timer); reject(new Error('Трек или ведущий сменился.')); } else if (ready) { clearInterval(timer); resolve(); } else if (health.status === 'error' || performance.now() > deadline) { clearInterval(timer); reject(new Error('Источник не открыл трек. Нажми «Повторить» или выбери другую запись.')); } }, 100); });
    return new Promise((resolve, reject) => {
      let complete = false;
      const timer = setTimeout(() => { complete = true; reject(new Error('Источник не подтвердил сведения о треке. Повтори выбор.')); }, 5000);
      widget.getCurrentSound(sound => {
        if (complete) return; complete = true; clearTimeout(timer);
        if (token !== generation || !isController() || !activeLease() || state.playback.url !== url) return resolve(false);
        resolve(publish({ title: sound?.title || state.playback.title, artist: sound?.user?.username || state.playback.artist || '', duration: (sound?.duration || 0) / 1000 || state.playback.duration, position: 0, playing: true }).then(result => { if (result) requestedPlaybackUrl = ''; return result; }));
      });
    });
  }
  function stream() {
    eventStream?.close(); eventStream = new EventSource('/api/rooms/' + id + '/events');
    eventStream.addEventListener('state', event => { try { const value = JSON.parse(event.data); if (clock.offset === null) clock.sample(value.serverTime, performance.now(), performance.now()); lastStateAt = performance.now(); render(value); } catch (error) { message(error); } });
    eventStream.addEventListener('closed', () => close('Комната закрыта или доступ отозван.'));
    eventStream.onerror = () => { void poll(); };
  }
  function close(reason) {
    stopped = true; ready = false; generation++; started = false; lease = ''; pendingPublish = null;
    clearTimeout(playerTimeout); widget?.pause(); eventStream?.close();
    el('host-controls').hidden = el('claim-host').hidden = el('release-host').hidden = true;
    el('chat-input').disabled = el('chat-form').querySelector('button').disabled = true;
    updateControls(); updateBadge(); message(reason);
  }
  async function poll() {
    if (busyJoin || stopped) return;
    busyJoin = true;
    try {
      if (!await window.LolzCloudSessionReady) return;
      if(desktop)desktopState=await desktop.state();
      const value = await call('join', { connection, health });
      lastStateAt = performance.now(); render(value);
      if (!eventStream) stream();
    } catch (error) {
      if ([401, 403, 404].includes(error.status)) close(error.message);
      else if (!state) message(error);
    } finally { busyJoin = false; }
  }
  el('join').onclick = () => {
    if (isController()) { toggleHostPlayback(); return; }
    started = autoplayBlocked || !started; autoplayBlocked = false; updateControls();
    if(started)appAudioPlaying();
    if (started && ready && state.playback.playing) { lastApplied = performance.now(); playHere(); }
    sync(started); void poll();
  };
  function toggleHostPlayback() {
    if (selectingTrack || stopped || !isController()) return;
    if (state.playback.playing && (autoplayBlocked || !started)) {
      started = true; autoplayBlocked = false; appAudioPlaying(); playHere(); updateControls(); sync(true); return;
    }
    started = true;
    if (!state.playback.playing) { autoplayBlocked = false; appAudioPlaying(); if (ready) playHere(); }
    void publish({ playing: !state.playback.playing });
  }
  el('resync').onclick = () => { started = true; autoplayBlocked = false; appAudioPlaying(); updateControls(); sync(true); };
  el('retry-player').onclick = () => {
    if (!state || stopped) return;
    if (isController() && requestedPlaybackUrl === state.playback.url) void chooseTrack(state.playback).catch(message);
    else void load(state.playback, true);
  };
  el('volume').oninput = () => widget?.setVolume(Number(el('volume').value));
  el('copy-invite').onclick = async () => {
    if (window.LolzCloudSocial) { await window.LolzCloudSocial.open('friends', { roomId: id }); return; }
    const invite = location.origin + '/room/' + id + '/';
    try { await navigator.clipboard.writeText(invite); message('Приглашение скопировано.'); }
    catch { message('Ссылка для приглашения: ' + invite); }
  };
  el('claim-host').onclick = () => control({ type: 'claim', connection, force: state?.host === true, name: 'Браузер' }).catch(message); el('release-host').onclick = () => control({ type: 'release', connection, lease }).then(() => { lease = ''; }).catch(message);
  el('host-track-form').onsubmit = event => { event.preventDefault(); void chooseTrack({ url: el('host-track').value.trim() }).catch(message); }; el('host-play').onclick = toggleHostPlayback; el('host-next').onclick = () => nextTrack().catch(message); el('host-seek').onchange = () => seekRoom(el('host-seek').value).catch(message);
  let searchRevision = 0;
  el('room-search-form').onsubmit = async event => {
    event.preventDefault();const revision=++searchRevision,query=el('room-search-query').value.trim();el('room-search-status').dataset.results='false';el('room-search-status').textContent='Ищем музыку…';
    try {
      const result=await request('/api/music/search?q='+encodeURIComponent(query));if(revision!==searchRevision)return;
      searchTracks=(Array.isArray(result.tracks)?result.tracks:[]).filter(track=>media.mediaUrl(track?.url)).slice(0,20);
      el('room-search-results').replaceChildren();el('room-search-status').dataset.results=String(searchTracks.length>0);el('room-search-status').textContent=searchTracks.length?'':'Ничего не найдено. Можно вставить ссылку SoundCloud или YouTube.';
      for(const track of searchTracks){const row=node('article','','room-search-result'),info=node('div','');row.dataset.trackUrl=track.url;info.append(node('strong',track.title),node('small',track.artist));row.append(info,node('div','','room-track-actions'));el('room-search-results').append(row);
      }
      searchActionsSignature='';renderSearchActions();
    } catch(error){if(revision===searchRevision)el('room-search-status').textContent=error.message;}
  };
  el('queue-form').onsubmit = async event => { event.preventDefault(); try { await queue({ type: 'add', track: { url: el('queue-url').value } }); el('queue-url').value = ''; } catch (error) { message(error); } };
  const roomSheet = el('room-sheet'); let sheetReturnFocus = null;
  function roomTab(tab, focus = false) {
    if (!['music', 'queue', 'people'].includes(tab)) tab = 'music';
    for (const name of ['music', 'queue', 'people']) {
      const selected = name === tab, button = el('room-tab-' + name);
      el('room-panel-' + name).hidden = !selected; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    if (history.state?.lolzcloudRoomSheet === id) history.replaceState({ ...history.state, tab }, '', location.href);
    if (focus) el('room-tab-' + tab).focus({ preventScroll: true });
    return tab;
  }
  function openRoomSheet(tab = 'music', fromHistory = false, opener = null) {
    if (!roomSheet) return;
    const opening = !roomSheet.open;
    if (opening) { sheetReturnFocus = opener || document.activeElement; roomSheet.showModal(); }
    tab = roomTab(tab);
    if (!fromHistory && history.state?.lolzcloudRoomSheet !== id) history.pushState({ lolzcloudRoomSheet: id, tab }, '', location.href);
    document.querySelectorAll('[data-room-open]').forEach(button => button.setAttribute('aria-expanded', 'true'));
    if (opening && !fromHistory) (tab === 'music' ? el('room-search-query') : el('room-tab-' + tab)).focus({ preventScroll: true });
  }
  function closeRoomSheet(fromHistory = false) {
    if (!roomSheet?.open) return;
    roomSheet.close(); document.querySelectorAll('[data-room-open]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (!fromHistory && history.state?.lolzcloudRoomSheet === id) history.back();
    if (sheetReturnFocus?.isConnected) sheetReturnFocus.focus({ preventScroll: true });
  }
  if (roomSheet) {
    for (const button of document.querySelectorAll('[data-room-open]')) { button.setAttribute('aria-expanded', 'false'); button.onclick = () => openRoomSheet(button.dataset.roomOpen, false, button); }
    for (const button of document.querySelectorAll('[data-room-tab]')) {
      button.onclick = () => roomTab(button.dataset.roomTab);
      button.onkeydown = event => {
        const names = ['music', 'queue', 'people'], index = names.indexOf(button.dataset.roomTab);
        const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
        if (next >= 0) { event.preventDefault(); roomTab(names[next], true); }
      };
    }
    el('room-sheet-close').onclick = () => closeRoomSheet();
    roomSheet.addEventListener('cancel', event => { event.preventDefault(); closeRoomSheet(); });
    window.addEventListener('popstate', () => { if (history.state?.lolzcloudRoomSheet === id) openRoomSheet(history.state.tab, true); else closeRoomSheet(true); });
    const viewportHeight = () => document.documentElement.style.setProperty('--room-viewport-height', (window.visualViewport?.height || innerHeight) + 'px');
    window.visualViewport?.addEventListener('resize', viewportHeight); window.addEventListener('resize', viewportHeight); viewportHeight();
  }
  el('chat-form').onsubmit = async event => {
    event.preventDefault(); if (chatSending || !state?.settings.chat) return;
    const input = el('chat-input'), submitted = input.value; if (!submitted.trim()) return;
    chatSending = true; el('chat-form').querySelector('button').disabled = true;
    try {
      render(await call('message', { text: submitted })); if (input.value === submitted) input.value = '';
      el('chat-messages').scrollTop = el('chat-messages').scrollHeight; chatUnread = 0; updateChatUnread();
    } catch (error) { message(error); }
    finally { chatSending = false; el('chat-form').querySelector('button').disabled = !state?.settings.chat; }
  };
  if (el('chat-unread')) el('chat-unread').onclick = () => { el('chat-messages').scrollTop = el('chat-messages').scrollHeight; chatUnread = 0; updateChatUnread(); };
  el('chat-messages').addEventListener('scroll', () => { const log = el('chat-messages'); if (log.scrollHeight - log.scrollTop - log.clientHeight < 30) { chatUnread = 0; updateChatUnread(); } });
  document.querySelectorAll('[data-reaction]').forEach(button => { button.onclick = () => call('message', { type: 'reaction', emoji: button.dataset.reaction }).then(render).catch(message); });
  el('settings-form').onsubmit = event => { event.preventDefault(); void control({ type: 'settings', settings: { name: el('settings-name').value, description: el('settings-description').value, public: el('settings-public').checked, chat: el('settings-chat').checked, autoNext: el('settings-auto').checked, capacity: Number(el('settings-capacity').value) } }).catch(message); };
  for(const [key,id]of [['public','settings-public'],['chat','settings-chat'],['autoNext','settings-auto']])el(id).onchange=async()=>{
    const input=el(id);pendingToggles.add(key);input.disabled=true;
    try{await control({type:'settings',settings:{[key]:input.checked}});message('Сохранено');}
    catch(error){message(error);}
    finally{pendingToggles.delete(key);input.disabled=false;if(state)input.checked=state.settings[key]===true;}
  };
  window.addEventListener('online', () => { void calibrate(); void poll(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden) { void calibrate(); void poll(); sync(true); } });
  window.addEventListener('pagehide', () => { eventStream?.close(); const csrf = window.LolzCloudSession?.csrf; if (csrf) { if (lease) void fetch('/api/rooms/' + id + '/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ type: 'release', connection, lease }), keepalive: true }); void fetch('/api/rooms/' + id + '/leave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ connection }), keepalive: true }); } });
  setInterval(() => {
    if (stopped) return;
    updateBadge(); sync();
    if(isController()&&!nativeHost()&&!selectingTrack&&!started&&ready&&state.playback.playing&&atEnd(target(),0)&&!advanceGate.pending)void finishTrack().catch(message);
    if (isController() && !nativeHost() && (!selectingTrack || selectionCommitted) && performance.now() - lastHeartbeat > 4000) {
      lastHeartbeat = performance.now();
      const token = generation, revision = state.revision;
      // Keep the controller lease alive during a slow source load without
      // sampling the outgoing player's position into the incoming recording.
      if (selectingTrack || advanceGate.pending || !started || !ready || !widget) void publish({});
      else samplePlayer(position => {
        if (token === generation && revision === state.revision && started && isController() && !advanceGate.pending) void publish({ position: position / 1000 });
      });
    }
  }, 1000);
  // A separate five-second timer avoids rounding a scheduled correction up to
  // the next one-second UI/heartbeat tick after an asynchronously loaded track.
  setInterval(() => { if (!stopped) sync(false, true); }, 5000);
  window.LolzCloudRoomPlayback={command(type,value){
    if(!widget||!ready)return false;
    if(type==='volume'||type==='volumeUp'||type==='volumeDown'){const control=el('volume');control.value=Math.max(0,Math.min(100,type==='volume'?Number(value)*100:Number(control.value)+(type==='volumeUp'?5:-5)));widget.setVolume(Number(control.value));return true;}
    if(type==='playPause')started=!started;else if(type==='pause')started=false;else if(type==='play')started=true;else return false;
    if(started){appAudioPlaying();widget.play();}else {lastApplied=performance.now();widget.pause();}updateControls();sync(started);return true;
  }};
  if(desktop)setInterval(()=>{if(stopped||nativeHost()||!state?.playback.url)return;samplePlayer((position,paused)=>{if(!nativeHost())desktop.listen({...state.playback,position:position/1000,playing:started&&!paused,rate:1});});},400);
  updateControls();
  setInterval(poll, 8000); setInterval(() => { if (!stopped) void calibrate(); }, 30000);
  window.LolzCloudSessionReady.then(session => { if (!session) return; void calibrate(); void poll(); });
})();
