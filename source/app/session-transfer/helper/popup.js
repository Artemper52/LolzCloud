'use strict';
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.getElementById('export'), status = document.getElementById('status'), input = document.getElementById('password');
  if (button.disabled || input.value.length < 10) return;
  let password = input.value; input.value = ''; button.disabled = true; status.textContent = 'Готовим зашифрованный файл…';
  try {
    const names = new Set(['oauth_token', 'oauth_refresh_token', 'sc_session', 'connectId', 'sc_tracking_user_id', 'datadome', 'OptanonConsent', 'OptanonAlertBoxClosed']);
    const raw = typeof browser !== 'undefined' ? await browser.cookies.getAll({ domain: 'soundcloud.com' }) : await new Promise((resolve, reject) => chrome.cookies.getAll({ domain: 'soundcloud.com' }, rows => { if (chrome.runtime.lastError) reject(Error()); else resolve(rows); }));
    const cookies = raw.filter(cookie => names.has(cookie.name) && cookie.value && /^(?:\.?soundcloud\.com|\.(?:[a-z0-9-]+\.)*soundcloud\.com|(?:[a-z0-9-]+\.)+soundcloud\.com)$/i.test(cookie.domain) && (cookie.session || !cookie.expirationDate || cookie.expirationDate * 1000 > Date.now()));
    if (!cookies.some(cookie => cookie.name === 'oauth_token')) { status.textContent = 'Вход SoundCloud не найден. Войди в обычном окне этого профиля браузера и повтори.'; return; }
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']); password = '';
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('lolzcloud-session-export:1') }, key, encoder.encode(JSON.stringify({ cookies })));
    const base64 = buffer => btoa(Array.from(new Uint8Array(buffer), value => String.fromCharCode(value)).join(''));
    const envelope = { format: 'lolzcloud-session-export', version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, salt: base64(salt), iv: base64(iv), data: base64(data) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = 'SoundCloud.lolzcloud-session'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    status.textContent = 'Готово. Выбери файл в LolzCloud и введи заданный пароль.';
  } catch { status.textContent = 'Не удалось сохранить вход. Проверь разрешение помощника на SoundCloud и повтори.'; }
  finally { password = ''; button.disabled = false; }
});
