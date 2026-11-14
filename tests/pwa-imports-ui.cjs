'use strict';
const { app, BrowserWindow, session } = require('electron'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const temporary = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-pwa-ui-') || !output) throw new Error('Isolated profile/output required');
app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio'); app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 18000) { const deadline = Date.now() + ms; while (!await check()) { if (Date.now() > deadline) throw new Error(label); await delay(50); } }
app.whenReady().then(async () => {
  let server, window, failure = '', serveLegacyWorker = true; const checks = [], requests = [], errors = [], screenshots = [];
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(error.message + '\nExpression: ' + code.slice(0, 300)); } };
  async function capture(name) { await delay(120); const file = path.join(output, name + '.png'); fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG()); screenshots.push(file); }
  try {
    const files = {};
    for (const [extension, codec] of [['wav', 'pcm_s16le'], ['mp3', 'libmp3lame'], ['m4a', 'aac'], ['flac', 'flac']]) {
      files[extension] = path.join(output, 'Локальная музыка & ' + extension + '.' + extension);
      execFileSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '8', '-codec:a', codec, files[extension]], { windowsHide: true, timeout: 20000 });
    }
    files.bad = path.join(output, 'Испорченная запись.mp3'); fs.writeFileSync(files.bad, 'ID3this-is-not-a-playable-audio-file');
    files.lrc = path.join(output, 'Мой текст.lrc'); fs.writeFileSync(files.lrc, '[00:00.00]Моя первая строка\n[00:02.00]Мой припев', 'utf8');
    files.txt = path.join(output, 'Мой текст.txt'); fs.writeFileSync(files.txt, 'Мой текст <b>без HTML</b>\nВторая строка', 'utf8');
    files.invalid = path.join(output, 'Не UTF-8.txt'); fs.writeFileSync(files.invalid, Buffer.from([255, 254, 0, 100]));
    const store = new CloudStore(); server = createServer({ store }); const owner = store.login({ id: 921, name: 'Участник · import fixture' }), room = store.createRoom(owner.user);
    const handler = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (request, response) => { requests.push(request.url); if (request.url === '/app/sw.js' && serveLegacyWorker) { const oldWorker = fs.readFileSync(path.join(__dirname, '../server/public/app/sw.js'), 'utf8').replace(/lolzcloud-app-shell-v\d+/, 'lolzcloud-app-shell-v1').replace("'/app/imports.js', ", '').replace('.then(() => self.skipWaiting())', ''); response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/app/' }); response.end(oldWorker); return; } handler(request, response); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
    const ses = session.fromPartition('pwa-import-isolated'); ses.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + owner.secret } }));
    let lyricRequests = 0; await ses.protocol.handle('https', () => { lyricRequests++; return new Response(JSON.stringify({ trackName: 'Сетевая запись', artistName: 'Артист', duration: 8, plainLyrics: 'Текст сервера', syncedLyrics: '[00:00]Текст сервера' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); });
    window = new BrowserWindow({ show: false, width: 360, height: 800, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, ...args) => { const message = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(message || '')) errors.push(message); });
    await window.loadURL(origin + '/api/health');
    const legacy = { id: '123', title: 'Сетевая запись', artist: 'Артист', duration: 8, audioUrl: origin + '/music/audio/123/' + 'a'.repeat(24) + '.mp3' };
    await js('localStorage.setItem("LolzCloud-app-v1",' + JSON.stringify(JSON.stringify({ queue: [legacy], index: 0 })) + ');new Promise((resolve,reject)=>{const r=indexedDB.open("LolzCloud-music-v1",1);r.onupgradeneeded=()=>{r.result.createObjectStore("tracks",{keyPath:"id"});r.result.createObjectStore("lyrics",{keyPath:"id"})};r.onsuccess=()=>{const db=r.result,t=db.transaction("tracks","readwrite");t.objectStore("tracks").put({...'+JSON.stringify(legacy)+',blob:new Blob([Uint8Array.from(atob('+JSON.stringify(fs.readFileSync(files.mp3).toString('base64'))+'),c=>c.charCodeAt(0))],{type:"audio/mpeg"}),bytes:1000});t.oncomplete=()=>{db.close();resolve()};t.onerror=reject}})');
    await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp&&LolzCloudApp.snapshot().offline.includes("123")'), 'Old database was not upgraded');
    check(true, 'IndexedDB v1 upgrade preserves an existing downloaded track and queue');
    await js('document.querySelector("[data-view=rooms]").click()'); await until(() => js('!!document.getElementById("rooms-frame").getAttribute("src")'), 'Room frame missing');
    await js('window.__keptRoom=document.getElementById("rooms-frame").contentWindow;document.querySelector("[data-view=library]").click()');
    async function upload(selector, selected) { if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3'); const doc = await window.webContents.debugger.sendCommand('DOM.getDocument'), found = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector }); await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: found.nodeId, files: selected }); }
    await upload('#audio-import', [files.wav, files.mp3, files.m4a, files.flac, files.bad]); await until(() => js('document.getElementById("audio-import-status").textContent.startsWith("Добавлено:")'), 'Real audio import did not finish', 25000);
    const imported = await js('LolzCloudOffline.list().then(rows=>rows.filter(row=>row.local))'), wav = imported.find(row => row.title.endsWith('wav')), mp3 = imported.find(row => row.title.endsWith('mp3'));
    check(!!wav && !!mp3 && imported.length >= 2 && imported.every(row => row.id.startsWith('local:') && row.audioUrl === '' && row.duration > 0), 'Real file input imports playable audio into verified local-only Blob records');
    check(await js('document.getElementById("audio-import-status").textContent.includes("Не удалось:")&&!document.getElementById("library-results").textContent.includes("Испорченная")'), 'A corrupt MP3 is rejected with partial counts and no phantom library row');
    check(await js('LolzCloudApp.snapshot().queue.join(",")==="123"&&document.getElementById("rooms-frame").contentWindow===__keptRoom'), 'Import preserves the pre-existing queue and exact persistent room frame');
    check(await js('document.documentElement.scrollWidth<=innerWidth&&document.getElementById("audio-import").getBoundingClientRect().right<=innerWidth'), 'Real file chooser and library fit 360px'); await capture('local-library-360');
    async function play(id) { await js('[...document.querySelectorAll("#library-results .track-row")].find(row=>row.dataset.trackId==='+JSON.stringify(id)+').querySelector(".track-play").click()'); await until(() => js('LolzCloudApp.snapshot().current==='+JSON.stringify(id)+'&&LolzCloudApp.snapshot().phase==="playing"'), 'Local audio did not play'); }
    await play(wav.id); check(await js('document.getElementById("audio").currentSrc.startsWith("blob:")'), 'A local WAV plays through a real HTMLMediaElement Blob source');
    await js('document.getElementById("mini-open").click();document.getElementById("player-like").click();document.getElementById("tab-lyrics").click()');
    await upload('#lyrics-import', [files.lrc]); await until(() => js('document.querySelectorAll("#lyrics-text .lyric-line").length===2'), 'LRC import did not render');
    await js('document.querySelectorAll("#lyrics-text .lyric-line")[1].click()'); await until(() => js('document.getElementById("audio").currentTime>=1.95&&document.querySelector("#lyrics-text [data-active=true]")?.textContent==="Мой припев"'), 'Imported LRC did not seek/highlight');
    check(true, 'Imported LRC timestamps seek real local audio and highlight the current line'); await js('document.getElementById("bookmark-add").click()'); await capture('local-lrc-player-360');
    const queueBeforeText = await js('LolzCloudApp.snapshot().queue.join(",")');
    await js('document.getElementById("player-dialog").close()'); await play('123'); await js('document.getElementById("mini-open").click()'); await until(() => js('document.getElementById("lyrics-text").textContent.includes("Текст сервера")'), 'Provider cache fixture not shown');
    const beforeImportRequests = lyricRequests; await upload('#lyrics-import', [files.txt]); await until(() => js('document.getElementById("lyrics-text").textContent.includes("Мой текст <b>без HTML</b>")'), 'TXT did not override provider lyrics');
    check(lyricRequests === beforeImportRequests && await js('!document.querySelector("#lyrics-text b")&&!document.getElementById("lyrics-import-remove").hidden'), 'Imported TXT takes priority over provider cache and renders filename/content as inert text');
    check(await js('LolzCloudApp.snapshot().queue.join(",")') === queueBeforeText && await js('document.getElementById("rooms-frame").contentWindow===__keptRoom'), 'Text import preserves queue and room');
    await upload('#lyrics-import', [files.invalid]); await until(() => js('document.getElementById("lyrics-import-status").textContent.includes("UTF-8")'), 'Invalid encoding not rejected');
    check(await js('document.getElementById("lyrics-text").textContent.includes("Мой текст <b>без HTML</b>")'), 'An invalid text import leaves the previous imported lyrics intact');
    await js('document.getElementById("player-dialog").close()'); await play(wav.id); await delay(200);
    await until(() => js('navigator.serviceWorker.ready.then(()=>!!navigator.serviceWorker.controller)'), 'Offline shell not ready');
    check(await js('caches.match("/app/imports.js").then(value=>!value)'), 'Legacy worker fixture lacks the new imports module before update');
    await js('window.__oldWorker=navigator.serviceWorker.controller'); serveLegacyWorker = false; await js('navigator.serviceWorker.getRegistration().then(value=>value.update())');
    await until(() => js('navigator.serviceWorker.controller!==__oldWorker'), 'New worker waited for all old tabs instead of activating');
    check(await js('caches.match("/app/imports.js").then(value=>!!value)'), 'New worker activates after complete precache and makes imports available to the existing client');
    await ses.enableNetworkEmulation({ offline: true }); await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp&&LolzCloudApp.snapshot().offline.includes('+JSON.stringify(wav.id)+')'), 'Local data did not restore offline');
    await js('document.getElementById("mini-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"&&document.getElementById("audio").currentSrc.startsWith("blob:")'), 'Offline local playback failed');
    check(await js('LolzCloudApp.snapshot().liked.includes('+JSON.stringify(wav.id)+')&&LolzCloudApp.snapshot().bookmarks.length===1'), 'Local identity, likes and bookmarks survive offline reload and actual audio playback');
    await js('document.getElementById("mini-open").click();document.getElementById("tab-lyrics").click()'); await until(() => js('document.getElementById("lyrics-text").textContent.includes("Мой припев")'), 'Imported lyrics did not survive offline');
    check(true, 'Imported LRC remains available offline with priority over remote lookup');
    await js('LolzCloudOffline.remove('+JSON.stringify(wav.id)+')'); await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp'), 'Reload missing local failed'); await js('document.getElementById("mini-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="error"'), 'Missing local file did not show error');
    check(await js('document.getElementById("player-state").textContent.includes("файл не найден")') && !requests.some(url => url.startsWith('/music/prepare') || url.startsWith('/music/audio')), 'A missing local file gives a clear reimport error and never falls through to network preparation');
    await ses.disableNetworkEmulation();
    const atomic = await js('(async()=>{const rows=await LolzCloudOffline.list(),source=await LolzCloudOffline.get('+JSON.stringify(mp3.id)+'),blob=source.blob;const db=await new Promise((r,j)=>{const q=indexedDB.open("LolzCloud-music-v1",2);q.onsuccess=()=>r(q.result);q.onerror=j});await new Promise((r,j)=>{const t=db.transaction("tracks","readwrite");t.objectStore("tracks").put({id:"quota-fixture",bytes:LolzCloudOffline.MAX_TOTAL-rows.reduce((n,row)=>n+(row.bytes||0),0)-blob.size-1});t.oncomplete=r;t.onerror=j});db.close();const tracks=[0,1].map(()=>({...source,id:"local:"+crypto.randomUUID(),local:true,audioUrl:""}));const results=await Promise.allSettled(tracks.map(row=>LolzCloudOffline.saveLocal(row,blob,"quota.mp3")));return{accepted:results.filter(row=>row.status==="fulfilled").length,rejected:results.filter(row=>row.status==="rejected").length}})()');
    check(atomic.accepted === 1 && atomic.rejected === 1, 'Concurrent local commits enforce one atomic shared 256MiB audio quota');
    check(errors.length === 0, 'Import scenarios have no uncaught JavaScript errors');
    console.log(JSON.stringify({ ok: true, count: checks.length, checks, codecs: imported.map(row=>row.title.split(' & ').pop()), screenshots }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); if (window) try { await capture('import-failure'); } catch {} }
  finally { fs.writeFileSync(path.join(output, 'pwa-imports-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, screenshots, errors, failure, fixtureNote: 'Actual isolated Chromium file input → File → verified audio Blob → IndexedDB → HTMLMediaElement and offline reload. Audio files generated by ffmpeg. Existing downloaded-track migration and quota pressure use controlled database fixtures. LRCLIB responses are deterministic adapters; Safari/native picker/device behavior not claimed.' }, null, 2)); if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
}).catch(error => { console.error(error); app.exit(1); });
