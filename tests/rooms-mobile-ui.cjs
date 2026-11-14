'use strict';
const { app, BrowserWindow, session } = require('electron'), fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const { soundcloud, youtube } = require('./fixtures/room-player-sdk.cjs');
const profile = process.env.LOLZCLOUD_ROOMS_TEST_PROFILE, output = process.env.LOLZCLOUD_ROOMS_TEST_OUTPUT;
if (!profile || !path.basename(profile).startsWith('LolzCloud-rooms-mobile-') || !output) throw Error('Isolated profile/output required');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 10000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() > end) throw Error(label); await delay(60); } }
app.whenReady().then(async () => {
  const windows = [], checks = [], errors = [], screenshots = []; let server, failure = '';
  const js = async (window, code) => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw Error(error.message + '\nExpression: ' + code + '\nRenderer: ' + errors.join('\n')); } };
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  async function tap(window, selector) {
    const p = await js(window, '(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');if(!el||el.disabled)throw Error("Tap target unavailable");el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
    window.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); window.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await delay(35);
  }
  async function capture(window, name) { await delay(180); const file = path.join(output, name + '.png'); fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG()); screenshots.push(file); }
  try {
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const origin = 'http://127.0.0.1:' + port, store = new CloudStore({ origin }), owner = store.login({ id: 851, name: 'Owner fixture' }), dj = store.login({ id: 852, name: 'Guest fixture' });
    const tracks = ['first', 'second', 'third'].map(name => ({ url: 'https://soundcloud.com/fixture/' + name, title: 'Fixture ' + name, artist: 'Room QA', duration: 200 }));
    server = createServer({ store, origin }); const handler = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (request, response) => {
      if (request.url.startsWith('/api/music/search?')) { const query = new URL(request.url, 'http://fixture').searchParams.get('q'); const send = () => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ tracks: query === 'old' ? [tracks[2]] : tracks })); }; if (query === 'old') setTimeout(send, 400); else send(); return; }
      handler(request, response);
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); const id = store.createRoom(owner.user).id;
    async function post(secret, action, value) { const response = await fetch(origin + '/api/rooms/' + id + '/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); const result = await response.json(); if (!response.ok) throw Error(result.error); return result; }
    async function client(secret, name, width) {
      const ses = session.fromPartition('mobile-room-' + name);
      ses.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + secret } }));
      await ses.protocol.handle('https', request => new Response(request.url.includes('/iframe_api') ? youtube : request.url.includes('/player/api.js') ? soundcloud : '<!doctype html><title>Declared SDK fixture</title>', { headers: { 'Content-Type': /\/api\.js|iframe_api/.test(request.url) ? 'text/javascript' : 'text/html' } }));
      const window = new BrowserWindow({ show: false, width, height: 800, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } }); windows.push(window);
      if (width < 500) window.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36');
      window.webContents.on('console-message', (_event, ...args) => { const value = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(value || '')) errors.push(name + ': ' + value); });
      await window.loadURL(origin + '/room/' + id + '/'); await until(() => js(window, '!!window.LolzCloudSession&&!document.getElementById("chat-input").disabled'), 'Room did not join: ' + name); return window;
    }
    const pc = await client(owner.secret, 'pc', 1366), phone = await client(owner.secret, 'phone', 360), guest = await client(dj.secret, 'guest', 420);
    const pcController = await post(owner.secret, 'control', { type: 'claim', connection: 'fixture-pc-controller', name: 'Fixture PC' });
    await fetch(origin + '/api/rooms/' + id + '/state', { method: 'PUT', headers: { Authorization: 'Bearer ' + owner.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ lease: pcController.lease, connection: 'fixture-pc-controller', sequence: 1, fresh: true, playback: { ...tracks[0], position: 12, playing: true } }) });
    await until(() => js(phone, '!!window.__fakePlayer'), 'Phone source did not preload');
    check(await js(phone, '!__fakePlayer.playing()&&document.getElementById("host-controls").hidden'), 'A joined phone preloads without audible playback or silently taking the PC controller');
    await js(phone, 'window.__originalPlayer=document.getElementById("player");window.__draftInput=document.getElementById("chat-input");__draftInput.value="Draft stays while selecting music"');
    async function search(window, query = 'music') { await tap(window, '#open-music'); await js(window, 'document.getElementById("room-search-query").value=' + JSON.stringify(query)); await tap(window, '#room-search-form button'); await until(() => js(window, 'document.querySelectorAll("#room-search-results .room-search-result").length===3'), 'Room search failed'); }
    await search(phone);
    check(await js(phone, 'document.querySelectorAll("#room-search-results [data-room-play]").length===3') && store.room(id).controller.connection === 'fixture-pc-controller', 'An owner phone sees direct play before claiming, while merely opening or searching never takes the PC controller');
    const second = '#room-search-results .room-search-result:nth-child(2) [data-room-play]';
    await tap(phone, second); await until(() => store.room(id).playback.url === tracks[1].url && store.room(id).playback.playing && js(phone, '__fakePlayer.playing()'), 'Owner phone direct play failed');
    check(store.room(id).controller.connection !== 'fixture-pc-controller', 'One explicit search Play transfers the owner controller from PC to phone and starts the chosen track');
    check(await js(phone, '__fixturePlayCalls.length>0&&__fixturePlayCalls.every(url=>url===' + JSON.stringify(tracks[1].url) + ')'), 'Unlock and handoff never play the outgoing track as an audio-gesture workaround');
    const stale = await fetch(origin + '/api/rooms/' + id + '/state', { method: 'PUT', headers: { Authorization: 'Bearer ' + owner.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ lease: pcController.lease, connection: 'fixture-pc-controller', sequence: 99, fresh: true, playback: tracks[0] }) });
    check(stale.status === 409 && store.room(id).playback.url === tracks[1].url, 'The old PC cannot overwrite the phone track after handoff');
    check(await js(phone, 'document.getElementById("player")===__originalPlayer&&document.getElementById("chat-input")===__draftInput&&__draftInput.value==="Draft stays while selecting music"&&!document.getElementById("room-sheet").open'), 'Direct play returns to the same room, source iframe and untouched chat draft');
    await capture(phone, 'room-playing-360');
    await search(guest); check(await js(guest, '!document.querySelector("#room-search-results [data-room-play]")&&document.getElementById("room-search-status").textContent==="Предложи песню в общую очередь."'), 'Listener results only offer queue proposals and do not promise direct play');
    await js(guest, 'document.querySelector("#room-search-results .room-search-result:nth-child(3) .room-track-actions button").click()');
    await until(() => (store.room(id).queue || []).some(row => row.track.url === tracks[2].url), 'Listener proposal did not reach the room');
    check(store.room(id).playback.url === tracks[1].url && !store.room(id).queue[0].approved, 'A listener proposal waits for approval and leaves the current music playing');
    await post(owner.secret, 'control', { type: 'role', userId: dj.user.id, role: 'dj' });
    await until(() => js(guest, 'document.querySelectorAll("#room-search-results [data-room-play]").length===3'), 'Role change left stale search actions');
    check(await js(guest, 'document.getElementById("room-search-query").value==="music"'), 'Promotion to DJ updates the existing search results without another query');
    await tap(guest, '#room-search-results [data-room-play]');
    await until(() => js(guest, 'document.getElementById("room-sheet-status").textContent.includes("уже есть ведущий")'), 'Busy DJ controller conflict was not readable in the open music dialog');
    check(store.room(id).playback.url === tracks[1].url && await js(guest, 'document.getElementById("room-sheet").open&&!document.querySelector("#room-search-results [data-room-play]").disabled'), 'DJ cannot steal an occupied controller; error keeps search and a working explicit retry');
    await capture(guest, 'room-dj-conflict-420');
    await tap(phone, '#open-people'); await tap(phone, '#release-host'); await tap(phone, '#room-sheet-close');
    await tap(guest, '#room-search-results [data-room-play]'); await until(() => store.room(id).controller.user.id === dj.user.id && store.room(id).playback.playing, 'DJ could not start after owner release');
    check(true, 'The same DJ result starts correctly after an explicit owner release');
    await post(owner.secret, 'control', { type: 'role', userId: dj.user.id, role: 'listener' });
    await tap(guest, '#open-music'); await until(() => js(guest, '!document.querySelector("#room-search-results [data-room-play]")'), 'Revoked DJ retained result play actions');
    check(await js(guest, 'document.getElementById("host-controls").hidden'), 'Revoking DJ removes stale play and transport controls in the existing room');
    await tap(guest, '#room-sheet-close');
    for (const name of ['queue-first', 'queue-chosen', 'queue-last']) await post(owner.secret, 'queue', { type: 'add', track: { ...tracks[0], url: 'https://soundcloud.com/fixture/' + name, title: name } });
    const before = store.room(id).queue.map(row => ({ id: row.id, url: row.track.url })), chosen = before.find(row => row.url.endsWith('queue-chosen'));
    const chosenSelector = '[data-queue-id="' + chosen.id + '"] [data-room-play]';
    await tap(phone, '#open-queue'); await until(() => js(phone, '!!document.querySelector(' + JSON.stringify(chosenSelector) + ')'), 'Direct queue action missing');
    await tap(phone, chosenSelector);
    await until(() => store.room(id).playback.url === chosen.url && store.room(id).playback.playing, 'Non-head queue direct play failed');
    check(JSON.stringify(store.room(id).queue.map(row => row.id)) === JSON.stringify(before.filter(row => row.id !== chosen.id).map(row => row.id)), 'Direct queue play atomically consumes only its exact queue ID and preserves every other row');
    const remaining = store.viewRoom(store.room(id), owner.user).queue.find(row => row.approved);
    await tap(phone, '#host-next'); await until(() => store.room(id).playback.url === remaining.track.url && store.room(id).playback.playing, 'Next after direct selection failed');
    check(!store.room(id).queue.some(row => row.id === remaining.id) && !store.room(id).queue.some(row => row.id === chosen.id), 'Next after direct queue selection consumes the next approved row without replaying the selected entry');
    await js(phone, 'window.__blockSoundCloud=true;LolzCloudRoomPlayback.command("pause")'); await tap(phone, '#host-play');
    await until(() => js(phone, 'document.getElementById("host-play").textContent==="Разрешить звук здесь"'), 'Silent SDK autoplay block was not surfaced');
    check(store.room(id).playback.playing && await js(phone, '!__fakePlayer.playing()'), 'A blocked local source is reported explicitly and does not pause the shared room');
    await js(phone, 'window.__blockSoundCloud=false'); await tap(phone, '#host-play'); await until(() => js(phone, '__fakePlayer.playing()'), 'Explicit audio recovery did not start');
    check(store.room(id).playback.playing, 'The explicit allow-sound action starts local audio without toggling the shared room into pause');
    const retryRow = store.viewRoom(store.room(id), owner.user).queue.find(row => row.approved), retrySelector = '[data-queue-id="' + retryRow.id + '"] [data-room-play]';
    await tap(phone, '#open-queue'); await js(phone, 'window.__failNextSoundCloud=true'); await tap(phone, retrySelector);
    await until(() => js(phone, '!document.getElementById("retry-player").hidden&&document.getElementById("room-sheet-status").textContent.includes("Источник не открыл")'), 'Failed queued SDK load did not expose a readable retry');
    const afterFailedLoad = store.room(id).queue.map(row => row.id);
    check(store.room(id).playback.url === retryRow.track.url && !store.room(id).playback.playing && !afterFailedLoad.includes(retryRow.id), 'A queued source error leaves the selected track paused and consumes its queue entry only once');
    await tap(phone, '#room-sheet-close'); await tap(phone, '#retry-player');
    await until(() => store.room(id).playback.url === retryRow.track.url && store.room(id).playback.playing && js(phone, '__fakePlayer.playing()'), 'Visible source retry did not resume the chosen recording');
    check(JSON.stringify(store.room(id).queue.map(row => row.id)) === JSON.stringify(afterFailedLoad) && await js(phone, 'document.getElementById("chat-input")===__draftInput&&__draftInput.value==="Draft stays while selecting music"'), 'Retry starts the selected track without consuming another queue entry or losing the original chat draft');
    for (const [window, width] of [[phone, 360], [guest, 420], [pc, 1366]]) check(await js(window, 'document.documentElement.scrollWidth<=innerWidth+1'), 'Room layout stays within the actual ' + width + 'px viewport');
    check(errors.length === 0, 'No uncaught JavaScript errors in mobile handoff/search/queue scenarios');
  } catch (error) { failure = error.stack || String(error); console.error(failure); for (const [index, window] of windows.entries()) if (!window.isDestroyed()) try { await capture(window, 'failure-' + index); } catch {} }
  finally { fs.writeFileSync(path.join(output, 'rooms-mobile-results.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', count: checks.length, checks, screenshots, errors, failure, fixtureNote: 'Real isolated Chromium DOM/mouse input, HTTP, sessions, SSE, role/lease/atomic queue APIs. Search metadata and SC/YT SDK are declared deterministic fixtures; this does not prove real external-provider audio or physical Android/iOS.' }, null, 2)); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
});
