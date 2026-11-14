'use strict';
const { app, BrowserWindow, session } = require('electron'), fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs'), { ListeningRoom } = require('../source/integrations/room.cjs');
const temporary = process.env.LOLZCLOUD_ROOMS_TEST_PROFILE, root = path.resolve(__dirname, '..'), output = process.env.LOLZCLOUD_ROOMS_TEST_OUTPUT || path.join(root, '.build');
fs.mkdirSync(output, { recursive: true });
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-rooms-ui-')) throw new Error('An isolated rooms profile is required.');
app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, label, milliseconds = 9000) { const deadline = Date.now() + milliseconds; while (!await predicate()) { if (Date.now() > deadline) throw new Error(label); await delay(90); } }
const {soundcloud:fakeWidget,youtube:fakeYoutube}=require('./fixtures/room-player-sdk.cjs');
app.whenReady().then(async () => {
  let server, desktop, desktopTimer; const windows = [], errors = [], measurements = [], scenarios = [], startedAt = Date.now(), streams = new Map();
  let testFailure = '';
  try {
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); const origin = 'http://127.0.0.1:' + port;
    const store = new CloudStore({ origin }), owner = store.login({ id: 501, name: 'Fixture owner' }), guest = store.login({ id: 502, name: 'Fixture guest' }), listener = store.login({ id: 503, name: 'Fixture listener' }); server = createServer({ origin, store, clientId: 'fixture-id', verifyProfile: async () => listener.user });
    server.on('request', (request, response) => {
      if (!/^\/api\/rooms\/[a-f0-9]{32}\/events(?:\?|$)/.test(request.url)) return;
      const identity = request.headers.authorization;
      streams.set(identity, response);
      response.on('close', () => { if (streams.get(identity) === response) streams.delete(identity); });
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); const room = store.createRoom(owner.user);
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
    async function client(secret, name, width = 1366, lag = 20) {
      const ses = session.fromPartition('rooms-test-' + name);
      ses.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + secret } }));
      await ses.protocol.handle('https', async request => {
        // Leave a real asynchronous SDK-loading gap after the outgoing player
        // was removed, so its pending callbacks must be rejected by room.js.
        if (request.url.includes('/iframe_api')) await delay(180);
        return new Response(request.url.includes('/iframe_api') ? fakeYoutube : request.url.includes('/player/api.js') ? fakeWidget : '<html><body style="background:#13241a;color:#b8e9c7;font:18px sans-serif;padding:35px">SoundCloud · deterministic synchronization fixture</body></html>', { headers: { 'Content-Type': (/\/(?:player\/api.js|iframe_api)/.test(request.url)) ? 'text/javascript' : 'text/html' } });
      });
      const window = new BrowserWindow({ show: false, width, height: 900, webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } }); windows.push(window);
      window.webContents.on('console-message', (_event, ...args) => { const value = args[1]; if (typeof value === 'string' && /Uncaught|TypeError|SyntaxError/.test(value)) errors.push(name + ': ' + value); });
      await window.loadURL(origin + '/room/' + room.id + '/?lag=' + lag); await until(() => window.webContents.executeJavaScript('!!window.LolzCloudSession'), name + ' did not authenticate'); return window;
    }
    const host = await client(owner.secret, 'owner'), one = await client(guest.secret, 'guest', 1366, 60), two = await client(listener.secret, 'mobile', 420, 100);
    const js = (window, code) => window.webContents.executeJavaScript(code);
    const queuedUrls = () => store.viewRoom(store.room(room.id), owner.user).queue.map(row => row.track.url);
    async function addQueued(url, window = host) {
      await js(window, 'document.getElementById("queue-url").value=' + JSON.stringify(url) + ';document.getElementById("queue-form").requestSubmit()');
      await until(() => queuedUrls().includes(url), 'Queue form did not add ' + url);
    }
    async function removeQueued(url) {
      const index = queuedUrls().indexOf(url);
      assert.ok(index >= 0, 'The requested queued track must exist before removal');
      await js(host, '(()=>{const item=document.querySelectorAll("#queue-list .queue-item")[' + index + '];const remove=item&&[...item.querySelectorAll("button")].find(button=>button.textContent==="Убрать");if(!remove)throw new Error("Queued item remove action missing");remove.click()})()');
      await until(() => !queuedUrls().includes(url), 'Queue remove did not apply for ' + url);
    }
    async function sharedTrack(url, label) {
      await until(async () => store.room(room.id).playback.url === url && store.room(room.id).playback.playing
        && (await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer?.url()===' + JSON.stringify(url) + '&&window.__fakePlayer.playing()')))).every(Boolean), label);
    }
    async function seekEnd() {
      await js(host, 'document.getElementById("host-seek").value="200";document.getElementById("host-seek").dispatchEvent(new Event("change"))');
    }
    await until(()=>js(host,'document.getElementById("settings-public").checked'),'New room was not open by default');
    assert.equal(await js(host,'document.getElementById("settings-public").getAttribute("role")'),'switch');
    await js(host,'document.getElementById("settings-chat").click()');
    await until(()=>store.room(room.id).settings.chat===false,'Chat switch did not save immediately');
    await until(()=>js(one,'document.getElementById("chat-input").disabled'),'Chat switch was not applied to listeners');
    await js(host,'document.getElementById("settings-chat").click()');
    await until(()=>store.room(room.id).settings.chat===true,'Chat switch did not restore immediately');
    await js(host,'document.getElementById("settings-public").click()');await until(()=>!store.room(room.id).settings.public,'Open-room switch did not hide the room');
    await until(()=>js(host,'!document.getElementById("settings-public").disabled'),'Open-room switch remained locked after saving');
    await js(host,'document.getElementById("settings-public").click()');await until(()=>store.room(room.id).settings.public,'Open-room switch did not restore the directory entry');
    assert.equal(await js(one, 'document.getElementById("claim-host").hidden&&document.getElementById("room-settings").hidden'), true, 'Listeners must not see owner/DJ controls');
    const forbiddenClaim = await fetch(origin + '/api/rooms/' + room.id + '/control', { method: 'POST', headers: { Authorization: 'Bearer ' + guest.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'claim', connection: 'guest-forbidden-control' }) });
    assert.equal(forbiddenClaim.status, 403, 'A listener must not acquire the host lease');
    scenarios.push('Listener controls remain unavailable and server rejects a listener host claim');
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
    async function recoverDrift(label, milliseconds) {
      const at = Date.now(); await js(one, 'window.__fakePlayer.drift(' + milliseconds + ')');
      await until(async () => { const values = await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.position()'))); return Math.max(...values) - Math.min(...values) < .45; }, label + ' did not correct within five seconds', 5000);
      measurements.push({ label, recoveryMs: Date.now() - at });
      await positions(label + ' settled');
    }
    await positions('playing');
    await recoverDrift('playing drift +9s', 9000);
    await delay(2600); // Let the audible-seek cooldown expire before testing the periodic path.
    await recoverDrift('periodic moderate drift +0.7s', 700);
    const otherVolumes = await Promise.all([host, two].map(window => js(window, 'window.__fixtureVolume')));
    await js(one, 'document.getElementById("volume").value="31";document.getElementById("volume").dispatchEvent(new Event("input"))');
    await until(() => js(one, 'window.__fixtureVolume===31'), 'Listener local volume did not reach the source player');
    assert.deepEqual(await Promise.all([host, two].map(window => js(window, 'window.__fixtureVolume'))), otherVolumes, 'A listener volume change must stay local');
    assert.equal(store.room(room.id).playback.playing, true);
    await js(one, 'document.getElementById("join").click()');
    await until(() => js(one, '!window.__fakePlayer.playing()'), 'Listener local mute did not pause its player');
    assert.equal(store.room(room.id).playback.playing, true, 'Local mute must not pause the shared room');
    assert.equal(await js(two, 'window.__fakePlayer.playing()'), true);
    await js(one, 'document.getElementById("join").click()');
    await until(() => js(one, 'window.__fakePlayer.playing()'), 'Listener local mute did not resume');
    await delay(400); await positions('listener local resume');
    scenarios.push('Local volume and local mute preserve shared playback and other listeners');

    const draft = 'Черновик сообщения во время обновления комнаты';
    await js(two, 'document.getElementById("chat-input").value=' + JSON.stringify(draft) + ';document.getElementById("chat-input").focus()');
    const chatText = 'Привет из комнаты: музыка играет у всех';
    await js(one, 'document.getElementById("chat-input").value=' + JSON.stringify(chatText) + ';document.getElementById("chat-form").requestSubmit()');
    await until(async () => store.room(room.id).chat.some(message => message.text === chatText)
      && (await Promise.all([host, one, two].map(window => js(window, 'document.getElementById("chat-messages").textContent.includes(' + JSON.stringify(chatText) + ')')))).every(Boolean), 'Chat message did not reach all three authenticated clients');
    assert.equal(await js(one, 'document.getElementById("chat-input").value'), '', 'Sending chat must clear only the submitted input');
    assert.equal(await js(two, 'document.getElementById("chat-input").value===' + JSON.stringify(draft) + '&&document.activeElement===document.getElementById("chat-input")'), true, 'SSE room updates must preserve an unfinished chat message and its focus');
    assert.equal(await js(two, 'document.documentElement.scrollWidth<=window.innerWidth+1'), true, 'Mobile room layout must not require horizontal scrolling');
    scenarios.push('Chat delivers to host and guests, preserves another guest draft/focus, mobile layout fits 420px');

    await js(host, 'document.getElementById("host-play").click()'); await until(async () => (await Promise.all([host, one, two].map(window => js(window, '!window.__fakeWidget.playing()')))).every(Boolean), 'Shared pause was not applied'); await positions('paused');
    await recoverDrift('paused drift +7s', 7000);
    assert.equal((await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.playing()')))).some(Boolean), false, 'Correcting paused drift must not resume playback');
    await js(host, 'document.getElementById("host-seek").value="37";document.getElementById("host-seek").dispatchEvent(new Event("change"))');
    await until(async () => (await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.position()')))).every(value => Math.abs(value - 37) < .4), 'Shared paused seek did not settle within five seconds', 5000);
    const paused = await positions('seek'); assert.ok(paused.every(value => Math.abs(value - 37) < .4));
    await js(host, 'document.getElementById("host-play").click()'); await delay(2000); await positions('resume');
    const scQueue = ['https://soundcloud.com/fixture/auto-first', 'https://soundcloud.com/fixture/auto-second', 'https://soundcloud.com/fixture/auto-reserve'];
    for (const url of scQueue) await addQueued(url);
    await seekEnd(); await sharedTrack(scQueue[0], 'Seeking to the end did not start the first approved room-queue track');
    await delay(700);
    assert.deepEqual(queuedUrls(), scQueue.slice(1), 'Seek-to-end must consume exactly one room-queue entry');
    assert.equal(store.room(room.id).playback.url, scQueue[0]);
    await js(host, 'window.__fakePlayer.finish();window.__fakePlayer.finish()');
    await sharedTrack(scQueue[1], 'SoundCloud FINISH did not advance to the next approved room track');
    await delay(700);
    assert.equal(store.room(room.id).playback.url, scQueue[1], 'Duplicate FINISH must not skip the next SoundCloud track');
    assert.deepEqual(queuedUrls(), scQueue.slice(2), 'Duplicate SoundCloud FINISH must consume exactly one queue entry');
    scenarios.push('SoundCloud seek-to-end uses the room queue and duplicate FINISH advances exactly once');
    await js(host, 'document.getElementById("settings-auto").click()');
    await until(() => !store.room(room.id).settings.autoNext, 'Auto-next switch did not disable room advancement');
    await seekEnd();
    await until(() => !store.room(room.id).playback.playing && store.room(room.id).playback.position >= 199, 'Seeking to the end with auto-next off must stop on the current track');
    await js(host, 'window.__fakePlayer.finish();window.__fakePlayer.finish()'); await delay(500);
    assert.equal(store.room(room.id).playback.url, scQueue[1]);
    assert.deepEqual(queuedUrls(), scQueue.slice(2), 'Auto-next off must preserve queued tracks');
    assert.equal((await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.playing()')))).some(Boolean), false, 'Auto-next off must leave all room players paused at the end');
    await removeQueued(scQueue[2]);
    scenarios.push('Auto-next off leaves the ended source paused and preserves the room queue');
    await js(two,'window.__blockYoutube=true');
    const youtubeUrl='https://music.youtube.com/watch?v=fixtureYT01';
    await delay(850);
    await js(host,'window.__fakePlayer.nativeSeek(140);document.getElementById("host-track").value='+JSON.stringify(youtubeUrl)+';document.getElementById("host-track-form").requestSubmit()');
    await until(()=>js(host,'window.__fakePlayer?.url()==='+JSON.stringify(youtubeUrl)+'&&window.__fakePlayer.playing()'), 'Browser host did not start YouTube');
    assert.deepEqual(errors, [], 'Late outgoing SoundCloud callbacks must not read a removed or replacement player');
    scenarios.push('Late outgoing SoundCloud sampling is ignored during asynchronous YouTube SDK replacement');
    await until(()=>js(two,'document.getElementById("connection-status").textContent.includes("Нажми Play")'), 'Blocked YouTube autoplay was incorrectly shown as synchronized');
    await js(two,'window.__blockYoutube=false;document.getElementById("resync").click()');await delay(2000);
    await positions('YouTube playing');
    const beforeRateChange = { url: store.room(room.id).playback.url, queue: queuedUrls() };
    await js(one, 'window.__fakePlayer.setRate(2)');
    await until(() => js(one, 'window.__fakePlayer.rate()===1'), 'YouTube must return an externally selected rate to shared 1x');
    assert.equal(store.room(room.id).playback.rate, 1);
    assert.equal(store.room(room.id).playback.url, beforeRateChange.url, 'Correcting playback rate must not change the shared track');
    assert.deepEqual(queuedUrls(), beforeRateChange.queue, 'Correcting playback rate must not advance the queue');
    scenarios.push('YouTube restores an externally changed playback rate to 1x without advancing the queue');
    await js(host, 'document.getElementById("settings-auto").click()');
    await until(() => store.room(room.id).settings.autoNext, 'Auto-next switch did not restore room advancement');
    assert.equal(await js(host,'document.querySelector("#player").getBoundingClientRect().height>=200'),true);
    await js(host,'document.getElementById("host-play").click()');
    await until(async()=>(await Promise.all([host,one,two].map(window=>js(window,'!window.__fakePlayer.playing()')))).every(Boolean),'YouTube shared pause failed');
    await js(host,'document.getElementById("host-seek").value="48";document.getElementById("host-seek").dispatchEvent(new Event("change"))');
    await until(async () => (await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.position()')))).every(value => Math.abs(value - 48) < .4), 'Shared YouTube seek did not settle within five seconds', 5000);
    await positions('YouTube seek');
    const ytQueue = ['https://music.youtube.com/watch?v=fixtureYT02', 'https://music.youtube.com/watch?v=fixtureYT03', 'https://music.youtube.com/watch?v=fixtureYT04'];
    for (const url of ytQueue) await addQueued(url);
    await js(host, 'document.getElementById("host-play").click()');
    await until(() => store.room(room.id).playback.playing, 'YouTube did not resume before end-of-track test');
    await seekEnd(); await sharedTrack(ytQueue[0], 'YouTube seek-to-end did not start the first approved room-queue track');
    await delay(600); assert.deepEqual(queuedUrls(), ytQueue.slice(1), 'YouTube seek-to-end must consume one room-queue entry');
    await js(host, 'window.__fakePlayer.finish();window.__fakePlayer.finish()');
    await sharedTrack(ytQueue[1], 'YouTube ended event did not start the next approved room track');
    await delay(700); assert.equal(store.room(room.id).playback.url, ytQueue[1], 'Duplicate YouTube ended event must not skip a track');
    assert.deepEqual(queuedUrls(), ytQueue.slice(2), 'Duplicate YouTube ended event must consume one room-queue entry');
    await removeQueued(ytQueue[2]);
    scenarios.push('YouTube seek-to-end and duplicate ended events each consume one approved room-queue entry');
    await js(host,'document.getElementById("host-track").value="https://soundcloud.com/fixture/after-youtube";document.getElementById("host-track-form").requestSubmit()');
    await sharedTrack('https://soundcloud.com/fixture/after-youtube', 'Switching from YouTube to SoundCloud did not replace all room players');
    try {
      await until(async () => { const values = await Promise.all([host, one, two].map(window => js(window, 'window.__fakePlayer.position()'))); return Math.max(...values) - Math.min(...values) < .45; }, 'Switching from YouTube to SoundCloud did not synchronize within five seconds', 5000);
    } catch (error) {
      const clients = await Promise.all([host, one, two].map(window => js(window, '({url:window.__fakePlayer.url(),position:window.__fakePlayer.position(),playing:window.__fakePlayer.playing(),badge:document.getElementById("connection-status").textContent,status:document.getElementById("status").textContent})')));
      throw new Error(error.message + ': ' + JSON.stringify({ playback: store.viewRoom(store.room(room.id), owner.user).playback, clients }));
    }
    await positions('SoundCloud after YouTube');
    fs.writeFileSync(path.join(output, 'rooms-owner-test.png'), (await host.webContents.capturePage()).toPNG()); fs.writeFileSync(path.join(output, 'rooms-mobile-test.png'), (await two.webContents.capturePage()).toPNG());
    two.setSize(360, 900); await delay(250);
    assert.equal(await js(two, 'document.documentElement.scrollWidth<=window.innerWidth+1'), true, 'The room layout must fit a narrow 360px phone viewport');
    fs.writeFileSync(path.join(output, 'rooms-mobile-360-test.png'), (await two.webContents.capturePage()).toPNG());
    two.setSize(420, 900); await delay(150);
    scenarios.push('Room layouts fit both 420px and 360px mobile viewports');
    await js(one, 'document.getElementById("queue-url").value="https://soundcloud.com/fixture/request";document.getElementById("queue-form").requestSubmit()'); await until(() => js(host, 'document.getElementById("queue-list").textContent.includes("request")'), 'Queue request did not reach the host');
    await js(two, 'document.querySelector("#queue-list .queue-item button").click()');
    await until(() => store.room(room.id).queue[0].votes.size === 1, 'Listener vote did not reach the room queue');
    assert.equal(await js(one, '[...document.querySelectorAll("#queue-list button")].some(button=>button.textContent==="Одобрить")'), false, 'A listener must not receive queue approval controls');
    await js(host, '[...document.querySelectorAll("#queue-list button")].find(button=>button.textContent==="Одобрить").click()');
    await until(() => store.room(room.id).queue[0].approved, 'Host queue approval did not persist');
    await until(() => js(one, 'document.getElementById("queue-list").textContent.includes("В очереди")'), 'Host approval did not reach the proposing listener');
    scenarios.push('Guest queue suggestions accept votes and host approval through the UI');
    const forbiddenNext = await fetch(origin + '/api/rooms/' + room.id + '/queue', { method: 'POST', headers: { Authorization: 'Bearer ' + guest.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'next' }) }); assert.equal(forbiddenNext.status, 403, 'A listener must not skip the shared queue');
    const djButton = label => '(()=>{const person=[...document.querySelectorAll("#participants .person")].find(row=>row.textContent.includes("Fixture guest"));const button=person&&[...person.querySelectorAll("button")].find(item=>item.textContent===' + JSON.stringify(label) + ');if(!button)throw new Error("DJ role action missing");button.click()})()';
    await js(host, djButton('Дать DJ'));
    await until(() => store.room(room.id).roles.get(guest.user.id) === 'dj', 'Owner UI did not assign DJ');
    await until(() => js(one, '!document.getElementById("claim-host").hidden'), 'Assigned DJ did not receive the take-control action');
    await js(host, 'document.getElementById("release-host").click()'); await delay(500); await js(one, 'document.getElementById("claim-host").click()'); await until(() => js(one, '!document.getElementById("host-controls").hidden'), 'DJ could not take over'); await until(() => js(host, 'document.getElementById("host-controls").hidden'), 'Previous host retained control');
    await js(host, djButton('Снять DJ'));
    await until(() => store.room(room.id).roles.get(guest.user.id) === 'listener', 'Owner UI did not revoke DJ');
    await until(() => js(one, 'document.getElementById("host-controls").hidden&&document.getElementById("claim-host").hidden'), 'Revoked DJ retained shared playback controls');
    await js(host, djButton('Дать DJ'));
    await until(() => js(one, '!document.getElementById("claim-host").hidden'), 'Reassigned DJ did not regain the control action');
    await js(one, 'document.getElementById("claim-host").click()');
    await until(() => js(one, '!document.getElementById("host-controls").hidden'), 'Reassigned DJ could not resume hosting');
    scenarios.push('Owner UI assigns and revokes DJ; listeners cannot claim a lease or advance the queue');
    const started = Date.now(); desktop = new ListeningRoom(() => ({ fresh: true, private: false, playback: { title: 'Desktop-controlled song', artist: 'Fixture', url: 'https://soundcloud.com/fixture/synchronized', duration: 200, position: 60 + (Date.now() - started) / 1000, playing: true, rate: 1 }, sampledAt: Date.now() }), { origin }); desktop.token = owner.secret; desktop.expires = owner.expires; desktop.user = owner.user; desktop.room = store.viewRoom(store.room(room.id), owner.user); await desktop.claim(); await desktop.publish(); desktopTimer = setInterval(() => { void desktop.publish().catch(error => errors.push(error.message)); }, 1000);
    await until(() => js(one, 'document.getElementById("host-controls").hidden'), 'Desktop takeover did not revoke browser DJ'); await delay(3000); const values = await positions('desktop takeover'); assert.ok(values.every(value => value > 60));
    // Chromium separates request failures from navigator state. Block only this isolated test origin
    // and break the guest's real SSE stream; this also works for loopback requests.
    // https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Network.pdl
    one.webContents.debugger.attach('1.3');
    await one.webContents.debugger.sendCommand('Network.enable');
    await one.webContents.debugger.sendCommand('Network.setBlockedURLs', { urls: [origin + '/*'] });
    await one.webContents.debugger.sendCommand('Network.overrideNetworkState', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const lostStream = streams.get('Bearer ' + guest.secret);
    assert.ok(lostStream && !lostStream.destroyed, 'A real guest SSE stream must exist before interruption');
    lostStream.destroy();
    assert.equal(await js(one, 'navigator.onLine'), false, 'Offline emulation must reach the browser online state');
    assert.equal(await js(one, 'fetch("/api/clock?offline="+Date.now(),{cache:"no-store"}).then(()=>false,()=>true)'), true, 'Offline guest must experience a real failed HTTP request');
    await until(() => js(one, 'document.getElementById("connection-status").textContent.includes("Восстанавливаем связь")'), 'An offline guest did not receive a visible connection recovery state', 4000);
    await one.webContents.debugger.sendCommand('Network.setBlockedURLs', { urls: [] });
    await one.webContents.debugger.sendCommand('Network.overrideNetworkState', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await js(one, 'window.dispatchEvent(new Event("online"))');
    await until(() => js(one, 'document.getElementById("connection-status").dataset.state==="ready"&&window.__fakePlayer.playing()'), 'Reconnected guest did not return to ready playback');
    await until(() => streams.has('Bearer ' + guest.secret) && streams.get('Bearer ' + guest.secret) !== lostStream, 'Guest did not reopen its real SSE stream after connection recovery');
    await delay(1500); await positions('reconnect');
    one.webContents.debugger.detach();
    scenarios.push('Real SSE recovery and browser/DJ/desktop handoff preserve synchronized playback');
    assert.deepEqual(errors, []); console.log('Room clients passed: three authenticated clients, real SSE, five-second drift recovery, local mute/volume, chat, room-queue seek/finish exactly once, browser/DJ/app handoff, network recovery. ' + JSON.stringify(measurements));
  } catch (error) { testFailure = error.stack || String(error); console.error(testFailure); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(output, 'rooms-ui-results.json'), JSON.stringify({ status: process.exitCode ? 'failed' : 'passed', durationMs: Date.now() - startedAt, sdk: 'Deterministic SoundCloud/YouTube SDK fixtures; real HTTP, SSE, sessions and UI', scenarios, measurements, errors, ...(testFailure ? { failure: testFailure } : {}) }, null, 2)); clearInterval(desktopTimer); if (desktop) await desktop.dispose(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } app.exit(process.exitCode || 0); }
});
