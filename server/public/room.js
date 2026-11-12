(() => {
  'use strict';
  const { request, avatar } = window.LolzCloudSite, { RoomClock, DriftCorrection } = window.LolzCloudRoomSync, el = id => document.getElementById(id), id = location.pathname.match(/\/room\/([a-f0-9]{32})/)?.[1];
  const desktop = window.LolzCloudDesktopRoom, media = window.LolzCloudMedia;
  let desktopState = null, playerKind = '', nativeRevision=0;
  const nativeHost = () => desktopState?.hosting && state?.controller?.connection === desktopState.connection;
  const connection = crypto.randomUUID(), clock = new RoomClock(), correction = new DriftCorrection();
  let state = null, widget = null, widgetScript = null, playerTimeout, loaded = '', ready = false, started = false, stopped = false, lease = '', sequence = 0, publishing = null, pendingPublish = null, lastApplied = 0, lastHeartbeat = 0, busyJoin = false, eventStream = null, lastStateAt = 0, queueSignature = '', peopleSignature = '', chatSignature = '', historySignature = '', reactionSignature = '', generation = 0, settingsFilled = false;
  const health = { status: 'autoplay', driftMs: null }, isController = () => nativeHost() || !!lease && state?.controller?.connection === connection, target = () => clock.position(state) * 1000;
  const pendingToggles = new Set();
  let autoplayBlocked = false;
  const message = error => { el('status').textContent = error instanceof Error ? error.message : String(error || ''); };
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
  function sync(force = false) {
    if (stopped || !widget || !ready || !state || !loaded) return;
    if (nativeHost()) { health.status = 'ready'; health.driftMs = 0; updateBadge(); return; }
    if (lastStateAt && performance.now() - lastStateAt > 15000) { widget.pause(); health.status = 'buffering'; updateBadge(); return; }
    if (!started) { lastApplied = performance.now(); widget.pause(); health.status = 'autoplay'; health.driftMs = null; updateBadge(); return; }
    const source = loaded, token = generation;
    widget.isPaused(paused => { if (stopped || !started || token !== generation || source !== loaded) return; if (state.playback.playing === paused) { lastApplied = performance.now(); state.playback.playing ? widget.play() : widget.pause(); } });
    widget.getPosition(position => { if (stopped || !started || token !== generation || state.playback.url !== source) return; const decision = correction.decide(position, target(), performance.now(), source, force); health.driftMs = Math.round(decision.drift); if (decision.seek) seekNow(Math.max(0, decision.position)); health.status = autoplayBlocked ? 'autoplay' : 'ready'; updateBadge(); });
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
  function nativeUpdate() { if (!isController() || performance.now() - lastApplied < 800 || !ready) return; const token = generation; widget.getPosition(position => widget.isPaused(paused => { if (token === generation && isController()) void publish({ position: position / 1000, playing: !paused }); })); }
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
    if (widget && (kind !== playerKind || kind === 'youtube')) { const old=el('player'), parent=old?.parentElement;widget.pause();widget.destroy?.();widget=null;const replacement=document.createElement('iframe');replacement.id='player';replacement.title='Плеер комнаты';replacement.allow='autoplay; encrypted-media; fullscreen';if(old?.isConnected)old.replaceWith(replacement);else parent?.append(replacement); }
    playerKind = kind;
    const token = ++generation;
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
        const next = await window.LolzCloudRoomPlayers.youtube(frame,track,{ready:()=>widgetReady(token),changed:playing=>{if(token!==generation)return;if(playing)autoplayBlocked=false;nativeUpdate();},ended:()=>{if(isController()&&state.settings.autoNext)void nextTrack().catch(message)},error:()=>playerFailed(token),blocked:()=>{if(token!==generation)return;autoplayBlocked=true;health.status='autoplay';updateBadge();message('Нажми Play в плеере YouTube, чтобы разрешить звук.');}});
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
        for (const name of ['PLAY', 'PAUSE', 'SEEK']) widget.bind(Widget.Events[name], nativeUpdate);
        widget.bind(Widget.Events.FINISH, () => { if (ready && !stopped && isController() && state.settings.autoNext) void nextTrack().catch(message); });
        widget.bind(Widget.Events.ERROR, () => playerFailed(generation));
      }
    } catch { playerFailed(token); }
  }
  function renderQueue() {
    const signature = JSON.stringify([state.queue, state.canControl]); if (signature === queueSignature) return; queueSignature = signature; el('queue-list').replaceChildren(); el('queue-count').textContent = state.queue.length + ' / 50';
    if (!state.queue.length) el('queue-list').append(node('p', 'Предложи первую песню — выберем следующую вместе.', 'empty-state'));
    for (const row of state.queue) { const item = node('article', '', 'queue-item'), info = node('div', '', 'queue-info'); info.append(node('strong', row.track.title), node('small', row.proposedBy.name + ' · ' + (row.approved ? 'В очереди' : 'Ждёт одобрения'))); item.append(info, button((row.voted ? '♥ ' : '♡ ') + row.votes, () => queue({ type: 'vote', id: row.id }))); if (state.canControl) item.append(button(row.approved ? 'Отложить' : 'Одобрить', () => queue({ type: 'approve', id: row.id }))); if (state.canControl || row.proposedBy.id === window.LolzCloudSession?.user.id) item.append(button('Убрать', () => queue({ type: 'remove', id: row.id }))); el('queue-list').append(item); }
  }
  function renderPeople() {
    const signature = JSON.stringify(state.participants); if (signature === peopleSignature) return; peopleSignature = signature; el('participants').replaceChildren(); el('people-count').textContent = state.participants.length;
    for (const user of state.participants) { const row = node('div', '', 'person'), info = node('span', '', 'person-info'), link = node('a', user.name); link.href = user.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; info.append(link, node('small', (user.role === 'owner' ? 'Владелец' : user.role === 'dj' ? 'Диджей' : 'Слушатель') + (user.sync?.status === 'buffering' ? ' · загружает трек' : user.sync?.status === 'autoplay' ? ' · ждёт нажатия Play' : user.sync?.status === 'error' ? ' · ошибка трека' : user.online ? ' · в сети' : ' · не в сети'))); row.append(avatar(user), info); if (state.host && user.id !== state.owner.id) row.append(button(user.role === 'dj' ? 'Снять DJ' : 'Дать DJ', () => control({ type: 'role', userId: user.id, role: user.role === 'dj' ? 'listener' : 'dj' })), button('Исключить', () => control({ type: 'kick', userId: user.id }))); el('participants').append(row); }
  }
  function renderConversation() {
    const signature = JSON.stringify([state.chat, state.settings.chat]); if (signature !== chatSignature) { chatSignature = signature; const bottom = el('chat-messages').scrollHeight - el('chat-messages').scrollTop - el('chat-messages').clientHeight < 70; el('chat-messages').replaceChildren(); if (!state.chat.length) el('chat-messages').append(node('p', state.settings.chat ? 'Здесь пока тихо. Поздоровайся с компанией!' : 'Ведущий выключил чат.', 'empty-state')); for (const row of state.chat) { const line = node('p', '', 'chat-message'); line.append(node('strong', row.user.name), node('span', row.text)); el('chat-messages').append(line); } if (bottom) el('chat-messages').scrollTop = el('chat-messages').scrollHeight; }
    el('chat-input').disabled = el('chat-form').querySelector('button').disabled = !state.settings.chat;
    const reactions = JSON.stringify(state.reactions);
    if (reactions !== reactionSignature) { reactionSignature = reactions; el('reactions').replaceChildren(...state.reactions.slice(-5).map(row => node('span', row.emoji + ' ' + row.user.name, 'reaction-chip'))); }
    const history = JSON.stringify(state.history); if (history !== historySignature) { historySignature = history; el('room-history').replaceChildren(...[...state.history].reverse().map(row => { const line = node('p', '', 'history-track'), link = node('a', row.artist + ' — ' + row.title); link.href = row.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; line.append(link, button('В очередь', () => queue({ type: 'add', track: row }))); return line; })); }
  }
  function render(value) {
    if (stopped || state && (value.epoch < state.epoch || value.epoch === state.epoch && value.revision < state.revision)) return; state = value;
    if(nativeHost())started=true;
    if (lease && value.controller?.connection !== connection) { lease = ''; pendingPublish = null; if (value.controller) message('Ведущий теперь на другом устройстве. Здесь можно продолжить слушать.'); }
    el('room-name').textContent = value.settings.name; el('room-description').textContent = value.settings.description; document.title = value.settings.name + ' · LolzCloud';
    el('track-title').textContent = value.playback.url ? value.playback.title || 'Трек SoundCloud' : 'Выбираем первую песню'; el('track-artist').textContent = value.playback.artist;
    el('playback-label').textContent = !value.playback.url ? 'СЦЕНА' : value.playback.playing ? 'СЕЙЧАС ИГРАЕТ' : 'НА ПАУЗЕ';
    el('room-status').textContent = value.reconnecting ? 'Ведущий переподключается. Позиция сохранена.' : value.playback.url && !value.playback.playing ? 'Общая пауза' : '';
    el('claim-host').hidden = !value.canControl || isController(); el('release-host').hidden = !isController(); el('host-controls').hidden = !isController(); el('controller-info').textContent = value.controller ? value.controller.user.name + ' · ' + value.controller.name : 'Пульт свободен. Владелец или диджей может продолжить.';
    updateControls();
    el('host-seek').max = value.playback.duration || 1; if (document.activeElement !== el('host-seek')) el('host-seek').value = clock.position(value); el('room-settings').hidden = !value.host;
    if (!settingsFilled && value.host) { settingsFilled = true; el('settings-name').value = value.settings.name; el('settings-description').value = value.settings.description; el('settings-public').checked = value.settings.public; el('settings-chat').checked = value.settings.chat; el('settings-auto').checked = value.settings.autoNext; el('settings-capacity').value = value.settings.capacity; }
    for(const [key,id]of [['public','settings-public'],['chat','settings-chat'],['autoNext','settings-auto']])if(!pendingToggles.has(key))el(id).checked=value.settings[key]===true;
    void load(value.playback); renderQueue(); renderPeople(); renderConversation(); updateBadge(); sync();
  }
  function updateControls() {
    el('join').textContent = isController() && state.playback.playing ? 'Пауза для всех' : !isController() && started ? 'Выключить звук у меня' : 'Слушать вместе';
    el('join').disabled = el('resync').disabled = stopped || !state?.playback.url;
    el('queue-url').disabled = el('queue-form').querySelector('button').disabled = stopped || !state;
    document.querySelectorAll('[data-reaction]').forEach(button => { button.disabled = stopped || !state; });
  }
  async function control(data) { if(desktop && ['claim','release'].includes(data.type)){if(data.type==='claim'&&!nativeHost())widget?.pause();desktopState=await desktop[data.type]();await poll();return {room:state};} const result = await call('control', data); if (result.lease) { lease = result.lease; sequence = 0; started = true; } render(result.room); return result; }
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
  async function nextTrack() { if (!isController()) return; if(nativeHost()){desktopState=await desktop.next();if(desktopState?.room)render(desktopState.room);return;} const value = await queue({ type: 'next' }); if (value.track) await openTrack(value.track.url); else await publish({ playing: false }); }
  async function openTrack(url) {
    if (!isController()) throw new Error('Сначала нажми «Вести здесь».');
    url = media.mediaUrl(url); if(!url)throw new Error('Нужна ссылка SoundCloud или YouTube Music.');
    if(nativeHost()){desktopState=await desktop.play(url);if(desktopState?.room)render(desktopState.room);return;}
    if (!await publish({ url, title: url.split('/').pop(), artist: '', duration: 0, position: 0, playing: false }) || state.playback.url !== url) return;
    const token = generation, deadline = performance.now() + 23000;
    await new Promise((resolve, reject) => { const timer = setInterval(() => { if (token !== generation || stopped || !isController()) { clearInterval(timer); reject(new Error('Трек или ведущий сменился.')); } else if (ready) { clearInterval(timer); resolve(); } else if (health.status === 'error' || performance.now() > deadline) { clearInterval(timer); reject(new Error('SoundCloud не открыл трек. Попробуй загрузить звук ещё раз.')); } }, 100); });
    widget.getCurrentSound(sound => { if (token === generation && isController()) void publish({ title: sound?.title || state.playback.title, artist: sound?.user?.username || '', duration: (sound?.duration || 0) / 1000, position: 0, playing: true }); });
  }
  function stream() {
    eventStream?.close(); eventStream = new EventSource('/api/rooms/' + id + '/events');
    eventStream.addEventListener('state', event => { try { const value = JSON.parse(event.data); if (clock.offset === null) clock.sample(value.serverTime, performance.now(), performance.now()); lastStateAt = performance.now(); render(value); } catch (error) { message(error); } });
    eventStream.addEventListener('closed', () => close('Комната закрыта или доступ отозван.'));
    eventStream.onerror = () => { void poll(); };
  }
  function close(reason) {
    stopped = true; started = false; lease = ''; pendingPublish = null;
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
    if (isController()) { started = true; if(!state.playback.playing && ready)widget?.play(); void publish({ playing: !state.playback.playing }); return; }
    started = !started; updateControls();
    if (started && ready && state.playback.playing) { lastApplied = performance.now(); widget.play(); }
    sync(started); void poll();
  };
  el('resync').onclick = () => { started = true; updateControls(); sync(true); };
  el('retry-player').onclick = () => { if (state && !stopped) void load(state.playback, true); };
  el('volume').oninput = () => widget?.setVolume(Number(el('volume').value));
  el('copy-invite').onclick = async () => {
    const invite = location.origin + '/room/' + id + '/';
    try { await navigator.clipboard.writeText(invite); message('Приглашение скопировано.'); }
    catch { message('Ссылка для приглашения: ' + invite); }
  };
  el('claim-host').onclick = () => control({ type: 'claim', connection, force: state?.host === true, name: 'Браузер' }).catch(message); el('release-host').onclick = () => control({ type: 'release', connection, lease }).then(() => { lease = ''; }).catch(message);
  el('host-track-form').onsubmit = event => { event.preventDefault(); void openTrack(el('host-track').value.trim()).catch(message); }; el('host-play').onclick = () => { if(!state.playback.playing && ready)widget?.play();return publish({ playing: !state.playback.playing }); }; el('host-next').onclick = () => nextTrack().catch(message); el('host-seek').onchange = () => publish({ position: Number(el('host-seek').value) });
  let searchRevision = 0;
  el('room-search-form').onsubmit = async event => {
    event.preventDefault();const revision=++searchRevision,query=el('room-search-query').value.trim();el('room-search-status').textContent='Ищем музыку…';
    try {
      const result=await request('/api/music/search?q='+encodeURIComponent(query));if(revision!==searchRevision)return;
      el('room-search-results').replaceChildren();el('room-search-status').textContent=result.tracks.length?'Выбери песню для общей очереди':'Ничего не найдено. Можно вставить ссылку SoundCloud или YouTube.';
      for(const track of result.tracks){const row=node('article','','room-search-result'),info=node('div','');info.append(node('strong',track.title),node('small',track.artist));row.append(info);
        if(isController())row.append(button('Включить всем',()=>openTrack(track.url)));
        row.append(button(isController()?'В очередь':'Предложить',()=>queue({type:'add',track})));el('room-search-results').append(row);
      }
    } catch(error){if(revision===searchRevision)el('room-search-status').textContent=error.message;}
  };
  el('queue-form').onsubmit = async event => { event.preventDefault(); try { await queue({ type: 'add', track: { url: el('queue-url').value } }); el('queue-url').value = ''; } catch (error) { message(error); } };
  el('chat-form').onsubmit = async event => { event.preventDefault(); try { render(await call('message', { text: el('chat-input').value })); el('chat-input').value = ''; } catch (error) { message(error); } }; document.querySelectorAll('[data-reaction]').forEach(button => { button.onclick = () => call('message', { type: 'reaction', emoji: button.dataset.reaction }).then(render).catch(message); });
  el('settings-form').onsubmit = event => { event.preventDefault(); void control({ type: 'settings', settings: { name: el('settings-name').value, description: el('settings-description').value, public: el('settings-public').checked, chat: el('settings-chat').checked, autoNext: el('settings-auto').checked, capacity: Number(el('settings-capacity').value) } }).catch(message); };
  for(const [key,id]of [['public','settings-public'],['chat','settings-chat'],['autoNext','settings-auto']])el(id).onchange=async()=>{
    const input=el(id);pendingToggles.add(key);input.disabled=true;
    try{await control({type:'settings',settings:{[key]:input.checked}});message('Сохранено');}
    catch(error){message(error);}
    finally{pendingToggles.delete(key);input.disabled=false;if(state)input.checked=state.settings[key]===true;}
  };
  window.addEventListener('online', () => { void calibrate(); void poll(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden) { void calibrate(); void poll(); sync(true); } });
  window.addEventListener('pagehide', () => { eventStream?.close(); const csrf = window.LolzCloudSession?.csrf; if (csrf) { if (lease) void fetch('/api/rooms/' + id + '/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ type: 'release', connection, lease }), keepalive: true }); void fetch('/api/rooms/' + id + '/leave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ connection }), keepalive: true }); } });
  setInterval(() => { if (stopped) return; updateBadge(); sync(); if (isController() && !nativeHost() && performance.now() - lastHeartbeat > 4000) { lastHeartbeat = performance.now(); const token = generation, revision = state.revision; if (ready && widget) widget.getPosition(position => { if (token === generation && revision === state.revision && isController()) void publish({ position: position / 1000 }); }); else void publish({}); } }, 1000);
  window.LolzCloudRoomPlayback={command(type,value){
    if(!widget||!ready)return false;
    if(type==='volume'||type==='volumeUp'||type==='volumeDown'){const control=el('volume');control.value=Math.max(0,Math.min(100,type==='volume'?Number(value)*100:Number(control.value)+(type==='volumeUp'?5:-5)));widget.setVolume(Number(control.value));return true;}
    if(type==='playPause')started=!started;else if(type==='pause')started=false;else if(type==='play')started=true;else return false;
    if(started)widget.play();else widget.pause();updateControls();sync(started);return true;
  }};
  if(desktop)setInterval(()=>{if(stopped||nativeHost()||!ready||!widget||!state?.playback.url)return;const token=generation;widget.getPosition(position=>widget.isPaused(paused=>{if(token!==generation)return;desktop.listen({...state.playback,position:position/1000,playing:started&&!paused,rate:1});}));},400);
  updateControls();
  setInterval(poll, 8000); setInterval(() => { if (!stopped) void calibrate(); }, 30000);
  window.LolzCloudSessionReady.then(session => { if (!session) return; void calibrate(); void poll(); });
})();
