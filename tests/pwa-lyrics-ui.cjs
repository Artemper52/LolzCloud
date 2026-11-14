'use strict';
const { app, BrowserWindow, session } = require('electron'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const temporary = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-pwa-ui-') || !output) throw new Error('Isolated profile/output required');
app.setPath('userData', temporary); app.disableHardwareAcceleration(); fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const deadline = Date.now() + 8000; while (!await check()) { if (Date.now() > deadline) throw new Error(label); await delay(40); } }
app.whenReady().then(async () => {
  let server, window, failure = '', scenario = 'own'; const checks = [], requests = [], errors = [];
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(error.message + '\n' + code); } };
  try {
    server = createServer({ origin: 'http://localhost', store: new CloudStore() }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
    const ses = session.fromPartition('pwa-lyrics-isolated');
    const candidate = (title, artist, duration = 60) => ({ trackName: title, artistName: artist, duration, plainLyrics: 'Свои слова\nВторая строка', syncedLyrics: '[00:00.00]Свои слова\n[00:10.00]Вторая строка' });
    await ses.protocol.handle('https', request => {
      const url = new URL(request.url); requests.push({ path: url.pathname, title: url.searchParams.get('track_name'), artist: url.searchParams.get('artist_name') });
      let value, status = 200;
      if (url.pathname === '/api/get') {
        if (scenario === 'rate') { status = 429; value = { error: 'Подожди минуту' }; }
        else if (scenario === 'manual' && url.searchParams.get('track_name') === 'Исправленная песня') value = candidate('Исправленная песня', 'Правильный артист');
        else { status = 404; value = { name: 'TrackNotFound' }; }
      } else if (url.pathname === '/api/search') {
        if (scenario === 'own') value = [candidate('Песня', 'Артист'), candidate('ПЕСНЯ (SLOWED)', 'АРТИСТ')];
        else if (scenario === 'plain') value = [candidate('Другая длительность', 'Артист', 65)];
        else value = [candidate('Чужая песня', 'Чужой артист')];
      } else { status = 404; value = {}; }
      return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    });
    window = new BrowserWindow({ show: false, width: 360, height: 800, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
    window.webContents.on('console-message', (_event, ...args) => { const message = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(message || '')) errors.push(message); });
    await window.loadURL(origin + '/app/');
    async function track(id, title, artist = 'Артист') {
      const row = { id, title, artist, duration: 60, audioUrl: origin + '/music/audio/' + id + '/' + 'a'.repeat(24) + '.mp3' };
      await js('window.addEventListener("pagehide",()=>localStorage.setItem("LolzCloud-app-v1",' + JSON.stringify(JSON.stringify({ queue: [row], index: 0 })) + '),{once:true})');
      await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp'), 'App not ready'); await js('document.getElementById("mini-open").click();document.getElementById("tab-lyrics").click()');
    }
    await track('601', 'Песня (slowed)'); await until(() => js('document.querySelectorAll("#lyrics-text .lyric-line").length===2'), '404 search own recording failed');
    check(requests.some(row => row.path === '/api/search') && await js('document.getElementById("lyrics-text").textContent.includes("Свои слова")'), 'GET404 falls back to search and selects exact Unicode-normalized title/artist while preserving slowed');
    scenario = 'plain'; await track('602', 'Другая длительность'); await until(() => js('document.getElementById("lyrics-text").textContent.includes("Свои слова")'), 'Own plain fallback missing');
    check(await js('document.querySelectorAll("#lyrics-text .lyric-line").length===0&&document.getElementById("lyrics-status").textContent.includes("длительность отличается")'), 'Own title/artist with a five-second duration mismatch renders plain text without clickable timings');
    scenario = 'manual'; await track('603', 'Сырое имя из каталога'); await until(() => js('!document.getElementById("lyrics-edit").hidden'), 'Foreign candidate was not rejected');
    check(await js('!document.getElementById("lyrics-text").textContent'), 'A foreign title and artist never become this track lyrics');
    await js('document.getElementById("lyrics-edit").click();document.getElementById("lyrics-title-input").value="Исправленная песня";document.getElementById("lyrics-artist-input").value="Правильный артист"'); await delay(100);
    check(await js('document.documentElement.scrollWidth<=innerWidth&&document.getElementById("lyrics-metadata-form").scrollWidth<=document.getElementById("lyrics-metadata-form").clientWidth'), 'Correction fields and actions fit the actual 360px player');
    fs.writeFileSync(path.join(output, 'lyrics-correction-360.png'), (await window.webContents.capturePage()).toPNG());
    await js('document.getElementById("lyrics-metadata-form").requestSubmit()'); await until(() => js('document.querySelectorAll("#lyrics-text .lyric-line").length===2'), 'Manual correction did not find lyrics');
    check(await js('JSON.parse(localStorage.getItem("LolzCloud-lyrics-metadata-v1"))["603"].title==="Исправленная песня"&&JSON.parse(localStorage.getItem("LolzCloud-app-v1")).queue[0].title==="Сырое имя из каталога"'), 'Manual correction persists separately from catalogue metadata and cached lyric content');
    await track('603', 'Сырое имя из каталога'); await until(() => js('document.querySelectorAll("#lyrics-text .lyric-line").length===2'), 'Correction was lost after reload');
    check(await js('LolzCloudOffline.lyrics("603").then(value=>value.policy===2&&value.identity.includes("исправленная песня"))'), 'Cache is bound to corrected identity and survives reload without confusing original metadata');
    scenario = 'rate'; const before = requests.filter(row => row.path === '/api/search').length; await track('604', 'Слишком много запросов'); await until(() => js('!document.getElementById("lyrics-edit").hidden'), '429 did not remain retryable');
    check(requests.filter(row => row.path === '/api/search').length === before, 'HTTP429 never starts a search fallback'); check(errors.length === 0, 'Targeted lyric scenarios have no uncaught browser errors');
    console.log(JSON.stringify({ ok: true, count: checks.length, checks }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); }
  finally { fs.writeFileSync(path.join(output, 'pwa-lyrics-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, requests, errors, failure, fixtureNote: 'Actual isolated Chromium UI + real local app HTTP; LRCLIB JSON/status responses are deterministic protocol fixtures. No physical Safari or live provider success claim.' }, null, 2)); if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
}).catch(error => { console.error(error); app.exit(1); });
