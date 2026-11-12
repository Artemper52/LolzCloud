(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const { ROOM_PARTITION } = require('../integrations/room-view.cjs');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const roomStyles = readFileSync(join(__dirname, 'lib/css/room-stage.css'), 'utf8');
  const el = id => document.getElementById('lc-room-' + id);
  const lobby = el('lobby'), stage = el('stage'), content = el('stage-content');
  const filters = [...lobby.querySelectorAll('[data-room-filter]')];
  let rooms = [], filter = 'public', authenticated = false, ready = false;
  let listing = false, pending = false, listError = '', actionError = '', lastList = 0;
  let guest = null, activeUrl = '', navigation = 0, cardsSignature = '';
  function sessionChanged() {
    document.body.classList.toggle('room-stage-open', !!activeUrl && document.body.dataset.view === 'room');
    const button = document.querySelector('[data-view=room]');
    if (button) {
      button.dataset.connected = String(!!activeUrl);
      button.title = activeUrl ? 'Комната подключена · вернуться' : 'Комнаты';
    }
    window.dispatchEvent(new CustomEvent('lolzcloud:room-session', { detail: { active: !!activeUrl } }));
  }
  window.LolzCloudRooms = { get active() { return !!activeUrl; }, leave: () => leave() };

  async function request(type, url) {
    const reply = await ipcRenderer.invoke('rooms:action', { type, url });
    if (!reply.ok) throw new Error(reply.error);
    return reply.result;
  }

  function node(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function card(room) {
    const article = node('article', '', 'room-card');
    const top = node('div', '', 'room-card-top');
    const avatar = node('span', room.owner.slice(0, 1).toUpperCase(), 'room-card-avatar');
    const image = document.createElement('img');
    image.alt = ''; image.referrerPolicy = 'no-referrer'; avatar.append(image);
    window.lolzArtwork(image, room.avatar);
    top.append(avatar, node('span', room.live ? 'В ЭФИРЕ' : room.public ? 'ОТКРЫТА' : 'ПО ССЫЛКЕ', room.live ? 'room-badge live' : 'room-badge'));
    const enter = node('button', room.own ? 'Открыть' : 'Войти', 'primary');
    enter.type = 'button'; enter.disabled = pending;
    enter.setAttribute('aria-label', (room.own ? 'Открыть ' : 'Войти в ') + room.name);
    enter.onclick = () => change('open', room.url);
    top.append(enter);
    article.append(top, node('h4', room.name), node('p', 'Ведущий · ' + room.owner, 'room-owner'));
    if (room.description) article.append(node('p', room.description, 'room-description'));
    const track = [room.artist, room.title].filter(Boolean).join(' — ');
    article.append(node('p', track || 'Выбирают музыку', 'room-current'), node('small', 'Слушают · ' + room.listeners, 'room-listeners'));
    if (room.own) {
      const details = node('details', '', 'room-card-menu');
      const close = node('button', 'Подтвердить закрытие');
      close.type = 'button'; close.disabled = pending;
      close.onclick = () => change('close', room.url);
      details.append(node('summary', 'Закрыть'), close);
      article.append(details);
    }
    return article;
  }

  function render() {
    el('create').hidden = !authenticated;
    el('create').disabled = pending;
    el('refresh').disabled = !authenticated || listing;
    el('join-form').querySelector('button').disabled = !authenticated || pending;
    for (const button of filters) button.setAttribute('aria-pressed', String(button.dataset.roomFilter === filter));
    const search = el('search').value.trim().toLocaleLowerCase('ru');
    const matches = rooms.filter(room => (filter === 'own' ? room.own : room.public)
      && [room.name, room.owner, room.title, room.artist, room.description].join(' ').toLocaleLowerCase('ru').includes(search));
    const signature = JSON.stringify([matches, pending]);
    if (signature !== cardsSignature) {
      el('cards').replaceChildren(...matches.map(card));
      cardsSignature = signature;
    }
    let status = '';
    if (actionError || listError) status = actionError || listError;
    else if (!ready) status = 'Проверяем вход…';
    else if (!authenticated) status = 'Войди через Lolzteam, чтобы увидеть комнаты и присоединиться.';
    else if (listing && !rooms.length) status = 'Загружаем комнаты…';
    else if (pending) status = 'Подключаемся…';
    else if (!matches.length) status = search ? 'Ничего не найдено.' : filter === 'own' ? 'Твоей комнаты пока нет.' : 'Открытых комнат пока нет. Можешь создать свою.';
    el('directory-status').textContent = status;
  }

  async function refresh() {
    if (!authenticated || listing) return;
    listing = true; listError = ''; render();
    try {
      const result = await request('list');
      if (authenticated) rooms = result.sort((a, b) => Number(b.live) - Number(a.live) || b.listeners - a.listeners);
    } catch (error) { listError = error.message; }
    finally { listing = false; lastList = Date.now(); render(); }
  }

  function detach() {
    if (!guest) return;
    const view = guest;
    guest = null;
    view.removeAttribute('id');
    view.hidden = true;
    // Navigating away gives the shared room client time to send its leave request.
    try { Promise.resolve(view.loadURL('about:blank')).catch(() => {}).finally(() => view.remove()); }
    catch { view.remove(); }
  }

  function connect(url) {
    detach();
    el('stage-status').textContent = 'Подключаемся к комнате…';
    el('reload').hidden = true;
    const view = document.createElement('webview');
    view.id = 'lc-room-webview';
    view.setAttribute('partition', ROOM_PARTITION);
    view.setAttribute('aria-label', 'Комната LolzCloud');
    view.src = url;
    view.addEventListener('dom-ready', () => {
      if (guest === view) void view.insertCSS(roomStyles).catch(() => {});
    });
    view.addEventListener('did-finish-load', () => {
      if (guest === view) el('stage-status').textContent = '';
    });
    function showLoadError() {
      if (guest !== view) return;
      el('stage-status').textContent = 'Не удалось загрузить комнату.';
      el('reload').hidden = false;
    }
    view.addEventListener('did-fail-load', event => {
      if (event.isMainFrame && event.errorCode !== -3) showLoadError();
    });
    view.addEventListener('render-process-gone', showLoadError);
    guest = view; content.append(view);
  }

  function leave(notify = true) {
    navigation++;
    detach();
    activeUrl = ''; stage.hidden = true; lobby.hidden = false;
    sessionChanged();
    if (notify) void ipcRenderer.invoke('rooms:action',{type:'leave-local'}).catch(()=>{});
  }
  ipcRenderer.on('lolzcloud:room-media',(_event,{command,value})=>{if(guest)void guest.executeJavaScript('window.LolzCloudRoomPlayback?.command('+JSON.stringify(command)+','+JSON.stringify(value ?? null)+')',true).catch(()=>{});});
  window.addEventListener('lolzcloud:pause-room',()=>{if(guest)void guest.executeJavaScript('window.LolzCloudRoomPlayback?.command("pause")',true).catch(()=>{});});
  ipcRenderer.on('lolzcloud:room-ended', (_event, url) => { if (activeUrl && url === activeUrl && !pending) leave(false); });
  ipcRenderer.on('lolzcloud:local-play', () => { if (activeUrl) leave(); });

  async function change(type, url) {
    if (pending || !authenticated) return;
    const revision = navigation;
    pending = true; actionError = ''; render();
    try {
      const result = await request(type, url);
      if (type === 'close') { if (url === activeUrl) leave(false); await refresh(); return; }
      if (revision !== navigation || !authenticated) return;
      activeUrl = result; lobby.hidden = true; stage.hidden = false;
      sessionChanged();
      connect(result); if (document.body.dataset.view === 'room') el('leave').focus();
    } catch (error) { actionError = error.message; }
    finally { pending = false; render(); }
  }

  el('create').onclick = () => change('create');
  el('broadcast').onclick = () => change('broadcast');
  ipcRenderer.on('lolzcloud:open-room', (_event,url) => { window.LolzCloudStudio.open('room'); void change('open',url); });
  el('refresh').onclick = () => { actionError = ''; void refresh(); };
  el('search').oninput = render;
  for (const button of filters) button.onclick = () => { filter = button.dataset.roomFilter; render(); };
  el('join-form').onsubmit = event => { event.preventDefault(); void change('open', el('invitation').value.trim()); };
  el('leave').onclick = () => { leave(); void refresh(); el('search').focus(); };
  el('reload').onclick = () => { if (activeUrl) connect(activeUrl); };
  el('copy-stage').onclick = async () => {
    try { await request('copy', activeUrl); el('stage-status').textContent = 'Приглашение скопировано.'; }
    catch (error) { el('stage-status').textContent = error.message; }
  };
  window.addEventListener('lolzcloud:navigation', event => {
    if (event.detail === 'room') { if (!activeUrl) void refresh(); }
    // The room session outlives its screen: hidden guests keep their audio,
    // connection, host lease and drafts until an explicit leave action.
    sessionChanged();
  });
  window.addEventListener('lolzcloud:state', event => {
    const state = event.detail.features?.room;
    if (!state) return;
    el('broadcast').disabled = !state.authenticated || !event.detail.fresh || event.detail.private || !event.detail.playback?.url;
    const changed = authenticated !== !!state.authenticated;
    authenticated = !!state.authenticated;
    if (ready && !changed) return;
    ready = true; actionError = '';
    if (!authenticated) { rooms = []; listError = ''; if (activeUrl || pending) leave(); }
    render();
    if (authenticated && document.body.dataset.view === 'room') void refresh();
  });
  setInterval(() => {
    if (document.body.dataset.view === 'room' && !activeUrl && !pending && Date.now() - lastList >= 20000) void refresh();
  }, 20000);
  render();
})();
