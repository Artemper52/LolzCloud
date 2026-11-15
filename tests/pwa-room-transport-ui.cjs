'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const { soundcloud, youtube } = require('./fixtures/room-player-sdk.cjs');
const profile = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!profile || !path.basename(profile).startsWith('LolzCloud-pwa-ui-') || !output) throw Error('Isolated profile/output required');
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio'); app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 10000) { const end = Date.now() + ms; while (!await check()) { if (Date.now() > end) throw Error(label); await delay(35); } }
app.whenReady().then(async () => {
  let server, window, failure = '', slowQueue = false, slowControl = false; const checks = [], errors = [], requests = [];
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const js = code => window.webContents.executeJavaScript(code, true);
  const room = code => js('(()=>{const w=document.getElementById("rooms-frame").contentWindow;return (' + code + ')})()');
  try {
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const origin = 'http://127.0.0.1:' + port, store = new CloudStore({ origin }), owner = store.login({ id: 891, name: 'Room owner fixture' });
    server = createServer({ store, origin }); const id = store.createRoom(owner.user).id;
    const solo = ['1', '2'].map((id, i) => ({ id, title: 'Intro', artist: 'Artist ' + (i ? 'B' : 'A'), duration: 60, audioUrl: origin + '/music/audio/' + id + '/' + 'a'.repeat(24) + '.mp3', cover: 'https://i1.sndcdn.com/fixture-' + id + '-large.jpg' }));
    const source = { url: 'https://soundcloud.com/fixture/room-speedup', title: 'Room Song (speed up)', artist: 'Room Artist', duration: 200 };
    const bytes = Buffer.alloc(44 + 60 * 8000 * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); for (let i = 0; i < 480000; i++) bytes.writeInt16LE(Math.round(1800 * Math.sin(i * 2 * Math.PI * 430 / 8000)), 44 + i * 2);
    const handler = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const url = new URL(req.url, origin);
      if (url.pathname === '/app/core.js') {
        const prefix = 'window.__systemHandlers={};const originalActionHandler=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);navigator.mediaSession.setActionHandler=(action,handler)=>{__systemHandlers[action]=handler;return originalActionHandler(action,handler)};localStorage.setItem("LolzCloud-app-v1",' + JSON.stringify(JSON.stringify({ queue: solo, index: 0 })) + ');\n';
        res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(prefix + fs.readFileSync(path.join(__dirname, '../server/public/app/core.js'), 'utf8')); return;
      }
      if (url.pathname.startsWith('/music/prepare/')) { const number = url.pathname.split('/')[3]; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ state: 'ready', audioUrl: origin + '/music/audio/' + number + '/' + 'a'.repeat(24) + '.mp3' })); return; }
      if (url.pathname.startsWith('/music/audio/')) {
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/), first = range ? +range[1] : 0, last = range?.[2] ? Math.min(bytes.length - 1, +range[2]) : bytes.length - 1;
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': last - first + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': 'bytes ' + first + '-' + last + '/' + bytes.length } : {}) }); res.end(bytes.subarray(first, last + 1)); return;
      }
      if (slowQueue && url.pathname === '/api/rooms/' + id + '/queue') { setTimeout(() => handler(req, res), 400); return; }
      if (slowControl && url.pathname === '/api/rooms/' + id + '/control') { setTimeout(() => handler(req, res), 400); return; }
      handler(req, res);
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    async function post(action, value, method = 'POST') { const response = await fetch(origin + '/api/rooms/' + id + '/' + action, { method, headers: { Authorization: 'Bearer ' + owner.secret, 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); const result = await response.json(); if (!response.ok) throw Error(result.error); return result; }
    const initial = await post('control', { type: 'claim', connection: 'fixture-external-controller' });
    await post('state', { connection: 'fixture-external-controller', lease: initial.lease, sequence: 1, fresh: true, playback: { ...source, position: 17, playing: true } }, 'PUT');
    const ses = session.fromPartition('pwa-room-transport');
    ses.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + owner.secret } }));
    await ses.protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.hostname === 'lrclib.net') {
        requests.push({ path: url.pathname, title: url.searchParams.get('track_name'), artist: url.searchParams.get('artist_name') });
        const candidate = { id: 801, trackName: 'Room Song', artistName: 'Room Artist', duration: 250, plainLyrics: 'First words\nSecond line', syncedLyrics: '[00:25.00]<00:25.00>First <00:26.00>words\n[00:50.00]Second line' };
        return new Response(JSON.stringify(url.pathname === '/api/search' ? [candidate] : { name: 'TrackNotFound' }), { status: url.pathname === '/api/search' ? 200 : 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Lrclib-Client' } });
      }
      return new Response(request.url.includes('/iframe_api') ? youtube : request.url.includes('/player/api.js') ? soundcloud : '<!doctype html><title>Declared external SDK fixture</title>', { headers: { 'Content-Type': /\/api\.js|iframe_api/.test(request.url) ? 'text/javascript' : 'text/html' } });
    });
    window = new BrowserWindow({ show: false, width: 390, height: 844, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, ...args) => { const message = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(message || '')) errors.push(message); });
    await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp'), 'PWA did not start');
    await js('document.getElementById("mini-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"'), 'Real synthetic solo did not play');
    await js('__systemHandlers.nexttrack()'); await until(() => js('LolzCloudApp.snapshot().current==="2"&&LolzCloudApp.snapshot().phase==="playing"'), 'Solo system Next failed');
    check(await js('navigator.mediaSession.metadata.title==="Intro"&&navigator.mediaSession.metadata.artist==="Artist B"&&navigator.mediaSession.metadata.artwork[0].src.includes("fixture-2")'), 'MediaSession updates artist and artwork when two different recordings have the same title');
    await js('LolzCloudApp.openRoom(' + JSON.stringify(origin + '/room/' + id + '/') + ')');
    await until(() => room('!!w.LolzCloudRoomTransport&&!!w.__fakePlayer&&w.document.getElementById("join").disabled===false'), 'Room transport did not load');
    await room('w.document.getElementById("chat-input").value="Kept chat draft"'); await room('w.document.getElementById("join").click()');
    await until(async () => await js('LolzCloudApp.snapshot().roomAudible&&document.getElementById("audio").paused') && await room('w.__fakePlayer.playing()'), 'Room did not acquire transport');
    const first = await room('w.LolzCloudRoomTransport.snapshot()');
    check(first.active && first.playback.playing && !first.capabilities.next && await js('LolzCloudApp.snapshot().current==="2"'), 'Explicit room listening pauses solo and retains its queue while using listener permissions');
    await js('__systemHandlers.nexttrack()'); await delay(100);
    check(store.room(id).playback.url === source.url && await js('LolzCloudApp.snapshot().current==="2"&&document.getElementById("audio").paused'), 'A listener system Next cannot resume or advance the old solo queue or steal the room controller');
    await js('__systemHandlers.pause()'); await until(() => room('!w.__fakePlayer.playing()'), 'Listener pause failed');
    check(store.room(id).playback.playing && await room('w.LolzCloudRoomTransport.snapshot().active'), 'Listener hardware Pause mutes locally and keeps room ownership for Resume');
    await js('__systemHandlers.play()'); await until(() => room('w.__fakePlayer.playing()'), 'Listener resume failed');
    check((await room('w.LolzCloudRoomTransport.snapshot().epoch')) === first.epoch && await js('document.getElementById("audio").paused'), 'Hardware Resume resumes the same room epoch and never starts the solo recording');
    await js('document.getElementById("room-lyrics").click()'); await until(() => js('document.querySelectorAll("#room-lyrics-text .lyric-line").length===2'), 'Room lyrics were not found');
    check(requests.length === 1 && requests[0].path === '/api/search' && requests[0].title === 'Room Song' && await js('document.getElementById("room-lyrics-status").textContent.includes("1.25×")&&document.querySelector("#room-lyrics-text .lyric-line").dataset.time==="20"&&document.querySelectorAll("#room-lyrics-text .lyric-word").length===2'), 'Room lyrics use the shared cleaned search, duration estimate and real word timings');
    check(await js('!document.querySelector("#room-lyrics-text button")') && await room('w.__fakePlayer.playing()&&w.document.getElementById("chat-input").value==="Kept chat draft"'), 'Read-only listener lyrics preserve room audio, source document and chat draft');
    await js('document.getElementById("room-lyrics-dialog").close();document.getElementById("room-lyrics").click()'); await until(() => js('document.querySelectorAll("#room-lyrics-text .lyric-line").length===2'), 'Warm room text disappeared');
    check(requests.length === 1, 'Reopening found room lyrics makes no provider request');
    await js('document.getElementById("room-lyrics-dialog").close()');
    await room('w.document.getElementById("claim-host").click()'); await until(() => room('w.LolzCloudRoomTransport.snapshot().capabilities.next'), 'Owner handoff did not expose room system controls');
    await js('__systemHandlers.play()'); await until(() => store.room(id).playback.playing, 'Host hardware Play failed');
    for (const name of ['head', 'last']) await post('queue', { type: 'add', track: { ...source, url: 'https://soundcloud.com/fixture/' + name, title: name } });
    await room('w.__fixtureNextReadyDelay=3300'); await js('__systemHandlers.nexttrack()'); await delay(2800);
    check(store.room(id).queue.length === 1 && await js('!document.getElementById("notice").textContent.includes("Комната не ответила")&&document.getElementById("audio").paused'), 'A valid room Next acknowledged as preparing does not falsely time out after 2.5 seconds or consume another queue entry');
    await until(() => store.room(id).playback.url.endsWith('/head') && store.room(id).playback.playing, 'Host system Next did not consume room queue head');
    check(store.room(id).queue.length === 1 && await js('LolzCloudApp.snapshot().current==="2"&&document.getElementById("audio").paused'), 'Host system Next consumes only the room queue head and leaves solo selected and paused');
    await js('__systemHandlers.seekto({seekTime:31})'); await until(() => store.room(id).playback.position >= 30.9, 'Room seek did not reach server');
    await js('__systemHandlers.previoustrack()'); await until(() => store.room(id).playback.position < 2, 'Room previous did not restart current recording');
    check(true, 'System Seek and Previous use the active room lease and shared source clock');
    slowQueue = true; await js('__systemHandlers.nexttrack()'); await delay(50);
    const outgoing = await room('w.LolzCloudRoomTransport.snapshot()'); await js('document.getElementById("mini-play").click()');
    await until(() => js('LolzCloudApp.snapshot().phase==="playing"&&!LolzCloudApp.snapshot().roomAudible'), 'Explicit solo resume failed'); await delay(800);
    check(await room('!w.__fakePlayer.playing()&&!w.LolzCloudRoomTransport.snapshot().active') && await js('!document.getElementById("audio").paused&&LolzCloudApp.snapshot().current==="2"'), 'Solo handoff during a slow room Next pauses the room immediately and late completion never reacquires audio');
    await js('window.dispatchEvent(new MessageEvent("message",{origin:location.origin,source:document.getElementById("rooms-frame").contentWindow,data:{type:"lolzcloud:room-transport",transport:' + JSON.stringify(outgoing) + '}}))'); await delay(80);
    check(await js('LolzCloudApp.snapshot().phase==="playing"&&!LolzCloudApp.snapshot().roomAudible'), 'A delayed active snapshot from before release cannot pause solo or regain system ownership');
    slowQueue = false; await room('w.document.getElementById("release-host").click()'); await until(() => !store.viewRoom(store.room(id),owner.user).controller, 'Controller did not release');
    slowControl = true; await room('w.document.getElementById("claim-host").click()'); await delay(50);
    await js('document.getElementById("mini-play").click();document.getElementById("mini-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"'), 'Solo choice during slow claim did not play'); await delay(600);
    check(await room('!w.LolzCloudRoomTransport.snapshot().active&&!w.__fakePlayer.playing()') && await js('!document.getElementById("audio").paused&&!LolzCloudApp.snapshot().roomAudible'), 'A delayed controller claim after an explicit solo choice cannot reacquire or autoplay room audio');
    await js('document.getElementById("rooms-directory").click()'); await until(() => room('w.location.pathname==="/rooms"'), 'Room directory did not open');
    check(await js('LolzCloudApp.snapshot().phase==="playing"'), 'Leaving the room document does not restart or stop the explicitly selected solo stream');
    slowControl = false; await js('LolzCloudApp.openRoom(' + JSON.stringify(origin + '/room/' + id + '/') + ')'); await until(() => room('!!w.LolzCloudRoomTransport&&!w.document.getElementById("join").disabled'), 'Replacement room did not load');
    await room('w.document.getElementById("join").click()'); await until(() => js('LolzCloudApp.snapshot().roomAudible&&document.getElementById("audio").paused'), 'Replacement room did not acquire');
    await js('document.getElementById("rooms-directory").click()'); await until(() => room('w.location.pathname==="/rooms"'), 'Owned room did not exit');
    await js('__systemHandlers.play();__systemHandlers.nexttrack()'); await delay(100);
    check(await js('LolzCloudApp.snapshot().phase==="paused"&&LolzCloudApp.snapshot().current==="2"&&document.getElementById("audio").paused&&navigator.mediaSession.metadata===null'), 'After leaving an owned room stale system Play/Next cannot restart the retained solo queue');
    await js('document.getElementById("mini-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"'), 'Explicit solo after room exit remained blocked');
    check(await js('!document.getElementById("audio").paused&&navigator.mediaSession.metadata.artist==="Artist B"'), 'An explicit solo UI choice after room exit restores playback and its own MediaSession metadata');
    check(await js('document.documentElement.scrollWidth<=innerWidth') && errors.length === 0, '390px room integration has no horizontal overflow or uncaught JavaScript errors');
    fs.writeFileSync(path.join(output, 'pwa-room-transport-390.png'), (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ ok: true, count: checks.length, checks }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); if (window && !window.isDestroyed()) fs.writeFileSync(path.join(output, 'pwa-room-transport-failure.png'), (await window.webContents.capturePage()).toPNG()); }
  finally { fs.writeFileSync(path.join(output, 'pwa-room-transport-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, errors, requests, failure, fixtureNote: 'Real isolated Chromium app/room DOM, MediaSession handlers, audible-clock HTMLAudio synthetic WAV, local HTTP/SSE/CSRF/room lease/queue; external SC/YT SDK and LRCLIB responses are declared deterministic fixtures. No physical phone, real external-provider audio or native OS command proof.' }, null, 2)); if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
});
