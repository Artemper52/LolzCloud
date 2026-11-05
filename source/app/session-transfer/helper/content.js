(() => {
  'use strict';
  if (window.top !== window || location.protocol !== 'http:' || location.hostname !== '127.0.0.1' || !/^\/transfer\/[a-f0-9]{48}\/$/.test(location.pathname) || location.search || location.hash) return;
  const node = document.getElementById('lolzcloud-transfer-request');
  if (!node) return;
  let request; try { request = JSON.parse(node.dataset.request); } catch { return; }
  const web = typeof browser === 'undefined' ? chrome : browser;
  const send = message => typeof browser !== 'undefined' ? web.runtime.sendMessage(message) : new Promise((resolve, reject) => web.runtime.sendMessage(message, result => { if (chrome.runtime.lastError) reject(Error()); else resolve(result); }));
  let running = false, done = false;
  function status(text, mode = '') { document.getElementById('helper-status').textContent = text; document.getElementById('helper-status').dataset.mode = mode; }
  async function transfer() {
    if (running || done) return; running = true;
    try {
      const result = await send({ type: 'auto-transfer', request });
      if (!result?.ok) throw Error(result?.error || 'Не удалось обратиться к помощнику.');
      if (result.needsPairing) { status('Помощник найден. Нажми его значок в браузере, сверь код ' + result.code + ' с LolzCloud и разреши автоматический вход один раз.', 'pair'); return; }
      status('Помощник передаёт вход в LolzCloud…', 'busy');
      const response = await fetch('import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.envelope), credentials: 'omit', cache: 'no-store' });
      const value = await response.json(); if (!value.ok) throw Error(value.error || 'Не удалось передать вход.');
      done = true; status('Готово. Вход передан автоматически — возвращайся в LolzCloud.', 'done');
    } catch (error) { status(error.message || 'Перезапусти перенос в LolzCloud и проверь помощник.', 'error'); }
    finally { running = false; }
  }
  web.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'describe-transfer') { respond({ request }); return false; }
    if (message?.type === 'retry-transfer') { void transfer(); respond({ ok: true }); }
    return false;
  });
  void transfer();
})();
