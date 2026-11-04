(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const card = document.createElement('section'); card.className = 'xp-card'; card.innerHTML = '<div class="xp-heading"><div><h3>Обновления LolzCloud</h3><p id="update-version"></p></div><button id="update-check">Проверить</button><button id="update-install" class="xp-primary" hidden>Обновиться и перезапустить</button></div><p id="update-status" role="status"></p><progress id="update-progress" max="100" value="0" hidden aria-label="Скачивание обновления"></progress>';
  document.querySelector('#lc-studio [data-pane=settings]')?.prepend(card);
  const chip = document.createElement('button'); chip.id = 'app-update-chip'; chip.hidden = true; chip.className = 'xp-primary'; chip.style.cssText = 'border:0;border-radius:20px;padding:7px 12px;font-size:11px;cursor:pointer'; document.querySelector('.titlebar-right')?.prepend(chip);
  const el = id => document.getElementById('update-' + id);
  let state = { supported: false, status: 'idle', currentVersion: '', percent: 0 };
  function render(value) {
    state = value; const busy = ['checking', 'downloading', 'installing'].includes(value.status), available = value.status === 'available';
    el('version').textContent = 'Версия ' + value.currentVersion + (value.legacy ? ' · Windows 7 Legacy' : '');
    const labels = { idle: 'Проверяем новые версии при запуске приложения.', checking: 'Проверяем новую версию…', current: 'У тебя последняя версия.', available: 'Доступна версия ' + value.version + '. Профиль сохранится при обновлении.', downloading: 'Скачиваем обновление · ' + Math.round(value.percent || 0) + '%', installing: 'Сохраняем профиль. Приложение сейчас перезапустится…', unsupported: 'Установи новую версию с lolzcloud.com.' };
    el('status').textContent = value.error || labels[value.status] || ''; el('check').disabled = busy || !value.supported; el('install').hidden = !available && !['downloading', 'installing'].includes(value.status); el('install').disabled = busy; el('progress').hidden = value.status !== 'downloading'; el('progress').value = value.percent || 0;
    chip.hidden = !available && !['downloading', 'installing'].includes(value.status); chip.disabled = busy; chip.textContent = value.status === 'downloading' ? Math.round(value.percent || 0) + '%' : value.status === 'installing' ? 'Перезапускаем…' : 'Обновиться · ' + value.version;
  }
  async function action(type) { try { const result = await ipcRenderer.invoke('updates:action', { type }); if (result.state) render(result.state); if (!result.ok) throw new Error(result.error); } catch (error) { el('status').textContent = error.message || 'Не удалось проверить обновления.'; } }
  el('check').onclick = () => action('check'); el('install').onclick = () => action('install'); chip.onclick = () => action('install'); ipcRenderer.on('updates:state', (_event, value) => render(value)); void action('state');
})();
