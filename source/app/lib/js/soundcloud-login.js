(() => {
  'use strict';
  const { ipcRenderer } = require('electron'), fs = require('node:fs'), path = require('node:path');
  document.body.insertAdjacentHTML('beforeend', fs.readFileSync(path.join(__dirname, 'lib/templates/soundcloud-login.html'), 'utf8'));
  const el = id => document.getElementById('sc-login-' + id), dialog = el('dialog'), view = document.getElementById('webview'), connection = document.getElementById('sc-connection');
  let pending = false, state = null, error = '', hint = '', slowTimer, failed = false;
  function open() { if (!dialog.open) dialog.showModal(); render(); }
  window.LolzCloudSignIn = { open };
  el('close').onclick = () => dialog.close(); dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.getElementById('browser-sign-in').onclick = open;
  for (const button of document.querySelectorAll('[data-sc-login]')) button.onclick = open;
  document.getElementById('sc-signin-dismiss').onclick = () => { sessionStorage.setItem('lc:signin-dismissed', '1'); document.getElementById('sc-signin-banner').hidden = true; };
  document.getElementById('sc-connection-retry').onclick = () => { failed = false; connection.hidden = true; view.reloadIgnoringCache(); };
  document.getElementById('sc-connection-browser').onclick = () => command({ type: 'open-browser' });
  async function command(action) {
    if (pending) return; pending = true; error = ''; hint = ''; render();
    try {
      const result = await ipcRenderer.invoke('soundcloud:action', action);
      if (result.state) state = result.state;
      if (!result.ok) error = result.error || 'Не удалось перенести вход.';
      el('unlock').hidden = !result.needsPassword;
      if (result.needsPassword) el('password').focus();
      if (result.ok && action.type === 'copy-link') hint = 'Ссылка скопирована. Открой её в браузере с нужным аккаунтом.';
    } catch { error = 'Нет связи с приложением. Попробуй открыть перенос ещё раз.'; }
    finally { pending = false; render(); }
  }
  el('start').onclick = () => command({ type: 'start' }); el('copy').onclick = () => command({ type: 'copy-link' }); el('file').onclick = () => command({ type: 'import-file' }); el('cancel').onclick = () => command({ type: 'cancel' });
  el('unlock').onsubmit = event => { event.preventDefault(); const password = el('password').value; el('password').value = ''; void command({ type: 'unlock-file', password }); };
  el('legacy').onclick = async () => { if (pending) return; pending = true; error = ''; render(); try { const result = await ipcRenderer.invoke('lolzteam:action', { type: 'import-soundcloud' }); if (result.state) state = result.state; if (!result.ok) error = result.error; else hint = 'Сохранённый вход перенесён.'; } catch { error = 'Не удалось перенести вход из прежней установки.'; } finally { pending = false; render(); } };
  function render() {
    const transfer = state?.browserSession || {}, busy = pending || transfer.busy;
    dialog.querySelectorAll('button:not(#sc-login-close)').forEach(button => { button.disabled = busy; });
    el('cancel').hidden = !transfer.active; el('status').classList.toggle('is-error', !!error);
    el('status').textContent = error || hint || (transfer.imported ? state?.loginImport?.verified ? 'Готово. Аккаунт SoundCloud подключён.' : state?.loginImport?.verification === 'unconfirmed' ? 'Сессия перенесена, но SoundCloud не подтвердил вход. Проверь аккаунт в браузере или повтори перенос после подключения.' : 'Сессия сохранена. SoundCloud проверит вход, когда подключение будет доступно.' : transfer.active ? 'Ждём твой браузер. Передача открыта на 5 минут.' : '');
    const banner = document.getElementById('sc-signin-banner');
    banner.hidden = !!state?.soundcloudSession?.saved || transfer.imported || sessionStorage.getItem('lc:signin-dismissed') === '1' || !connection.hidden;
  }
  window.addEventListener('lolzcloud:state', event => { state = event.detail; render(); });
  function problem(slow) {
    connection.hidden = false; document.getElementById('sc-connection-title').textContent = slow ? 'SoundCloud долго не отвечает' : 'Не удалось открыть SoundCloud';
    document.getElementById('sc-connection-copy').textContent = slow ? 'Можно перенести готовый вход из браузера или повторить подключение. Остальные разделы LolzCloud доступны.' : 'Если SoundCloud открывается в браузере, перенеси оттуда вход. Если сайт недоступен и в браузере, сначала проверь подключение.';
    document.getElementById('sc-signin-banner').hidden = true;
  }
  view.addEventListener('did-start-loading', () => { failed = false; clearTimeout(slowTimer); slowTimer = setTimeout(() => problem(true), 12000); });
  view.addEventListener('did-fail-load', event => { if (event.isMainFrame === false || event.errorCode === -3) return; failed = true; clearTimeout(slowTimer); problem(false); });
  view.addEventListener('did-finish-load', () => { clearTimeout(slowTimer); if (!failed) { connection.hidden = true; render(); } });
  ipcRenderer.on('appReqEsc', () => { if (dialog.open) dialog.close(); });
  ipcRenderer.on('soundcloud:session-imported', () => { failed = false; connection.hidden = true; hint = ''; });
})();
