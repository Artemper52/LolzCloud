(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const { ROOM_ORIGIN, ROOM_PARTITION, roomUrl, socialUrl } = require('../integrations/room-view.cjs');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const roomStyles = readFileSync(join(__dirname, 'lib/css/room-stage.css'), 'utf8');
  const el = id => document.getElementById('lc-room-' + id);
  const lobby = el('lobby'), stage = el('stage'), content = el('stage-content');
  const filters = [...lobby.querySelectorAll('[data-room-filter]')];
  let rooms = [], filter = 'public', authenticated = false, ready = false;
  let listing = false, pending = false, listError = '', actionError = '', lastList = 0;
  let guest = null, activeUrl = '', navigation = 0, cardsSignature = '';
  let socialGuest = null, socialSequence = 0, socialFailed = false, cloudUserId = null;
  let shellAvatarUrl = '';
  const socialContent = document.getElementById('lc-social-content'), socialStatus = document.getElementById('lc-social-status');
  function sessionChanged() {
    document.body.classList.toggle('room-stage-open', !!activeUrl && document.body.dataset.view === 'room');
    const button = document.querySelector('[data-view=room]');
    if (button) {
      button.dataset.connected = String(!!activeUrl);
      button.title = activeUrl ? 'Комната подключена · вернуться' : 'Комнаты';
    }
    window.dispatchEvent(new CustomEvent('lolzcloud:room-session', { detail: { active: !!activeUrl } }));
  }
  window.LolzCloudRooms = { get active() { return !!activeUrl; }, leave: () => leave(), openSocial: (tab, options) => openSocial(tab, options) };
  const profileEntry = document.getElementById('open-account');
  if (profileEntry) { profileEntry.onclick = () => { void openSocial('profile'); }; profileEntry.title = 'Профиль LolzCloud'; profileEntry.setAttribute('aria-label', 'Профиль LolzCloud'); }
  document.getElementById('lc-social-connections')?.addEventListener('click', () => window.lolzShowAccount?.());
  function shellIdentity(user) {
    const name = document.getElementById('account-name'), description = document.getElementById('account-description'), avatar = document.getElementById('account-avatar');
    if (!name || !description || !avatar) return;
    const appRole = user?.roles?.find(role => role.source === 'lolzcloud' && role.id === 'owner') || user?.roles?.find(role => role.source === 'lolzcloud' && role.id === 'tester');
    name.textContent = user?.name || 'Твой профиль'; description.textContent = appRole?.label || (user?.rank?.source === 'lolzcloud' ? user.rank.label : 'Открыть профиль LolzCloud');
    avatar.textContent = (user?.name || 'L').slice(0, 1).toUpperCase();
    let url = ''; try { const value = new URL(user?.avatar); if (value.protocol === 'https:' && !value.username && !value.password) url = value.href; } catch { /* Use the user's initial. */ }
    if (url === shellAvatarUrl) return;
    shellAvatarUrl = url; avatar.classList.remove('has-social-avatar'); avatar.style.backgroundImage = '';
    if (url) { const image = new Image(); image.onload = () => { if (shellAvatarUrl === url) { avatar.style.backgroundImage = 'url(' + JSON.stringify(url) + ')'; avatar.classList.add('has-social-avatar'); } }; image.src = url; }
  }

  function socialState(value) {
    const badge = document.getElementById('lc-social-unread'), inbox = document.getElementById('lc-social-inbox');
    const count = authenticated && String(value?.userId) === String(cloudUserId) ? Math.max(0, Math.floor(Number(value?.unread) || 0)) : 0;
    if (badge) { badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count); }
    inbox?.setAttribute('aria-label', count ? 'Уведомления, непрочитанных: ' + count : 'Уведомления');
  }
  function socialRoomOpen(event) {
    if (event.channel === 'lolzcloud:social-open-rooms') { window.LolzCloudStudio.open('room'); return; }
    if (event.channel !== 'lolzcloud:social-open-room') return;
    const target = roomUrl(event.args?.[0]?.url);
    if (!target) return;
    window.LolzCloudStudio.open('room');
    if (target === activeUrl && guest) { void guest.executeJavaScript('window.LolzCloudSocial?.close()', true).catch(() => {}); return; }
    void change('open', target);
  }
  async function showSocial(view, tab, options, sequence) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (sequence !== socialSequence || view !== guest && view !== socialGuest) return;
      try {
        const shown = await view.executeJavaScript('(()=>{if(!window.LolzCloudSocial?.open)return false;window.LolzCloudSocial.open(' + JSON.stringify(tab) + ',' + JSON.stringify(options) + ');return true})()', true);
        if (shown) { if (view === socialGuest) socialStatus.textContent = ''; return; }
      } catch { /* The webview is still loading. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (sequence === socialSequence) window.LolzCloudStudio.notify('Профиль пока не загрузился. Попробуй открыть его ещё раз.', true);
  }
  function detachSocial() {
    socialSequence++;
    if (!socialGuest) return;
    const view = socialGuest; socialGuest = null;
    try { Promise.resolve(view.loadURL('about:blank')).catch(() => {}).finally(() => view.remove()); } catch { view.remove(); }
  }
  async function openSocial(tab = 'profile', options = {}) {
    if (!['profile', 'friends', 'notifications'].includes(tab)) return;
    if (!authenticated) {
      window.LolzCloudStudio.open('room');
      window.LolzCloudStudio.notify('Войди через Lolzteam, чтобы открыть профиль, друзей и уведомления.');
      lobby.querySelector('[data-do="room-login"]')?.focus(); return;
    }
    if (socialFailed && !activeUrl) { detachSocial(); socialFailed = false; }
    const sequence = ++socialSequence, data = {};
    if (Number.isSafeInteger(Number(options.userId)) && Number(options.userId) > 0) data.userId = Number(options.userId);
    if (activeUrl) data.roomId = activeUrl.split('/')[4];
    const target = new URL('/social', ROOM_ORIGIN); target.searchParams.set('tab', tab);
    if (data.userId) target.searchParams.set('user', data.userId);
    try {
      const address = await request('social', target.href);
      if (sequence !== socialSequence || !authenticated || !socialUrl(address)) return;
      if (guest && activeUrl) {
        window.LolzCloudStudio.open('room');
        await showSocial(guest, tab, data, sequence); return;
      }
      window.LolzCloudStudio.open('social');
      document.getElementById('page-title').textContent = 'Профиль и друзья';
      if (!socialGuest) {
        socialStatus.textContent = 'Загружаем профиль…';
        const view = document.createElement('webview'); view.setAttribute('partition', ROOM_PARTITION); view.setAttribute('aria-label', 'Профиль и друзья LolzCloud'); view.src = address;
        view.addEventListener('ipc-message', socialRoomOpen);
        const failed = () => { if (view === socialGuest) { socialFailed = true; socialStatus.textContent = 'Не удалось загрузить профиль. Открой раздел ещё раз.'; } };
        view.addEventListener('did-fail-load', event => { if (event.isMainFrame && event.errorCode !== -3) failed(); });
        view.addEventListener('render-process-gone', failed);
        socialGuest = view; socialContent.append(view);
      }
      await showSocial(socialGuest, tab, data, sequence);
    } catch (error) { window.LolzCloudStudio.notify(error.message || 'Не удалось открыть профиль.', true); }
  }
  document.querySelectorAll('[data-social-open]').forEach(button => { button.onclick = () => { void openSocial(button.dataset.socialOpen); }; });
  ipcRenderer.on('lolzcloud:open-social', (_event, value) => { void openSocial(value?.tab || 'notifications'); });
  ipcRenderer.on('lolzcloud:social-state', (_event, value) => socialState(value));
  ipcRenderer.on('lolzcloud:cloud-identity', (_event, user) => { if (authenticated && user?.id === cloudUserId) shellIdentity(user); });

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
    view.addEventListener('ipc-message', socialRoomOpen);
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
    socialSequence++;
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
    document.body.classList.toggle('social-stage-open', event.detail === 'social');
    if (event.detail === 'room') { if (!activeUrl) void refresh(); }
    // The room session outlives its screen: hidden guests keep their audio,
    // connection, host lease and drafts until an explicit leave action.
    sessionChanged();
  });
  window.addEventListener('lolzcloud:state', event => {
    const state = event.detail.features?.room;
    if (!state) return;
    el('broadcast').disabled = !state.authenticated || !event.detail.fresh || event.detail.private || !event.detail.playback?.url;
    const changed = authenticated !== !!state.authenticated || cloudUserId !== (state.user?.id || null);
    authenticated = !!state.authenticated;
    cloudUserId = state.user?.id || null;
    shellIdentity(authenticated ? state.user : null);
    socialState(event.detail.features?.social);
    if (ready && !changed) return;
    ready = true; actionError = '';
    if (!authenticated) { rooms = []; listError = ''; if (activeUrl || pending) leave(); detachSocial(); if (document.body.dataset.view === 'social') window.LolzCloudStudio.open('room'); }
    render();
    if (authenticated && document.body.dataset.view === 'room') void refresh();
  });
  setInterval(() => {
    if (document.body.dataset.view === 'room' && !activeUrl && !pending && Date.now() - lastList >= 20000) void refresh();
  }, 20000);
  render();
})();
