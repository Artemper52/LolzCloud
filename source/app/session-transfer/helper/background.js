'use strict';
if (typeof importScripts === 'function') importScripts('bridge.js');
const web = typeof browser === 'undefined' ? chrome : browser;
const bridge = LolzCloudBrowserBridge;
const call = (area, method, ...args) => { const api = area.split('.').reduce((object, name) => object[name], web); return typeof browser !== 'undefined' ? api[method](...args) : new Promise((resolve, reject) => api[method](...args, result => { if (chrome.runtime.lastError) reject(Error('Нет доступа к браузеру. Проверь разрешения помощника.')); else resolve(result); })); };
let pairingQueue = Promise.resolve();
async function currentTransfer() {
  const tabs = await call('tabs', 'query', { active: true, currentWindow: true }), tab = tabs[0];
  if (!tab || !bridge.transferUrl(tab.url)) throw Error('В LolzCloud нажми «Войти через браузер». Оставь открытой страницу переноса в этом профиле браузера.');
  const description = await call('tabs', 'sendMessage', tab.id, { type: 'describe-transfer' }, { frameId: 0 });
  const identity = await bridge.verify(description?.request, tab.url);
  return { tab, request: description.request, identity };
}
async function handle(message, sender) {
  const popup = sender.url === web.runtime.getURL('popup.html') && !sender.tab;
  if (message?.type === 'pair-info' || message?.type === 'pair' || message?.type === 'forget') {
    if (!popup) throw Error('Открой помощник кнопкой браузера.');
    if (message.type === 'forget') { await call('storage.local', 'remove', 'pairedApps'); return { ok: true }; }
    const { tab, request, identity } = await currentTransfer(), saved = await call('storage.local', 'get', 'pairedApps');
    if (message.type === 'pair-info') return { ok: true, code: identity.code, fingerprint: identity.fingerprint, paired: (saved.pairedApps || []).includes(identity.fingerprint) };
    if (message.fingerprint !== identity.fingerprint) throw Error('Страница переноса изменилась. Открой помощник ещё раз и сверь код.');
    // Only the extension popup can approve a new app; a local page cannot pair itself.
    const pairs = [...new Set([...(saved.pairedApps || []), identity.fingerprint])].slice(-8);
    await call('storage.local', 'set', { pairedApps: pairs });
    await call('tabs', 'sendMessage', tab.id, { type: 'retry-transfer' }, { frameId: 0 });
    return { ok: true, code: identity.code };
  }
  if (message?.type !== 'auto-transfer' || sender.frameId !== 0 || !sender.tab || !bridge.transferUrl(sender.url) || sender.tab.url !== sender.url) throw Error('Неверная страница переноса.');
  const request = message.request, identity = await bridge.verify(request, sender.url), saved = await call('storage.local', 'get', 'pairedApps');
  if (!(saved.pairedApps || []).includes(identity.fingerprint)) return { ok: true, needsPairing: true, code: identity.code };
  const cookies = bridge.selectCookies(await call('cookies', 'getAll', { domain: 'soundcloud.com' }));
  let profile = null;
  try {
    const token = cookies.find(row => row.name === 'oauth_token' && ['soundcloud.com', '.soundcloud.com'].includes(row.domain) && (row.path || '/') === '/');
    const reply = await fetch('https://api.soundcloud.com/me', { headers: { Authorization: 'OAuth ' + token.value }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (reply.ok) { const user = await reply.json(); if (user.id && typeof user.username === 'string' && /^https:\/\/soundcloud\.com\/[\w-]+\/?$/.test(user.permalink_url)) profile = { id: user.id, name: user.username.slice(0, 100), url: user.permalink_url }; }
  } catch { /* The app can verify a session when the browser API is unavailable. */ }
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browserName = /Edg\//.test(agent) ? 'Microsoft Edge' : /YaBrowser\//.test(agent) ? 'Яндекс Браузер' : /OPR\//.test(agent) ? 'Opera' : /Firefox\//.test(agent) ? 'Firefox' : /Vivaldi\//.test(agent) ? 'Vivaldi' : /Chrome\//.test(agent) ? 'Chrome / Chromium' : 'Браузер';
  return { ok: true, envelope: await bridge.encrypt(request, cookies, { profile, browser: browserName }) };
}
// Serialize pairing writes without holding unrelated transfer requests open.
web.runtime.onMessage.addListener((message, sender, respond) => {
  const run = () => handle(message, sender).catch(error => ({ ok: false, error: error.message }));
  const task = ['pair', 'forget'].includes(message?.type) ? pairingQueue = pairingQueue.then(run, run) : run();
  task.then(respond); return true;
});
