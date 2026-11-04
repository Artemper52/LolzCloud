(async function (config) {
  try {
    if (location.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(location.hostname)) { alert('Открой SoundCloud, войди в свой аккаунт и нажми эту закладку ещё раз.'); return; }
    const names = new Set(['oauth_token', 'oauth_refresh_token', 'sc_session', 'connectId', 'sc_tracking_user_id', 'datadome', 'OptanonConsent', 'OptanonAlertBoxClosed']);
    const cookies = document.cookie.split(';').map(row => { const at = row.indexOf('='); return { name: row.slice(0, at).trim(), value: row.slice(at + 1), domain: '.soundcloud.com', path: '/', secure: true, session: true, hostOnly: false }; }).filter(row => names.has(row.name) && row.value);
    if (!cookies.some(row => row.name === 'oauth_token')) { alert('Браузер не предоставил вход SoundCloud. Если ты уже вошёл, используй помощник браузера из страницы переноса: он поддерживает защищённые cookies.'); return; }
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(config.key), char => char.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('lolzcloud-session:1:' + config.id) }, key, new TextEncoder().encode(JSON.stringify({ cookies })));
    const base64 = buffer => btoa(Array.from(new Uint8Array(buffer), char => String.fromCharCode(char)).join(''));
    const envelope = { format: 'lolzcloud-session', version: 1, id: config.id, iv: base64(iv), data: base64(data) };
    if (config.file) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'SoundCloud.lolzcloud-session'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
      alert('Зашифрованный файл сохранён. В LolzCloud нажми «Выбрать файл сессии».');
    } else location.assign(config.receiver + '#' + encodeURIComponent(JSON.stringify(envelope)));
  } catch { alert('Не удалось передать вход. Открой перенос в LolzCloud заново или используй файл сессии.'); }
})
