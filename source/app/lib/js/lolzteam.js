(() => {
  'use strict';
  const { ipcRenderer: lztIpc } = require('electron');
  const lztFs = require('node:fs');
  const lztPath = require('node:path');
  const { clock: lztClock } = require('../integrations/lolzteam/status.cjs');
  document.body.insertAdjacentHTML('beforeend', lztFs.readFileSync(lztPath.join(__dirname, 'lib/templates/lolzteam.html'), 'utf8'));
  const element = id => document.getElementById('lzt-' + id);
  const lztDialog = element('dialog');
  const lztWebview = document.getElementById('webview');
  let state = null;
  let localError = '';
  let pending = false;
  let polling = false;
  lztIpc.on('lolzcloud:state', (_event, value) => { if (value?.playback) { state = value; render(); } });
  function applyTheme() { document.documentElement.classList.add('lzt-app-theme'); }

  function showPanel() {
    if (!lztDialog.open) lztDialog.showModal();
  }
  window.lolzShowAccount = showPanel;
  element('launcher').addEventListener('click', showPanel);
  element('close').addEventListener('click', () => lztDialog.close());
  lztDialog.addEventListener('click', event => { if (event.target === lztDialog) lztDialog.close(); });
  lztIpc.on('lolzteam:open', showPanel);
  lztIpc.on('appReqEsc', () => { if (lztDialog.open) lztDialog.close(); });
  lztIpc.on('soundcloud:session-imported', () => { lztWebview.reloadIgnoringCache(); });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyL') {
      event.preventDefault();
      showPanel();
    }
  });
  const sidebar = document.querySelector('.interface .sidebar');
  if (sidebar) {
    const button = document.createElement('a');
    button.href = '#lolzteam';
    button.className = 'side-btn lzt-sidebar-button';
    button.innerHTML = '<div class="icon" aria-hidden="true">♫</div><div class="name">Lolzteam</div>';
    button.addEventListener('click', event => { event.preventDefault(); showPanel(); });
    sidebar.insertBefore(button, sidebar.lastElementChild);
  }

  async function command(action) {
    if (pending) return;
    pending = true;
    localError = '';
    render();
    try {
      const result = await lztIpc.invoke('lolzteam:action', action);
      if (result.state) state = result.state;
      if (!result.ok) localError = result.error;
    } catch { localError = 'Нет связи с приложением. Перезапусти LolzCloud.'; }
    finally {
      pending = false;
      render();
    }
  }

  element('connect-form').addEventListener('submit', async event => {
    event.preventDefault();
    const token = element('token').value;
    // Clear the visible field immediately; the token is never part of a public state.
    element('token').value = '';
    await command({ type: 'connect', token });
  });
  element('get-token').addEventListener('click', () => command({ type: 'open-token' }));
  element('open-profile').addEventListener('click', () => command({ type: 'open-profile' }));
  element('disconnect').addEventListener('click', () => command({ type: 'disconnect' }));
  element('forget').addEventListener('click', () => command({ type: 'forget' }));
  element('my-lolzteam').addEventListener('click', () => command({ type: 'open-profile' }));
  element('my-soundcloud').addEventListener('click', () => command({ type: 'open-soundcloud' }));
  document.getElementById('lc-my-lolzteam').addEventListener('click', () => command({ type: 'open-profile' }));
  document.getElementById('lc-my-soundcloud').addEventListener('click', () => command({ type: 'open-soundcloud' }));
  element('now-listening').addEventListener('click', () => { lztDialog.close(); showsongshowcase(); });
  element('import-soundcloud').addEventListener('click', () => { lztDialog.close(); window.LolzCloudSignIn?.open(); });
  element('sc-profile-form').addEventListener('submit', event => {
    event.preventDefault();
    command({ type: 'set-soundcloud-profile', url: element('sc-profile-url').value });
  });
  element('refresh-sc-profile').addEventListener('click', () => command({ type: 'refresh-soundcloud-profile' }));
  const settingsFields = {
    enabled: 'enabled', 'show-time': 'showTime',
    'show-duration': 'showDuration', format: 'format', pause: 'pauseBehavior', prefix: 'prefix',
    'discord-enabled': 'discordEnabled',
  };
  for (const [id, setting] of Object.entries(settingsFields)) {
    const control = element(id);
    control.addEventListener('change', () => command({
      type: 'configure', settings: { [setting]: control.type === 'checkbox' ? control.checked : control.value },
    }));
  }
  element('copy').addEventListener('click', async () => {
    if (!state?.preview) return;
    try {
      await navigator.clipboard.writeText(state.preview);
      element('copy').textContent = '✓';
      setTimeout(() => { element('copy').textContent = '⧉'; }, 1500);
    } catch { localError = 'Не удалось скопировать статус.'; render(); }
  });

  function render() {
    if (!state) {
      element('message').textContent = localError || 'Загружаем настройки…';
      return;
    }
    const config = state.settings;
    const track = state.playback;
    const connected = state.connected;
    const active = connected && config.enabled && !state.private;
    const error = localError || state.error;
    const lztProfile = state.profiles?.lolzteam;
    const scProfile = state.profiles?.soundcloud;
    element('my-lolzteam').disabled = !lztProfile;
    element('my-soundcloud').disabled = !scProfile;
    document.getElementById('lc-my-lolzteam').disabled = !lztProfile;
    document.getElementById('lc-my-soundcloud').disabled = !scProfile;
    element('my-lolzteam').title = lztProfile?.url || '';
    element('my-soundcloud').title = scProfile?.url || '';
    element('soundcloud-account').textContent = scProfile ? `SoundCloud · ${scProfile.name}${state.soundcloudProfileSource === 'manual' ? ' · ссылка сохранена вручную' : ''}` : 'Профиль SoundCloud пока не определён. Можно войти в плеере или сохранить свою ссылку без входа.';
    if (document.activeElement !== element('sc-profile-url')) element('sc-profile-url').value = scProfile?.url || '';
    element('refresh-sc-profile').disabled = pending;
    element('import-soundcloud').hidden = false;
    element('import-hint').hidden = false;
    element('import-soundcloud').disabled = pending || state.importing;
    element('import-soundcloud').textContent = pending || state.importing ? 'Переносим вход…' : 'Вход SoundCloud из браузера';
    element('discord-state').textContent = !config.discordEnabled ? 'Трансляция в Discord выключена'
      : (state.discord?.connected ? (state.discord.activity ? 'В Discord: трек · кнопки: ' + ((state.discord.activity.buttons || []).map(button => button.label).join(', ') || 'профили не указаны') : 'Discord подключён · ожидаем музыку') : (state.discord?.error || 'Подключаемся к Discord…'));
    const legacyDiscord = document.querySelector('input[name="discordrpc"]');
    if (legacyDiscord) legacyDiscord.checked = config.discordEnabled;
    element('connect-form').hidden = connected || state.storagePending;
    element('connected').hidden = !connected;
    element('account-badge').textContent = connected ? 'Привязан' : 'Не привязан';
    element('account-badge').classList.toggle('lzt-badge-connected', connected);
    element('account-name').textContent = state.user?.name || '';
    element('account-id').textContent = state.user ? `ID ${state.user.id} · Lolzteam` : '';
    element('preview-name').textContent = state.user?.name || 'Твой профиль';
    element('avatar').textContent = (state.user?.name || 'L').slice(0, 1).toUpperCase();
    element('enabled').disabled = pending || !connected;
    element('connect').disabled = pending;
    element('connect').textContent = pending ? 'Подключаем…' : 'Привязать';
    element('disconnect').disabled = pending;
    element('forget').hidden = !connected || !error;
    element('forget').disabled = pending;
    element('token').disabled = pending;
    if (!pending) {
      for (const [id, key] of Object.entries(settingsFields)) {
        const control = element(id);
        if (document.activeElement === control && control.type === 'text') continue;
        if (control.type === 'checkbox') control.checked = config[key];
        else control.value = config[key];
      }
    }
    element('show-duration').disabled = pending || !config.showTime;
    element('launcher-state').textContent = active ? 'В эфире' : (connected ? 'На паузе' : 'Подключить');
    element('launcher').classList.toggle('lzt-live', active);
    element('broadcast-help').textContent = !connected ? 'Привяжи аккаунт, чтобы начать.'
      : (state.user.canEditStatus === false ? 'На форуме недоступна смена статуса.' : (active ? 'Текущий трек появится под твоим ником.' : 'Включи, когда захочешь поделиться музыкой.'));
    const hasTrack = !!track.title && state.fresh;
    element('track-title').textContent = hasTrack ? track.title : 'Включи любимый трек';
    element('track-title').title = hasTrack ? track.title : '';
    element('track-artist').textContent = hasTrack ? (track.artist || 'SoundCloud') : 'Музыка появится здесь автоматически';
    element('track-state').textContent = hasTrack ? (track.playing ? 'СЕЙЧАС ИГРАЕТ' : 'НА ПАУЗЕ') : 'СЕЙЧАС В SOUNDCLOUD';
    element('position').textContent = hasTrack ? lztClock(track.position) : '0:00';
    element('duration').textContent = hasTrack ? lztClock(track.duration) : '0:00';
    const progress = hasTrack && track.duration > 0 ? Math.min(100, track.position / track.duration * 100) : 0;
    element('progress-fill').style.width = progress + '%';
    element('progress-fill').parentElement.setAttribute('aria-valuenow', String(Math.round(progress)));
    const cover = element('cover');
    if (hasTrack && track.cover) {
      window.lolzArtwork(cover, track.cover);
      element('cover-placeholder').hidden = true;
    } else {
      window.lolzArtwork(cover, '');
      element('cover-placeholder').hidden = false;
    }
    element('preview-status').textContent = hasTrack ? state.preview : '♫ Исполнитель — Трек · 1:23/3:45';
    element('preview-example').textContent = hasTrack ? 'Предпросмотр' : 'Пример';
    element('length').textContent = hasTrack ? `${state.preview.length}/50 символов · тайм-код сохраняется` : 'До 50 символов · тайм-код сохраняется';
    element('copy').disabled = !hasTrack;
    element('now-listening').disabled = !hasTrack;
    const wait = Math.max(0, Math.ceil((state.nextUpdateAt - Date.now()) / 1000));
    let sync = 'В ожидании подключения';
    if (state.private) sync = 'Приватный режим · музыка скрыта в статусах';
    else if (state.restorePending) sync = 'Восстановление прежнего статуса' + (wait ? ` · через ${wait} с` : '…');
    else if (active && state.busy) sync = 'Синхронизация с Lolzteam…';
    else if (active && hasTrack && track.playing) sync = wait ? `Следующее обновление через ${wait} с` : 'Готовим обновление статуса…';
    else if (active) sync = hasTrack ? 'Музыка на паузе' : 'Ожидаем трек из SoundCloud';
    else if (connected) sync = 'Трансляция выключена';
    element('sync-text').textContent = sync;
    element('sync-dot').classList.toggle('lzt-signal-active', active && !error);
    element('message').textContent = error;
    element('message').classList.toggle('lzt-error', !!error);
    element('dialog').classList.toggle('lzt-is-live', active);
    const note = lztDialog.querySelector('.lzt-note p');
    note.textContent = config.pauseBehavior === 'restore'
      ? 'Прежний статус вернётся после паузы, выключения трансляции и обычного закрытия приложения.'
      : 'При выключении трансляции и обычном закрытии приложения прежний статус вернётся. Поведение на паузе — справа.';
    void applyTheme();
    window.dispatchEvent(new CustomEvent('lolzcloud:state', { detail: state }));
  }

  async function poll() {
    if (pending || polling) return;
    polling = true;
    try {
      const result = await lztIpc.invoke('lolzteam:action', { type: 'state' });
      if (result.ok && !pending) state = result.state;
      else if (!result.ok) localError = result.error;
    } catch { localError = 'Не удалось получить настройки Lolzteam.'; }
    finally { polling = false; render(); }
  }
  lztWebview.addEventListener('did-start-navigation', event => {
    if (event.isMainFrame && !event.isInPlace) lztIpc.send('lolzteam:playback', {});
  });
  lztWebview.addEventListener('dom-ready', () => {
    void applyTheme();
    // Playback collection is independent of the older optional UI plugins.
    const ticker = lztFs.readFileSync(lztPath.join(__dirname, '../plugins/infoticker.js'), 'utf8');
    lztWebview.executeJavaScript(ticker).catch(() => {});
  });
  // Keep the integration reachable if SoundCloud is slow or unavailable.
  setTimeout(() => document.getElementById('loadingscreen')?.classList.add('fadels'), 12_000);
  setInterval(poll, 1000);
  void poll();
  if (new URLSearchParams(location.search).has('lolzteam')) {
    showPanel();
    localStorage.setItem('lolzteam-welcome-seen', '1');
  }
})();
