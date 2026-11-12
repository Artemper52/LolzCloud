(() => {
  'use strict';
  const el = id => document.getElementById(id), page = document.body.dataset.page;
  function avatar(user) {
    const tile = document.createElement('span'); tile.className = 'avatar'; const letter = document.createElement('span'); letter.textContent = (user.name || 'L').slice(0, 1).toUpperCase(); tile.append(letter);
    if (user.avatar) { const image = document.createElement('img'); image.alt = ''; image.src = user.avatar; image.onerror = () => { image.hidden = true; }; tile.append(image); }
    return tile;
  }
  async function request(url, body, method = body ? 'POST' : 'GET') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response, value;
    try {
      response = await fetch(url, { method, credentials: 'same-origin', signal: controller.signal, ...(body ? { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.LolzCloudSession?.csrf || '' }, body: JSON.stringify(body) } : {}) });
      value = await response.json();
    } catch {
      throw new Error(controller.signal.aborted ? 'Сервер долго отвечает. Попробуй ещё раз.' : 'Не удалось связаться с LolzCloud. Проверь интернет.');
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      if (response.status === 401) location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
      const error = new Error(value.error || 'Не удалось выполнить запрос.');
      error.status = response.status;
      throw error;
    }
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
    if (el('create-room')) {
      el('create-room').disabled = false;
      el('create-room').onclick = async () => { el('create-room').disabled = true; try { const room = await request('/api/rooms', {}); location.assign(room.url); } catch (error) { el('status').textContent = error.message; el('create-room').disabled = false; } };
    }
    let pending=false,signature='';
    async function refresh(){
      if(pending)return;pending=true;
      try{
        const data=await request('/api/rooms');data.rooms.sort((a,b)=>Number(b.playback.playing)-Number(a.playback.playing)||b.viewers-a.viewers);
        const next=JSON.stringify(data.rooms);if(next===signature)return;signature=next;
        const cards=data.rooms.map(room=>{
          const link=document.createElement('a'),top=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small'),badge=document.createElement('span'),track=document.createElement('p');
          link.href=room.url;link.className='room-card';top.className='directory-card-top';badge.className='directory-badge';badge.dataset.live=String(room.playback.playing);
          badge.textContent=room.playback.playing?'В ЭФИРЕ':room.settings.public?'ОТКРЫТА':'ПО ССЫЛКЕ';top.append(avatar(room.owner),badge);
          title.textContent=room.settings?.name||'Комната '+room.owner.name;detail.textContent=room.participants.filter(person=>person.online).length+' слушают · '+room.owner.name;
          track.textContent=[room.playback.artist,room.playback.title].filter(Boolean).join(' — ')||'Выбирают первую песню';link.append(top,title,detail,track);return link;
        });
        el('my-rooms').replaceChildren(...cards);if(!cards.length)el('my-rooms').textContent='Пока тихо. Создай открытую комнату и включи музыку всем.';
        if(el('rooms-count'))el('rooms-count').textContent=data.rooms.length;
      }catch(error){el('status').textContent=error.message;}finally{pending=false;}
    }
    await refresh();setInterval(()=>{if(!document.hidden)void refresh();},10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  }).catch(error => { el('status').textContent = error.message; });
})();
