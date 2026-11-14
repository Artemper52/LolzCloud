'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const temporary = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-pwa-ui-') || !output) throw new Error('An isolated PWA profile and output are required.');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 12000) { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error(label); await delay(50); } }
app.whenReady().then(async () => {
  let server, window, failure = '', maliciousStart = false; const checks = [], requests = [], errors = [];
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(error.message + '\nExpression: ' + code); } };
  try {
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const origin = 'http://127.0.0.1:' + port, store = new CloudStore({ origin }); server = createServer({ origin, store }); const owner = store.login({ id: 911, name: 'Участник · тест входа' }), handler = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const url = new URL(req.url, origin); requests.push(url.pathname + url.search);
      if (url.pathname === '/api/desktop/start' && maliciousStart) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ deviceCode: 'a'.repeat(43), code: 'a'.repeat(12), expiresIn: 600, verificationUrl: 'https://evil.test/connect?code=' + 'a'.repeat(12) })); return; }
      if (url.pathname === '/api/desktop/session') { setTimeout(() => handler(req, res), 450); return; }
      handler(req, res);
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); const ses = session.fromPartition('pwa-login-isolated');
    // No bearer injection or pre-installed cookie: the production HTTP flow
    // itself must commit a secure HttpOnly cookie in this fresh browser jar.
    window = new BrowserWindow({ show: false, width: 390, height: 844, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, ...args) => { const message = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(message || '')) errors.push(message); });
    await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp'), 'PWA not ready');
    await js('document.querySelector("[data-view=profile]").click()'); await until(() => js('!!document.querySelector("#profile-gate .primary")'), 'Login gate missing');
    check(await js('!document.getElementById("rooms-frame").getAttribute("src")&&!document.getElementById("social-frame").getAttribute("src")'), 'Anonymous music opens without mounting unauthorized shared frames');
    await js('document.querySelector("#profile-gate .primary").click()'); await until(() => js('document.getElementById("login-code").textContent.length===12'), 'Device pairing did not start');
    const firstCode = await js('document.getElementById("login-code").textContent');
    check(await js('document.getElementById("login-browser").href===location.origin+"/connect?code="+document.getElementById("login-code").textContent&&document.getElementById("login-browser").target==="_blank"'), 'Pairing exposes only an exact same-origin verification link and a visible code');
    await js('document.getElementById("login-cancel").click()'); store.approveDevice(firstCode, owner.user); await delay(2800);
    check(await js('!document.getElementById("login-dialog").open') && !requests.includes('/api/desktop/session'), 'Cancel then late browser approval cannot commit a session or reopen login');
    check((await ses.cookies.get({ url: origin })).every(cookie => cookie.name !== '__Host-lc_session'), 'Cancelled pairing does not install a cookie');
    maliciousStart = true; await js('document.querySelector("#profile-gate .primary").click()'); await until(() => js('!document.getElementById("login-retry").hidden'), 'Malformed verification URL was not rejected');
    check(await js('document.getElementById("login-browser").hidden&&!document.getElementById("login-browser").hasAttribute("href")'), 'A foreign verification URL never becomes a clickable login destination');
    maliciousStart = false; await js('document.getElementById("login-retry").click()'); await until(() => js('document.getElementById("login-code").textContent.length===12'), 'Pairing retry failed');
    const secondCode = await js('document.getElementById("login-code").textContent'); check(secondCode !== firstCode, 'Explicit retry starts a fresh pairing generation'); store.approveDevice(secondCode, owner.user);
    await until(() => js('document.getElementById("login-cancel").disabled'), 'Commit phase did not lock cancellation');
    await js('document.getElementById("login-cancel").click();document.getElementById("login-dialog").dispatchEvent(new Event("cancel",{cancelable:true}))');
    check(await js('document.getElementById("login-dialog").open&&document.getElementById("login-cancel").disabled'), 'Cancel and Escape cannot interrupt the short cookie commit phase');
    await until(() => js('!document.getElementById("login-dialog").open&&!!document.getElementById("social-frame").getAttribute("src")'), 'Verified pairing did not authenticate the isolated cookie jar');
    const cookies = await ses.cookies.get({ url: origin }), authenticated = cookies.find(cookie => cookie.name === '__Host-lc_session');
    check(!!authenticated && authenticated.httpOnly && authenticated.secure && authenticated.path === '/', 'Production session endpoint commits a secure host-only HttpOnly cookie');
    check(await js('fetch("/api/session").then(r=>r.json()).then(v=>v.authenticated===true&&v.user.id===911&&typeof v.csrf==="string"&&v.csrf.length===43)'), 'A second cookie-only GET verifies the approved user identity and CSRF before success');
    check(await js('!document.cookie.includes("lc_session")&&!JSON.stringify(localStorage).includes(' + JSON.stringify(authenticated.value) + ')&&!location.href.includes(' + JSON.stringify(authenticated.value) + ')'), 'The bearer is absent from page cookies, URLs and localStorage');
    check(requests.filter(url => url === '/api/desktop/session').length === 1, 'Only the current explicitly approved generation commits once');
    check(await js('document.documentElement.scrollWidth<=innerWidth'), 'Pairing and profile gate fit the 390px viewport');
    await delay(150); fs.writeFileSync(path.join(output, 'pwa-login-profile.png'), (await window.webContents.capturePage()).toPNG());
    check(errors.length === 0, 'Pairing scenarios have no uncaught browser errors');
    console.log(JSON.stringify({ ok: true, count: checks.length, checks }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); if (window) try { fs.writeFileSync(path.join(output, 'pwa-login-failure.png'), (await window.webContents.capturePage()).toPNG()); } catch {} }
  finally { fs.writeFileSync(path.join(output, 'pwa-login-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, errors, failure, fixtureNote: 'Real CloudStore start/poll/session endpoints, fresh Chromium cookie jar. Browser approval is a controlled fixture; no personal account or live OAuth approval. This does not claim Safari hardware verification.' }, null, 2)); if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
}).catch(error => { console.error(error); app.exit(1); });
