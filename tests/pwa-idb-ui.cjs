'use strict';
const { app, BrowserWindow, session } = require('electron'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const temporary = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-pwa-ui-') || !output) throw new Error('Isolated profile/output required');
app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {}); fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const deadline = Date.now() + 8000; while (!await check()) { if (Date.now() > deadline) throw new Error(label); await delay(40); } }
app.whenReady().then(async () => {
  let server, window, blocker, failure = ''; const checks = [];
  const js = code => window.webContents.executeJavaScript(code), check = (value, label) => { assert.ok(value, label); checks.push(label); };
  try {
    server = createServer({ store: new CloudStore() }); const handler = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (req.url === '/app/idb-fixture.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'self' https://lrclib.net" }); res.end(fs.readFileSync(path.join(__dirname, '../server/public/app/index.html'), 'utf8').replace('<script src="/app/core.js"', '<script src="/app/idb-hook.js" defer></script><script src="/app/core.js"')); return; }
      if (req.url === '/app/idb-hook.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.__dbOpened=0;window.__dbClosed=0;const actualOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const request=actualOpen(...args);if(args[0]==="LolzCloud-music-v1")request.addEventListener("success",()=>{const db=request.result,close=db.close.bind(db);window.__dbOpened++;let closed=false;db.close=()=>{if(!closed){closed=true;window.__dbClosed++}return close()}});return request};'); return; }
      handler(req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port, ses = session.fromPartition('pwa-idb-blocked');
    const options = { show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } };
    blocker = new BrowserWindow(options); window = new BrowserWindow(options); await blocker.loadURL(origin + '/api/health');
    await blocker.webContents.executeJavaScript('new Promise((resolve,reject)=>{const r=indexedDB.open("LolzCloud-music-v1",1);r.onupgradeneeded=()=>{r.result.createObjectStore("tracks",{keyPath:"id"});r.result.createObjectStore("lyrics",{keyPath:"id"})};r.onsuccess=()=>{window.__blockingDB=r.result;resolve()};r.onerror=reject})');
    await window.loadURL(origin + '/app/idb-fixture.html'); await until(() => js('document.getElementById("storage-status").textContent.includes("Закрой другие вкладки")'), 'Blocked upgrade did not reject readably');
    check(await js('__dbOpened===0'), 'A genuinely blocked v1→v2 request rejects without reporting an open connection');
    await blocker.webContents.executeJavaScript('__blockingDB.close()'); await until(() => js('__dbOpened===1&&__dbClosed===1'), 'Rejected request opened an orphan connection after blocker closed');
    check(true, 'A rejected request closes its late onsuccess connection after the blocking tab releases the database');
    check(await js('LolzCloudOffline.list().then(rows=>Array.isArray(rows)&&__dbOpened===2&&__dbClosed===1)'), 'Retry creates exactly one new live connection and returns the upgraded database');
    await js('LolzCloudOffline.list()'); check(await js('__dbOpened===2&&__dbClosed===1'), 'Subsequent reads reuse the successful retry connection');
    await blocker.webContents.executeJavaScript('new Promise((resolve,reject)=>{const r=indexedDB.open("LolzCloud-music-v1",3);r.onsuccess=()=>{r.result.close();resolve()};r.onerror=reject;r.onblocked=()=>reject(new Error("Unexpected leaked connection"))})');
    check(await js('__dbOpened===2&&__dbClosed===2'), 'A later version change closes the sole remaining connection without a leaked blocked upgrade');
    console.log(JSON.stringify({ ok: true, count: checks.length, checks }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); }
  finally { fs.writeFileSync(path.join(output, 'pwa-idb-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, failure, fixtureNote: 'Two real isolated Chromium windows sharing IndexedDB. Controlled old-version blocker, production open implementation, instrumented open/close counts.' }, null, 2)); for (const current of [window, blocker]) if (current && !current.isDestroyed()) current.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
}).catch(error => { console.error(error); app.exit(1); });
