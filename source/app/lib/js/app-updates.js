(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const card = document.createElement('section'); card.className = 'xp-card'; card.innerHTML = '<div class="xp-heading"><div><h3>Обновления LolzCloud</h3><p id="update-version"></p></div><button id="update-check">Проверить</button><button id="update-install" class="xp-primary" hidden>Обновиться и перезапустить</button></div><p id="update-status" role="status"></p><progress id="update-progress" max="100" value="0" hidden aria-label="Скачивание обновления"></progress>';
  document.querySelector('#lc-studio [data-pane=settings]')?.prepend(card);
  const chip = document.createElement('button');
  chip.id = 'app-update-chip';
  chip.type = 'button';
  chip.hidden = true;
  chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 18v2h14v-2"/></svg><span></span>';
  document.querySelector('.window-controls').after(chip);
  const el = id => document.getElementById('update-' + id);
  const chipLabel = chip.querySelector('span');
  const announce = document.createElement('span');
  announce.className = 'update-announcement';
  announce.setAttribute('role', 'status');
  chip.after(announce);
  function render(value) {
    const busy = ['checking', 'downloading', 'installing'].includes(value.status);
    const available = value.available === true || value.status === 'available';
    const applying = ['downloading', 'installing'].includes(value.status);
    el('version').textContent = 'Версия ' + value.currentVersion + (value.legacy ? ' · Windows 7 Legacy' : '');
    const labels = { idle: 'Проверяем новые версии при запуске приложения.', checking: 'Проверяем новую версию…', current: 'У тебя последняя версия.', available: 'Доступна версия ' + value.version + '. Профиль сохранится при обновлении.', downloading: 'Скачиваем обновление · ' + Math.round(value.percent || 0) + '%', installing: 'Сохраняем профиль. Приложение сейчас перезапустится…', unsupported: 'Установи новую версию с lolzcloud.com.' };
    el('status').textContent = value.error || labels[value.status] || ''; el('check').disabled = busy || !value.supported;
    el('install').hidden = !available && !applying; el('install').disabled = busy;
    el('progress').hidden = value.status !== 'downloading'; el('progress').value = value.percent || 0;
    chip.hidden = !available && !applying;
    chip.disabled = busy;
    chipLabel.textContent = value.status === 'downloading' ? 'Загрузка ' + Math.round(value.percent || 0) + '%' : value.status === 'installing' ? 'Перезапуск…' : 'Есть обновление';
    chip.title = value.error || (applying ? labels[value.status] : 'Обновить до ' + value.version + ' и перезапустить');
    chip.setAttribute('aria-label', applying ? chip.title : chipLabel.textContent + ' ' + value.version + '. Обновить и перезапустить.');
    const announcement = available ? 'Доступно обновление LolzCloud ' + value.version : '';
    if (announce.textContent !== announcement) announce.textContent = announcement;
  }
  async function action(type) { try { const result = await ipcRenderer.invoke('updates:action', { type }); if (result.state) render(result.state); if (!result.ok) throw new Error(result.error); } catch (error) { el('status').textContent = error.message || 'Не удалось проверить обновления.'; } }
  el('check').onclick = () => action('check'); el('install').onclick = () => action('install'); chip.onclick = () => action('install'); ipcRenderer.on('updates:state', (_event, value) => render(value)); void action('state');
})();
