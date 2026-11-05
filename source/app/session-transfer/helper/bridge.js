/* Shared by the extension worker, popup and deterministic protocol tests. */
(function (scope) {
  'use strict';
  const REQUEST = 'lolzcloud-browser-request', FORMAT = 'lolzcloud-session';
  const names = new Set(['oauth_token', 'oauth_refresh_token', 'sc_session', 'connectId', 'sc_tracking_user_id', 'datadome', 'OptanonConsent', 'OptanonAlertBoxClosed']);
  const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const base64 = value => btoa(Array.from(new Uint8Array(value), char => String.fromCharCode(char)).join(''));
  function transferUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password && !url.search && !url.hash && /^\/transfer\/[a-f0-9]{48}\/$/.test(url.pathname) ? url : null;
    } catch { return null; }
  }
  async function verify(request, url, now = Date.now()) {
    const page = transferUrl(url);
    if (!page || !request || request.format !== REQUEST || request.version !== 1 || request.id !== page.pathname.split('/')[2] || request.receiver !== page.href + 'receive' || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now || request.expiresAt > now + 5 * 60000 + 5000) throw Error('Передача устарела. Открой вход в LolzCloud заново.');
    for (const [field, length] of [['key', 32], ['signature', 64], ['publicKey', 91]]) {
      const value = request[field];
      if (typeof value !== 'string' || value.length > 140 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || bytes(value).length !== length) throw Error('Запрос переноса повреждён.');
    }
    const payload = { format: request.format, version: request.version, id: request.id, key: request.key, receiver: request.receiver, expiresAt: request.expiresAt, publicKey: request.publicKey };
    const key = await crypto.subtle.importKey('spki', bytes(request.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(request.signature), new TextEncoder().encode(JSON.stringify(payload)))) throw Error('LolzCloud не подтвердил этот запрос.');
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(request.publicKey))), char => char.toString(16).padStart(2, '0')).join('');
    return { fingerprint, code: fingerprint.slice(0, 16).toUpperCase().match(/.{4}/g).join(' ') };
  }
  function selectCookies(rows, now = Date.now()) {
    const cookies = rows.filter(cookie => names.has(cookie.name) && typeof cookie.value === 'string' && cookie.value && /^\.?(?:[a-z0-9-]+\.)*soundcloud\.com$/i.test(cookie.domain) && (cookie.session || !cookie.expirationDate || cookie.expirationDate * 1000 > now));
    if (!cookies.some(cookie => cookie.name === 'oauth_token' && ['soundcloud.com', '.soundcloud.com'].includes(cookie.domain) && (cookie.path || '/') === '/')) throw Error('Войди в SoundCloud в обычном окне этого профиля браузера, затем вернись на страницу переноса и обнови её.');
    return cookies;
  }
  async function encrypt(request, cookies, info) {
    const key = await crypto.subtle.importKey('raw', bytes(request.key), 'AES-GCM', false, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(FORMAT + ':1:' + request.id) }, key, new TextEncoder().encode(JSON.stringify({ cookies, ...(info ? { info } : {}) })));
    return { format: FORMAT, version: 1, id: request.id, iv: base64(iv), data: base64(data) };
  }
  const api = { transferUrl, verify, selectCookies, encrypt };
  if (typeof module !== 'undefined') module.exports = api;
  else scope.LolzCloudBrowserBridge = api;
})(typeof self === 'undefined' ? this : self);
