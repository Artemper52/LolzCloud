(() => {
  'use strict';
  const { ipcRenderer } = require('electron'), fs = require('node:fs'), path = require('node:path');
  document.body.insertAdjacentHTML('beforeend', fs.readFileSync(path.join(__dirname, 'lib/templates/soundcloud-login.html'), 'utf8'));
  const el = id => document.getElementById('sc-login-' + id), dialog = el('dialog'), view = document.getElementById('webview'), connection = document.getElementById('sc-connection');
  let pending = false, state = null, error = '', hint = '', slowTimer, failed = false, verification = false, accountsSignature = '', browsersSignature = '', firstStarted = false;
  function open() { if (!dialog.open) dialog.showModal(); render(); if (!state?.browserProfiles?.length && !pending) void command({ type: 'browser-list' }); }
  window.LolzCloudSignIn = { open };
  const verificationNotice = document.createElement('section');
  verificationNotice.id = 'sc-verification';
  verificationNotice.hidden = true;
  verificationNotice.setAttribute('role', 'status');
  const verificationText = document.createElement('span');
  verificationText.textContent = 'SoundCloud просит пройти проверку. Выполни её на странице ниже.';
  const verificationButton = document.createElement('button');
  verificationButton.type = 'button';
  verificationButton.textContent = 'Открыть проверку';
  verificationButton.onclick = () => {
    dialog.close();
    document.getElementById('lc-studio')?.close();
    window.lolzSelectNavigation('browser');
    view.focus();
  };
  verificationNotice.append(verificationText, verificationButton);
  view.parentElement.append(verificationNotice);
  view.addEventListener('console-message', event => {
    try {
      const url = new URL(view.getURL());
      if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) || !event.message.startsWith('LolzCloudReceive|Verification|')) return;
      verification = JSON.parse(event.message.slice('LolzCloudReceive|Verification|'.length)).active === true;
      verificationNotice.hidden = !verification;
      if (verification) {
        clearTimeout(slowTimer); connection.hidden = true; failed = false;
        verificationButton.click();
        ipcRenderer.send('lolzteam:verification', true);
      } else ipcRenderer.send('lolzteam:verification', false);
    } catch { /* Navigation can replace the document while it reports. */ }
  });
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
  el('browsers-refresh').onclick = () => command({ type: 'browser-list' });
  el('unlock').onsubmit = event => { event.preventDefault(); const password = el('password').value; el('password').value = ''; void command({ type: 'unlock-file', password }); };
  el('legacy').onclick = async () => { if (pending) return; pending = true; error = ''; render(); try { const result = await ipcRenderer.invoke('lolzteam:action', { type: 'import-soundcloud' }); if (result.state) state = result.state; if (!result.ok) error = result.error; else hint = 'Сохранённый вход перенесён.'; } catch { error = 'Не удалось перенести вход из прежней установки.'; } finally { pending = false; render(); } };
  function render() {
    const transfer = state?.browserSession || {}, busy = pending || transfer.busy;
    const connected = state?.soundcloudSession?.hasLogin || state?.soundcloudSession?.saved;
    el('connected').hidden = !connected;
    el('connected-name').textContent = state?.soundcloudProfile?.name || 'Аккаунт SoundCloud сохранён';
    el('connected-detail').textContent = state?.soundcloudSession?.source === 'previous-version' ? 'Вход автоматически перенесён из прежней установки LolzCloud.' : 'Прежний вход восстановлен автоматически. Чтобы сменить аккаунт, выбери его из браузера ниже.';
    const accounts = transfer.accounts || [], accountKey = JSON.stringify(accounts);
    el('accounts').hidden = !accounts.length;
    if (accountKey !== accountsSignature) {
      accountsSignature = accountKey; el('account-list').replaceChildren();
      for (const account of accounts) {
        const button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('small'); button.type = 'button';
        name.textContent = account.name; detail.textContent = account.browser + (account.profile?.url ? ' · ' + account.profile.url.replace('https://soundcloud.com/', '@') : ' · аккаунт будет проверен после выбора');
        button.append(name, detail); button.onclick = () => command({ type: 'choose-account', id: account.id }); el('account-list').append(button);
      }
    }
    const browsers = state?.browserProfiles || [], browserKey = JSON.stringify(browsers);
    if (browserKey !== browsersSignature) {
      browsersSignature = browserKey; el('browser-list').replaceChildren();
      for (const browser of browsers) { const button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('small'); button.type = 'button'; name.textContent = browser.name; detail.textContent = browser.detail; button.append(name, detail); button.onclick = () => command({ type: 'start-browser', id: browser.id }); el('browser-list').append(button); }
    }
    dialog.querySelectorAll('button:not(#sc-login-close)').forEach(button => { button.disabled = busy; });
    el('cancel').hidden = !transfer.active; el('pairing').hidden = !transfer.active; el('pairing-code').textContent = transfer.pairingCode || ''; el('status').classList.toggle('is-error', !!error);
    el('status').textContent = error || hint || (transfer.imported ? state?.loginImport?.verified ? 'Готово. Аккаунт SoundCloud подключён.' : state?.loginImport?.verification === 'unconfirmed' ? 'Сессия перенесена, но SoundCloud не подтвердил вход. Проверь аккаунт в браузере или повтори перенос после подключения.' : 'Сессия сохранена. SoundCloud проверит вход, когда подключение будет доступно.' : accounts.length ? 'Выбери аккаунт выше. Другие браузеры можно подключить в этой же передаче.' : transfer.active ? 'Ждём аккаунты из браузеров. Передача открыта на 5 минут.' : '');
    const banner = document.getElementById('sc-signin-banner');
    banner.hidden = !!connected || transfer.imported || sessionStorage.getItem('lc:signin-dismissed') === '1' || !connection.hidden;
  }
  window.addEventListener('lolzcloud:state', event => { state = event.detail; render(); if (state?.firstSignIn && !firstStarted && !pending) { firstStarted = true; if (!dialog.open) dialog.showModal(); void command({ type: 'start' }); } });
  function problem(slow) {
    if (verification) return;
    connection.hidden = false; document.getElementById('sc-connection-title').textContent = slow ? 'SoundCloud долго не отвечает' : 'Не удалось открыть SoundCloud';
    document.getElementById('sc-connection-copy').textContent = slow ? 'Можно перенести готовый вход из браузера или повторить подключение. Остальные разделы LolzCloud доступны.' : 'Если SoundCloud открывается в браузере, перенеси оттуда вход. Если сайт недоступен и в браузере, сначала проверь подключение.';
    document.getElementById('sc-signin-banner').hidden = true;
  }
  view.addEventListener('did-start-navigation', event => { if (!event.isMainFrame || event.isInPlace) return; failed = false; verification = false; verificationNotice.hidden = true; clearTimeout(slowTimer); slowTimer = setTimeout(() => problem(true), 12000); });
  view.addEventListener('did-fail-load', event => { if (event.isMainFrame === false || event.errorCode === -3) return; failed = true; clearTimeout(slowTimer); problem(false); });
  view.addEventListener('did-finish-load', () => { clearTimeout(slowTimer); if (!failed) { connection.hidden = true; render(); } });
  view.addEventListener('dom-ready', () => { clearTimeout(slowTimer); failed = false; connection.hidden = true; render(); });
  ipcRenderer.on('appReqEsc', () => { if (dialog.open) dialog.close(); });
  ipcRenderer.on('soundcloud:session-imported', () => { failed = false; connection.hidden = true; hint = ''; });
})();
