'use strict';
const { app, BrowserWindow, session } = require('electron'), fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs'), { ListeningRoom } = require('../source/integrations/room.cjs');
const temporary = process.env.LOLZCLOUD_ROOMS_TEST_PROFILE, root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-rooms-ui-')) throw new Error('An isolated rooms profile is required.');
app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, label, milliseconds = 9000) { const deadline = Date.now() + milliseconds; while (!await predicate()) { if (Date.now() > deadline) throw new Error(label); await delay(90); } }
const {soundcloud:fakeWidget,youtube:fakeYoutube}=require('./fixtures/room-player-sdk.cjs');
app.whenReady().then(async () => {
  let server, desktop, desktopTimer; const windows = [], errors = [], measurements = [];
  try {
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); const origin = 'http://127.0.0.1:' + port;
    const store = new CloudStore({ origin }), owner = store.login({ id: 501, name: 'Fixture owner' }), guest = store.login({ id: 502, name: 'Fixture guest' }), listener = store.login({ id: 503, name: 'Fixture listener' }); server = createServer({ origin, store, clientId: 'fixture-id', verifyProfile: async () => listener.user }); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); const room = store.createRoom(owner.user);
    const authSession = session.fromPartition('rooms-test-auth');
    const auth = new BrowserWindow({ show: false, webPreferences: { session: authSession, sandbox: true, offscreen: true } });
    windows.push(auth);
    await auth.loadURL(origin + '/auth/lolz/callback');
    assert.match(await auth.webContents.executeJavaScript('document.getElementById("status").textContent'), /Вход не подтверждён/);
    assert.equal(await auth.webContents.executeJavaScript('getComputedStyle(document.documentElement).backgroundColor'), 'rgb(17, 16, 26)');
    const pair = store.beginDevice(), state = store.beginLogin('/connect?code=' + pair.code);
    await authSession.cookies.set({ url: origin, name: '__Host-lc_login', value: state, secure: true, httpOnly: true, path: '/' });
    await auth.loadURL('about:blank');
    await auth.loadURL(origin + '/auth/lolz/callback#access_token=fixture-token&state=' + state);
    await until(() => auth.webContents.executeJavaScript('location.pathname === "/connect" && !!window.LolzCloudSession'), 'OAuth callback did not finish browser pairing');
    await auth.webContents.executeJavaScript('document.getElementById("approve").click()');
    await until(() => auth.webContents.executeJavaScript('document.getElementById("status").textContent.includes("Готово")'), 'Browser did not approve desktop pairing');
    assert.equal(store.pollDevice(pair.deviceCode).user.id, listener.user.id);
    async function client(secret, name, width = 1366, lag = 20) { const ses = session.fromPartition('rooms-test-' + name); ses.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => { callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + secret } }); }); await ses.protocol.handle('https', request => new Response(request.url.includes('/iframe_api') ? fakeYoutube : request.url.includes('/player/api.js') ? fakeWidget : '<html><body style="background:#13241a;color:#b8e9c7;font:18px sans-serif;padding:35px">SoundCloud · deterministic synchronization fixture</body></html>', { headers: { 'Content-Type': (/\/(?:player\/api.js|iframe_api)/.test(request.url)) ? 'text/javascript' : 'text/html' } })); const window = new BrowserWindow({ show: false, width, height: 900, webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } }); windows.push(window); window.webContents.on('console-message', (_event, ...args) => { const value = args[1]; if (typeof value === 'string' && /Uncaught|TypeError|SyntaxError/.test(value)) errors.push(name + ': ' + value); }); await window.loadURL(origin + '/room/' + room.id + '/?lag=' + lag); await until(() => window.webContents.executeJavaScript('!!window.LolzCloudSession'), name + ' did not authenticate'); return window; }
    const host = await client(owner.secret, 'owner'), one = await client(guest.secret, 'guest', 1366, 60), two = await client(listener.secret, 'mobile', 420, 100);
    const js = (window, code) => window.webContents.executeJavaScript(code);
    assert.equal(store.room(room.id).settings.public, true, 'New rooms must be public');
    await js(host, 'document.getElementById("settings-chat").click()');
    await until(() => !store.room(room.id).settings.chat, 'Chat toggle did not save immediately');
    await until(() => js(one, 'document.getElementById("chat-input").disabled'), 'Chat setting did not reach a guest');
    await until(() => js(host, '!document.getElementById("settings-chat").disabled'), 'Chat toggle stayed busy');
    await js(host, 'document.getElementById("settings-chat").click()');
    await until(() => store.room(room.id).settings.chat, 'Chat toggle did not restore');
    await js(host, 'document.getElementById("settings-public").click()');
    await until(() => !store.room(room.id).settings.public, 'Public toggle did not save');
    await until(() => js(host, '!document.getElementById("settings-public").disabled'), 'Public toggle stayed busy');
    await js(host, 'document.getElementById("settings-public").click()');
    await until(() => store.room(room.id).settings.public, 'Public toggle did not restore');
    await js(host, 'document.getElementById("settings-form").closest("details").open=true;document.querySelector(".room-toggle").scrollIntoView()');
    await delay(200);fs.writeFileSync(path.join(root,'.build/rooms-toggles-0911.png'),(await host.webContents.capturePage()).toPNG());
    let rejectedWidget = false;
    await two.webContents.session.protocol.unhandle('https');
    await two.webContents.session.protocol.handle('https', request => {
      if(request.url.includes('/iframe_api'))return new Response(fakeYoutube,{headers:{'Content-Type':'text/javascript'}});
      if (!request.url.includes('/player/api.js')) return new Response('<html><body>SoundCloud fixture</body></html>', { headers: { 'Content-Type': 'text/html' } });
      if (!rejectedWidget) { rejectedWidget = true; return new Response('', { status: 503 }); }
      return new Response(fakeWidget, { headers: { 'Content-Type': 'text/javascript' } });
    });
    await js(host, 'document.getElementById("claim-host").click()'); await until(() => js(host, '!document.getElementById("host-controls").hidden'), 'Browser could not become the host');
    await js(host, 'document.getElementById("host-track").value="https://soundcloud.com/fixture/synchronized";document.getElementById("host-track-form").requestSubmit()'); await until(() => js(host, 'window.__fakeWidget?.playing()'), 'Host did not start the track');
    await until(() => js(two, '!document.getElementById("retry-player").hidden'), 'Missing SoundCloud did not show a recovery button');
    assert.equal(await js(two, 'document.getElementById("chat-input").disabled'), false);
    await js(two, 'document.getElementById("retry-player").click()');
    await until(() => js(one, '!!window.__fakeWidget'), 'Guest did not preload the track'); await until(() => js(two, '!!window.__fakeWidget'), 'Mobile guest could not retry the track'); await js(one, 'document.getElementById("join").click()'); await js(two, 'document.getElementById("join").click()'); await delay(3500);
    async function positions(label) { const values = await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.position()'))); const spread = Math.max(...values) - Math.min(...values); measurements.push({ label, spreadMs: Math.round(spread * 1000) }); assert.ok(spread < .45, label + ': spread=' + spread + 's'); return values; }
    await positions('playing'); await js(host, 'document.getElementById("host-play").click()'); await until(async () => (await Promise.all([host, one, two].map(window => js(window, '!window.__fakeWidget.playing()')))).every(Boolean), 'Shared pause was not applied'); await positions('paused');
    await js(host, 'document.getElementById("host-seek").value="37";document.getElementById("host-seek").dispatchEvent(new Event("change"))'); await delay(1500); const paused = await positions('seek'); assert.ok(paused.every(value => Math.abs(value - 37) < .4));
    await js(host, 'document.getElementById("host-play").click()'); await delay(2000); await positions('resume');
    await js(two,'window.__blockYoutube=true');
    const youtubeUrl='https://music.youtube.com/watch?v=fixtureYT01';
    await js(host,'document.getElementById("host-track").value='+JSON.stringify(youtubeUrl)+';document.getElementById("host-track-form").requestSubmit()');
    await until(()=>js(host,'window.__fakePlayer?.url()==='+JSON.stringify(youtubeUrl)+'&&window.__fakePlayer.playing()'), 'Browser host did not start YouTube');
    await until(()=>js(two,'document.getElementById("connection-status").textContent.includes("Нажми Play")'), 'Blocked YouTube autoplay was incorrectly shown as synchronized');
    await js(two,'window.__blockYoutube=false;document.getElementById("resync").click()');await delay(2000);
    await positions('YouTube playing');
    assert.equal(await js(host,'document.querySelector("#player").getBoundingClientRect().height>=200'),true);
    await js(host,'document.getElementById("host-play").click()');
    await until(async()=>(await Promise.all([host,one,two].map(window=>js(window,'!window.__fakePlayer.playing()')))).every(Boolean),'YouTube shared pause failed');
    await js(host,'document.getElementById("host-seek").value="48";document.getElementById("host-seek").dispatchEvent(new Event("change"))');await delay(1200);await positions('YouTube seek');
    await js(host,'document.getElementById("host-track").value="https://soundcloud.com/fixture/after-youtube";document.getElementById("host-track-form").requestSubmit()');
    await until(()=>js(two,'window.__fakePlayer?.url()==="https://soundcloud.com/fixture/after-youtube"&&window.__fakePlayer.playing()'),'Switching from YouTube to SoundCloud did not replace the room player');await delay(1500);await positions('SoundCloud after YouTube');
    fs.writeFileSync(path.join(root, '.build/rooms-owner-test.png'), (await host.webContents.capturePage()).toPNG()); fs.writeFileSync(path.join(root, '.build/rooms-mobile-test.png'), (await two.webContents.capturePage()).toPNG());
    await js(one, 'document.getElementById("queue-url").value="https://soundcloud.com/fixture/request";document.getElementById("queue-form").requestSubmit()'); await until(() => js(host, 'document.getElementById("queue-list").textContent.includes("request")'), 'Queue request did not reach the host');
    const sent = await fetch(origin + '/api/rooms/' + room.id + '/control', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'role', userId: guest.user.id, role: 'dj' }) }); assert.equal(sent.status, 200);
    await js(host, 'document.getElementById("release-host").click()'); await delay(500); await js(one, 'document.getElementById("claim-host").click()'); await until(() => js(one, '!document.getElementById("host-controls").hidden'), 'DJ could not take over'); await until(() => js(host, 'document.getElementById("host-controls").hidden'), 'Previous host retained control');
    const started = Date.now(); desktop = new ListeningRoom(() => ({ fresh: true, private: false, playback: { title: 'Desktop-controlled song', artist: 'Fixture', url: 'https://soundcloud.com/fixture/synchronized', duration: 200, position: 60 + (Date.now() - started) / 1000, playing: true, rate: 1 }, sampledAt: Date.now() }), { origin }); desktop.token = owner.secret; desktop.expires = owner.expires; desktop.user = owner.user; desktop.room = store.viewRoom(store.room(room.id), owner.user); await desktop.claim(); await desktop.publish(); desktopTimer = setInterval(() => { void desktop.publish().catch(error => errors.push(error.message)); }, 1000);
    await until(() => js(one, 'document.getElementById("host-controls").hidden'), 'Desktop takeover did not revoke browser DJ'); await delay(3000); const values = await positions('desktop takeover'); assert.ok(values.every(value => value > 60));
    await one.webContents.session.enableNetworkEmulation({ offline: true }); await delay(1200); await one.webContents.session.enableNetworkEmulation({ offline: false }); await js(one, 'window.dispatchEvent(new Event("online"))'); await delay(3000); await positions('reconnect');
    assert.deepEqual(errors, []); console.log('Room clients passed: three authenticated clients, real SSE, browser/DJ/app handoff, play/pause/seek, queue, network recovery. ' + JSON.stringify(measurements));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { clearInterval(desktopTimer); if (desktop) await desktop.dispose(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } app.exit(process.exitCode || 0); }
});
