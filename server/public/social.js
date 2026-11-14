(() => {
  'use strict';
  const site = window.LolzCloudSite;
  if (!site) return;
  const { request, avatar } = site;
  const tabs = { profile: 'Профиль', friends: 'Друзья', notifications: 'Входящие' };
  const standalone = document.body.dataset.page === 'social';
  let session, shell, view, status, heading, dialog, previousFocus, activeTab = 'profile', activeUserId = 0;
  let room = null, contextRoomId = '', viewVersion = 0, busy = 0, stream = null, streamHealthy = false, refreshPending = null;
  let snapshot = { notifications: [], unread: 0, revision: 0 }, snapshotSignature = '', inboxSignature = '';
  let closed = true;
  const sentInvites = new Set();
  const node = (tag, text = '', className = '') => { const result = document.createElement(tag); result.textContent = text; if (className) result.className = className; return result; };
  const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const validRoom = value => /^[a-f0-9]{32}$/.test(value || '') ? value : '';
  function message(text = '', error = false) { if (!status) return; status.textContent = text; status.dataset.error = String(error); }
  function action(label, run, primary = false) {
    const button = node('button', label, 'button' + (primary ? ' primary' : '')); button.type = 'button';
    button.onclick = () => void perform(button, run); return button;
  }
  async function perform(button, run) {
    if (button.disabled) return;
    button.disabled = true; busy++; message('');
    try { await run(button); }
    catch (error) { message(error.message || 'Не удалось выполнить действие. Попробуй ещё раз.', true); }
    finally { busy--; if (button.isConnected && button.dataset.sent !== 'true') button.disabled = false; if (!busy) renderInbox(); }
  }
  function titleLine(user, compact = false) {
    const line = node('span', '', 'social-badges');
    const roles = (Array.isArray(user?.roles) ? user.roles : []).filter(role => role?.source === 'lolzcloud' && ['owner', 'tester'].includes(role.id));
    for (const role of roles.slice(0, compact ? 1 : 2)) {
      const badge = node('span', role.label, 'social-app-role'); badge.dataset.appRole = role.id;
      badge.title = 'Роль в LolzCloud'; line.append(badge);
    }
    if (user?.rank?.source === 'lolzcloud' && user.rank.label) line.append(node('span', user.rank.label, 'social-rank'));
    const titles = (Array.isArray(user?.titles) ? user.titles : []).filter(title => title?.source === 'lolzteam' && typeof title.label === 'string' && title.label);
    for (const title of titles.slice(0, compact ? 1 : 3)) {
      const badge = node('span', '', 'social-verified'), mark = node('span', '✓', 'social-verified-mark');
      mark.setAttribute('aria-hidden', 'true'); badge.title = 'Титул подтверждён Lolzteam'; badge.append(mark, node('span', title.label)); line.append(badge);
    }
    return line;
  }
  function userButton(user, options = {}) {
    const button = node('button', '', 'social-user' + (options.className ? ' ' + options.className : '')); button.type = 'button';
    button.dataset.userId = validId(user?.id); button.setAttribute('aria-label', 'Профиль ' + (user?.name || 'участника'));
    if (options.avatar !== false) button.append(avatar(user || {}));
    const info = node('span'); info.append(node('strong', user?.name || 'Участник', 'social-user-name'));
    if (options.badges !== false) info.append(titleLine(user, true));
    button.append(info); button.onclick = () => void open('profile', { userId: user?.id }); return button;
  }
  function buildShell() {
    if (shell) return;
    shell = node('section', '', 'social-surface');
    const top = node('div', '', 'social-topbar'); heading = node('h2', 'Твоя компания'); heading.id = 'social-title'; top.append(heading);
    if (!standalone) { const closeButton = action('×', close); closeButton.className = 'social-close'; closeButton.setAttribute('aria-label', 'Закрыть'); top.append(closeButton); }
    const nav = node('div', '', 'social-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Твоя компания');
    for (const [key, label] of Object.entries(tabs)) {
      const button = action(label, () => open(key, { userId: session?.user.id, roomId: contextRoomId })); button.className = '';
      button.dataset.socialTab = key; button.id = 'social-tab-' + key; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'social-view');
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const keys = Object.keys(tabs), index = keys.indexOf(key);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
        nav.children[next].focus(); nav.children[next].click();
      };
      nav.append(button);
    }
    view = node('div', '', 'social-view'); view.id = 'social-view'; view.setAttribute('role', 'tabpanel'); view.tabIndex = -1;
    status = node('p', '', 'social-status'); status.setAttribute('role', 'status');
    shell.append(top, nav, view, status);
    if (standalone) document.getElementById('social-root').replaceChildren(shell);
    else {
      dialog = node('dialog', '', 'social-dialog'); dialog.setAttribute('aria-labelledby', 'social-title'); dialog.append(shell); document.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('click', event => { const bounds = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right)) close(); });
    }
  }
  async function open(tab = 'profile', options = {}) {
    session = await window.LolzCloudSessionReady;
    if (!session) return false;
    buildShell();
    activeTab = Object.hasOwn(tabs, tab) ? tab : 'profile'; activeUserId = validId(options.userId) || session.user.id;
    contextRoomId = validRoom(options.roomId) || room?.id || '';
    if (closed) { previousFocus = document.activeElement; if (dialog && !dialog.open) dialog.showModal(); }
    closed = false; message(''); heading.textContent = activeTab === 'friends' && contextRoomId ? 'Пригласить друзей' : tabs[activeTab];
    shell.querySelectorAll('[data-social-tab]').forEach(button => { const selected = button.dataset.socialTab === activeTab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    view.setAttribute('aria-labelledby', 'social-tab-' + activeTab);
    if (standalone) {
      const query = new URLSearchParams({ tab: activeTab }); if (activeTab === 'profile' && activeUserId !== session.user.id) query.set('user', activeUserId);
      history.replaceState(null, '', '/social?' + query); document.title = tabs[activeTab] + ' · LolzCloud';
    }
    await loadView(); return true;
  }
  function close() {
    if (standalone || closed) return;
    closed = true; viewVersion++; dialog.close(); previousFocus?.isConnected && previousFocus.focus();
    document.dispatchEvent(new CustomEvent('lolzcloud:social-closed'));
  }
  async function loadView() {
    const token = ++viewVersion; inboxSignature = ''; view.replaceChildren(node('p', 'Загружаем…', 'social-loading')); view.setAttribute('aria-busy', 'true');
    try {
      if (activeTab === 'profile') {
        const own = activeUserId === session.user.id, result = await request(own ? '/api/social/me' : '/api/social/users/' + activeUserId);
        if (token !== viewVersion) return;
        renderProfile(result.profile);
      } else if (activeTab === 'friends') {
        const result = await request('/api/social/friends'); if (token !== viewVersion) return; renderFriends(result);
      } else {
        const result = await request('/api/social/notifications'); if (token !== viewVersion) return; updateSnapshot(result); renderInbox(true);
      }
    } catch (error) {
      if (token !== viewVersion) return;
      view.replaceChildren(node('p', error.message, 'social-empty'), action('Повторить', loadView)); message(error.message, true);
    } finally { if (token === viewVersion) view.removeAttribute('aria-busy'); }
  }
  function cover(profile) {
    const result = node('div', '', 'social-cover'); result.dataset.preset = ['forest', 'paper', 'ink'].includes(profile.background?.preset) ? profile.background.preset : 'forest';
    if (profile.background?.url) { const image = node('img'); image.alt = ''; image.src = profile.background.url; image.onerror = () => image.remove(); result.append(image); }
    return result;
  }
  function relationshipActions(profile) {
    const actions = node('div', '', 'social-profile-actions'), relation = profile.relationship;
    const change = async (method, suffix = '') => { await request('/api/social/friends' + suffix, method === 'POST' && !suffix ? { userId: profile.id } : {}, method); await loadView(); };
    if (relation === 'incoming') actions.append(action('Принять заявку', () => change('POST', '/' + profile.id + '/accept'), true), action('Отклонить', () => change('DELETE', '/' + profile.id)));
    else if (relation === 'outgoing') actions.append(node('span', 'Заявка отправлена', 'social-note'), action('Отменить', () => change('DELETE', '/' + profile.id)));
    else if (relation === 'friends') {
      if (contextRoomId) actions.append(inviteButton(profile, true));
      actions.append(action('Удалить из друзей', button => confirmRemove(button, () => change('DELETE', '/' + profile.id))));
    } else if (relation === 'none') actions.append(action('Добавить в друзья', () => change('POST'), true));
    else if (relation === 'blocked') actions.append(node('span', 'Действия с этим профилем недоступны.', 'social-note'));
    return actions;
  }
  function renderProfile(profile) {
    const head = node('div', '', 'social-profile-head'); head.append(avatar(profile));
    if (profile.editable === true && profile.id === session.user.id) head.append(action('Изменить профиль', () => renderEditor(profile)));
    const name = node('h3', profile.name, 'social-name'), links = node('div', '', 'social-profile-links'), lolz = node('a', 'Профиль Lolzteam ↗');
    lolz.href = profile.url; lolz.target = '_blank'; lolz.rel = 'noopener noreferrer'; links.append(lolz);
    if (profile.joinedAt) { const date = new Date(profile.joinedAt); if (!Number.isNaN(date.getTime())) links.append(node('span', 'В LolzCloud с ' + date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }))); }
    view.replaceChildren(cover(profile), head, name, titleLine(profile), node('p', profile.bio || (profile.id === session.user.id ? 'Расскажи о себе и музыке, которую любишь.' : 'Здесь пока только музыка.'), 'social-bio'), links);
    const verifiedTitles = (profile.titles || []).filter(title => title.source === 'lolzteam' && title.label);
    if (verifiedTitles.length > 3) {
      const details = node('details', '', 'social-all-titles'), summary = node('summary', 'Все подтверждённые титулы · ' + verifiedTitles.length), list = node('ul');
      list.append(...verifiedTitles.map(title => node('li', title.label))); details.append(summary, list); view.append(details);
    }
    if (profile.id === session.user.id) {
      const verified = new Date(profile.lolzVerifiedAt || 0);
      view.append(node('small', profile.lolzVerifiedAt && !Number.isNaN(verified.getTime()) ? 'Данные Lolzteam обновлены ' + verified.toLocaleDateString('ru-RU') + '. Титулы обновятся при следующем входе.' : 'Аватар и подтверждённые титулы Lolzteam обновятся при следующем входе.', 'social-note'));
    }
    if (profile.relationship !== 'self') view.append(relationshipActions(profile));
    if (profile.canManageRoles === true && profile.id !== session.user.id) {
      const manage = action('Управлять ролями', () => renderRoleEditor(profile, manage));
      manage.dataset.manageRoles = ''; view.append(manage);
    }
    view.scrollTop = 0;
  }
  function renderRoleEditor(profile, manage) {
    if (profile.canManageRoles !== true || profile.id === session.user.id || view.querySelector('.social-role-editor')) return;
    const token = viewVersion, form = node('form', '', 'social-role-editor'); form.id = 'social-role-editor';
    form.append(node('h4', 'Роли LolzCloud'), node('p', 'Действуют только в LolzCloud. Подтверждённые титулы форума здесь не меняются.', 'social-note'));
    const selected = new Set((profile.roles || []).filter(role => role.source === 'lolzcloud').map(role => role.id));
    for (const [id, label, detail] of [['owner', 'Владелец', 'Может менять роли других пользователей.'], ['tester', 'Тестер', 'Участник тестирования LolzCloud.']]) {
      const row = node('label', '', 'social-role-choice'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.name = 'role'; checkbox.value = id; checkbox.checked = selected.has(id); checkbox.id = 'social-role-' + id;
      const text = node('span'); text.append(node('strong', label), node('small', detail, 'social-note')); row.append(checkbox, text); form.append(row);
    }
    const footer = node('div', '', 'social-role-footer'), save = node('button', 'Сохранить роли', 'button primary'); save.type = 'submit';
    footer.append(save, action('Отмена', () => { form.remove(); manage.hidden = false; manage.focus(); message(''); })); form.append(footer);
    manage.hidden = true; view.append(form); form.querySelector('input').focus();
    form.onsubmit = event => {
      event.preventDefault();
      void perform(save, async () => {
        try {
          const roles = [...form.querySelectorAll('input[name=role]:checked')].map(input => input.value);
          const result = await request('/api/social/users/' + profile.id + '/roles', { revision: profile.revision, roles }, 'PUT');
          if (token !== viewVersion || activeUserId !== profile.id || closed) return;
          renderProfile(result.profile); message('Роли сохранены.');
        } catch (error) {
          if (token !== viewVersion) return;
          if ([403, 409].includes(error.status) && !footer.querySelector('[data-roles-reload]')) {
            const reload = action('Загрузить свежий профиль', loadView); reload.dataset.rolesReload = ''; footer.append(reload);
          }
          throw error;
        }
      });
    };
  }
  function confirmRemove(button, run) {
    if (button.dataset.confirm === 'true') return run();
    button.dataset.confirm = 'true'; button.textContent = 'Удалить? Нажми ещё раз';
    setTimeout(() => { if (button.isConnected) { button.dataset.confirm = ''; button.textContent = 'Удалить из друзей'; } }, 5000);
  }
  async function imageData(file, kind) {
    if (!file || !['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Выбери изображение JPEG или PNG.');
    if (file.size > 16 * 1024 * 1024) throw new Error('Выбери изображение меньше 16 МБ.');
    const image = new Image(), source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Не удалось прочитать изображение.')); reader.readAsDataURL(file); });
    {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Не удалось открыть изображение. Выбери другой файл.')); image.src = source; });
      const maximum = kind === 'avatar' ? 1024 : 2048, limit = kind === 'avatar' ? 350 * 1024 : 950 * 1024;
      let ratio = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
      if (!image.naturalWidth || !image.naturalHeight || Math.max(image.naturalWidth, image.naturalHeight) > 20000) throw new Error('Это изображение слишком большое. Сначала уменьши его.');
      const canvas = document.createElement('canvas'); let blob;
      for (let attempt = 0; attempt < 8; attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext('2d'); context.fillStyle = '#1b2920'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', Math.max(.5, .88 - attempt * .06)));
        if (blob && blob.size <= limit) break; ratio *= .82;
      }
      if (!blob || blob.size > limit) throw new Error('Не удалось уменьшить изображение. Выбери другой файл.');
      return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Не удалось прочитать изображение.')); reader.readAsDataURL(blob); });
    }
  }
  function renderEditor(profile) {
    const token = ++viewVersion; message('');
    const form = node('form', '', 'social-editor'); form.id = 'social-profile-form';
    let avatarUrl = profile.avatarSource === 'custom' ? profile.avatar : '', backgroundUrl = profile.background?.url || '', preset = profile.background?.preset || 'forest', uploads = 0;
    const uploadVersions = { avatar: 0, background: 0 };
    const preview = node('div', '', 'social-edit-preview');
    const repaint = () => { preview.replaceChildren(cover({ background: { preset, url: backgroundUrl } }), avatar({ ...profile, avatar: avatarUrl || profile.lolzAvatar || '' })); };
    repaint(); form.append(preview);
    const avatarGroup = node('fieldset'), avatarLegend = node('legend', 'Аватар'); avatarGroup.append(avatarLegend);
    const sourceControls = node('div', '', 'social-source-controls'), fileAvatar = node('input'); fileAvatar.type = 'file'; fileAvatar.accept = 'image/jpeg,image/png'; fileAvatar.id = 'social-avatar-file'; fileAvatar.setAttribute('aria-label', 'Свой аватар JPEG или PNG');
    const lolzButton = action('Из Lolzteam', () => { uploadVersions.avatar++; avatarUrl = ''; updateSources(); repaint(); }), customButton = action('Свой', () => { fileAvatar.focus(); fileAvatar.click(); });
    function updateSources() { lolzButton.setAttribute('aria-pressed', String(!avatarUrl)); customButton.setAttribute('aria-pressed', String(!!avatarUrl)); }
    updateSources(); sourceControls.append(lolzButton, customButton); avatarGroup.append(sourceControls, fileAvatar, node('small', 'JPEG или PNG. Аватар и фон доступны каждому.', 'social-note'));
    const backgroundGroup = node('fieldset'); backgroundGroup.append(node('legend', 'Фон профиля'));
    const presets = node('div', '', 'social-preset-options');
    for (const [key, label] of [['forest', 'Лес'], ['paper', 'Бумага'], ['ink', 'Чернила']]) {
      const button = action(label, () => { uploadVersions.background++; preset = key; backgroundUrl = ''; updatePresets(); repaint(); }); button.dataset.preset = key; presets.append(button);
    }
    function updatePresets() { presets.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(!backgroundUrl && button.dataset.preset === preset))); }
    updatePresets(); const fileBackground = node('input'); fileBackground.type = 'file'; fileBackground.accept = 'image/jpeg,image/png'; fileBackground.id = 'social-background-file'; fileBackground.setAttribute('aria-label', 'Свой фон JPEG или PNG');
    backgroundGroup.append(presets, fileBackground, action('Сбросить свой фон', () => { uploadVersions.background++; backgroundUrl = ''; updatePresets(); repaint(); }));
    const bioLabel = node('label', 'О себе'), bio = node('textarea'); bio.id = 'social-bio'; bio.maxLength = 240; bio.value = profile.bio || ''; bio.placeholder = 'Что слушаешь?'; bioLabel.append(bio);
    const preferences = profile.preferences || {}, requests = node('input'); requests.type = 'checkbox'; requests.checked = preferences.allowFriendRequests !== false; requests.id = 'social-allow-requests';
    const requestsLabel = node('label', '', 'social-preference'); requestsLabel.append(requests, node('span', 'Принимать заявки в друзья'));
    const invitationsLabel = node('label', 'Кто может приглашать в комнаты'), invitations = node('select'); invitations.id = 'social-allow-invites';
    for (const [value, label] of [['friends', 'Друзья'], ['everyone', 'Все пользователи'], ['none', 'Никто']]) { const option = node('option', label); option.value = value; invitations.append(option); }
    invitations.value = ['friends', 'everyone', 'none'].includes(preferences.allowRoomInvites) ? preferences.allowRoomInvites : 'friends'; invitationsLabel.append(invitations);
    const notifications = node('input'); notifications.type = 'checkbox'; notifications.checked = preferences.notificationsEnabled !== false; notifications.id = 'social-notifications-enabled';
    const notificationsLabel = node('label', '', 'social-preference'); notificationsLabel.append(notifications, node('span', 'Уведомлять о друзьях и приглашениях'));
    const footer = node('div', '', 'social-editor-footer'), save = node('button', 'Сохранить', 'button primary'); save.type = 'submit'; footer.append(save, action('Отмена', () => { viewVersion++; renderProfile(profile); message(''); }));
    form.append(avatarGroup, backgroundGroup, bioLabel, requestsLabel, invitationsLabel, notificationsLabel, node('small', 'Роли LolzCloud назначает владелец. Подтверждённые титулы Lolzteam обновляются при входе.', 'social-note'), footer);
    async function upload(input, kind) {
      const file = input.files?.[0]; if (!file) return; input.value = ''; const uploadVersion = ++uploadVersions[kind]; uploads++; save.disabled = true; message('Готовим изображение…');
      try {
        const dataUrl = await imageData(file, kind); if (token !== viewVersion || uploadVersion !== uploadVersions[kind]) return;
        message('Загружаем изображение…'); const result = await request('/api/social/media', { kind, dataUrl }); if (token !== viewVersion || uploadVersion !== uploadVersions[kind]) return;
        if (kind === 'avatar') avatarUrl = result.url; else backgroundUrl = result.url;
        updateSources(); updatePresets(); repaint(); message('Изображение готово. Сохрани профиль, чтобы применить его.');
      } catch (error) { if (token === viewVersion) message(error.message, true); }
      finally { uploads--; if (token === viewVersion) save.disabled = uploads > 0; }
    }
    fileAvatar.onchange = () => void upload(fileAvatar, 'avatar'); fileBackground.onchange = () => void upload(fileBackground, 'background');
    form.onsubmit = event => {
      event.preventDefault(); if (uploads || save.disabled) return;
      void perform(save, async () => {
        let result;
        try { result = await request('/api/social/me', { revision: profile.revision, bio: bio.value, avatarUrl, backgroundUrl, backgroundPreset: preset, allowFriendRequests: requests.checked, allowRoomInvites: invitations.value, notificationsEnabled: notifications.checked }, 'PUT'); }
        catch (error) {
          if (error.status === 409 && token === viewVersion && !footer.querySelector('[data-profile-reload]')) {
            const reload = action('Загрузить свежий профиль', loadView); reload.dataset.profileReload = ''; footer.append(reload, node('small', 'При загрузке свежего профиля черновик будет заменён.', 'social-note'));
          }
          throw error;
        }
        const updated = result.profile; window.LolzCloudSession.user = { ...window.LolzCloudSession.user, ...updated };
        window.dispatchEvent(new CustomEvent('lolzcloud:profile-updated', { detail: { profile: updated } }));
        if (token === viewVersion) { viewVersion++; renderProfile(updated); message('Профиль сохранён.'); }
      });
    };
    view.replaceChildren(form); view.scrollTop = 0;
  }
  function section(title, rows) {
    const result = node('section', '', 'social-section'), top = node('div', '', 'social-section-heading'); top.append(node('h3', title), node('span', String(rows.length))); result.append(top); return result;
  }
  function inviteButton(profile, primary = false) {
    const key = contextRoomId + ':' + profile.id, button = action(sentInvites.has(key) ? 'Отправлено' : 'Пригласить', async button => {
      if (!contextRoomId) return;
      await request('/api/social/invitations', { roomId: contextRoomId, userId: profile.id }); sentInvites.add(key); button.dataset.sent = 'true'; button.textContent = 'Отправлено'; message('Приглашение для ' + profile.name + ' отправлено.');
    }, primary);
    if (sentInvites.has(key)) { button.disabled = true; button.dataset.sent = 'true'; } return button;
  }
  function friendRow(profile, relationship) {
    const row = node('div', '', 'social-person'), buttons = node('div', '', 'social-person-actions'); row.dataset.userId = profile.id; row.append(userButton(profile));
    const refresh = async (path, method = 'POST', body = {}) => { await request(path, body, method); await loadView(); };
    if (relationship === 'incoming') buttons.append(action('Принять', () => refresh('/api/social/friends/' + profile.id + '/accept'), true), action('Отклонить', () => refresh('/api/social/friends/' + profile.id, 'DELETE')));
    else if (relationship === 'outgoing') buttons.append(action('Отменить заявку', () => refresh('/api/social/friends/' + profile.id, 'DELETE')));
    else if (relationship === 'friends') {
      if (contextRoomId) buttons.append(inviteButton(profile));
      buttons.append(action('Удалить', button => confirmRemove(button, () => refresh('/api/social/friends/' + profile.id, 'DELETE'))));
    } else if (relationship === 'none') buttons.append(action('Добавить', () => refresh('/api/social/friends', 'POST', { userId: profile.id }), true));
    for (const button of buttons.children) { button.className = button.classList.contains('primary') ? 'social-action-primary' : ''; }
    row.append(buttons); return row;
  }
  function renderFriends(data) {
    const search = node('form', '', 'social-search'), input = node('input'), submit = node('button', 'Найти', 'button'); input.type = 'search'; input.minLength = 1; input.maxLength = 100; input.required = true; input.placeholder = 'Ник или ID в LolzCloud'; input.setAttribute('aria-label', 'Найти пользователя'); input.id = 'social-user-search'; submit.type = 'submit'; search.append(input, submit);
    const results = node('div', '', 'social-search-results'); results.id = 'social-search-results'; let searchToken = 0;
    search.onsubmit = event => { event.preventDefault(); const query = input.value.trim(); if (query.length < 2 && !/^\d+$/.test(query)) { message('Введи хотя бы две буквы ника или числовой ID.', true); return; } const token = ++searchToken, currentView = viewVersion; void perform(submit, async () => {
      const result = await request('/api/social/users?q=' + encodeURIComponent(query)); if (token !== searchToken || currentView !== viewVersion) return;
      results.replaceChildren(...result.users.map(profile => friendRow(profile, profile.relationship)));
      if (!result.users.length) results.append(node('p', 'Пользователь не найден. Попроси друга войти в LolzCloud через Lolzteam.', 'social-empty'));
    }); };
    view.replaceChildren();
    if (contextRoomId) {
      const context = node('div', '', 'social-invite-context'), link = node('input'); link.type = 'text'; link.readOnly = true; link.value = location.origin + '/room/' + contextRoomId + '/'; link.className = 'social-invite-link'; link.setAttribute('aria-label', 'Ссылка приглашения');
      context.append(node('span', room?.id === contextRoomId ? 'Приглашение в «' + room.name + '». Друг сам решит, когда присоединиться.' : 'Выбери друга для приглашения в комнату.'), link, action('Копировать ссылку', async () => {
        try { await navigator.clipboard.writeText(link.value); message('Ссылка скопирована.'); }
        catch { link.focus(); link.select(); message('Скопируй ссылку из выделенного поля.'); }
      })); view.append(context);
    }
    view.append(search, results);
    for (const [key, title] of [['incoming', 'Входящие заявки'], ['outgoing', 'Отправленные заявки'], ['friends', 'Друзья']]) {
      const rows = Array.isArray(data[key]) ? data[key] : []; if (key !== 'friends' && !rows.length) continue;
      const group = section(title, rows); group.dataset.friendGroup = key; group.append(...rows.map(profile => friendRow(profile, key)));
      if (!rows.length) group.append(node('p', 'Знакомые лица появятся здесь. Найди друга по нику или открой профиль участника комнаты.', 'social-empty')); view.append(group);
    }
    view.scrollTop = 0;
  }
  function timeElement(value) { const time = node('time'), date = new Date(value); if (!Number.isNaN(date.getTime())) { time.dateTime = date.toISOString(); time.textContent = date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } return time; }
  async function openRoom(value) {
    const destination = new URL(value, location.origin);
    if (destination.origin !== location.origin || !/^\/room\/[a-f0-9]{32}\/?$/.test(destination.pathname) || destination.username || destination.password) throw new Error('Ссылка комнаты недействительна. Обнови приглашение.');
    if (window.LolzCloudDesktopSocial?.openRoom) return window.LolzCloudDesktopSocial.openRoom(destination.href);
    const event = new CustomEvent('lolzcloud:social-room-open', { cancelable: true, detail: { url: destination.href, roomId: destination.pathname.split('/')[2] } });
    if (document.dispatchEvent(event)) location.assign(destination.href);
  }
  function notificationRow(item) {
    const row = node('article', '', 'social-notification'); row.dataset.notificationId = item.id; row.dataset.unread = String(!item.readAt); row.append(userButton(item.actor, { badges: false }));
    const copy = item.type === 'room_invite' ? 'Приглашает в «' + (item.room?.name || 'комнату') + '».' : item.type === 'friend_accept' ? 'Принял заявку. Теперь вы друзья.' : 'Хочет добавить тебя в друзья.';
    row.append(node('p', copy, 'social-notification-copy'), timeElement(item.createdAt));
    const actions = node('div', '', 'social-notification-actions');
    const changed = async (path, body, method = 'POST') => { await request(path, body, method); await refreshNotifications(true); if (activeTab === 'notifications' && !closed) renderInbox(true); };
    if (item.type === 'room_invite' && item.status === 'pending') {
      if (room && room.id !== item.room?.id) row.append(node('small', 'Сейчас ты в «' + room.name + '». Переход откроет другую комнату.', 'social-note'));
      actions.append(action('Войти в комнату', async () => { const result = await request('/api/social/invitations/' + item.id + '/respond', { accept: true }); if (result.url) { await openRoom(result.url); void refreshNotifications(true).catch(() => {}); } else throw new Error('Комната недоступна. Обнови входящие.'); }, true), action('Не сейчас', () => changed('/api/social/invitations/' + item.id + '/respond', { accept: false })));
    } else if (item.type === 'room_invite' && item.status === 'accepted' && item.room?.url) actions.append(action('Открыть комнату', () => openRoom(item.room.url)));
    else if (item.type === 'friend_request' && item.status === 'pending') actions.append(action('Принять', () => changed('/api/social/friends/' + item.actor.id + '/accept', {}), true), action('Отклонить', () => changed('/api/social/friends/' + item.actor.id, {}, 'DELETE')));
    if (item.status === 'declined') row.append(node('small', 'Отклонено', 'social-note'));
    if (item.status === 'expired') row.append(node('small', 'Приглашение больше не действует.', 'social-note'));
    if (item.type === 'friend_request' && item.status === 'accepted') row.append(node('small', 'Вы теперь друзья.', 'social-note'));
    row.append(actions); return row;
  }
  function renderInbox(force = false) {
    if (!view || activeTab !== 'notifications' || closed || busy && !force) return;
    const signature = JSON.stringify(snapshot); if (!force && signature === inboxSignature) return; inboxSignature = signature;
    const scroll = view.scrollTop, focused = document.activeElement, focusId = focused?.closest('[data-notification-id]')?.dataset.notificationId, focusText = focused?.textContent;
    const top = node('div', '', 'social-section-heading'); top.append(node('h3', 'Друзья и приглашения'));
    top.append(action('Обновить', loadView));
    if (snapshot.unread) top.append(action('Прочитать всё', async () => { updateSnapshot(await request('/api/social/notifications/read', { all: true })); renderInbox(true); }));
    const list = node('div'); list.id = 'social-notifications-list'; const items = Array.isArray(snapshot.notifications) ? snapshot.notifications : []; list.append(...items.map(notificationRow));
    if (!items.length) list.append(node('p', 'Здесь появятся заявки в друзья и приглашения в комнаты.', 'social-empty'));
    view.replaceChildren(top, list); view.scrollTop = scroll;
    if (focusId) { const row = [...list.children].find(row => row.dataset.notificationId === focusId), button = row && [...row.querySelectorAll('button')].find(button => button.textContent === focusText); button?.focus({ preventScroll: true }); }
  }
  function updateSnapshot(value) {
    if (value.userId && session && value.userId !== session.user.id) return;
    if (!Array.isArray(value.notifications)) return;
    if (Number(value.revision) < Number(snapshot.revision)) return;
    snapshot = value; const signature = JSON.stringify(value);
    const unread = Math.max(0, Number(value.unread) || 0); document.querySelectorAll('[data-social-unread]').forEach(badge => { badge.hidden = !unread; badge.textContent = unread > 99 ? '99+' : String(unread); });
    if (signature !== snapshotSignature) {
      snapshotSignature = signature; document.dispatchEvent(new CustomEvent('lolzcloud:social-notifications', { detail: { ...value, userId: value.userId || session?.user.id } })); renderInbox();
    }
  }
  function refreshNotifications(force = false) {
    if (!session) return Promise.resolve();
    if (refreshPending && !force) return refreshPending;
    const pending = request('/api/social/notifications').then(updateSnapshot); refreshPending = pending;
    return pending.finally(() => { if (refreshPending === pending) refreshPending = null; });
  }
  function connectEvents() {
    if (stream && stream.readyState !== EventSource.CLOSED) return;
    stream?.close(); stream = new EventSource('/api/social/events');
    stream.onopen = () => { streamHealthy = true; };
    stream.addEventListener('notifications', event => { try { updateSnapshot(JSON.parse(event.data)); } catch { /* Polling retries an invalid or interrupted snapshot. */ } });
    stream.onerror = () => { streamHealthy = false; };
  }
  function mountNavigation() {
    if (window.LolzCloudDesktopSocial?.nativeNotifications === true) return;
    const header = document.querySelector('body > header'); if (!header || header.querySelector('.social-nav')) return;
    const nav = node('nav', '', 'social-nav'); nav.setAttribute('aria-label', 'Твоя компания');
    nav.append(action('Друзья', () => open('friends')));
    const inbox = action('Входящие', () => open('notifications')), badge = node('span', '', 'social-unread'); badge.dataset.socialUnread = ''; badge.hidden = true; inbox.append(badge); nav.append(inbox);
    const account = document.getElementById('account'); header.insertBefore(nav, account || null);
  }
  window.LolzCloudSocial = { open, close, isOpen: () => !closed, userButton, titleLine, notifications: () => snapshot,
    setRoom: value => { if (validRoom(value?.id)) room = { id: value.id, name: value.name || 'комната', url: value.url }; },
    refresh: async () => { await refreshNotifications(); if (!closed) await loadView(); }
  };
  document.dispatchEvent(new CustomEvent('lolzcloud:social-ready'));
  window.LolzCloudSessionReady.then(value => {
    if (!value) return; session = value; mountNavigation();
    void refreshNotifications().catch(() => {}); connectEvents();
    if (standalone) { const query = new URLSearchParams(location.search); void open(query.get('tab'), { userId: query.get('user') }); }
  });
  const pollTimer = setInterval(() => { if (!document.hidden && !streamHealthy) void refreshNotifications().catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) { connectEvents(); void refreshNotifications().catch(() => {}); } });
  window.addEventListener('pagehide', () => { clearInterval(pollTimer); stream?.close(); });
})();
