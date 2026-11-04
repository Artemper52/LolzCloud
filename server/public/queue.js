(() => {
  'use strict';
  const id = location.pathname.match(/\/room\/([a-f0-9]{32})/)?.[1]; if (!id) return;
  const panel = document.createElement('section'); panel.className = 'people queue-panel';
  panel.innerHTML = '<h2>Общая очередь</h2><form><label>Трек SoundCloud<input type="url" required placeholder="https://soundcloud.com/артист/трек" aria-label="Ссылка на трек"></label><button class="button">Предложить трек</button></form><p role="status"></p><div class="queue-list"></div>';
  document.querySelector('main').append(panel); let csrf = '', state = null, busy = false;
  const status = panel.querySelector('[role=status]'), list = panel.querySelector('.queue-list');
  async function action(value) { try { if (!csrf) csrf = (await (await fetch('/api/session')).json()).csrf; const response = await fetch('/api/rooms/' + id + '/queue', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(value) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); state = result.room; render(); status.textContent = 'Готово'; } catch (error) { status.textContent = error.message; } }
  function button(label, actionValue) { const node = document.createElement('button'); node.textContent = label; node.onclick = () => action(actionValue); return node; }
  function render() { list.replaceChildren(); if (!state?.queue?.length) { list.textContent = 'Предложи первую песню.'; return; } for (const row of state.queue) { const item = document.createElement('article'), title = document.createElement('strong'), detail = document.createElement('small'); title.textContent = row.track.title; detail.textContent = row.proposedBy.name + ' · ' + (row.approved ? 'Подтверждён' : 'Ждёт ведущего'); item.append(title, detail, button((row.voted ? '♥ ' : '♡ ') + row.votes, { type: 'vote', id: row.id })); if (state.host) item.append(button(row.approved ? 'Снять одобрение' : 'Одобрить', { type: 'approve', id: row.id })); if (state.host || row.proposedBy.id === window.LolzCloudSite?.user?.id) item.append(button('Убрать', { type: 'remove', id: row.id })); list.append(item); } }
  panel.querySelector('form').onsubmit = async event => { event.preventDefault(); const input = panel.querySelector('input'); await action({ type: 'add', track: { url: input.value } }); if (status.textContent === 'Готово') input.value = ''; };
  async function refresh() { if (busy || document.hidden) return; busy = true; try { const response = await fetch('/api/rooms/' + id); if (response.ok) { state = await response.json(); render(); } } finally { busy = false; } }
  void refresh(); setInterval(refresh, 2500);
})();
