(() => {
  'use strict';
  const el = id => document.getElementById(id), page = document.body.dataset.page;
  function avatar(user) {
    const tile = document.createElement('span'); tile.className = 'avatar'; const letter = document.createElement('span'); letter.textContent = (user.name || 'L').slice(0, 1).toUpperCase(); tile.append(letter);
    if (user.avatar) { const image = document.createElement('img'); image.alt = ''; image.src = user.avatar; image.onerror = () => { image.hidden = true; }; tile.append(image); }
    return tile;
  }
  async function request(url, body) {
    const response = await fetch(url, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.LolzCloudSession?.csrf || '' }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) { if (response.status === 401) location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); throw new Error(value.error || 'Не удалось выполнить запрос.'); }
    return value;
  }
  window.LolzCloudSite = { request, avatar };
  if (page === 'login') {
    const next = new URLSearchParams(location.search).get('next') || '/rooms';
    el('login').href = '/auth/lolz?next=' + encodeURIComponent(next); return;
  }
  window.LolzCloudSessionReady = request('/api/session').then(session => {
    if (!session.authenticated) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    window.LolzCloudSession = session;
    const account = el('account'); if (account) { const link = document.createElement('a'); link.textContent = session.user.name; link.href = session.user.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; account.append(avatar(session.user), link); }
    const logout = el('logout'); if (logout) { logout.hidden = false; logout.onclick = async () => { try { await request('/api/logout', {}); location.replace('/login'); } catch (error) { el('status').textContent = error.message; } }; }
    return session;
  }).catch(error => { el('status').textContent = error.message; return null; });
  if (page === 'connect') {
    const code = new URLSearchParams(location.search).get('code') || ''; el('pair-code').textContent = code;
    el('approve').onclick = async () => {
      el('approve').disabled = true;
      try { const session = await window.LolzCloudSessionReady; if (!session) return; await request('/api/desktop/approve', { code }); el('status').textContent = 'Готово. Вернись в LolzCloud на компьютере.'; el('approve').textContent = 'Приложение подключено ✓'; }
      catch (error) { el('status').textContent = error.message; el('approve').disabled = false; }
    };
  }
  if (page === 'rooms') window.LolzCloudSessionReady.then(async session => {
    if (!session) return;
    const data = await request('/api/rooms');
    for (const room of data.rooms) { const link = document.createElement('a'), title = document.createElement('strong'), detail = document.createElement('small'); link.href = room.url; link.className = 'room-card'; title.textContent = room.settings?.name || 'Комната ' + room.owner.name; detail.textContent = room.participants.length + ' слушателей · ' + (room.playback.title || 'Выбирают музыку'); link.append(title, detail); el('my-rooms').append(link); }
    if (!data.rooms.length) el('my-rooms').textContent = 'Сейчас нет открытых комнат. Пригласи друзей в свою.';
    if (el('create-room')) el('create-room').onclick = async () => { el('create-room').disabled = true; try { const room = await request('/api/rooms', {}); location.assign(room.url); } catch (error) { el('status').textContent = error.message; el('create-room').disabled = false; } };
  }).catch(error => { el('status').textContent = error.message; });
})();
