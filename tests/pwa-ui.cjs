'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { createServer } = require('../server/index.cjs'), { CloudStore } = require('../server/core.cjs');
const { soundcloud, youtube } = require('./fixtures/room-player-sdk.cjs');
const temporary = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-pwa-ui-') || !output) throw new Error('An isolated PWA profile and output are required.');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', temporary); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio'); app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 12000) { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error(label); await delay(70); } }
app.whenReady().then(async () => {
  let server, failure = '', window; const checks = [], screenshots = [], errors = [], requests = [], prepareCounts = new Map(); let failShell = false, failMusic = false, stallNativePreparation = false, legacyWorker = true;
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(error.message + '\nExpression: ' + code + '\nConsole: ' + errors.join('\n')); } };
  const reload = () => new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  const click = id => js('document.getElementById(' + JSON.stringify(id) + ').click()');
  async function capture(name) { await delay(130); const filename = path.join(output, name + '.png'); fs.writeFileSync(filename, (await window.webContents.capturePage()).toPNG()); screenshots.push(filename); }
  try {
    // Production icons were rasterized once from the project's real SVG.
    // Verification never rewrites product files while another agent packages.
    for (const size of [192, 512]) { const bytes = fs.readFileSync(path.join(__dirname, '../server/public/app/icon-' + size + '.png')); assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size); }
    const music = path.join(output, 'fixture.mp3');
    execFileSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '60', '-codec:a', 'libmp3lame', '-b:a', '64k', music], { windowsHide: true, timeout: 20000 });
    const mp3 = fs.readFileSync(music), reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const origin = 'http://127.0.0.1:' + port, store = new CloudStore({ origin }); server = createServer({ origin, store }); const owner = store.login({ id: 901, name: 'Марина · тест' }), room = store.createRoom(owner.user), handler = server.listeners('request')[0]; server.removeAllListeners('request');
    const track = (id, title = 'Тихий город') => ({ id, title, artist: 'Ночной эфир', duration: 60, audioUrl: origin + '/music/audio/' + id + '/' + 'a'.repeat(24) + '.mp3', url: 'https://soundcloud.com/test/track-' + id, cover: '' });
    server.on('request', (req, res) => {
      const url = new URL(req.url, origin); requests.push(url.pathname + url.search);
      const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
      if (legacyWorker && url.pathname === '/app/sw.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/app/' });
        res.end(fs.readFileSync(path.join(__dirname, '../server/public/app/sw.js'), 'utf8').replace('lolzcloud-app-shell-v3', 'lolzcloud-app-shell-v1')); return;
      }
      if (url.pathname === '/app/native-test.html') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; media-src 'self' blob:; connect-src 'self' https://lrclib.net; frame-src 'self'" });
        res.end(fs.readFileSync(path.join(__dirname, '../server/public/app/index.html'), 'utf8').replace('<script src="/app/core.js"', '<script src="/app/native-fixture.js" defer></script><script src="/app/core.js"')); return;
      }
      if (url.pathname === '/app/native-fixture.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(`window.__nativeCalls=[];window.__nativeTrack=null;window.__nativeQueue=null;window.__nativeDownloads=[];window.__nativeTag=null;
const nativeEmit=(name,value)=>window.dispatchEvent(new CustomEvent('lolzcloud:'+name,{detail:{...(['selection','playback'].includes(name)?window.__nativeTag:{}),...value}}));
const nativeSelection=()=>{const selected=window.__nativeTrack?.queueIndex;const i=Number.isInteger(selected)&&window.__nativeQueue?.tracks[selected]?.id===window.__nativeTrack?.id?selected:window.__nativeQueue?.tracks.findIndex(row=>row.id===window.__nativeTrack?.id)??-1;if(i>=0)nativeEmit('selection',{index:i,track:window.__nativeQueue.tracks[i],queue:true});};
window.webkit={messageHandlers:{lolzcloud:{postMessage(message){window.__nativeCalls.push(message);
window.__nativeTag={clientId:message.clientId,requestId:message.requestId};
if(message.action==='queue'){window.__nativeQueue=message;nativeSelection();}
if(message.action==='play'){window.__nativeTrack=message;nativeSelection();nativeEmit('playback',{id:message.id,state:'playing',time:message.position||0,duration:message.duration,queue:true});}
if(message.action==='stop'){window.__nativeTrack=null;nativeEmit('playback',{id:'',state:'paused',time:0,duration:0});}
if(['pause','resume','seek'].includes(message.action)&&window.__nativeTrack)nativeEmit('playback',{id:window.__nativeTrack.id,state:message.action==='pause'?'paused':'playing',time:message.position||0,duration:window.__nativeTrack.duration,queue:true});
if(message.action==='downloads')nativeEmit('download',{state:'list',tracks:__nativeDownloads});
if(message.action==='download'){__nativeDownloads=[...__nativeDownloads.filter(row=>row.id!==message.track.id),message.track];nativeEmit('download',{id:message.track.id,state:'ready',tracks:__nativeDownloads});}
if(message.action==='removeDownload'){__nativeDownloads=__nativeDownloads.filter(row=>row.id!==message.id);nativeEmit('download',{state:'list',tracks:__nativeDownloads});}
if(message.action==='importAudio'){nativeEmit('download',{state:'loading',import:true,importing:true});const local={id:'local:12345678-1234-4567-89ab-123456789abc',local:true,source:'local',title:'Native local fixture',artist:'',audioUrl:'',duration:8,cover:''};__nativeDownloads.push(local);nativeEmit('download',{state:'ready',import:true,importing:true,id:local.id,tracks:__nativeDownloads});nativeEmit('download',{state:'list',import:true,importing:false,tracks:__nativeDownloads});}}}}};`); return;
      }
      if (failShell && url.pathname.startsWith('/app/')) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('fixture server unavailable'); return; }
      if (url.pathname === '/music/search') {
        if (failMusic) return json({ error: 'Каталог временно недоступен. Повтори поиск.' }, 503);
        const query = url.searchParams.get('q'), offset = url.searchParams.get('offset');
        const respond = () => json({ tracks: query === 'старый' ? [track('119', 'Устаревший результат')] : offset === '20' ? [track('123'), track('125', 'Третий трек')] : [track('123'), track('124', 'Первые лучи')], nextOffset: offset === '20' ? null : '20' });
        if (query === 'старый') { setTimeout(respond, 400); return; } respond(); return;
      }
      const prep = url.pathname.match(/^\/music\/prepare\/(\d+)\/[a-f0-9]{24}$/);
      if (prep) { const count = (prepareCounts.get(prep[1]) || 0) + 1; prepareCounts.set(prep[1], count); return count === 1 || prep[1] === stallNativePreparation ? json({ state: 'preparing', retryAfterMs: 50 }, 202) : json({ state: 'ready', audioUrl: track(prep[1]).audioUrl }); }
      if (/^\/music\/audio\/\d+\/[a-f0-9]{24}\.mp3$/.test(url.pathname)) {
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/); const first = range ? +range[1] : 0, last = range?.[2] ? Math.min(mp3.length - 1, +range[2]) : mp3.length - 1;
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': last - first + 1, ...(range ? { 'Content-Range': 'bytes ' + first + '-' + last + '/' + mp3.length } : {}) }); res.end(mp3.subarray(first, last + 1)); return;
      }
      handler(req, res);
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const ses = session.fromPartition('pwa-ui-isolated');
    ses.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + owner.secret } }));
    await ses.protocol.handle('https', request => {
      if (request.url.startsWith('https://lrclib.net/')) return new Response(JSON.stringify({ trackName: 'Тихий город', artistName: 'Ночной эфир', duration: 60, plainLyrics: 'Тихий город\nПервые лучи', syncedLyrics: '[00:00.00]Тихий город\n[00:10.00]Первые лучи' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      return new Response(request.url.includes('/iframe_api') ? youtube : request.url.includes('/player/api.js') ? soundcloud : '<!doctype html><title>SDK test fixture</title>', { headers: { 'Content-Type': /\/(?:player\/api.js|iframe_api)/.test(request.url) ? 'text/javascript' : 'text/html' } });
    });
    window = new BrowserWindow({ show: false, width: 390, height: 844, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    window.webContents.on('console-message', (_event, ...args) => { const message = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(message || '')) errors.push(message); });
    await window.loadURL(origin + '/app/'); await until(() => js('!!window.LolzCloudApp'), 'PWA boot failed');
    check(await js('document.querySelector("link[rel=manifest]").href.endsWith("/app/manifest.webmanifest")&&!!document.querySelector("link[rel=apple-touch-icon]")'), 'Installable manifest and Apple touch icon are present');
    check(await js('document.documentElement.scrollWidth<=innerWidth'), 'Search has no horizontal overflow at 390px');
    await js('document.getElementById("search-query").value="старый";document.getElementById("search-form").requestSubmit()'); await delay(50);
    await js('document.getElementById("search-query").value="город";document.getElementById("search-form").requestSubmit()');
    await until(() => js('document.querySelectorAll("#search-results .track-row").length===2'), 'Search did not return actual HTTP results'); await delay(500);
    check(await js('!document.getElementById("search-results").textContent.includes("Устаревший")'), 'A late cancelled search cannot replace a newer query');
    check(requests.some(value => value.startsWith('/music/search?q=')), 'Search uses the public native catalogue endpoint without browser navigation');
    await capture('pwa-search-iphone'); await click('search-more'); await until(() => js('document.querySelectorAll("#search-results .track-row").length===3'), 'Next page missing');
    check(await js('[...document.querySelectorAll("#search-results .track-row")].filter(row=>row.dataset.trackId==="123").length===1&&document.getElementById("search-more").hidden'), 'Pagination deduplicates results and stops at the final cursor');
    await js('document.querySelectorAll("#search-results .track-play")[0].click()'); await delay(50); await js('document.querySelectorAll("#search-results .track-play")[1].click()');
    await until(() => js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"'), 'Track replacement did not play'); await delay(800);
    check(await js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"'), 'A cancelled cold preparation cannot start an old track over a newer selection');
    await js('document.querySelectorAll("#search-results .track-play")[2].click()'); await delay(70); await click('mini-play'); await delay(800);
    check(await js('LolzCloudApp.snapshot().current==="125"&&LolzCloudApp.snapshot().phase==="paused"'), 'Pausing during preparation cancels the pending start and keeps the app paused');
    await js('document.querySelector("#search-results .track-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"&&document.getElementById("audio").currentTime>0'), 'Real MP3 did not play after preparation');
    check((prepareCounts.get('123') || 0) >= 2, 'Cold audio preparation is polled before real HTMLAudio playback');
    check(await js('LolzCloudApp.snapshot().queue.join(",")==="123,124,125"'), 'Playing a result creates a real ordered queue');
    await click('mini-open'); await click('player-like');
    check(await js('document.getElementById("player-like").getAttribute("aria-pressed")==="true"&&LolzCloudApp.snapshot().liked.includes("123")'), 'Favourite action updates persisted state and its accessible selected state');
    await js('document.getElementById("player-seek").value=12;document.getElementById("player-seek").dispatchEvent(new Event("change"))'); await until(() => js('document.getElementById("audio").currentTime>=11.8'), 'Seek failed');
    check(true, 'Seek changes the real audio element position');
    await click('player-play'); await js('document.getElementById("player-options").open=true;document.getElementById("rate-presets").children[0].click()');
    check(await js('document.getElementById("audio").paused&&document.getElementById("audio").playbackRate===0.85&&LolzCloudApp.snapshot().phase==="paused"'), 'Changing a speed preset on pause changes the real rate without starting playback');
    await js('document.getElementById("player-rate").value=1.5;document.getElementById("player-rate").dispatchEvent(new Event("input"))');
    check(await js('document.getElementById("audio").paused&&document.getElementById("audio").playbackRate===1.5'), 'The full 0.5–2 speed slider preserves pause');
    await click('bookmark-add'); await js('document.getElementById("player-seek").value=25;document.getElementById("player-seek").dispatchEvent(new Event("change"));document.querySelector(".bookmark-jump").click()');
    check(await js('document.getElementById("audio").paused&&Math.abs(document.getElementById("audio").currentTime-12)<0.5&&LolzCloudApp.snapshot().bookmarks.length===1'), 'A saved moment seeks the real audio and preserves a paused player');
    await js('document.getElementById("sleep-select").value="15";document.getElementById("sleep-select").dispatchEvent(new Event("change"));document.getElementById("player-options").scrollIntoView({behavior:"instant",block:"start"})'); await capture('pwa-player-comfort');
    window.setContentSize(360, 800); await delay(80); check(await js('document.getElementById("player-dialog").scrollWidth<=document.getElementById("player-dialog").clientWidth&&document.getElementById("sleep-select").getBoundingClientRect().right<=innerWidth&&document.querySelector(".bookmark-jump").getBoundingClientRect().height>=44'), 'Speed, sleep and bookmark controls fit 360px with usable touch targets'); await capture('pwa-player-comfort-360'); window.setContentSize(390, 844);
    await js('document.getElementById("sleep-select").value="0";document.getElementById("sleep-select").dispatchEvent(new Event("change"))');
    await js('document.getElementById("player-rate").value=1;document.getElementById("player-rate").dispatchEvent(new Event("input"));document.getElementById("player-options").open=false'); await click('player-play');
    await click('player-next'); await until(() => js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"'), 'Next failed');
    check(await js('LolzCloudApp.snapshot().bookmarks.length===0'), 'Saved moments are scoped to their own track');
    await click('player-previous'); await until(() => js('LolzCloudApp.snapshot().current==="123"&&LolzCloudApp.snapshot().phase==="playing"'), 'Previous failed');
    check(true, 'Next and previous change the actual playing queue item');
    await js('document.getElementById("sleep-select").value="15";document.getElementById("sleep-select").dispatchEvent(new Event("change"));window.__actualNow=Date.now;Date.now=()=>__actualNow()+16*60000;document.dispatchEvent(new Event("visibilitychange"));Date.now=__actualNow;true');
    check(await js('document.getElementById("audio").paused&&LolzCloudApp.snapshot().phase==="paused"&&LolzCloudApp.snapshot().sleepDeadline===0'), 'Sleep uses the wall-clock deadline and pauses on return after a suspended interval'); await click('player-play');
    await click('player-repeat'); await click('player-repeat'); await js('document.getElementById("audio").currentTime=59.9');
    await until(() => js('LolzCloudApp.snapshot().current==="123"&&LolzCloudApp.snapshot().phase==="playing"&&document.getElementById("audio").currentTime<2'), 'Automatic repeat one failed');
    check(true, 'Repeat-one restarts the actual audio when its ended event fires');
    await click('player-next'); await until(() => js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"'), 'Manual next incorrectly repeated current');
    check(true, 'Manual next moves forward even when repeat-one is enabled');
    await click('player-previous'); await until(() => js('LolzCloudApp.snapshot().current==="123"&&LolzCloudApp.snapshot().phase==="playing"'), 'Return after repeat check failed');
    await click('tab-lyrics'); await until(() => js('document.querySelectorAll("#lyrics-text .lyric-line").length===2'), 'Lyrics not rendered');
    await js('document.querySelectorAll("#lyrics-text .lyric-line")[1].click()'); await until(() => js('document.getElementById("audio").currentTime>=9.8'), 'Lyric seek failed');
    check(true, 'LRCLIB timestamps render as inert text and seek actual audio');
    await capture('pwa-player-iphone'); await click('player-download'); await until(() => js('LolzCloudApp.snapshot().offline.includes("123")'), 'Full MP3 download was not committed', 20000);
    check(await js('LolzCloudOffline.get("123").then(row=>row.blob instanceof Blob&&row.bytes>128)'), 'Explicit offline save commits a verified real MP3 blob in IndexedDB');
    await js('document.getElementById("player-dialog").close();document.querySelector("[data-view=library]").click()'); await capture('pwa-library-iphone');
    await js('document.querySelector("[data-view=rooms]").click()'); await until(() => js('document.getElementById("rooms-frame").contentDocument?.getElementById("my-rooms")&&document.getElementById("rooms-frame").contentWindow.LolzCloudSession?.authenticated'), 'Shared rooms did not authenticate');
    await js('LolzCloudApp.openRoom(' + JSON.stringify(origin + '/room/' + room.id + '/') + ')'); await until(() => js('!!document.getElementById("rooms-frame").contentDocument?.getElementById("join")'), 'Room frame not loaded');
    await js('window.__roomFrame=document.getElementById("rooms-frame").contentWindow;window.__roomPauses=0;__roomFrame.addEventListener("message",e=>{if(e.data?.type==="lolzcloud:app-audio")parent.__roomPauses++})');
    await js('document.querySelector("[data-view=search]").click()'); await click('mini-play'); await delay(50); if (await js('LolzCloudApp.snapshot().phase!=="playing"')) await click('mini-play');
    await until(() => js('LolzCloudApp.snapshot().phase==="playing"'), 'Local playback resume failed');
    await js('window.dispatchEvent(new MessageEvent("message",{origin:location.origin,source:window,data:{type:"lolzcloud:room-audio",playing:true}}));window.dispatchEvent(new MessageEvent("message",{origin:"https://evil.test",source:__roomFrame,data:{type:"lolzcloud:room-audio",playing:true}}))');
    check(await js('LolzCloudApp.snapshot().phase==="playing"'), 'Forged room messages with wrong origin or source cannot pause local audio');
    await js('__roomFrame.parent.postMessage({type:"lolzcloud:room-audio",playing:true},location.origin)');
    // The preceding postMessage executes in the parent, so it must be ignored.
    await delay(60); check(await js('LolzCloudApp.snapshot().phase==="playing"'), 'A same-origin parent source is also ignored');
    const liveRoomFrame = window.webContents.mainFrame.frames.find(frame => frame.url.includes('/room/' + room.id + '/'));
    assert.ok(liveRoomFrame, 'Actual room frame missing');
    await liveRoomFrame.executeJavaScript('parent.postMessage({type:"lolzcloud:room-audio",playing:true},location.origin)'); await until(() => js('LolzCloudApp.snapshot().phase==="paused"'), 'Valid room message did not pause local audio');
    check(true, 'A trusted room-frame playback message pauses the local audio');
    await js('__roomPauses=0');
    await click('mini-play'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"&&__roomPauses>0'), 'App did not pause room');
    check(await js('__roomPauses===1'), 'One explicit local playback sends one pause only to the persistent room frame');
    await js('document.querySelector("[data-view=rooms]").click();__roomFrame.document.getElementById("track-title").textContent="Тихий город";__roomFrame.document.getElementById("track-artist").textContent="Ночной эфир"');
    await click('room-lyrics'); await until(() => js('document.getElementById("room-lyrics-text").textContent.includes("Первые лучи")'), 'Room lyrics failed');
    check(await js('document.getElementById("rooms-frame").contentWindow===__roomFrame'), 'Opening room lyrics keeps the exact same live room frame');
    await js('document.getElementById("room-lyrics-dialog").close();document.querySelector("[data-view=profile]").click()'); await until(() => js('!!document.getElementById("social-frame").contentWindow.LolzCloudSocial'), 'Shared social did not mount');
    check(await js('document.getElementById("rooms-frame").contentWindow===__roomFrame'), 'Profile and friends keep the live room mounted');
    check(await js('document.getElementById("social-frame").contentDocument.dispatchEvent(new CustomEvent("lolzcloud:social-room-open",{cancelable:true,detail:{url:__roomFrame.location.href}}))===false&&LolzCloudApp.snapshot().view==="rooms"&&document.getElementById("social-frame").contentWindow.location.pathname==="/social"&&document.getElementById("rooms-frame").contentWindow===__roomFrame'), 'A social invitation opens in the existing room frame and never starts a second room inside the profile');
    await js('document.querySelector("[data-view=search]").click()'); window.setContentSize(360, 800); await delay(100);
    check(await js('document.documentElement.scrollWidth<=innerWidth'), 'Search and bottom navigation fit an actual 360px viewport'); await capture('pwa-search-360');
    window.setContentSize(1024, 768); await click('mini-open'); await delay(120);
    check(await js('document.documentElement.scrollWidth<=innerWidth&&document.getElementById("player-dialog").scrollWidth<=document.getElementById("player-dialog").clientWidth'), 'iPad layout has no horizontal overflow in the two-column player'); await capture('pwa-player-ipad');
    await js('document.getElementById("player-dialog").close()');
    await until(() => js('navigator.serviceWorker.ready.then(()=>!!navigator.serviceWorker.controller)'), 'Service worker did not control the app'); await delay(200);
    await until(() => js('caches.keys().then(keys=>keys.includes("lolzcloud-app-shell-v1"))'), 'Legacy shell cache did not install');
    legacyWorker = false; await js('navigator.serviceWorker.getRegistration("/app/").then(registration=>registration.update())');
    await until(() => js('caches.keys().then(keys=>keys.includes("lolzcloud-app-shell-v3")&&!keys.includes("lolzcloud-app-shell-v1"))'), 'New worker did not activate and retire its old shell');
    check(true, 'An actual worker update from the v1 cache fixture activates v3 and removes the obsolete shell cache');
    await js('document.getElementById("sleep-select").value="30";document.getElementById("sleep-select").dispatchEvent(new Event("change"))'); const sleepBeforeReload = await js('LolzCloudApp.snapshot().sleepDeadline'); await delay(150);
    failShell = true; await reload(); await until(() => js('!!window.LolzCloudApp'), 'Cached shell did not survive HTTP503');
    check(await js('document.title.includes("LolzCloud")&&LolzCloudApp.snapshot().liked.includes("123")'), 'HTTP503 uses the cached shell and preserves the collection'); failShell = false;
    check(await js('LolzCloudApp.snapshot().sleepDeadline') === sleepBeforeReload && await js('LolzCloudApp.snapshot().bookmarks.length===1'), 'The sleep deadline and per-track bookmarks survive an application reload');
    await js('document.getElementById("sleep-select").value="0";document.getElementById("sleep-select").dispatchEvent(new Event("change"))');
    await until(() => js('LolzCloudApp.snapshot().offline.includes("123")'), 'Offline index was not restored');
    await ses.enableNetworkEmulation({ offline: true }); await reload(); await until(() => js('!!window.LolzCloudApp&&LolzCloudApp.snapshot().offline.includes("123")'), 'Offline shell failed');
    await js('document.querySelector("[data-view=library]").click()'); await until(() => js('!!document.querySelector("#library-results .track-play")'), 'Offline library missing'); await js('document.querySelector("#library-results .track-play").click()');
    await until(() => js('LolzCloudApp.snapshot().phase==="playing"&&document.getElementById("audio").currentSrc.startsWith("blob:")'), 'Saved MP3 did not play without network');
    check(true, 'Offline reload and actual Blob audio playback work with network disabled');
    await ses.disableNetworkEmulation();
    failMusic = true; await js('document.querySelector("[data-view=search]").click();document.getElementById("search-query").value="недоступно";document.getElementById("search-form").requestSubmit()');
    await until(() => js('document.getElementById("search-status").dataset.error==="true"'), 'Catalogue error not visible'); check(await js('!document.getElementById("search-submit").disabled&&document.getElementById("search-query").value==="недоступно"'), 'A catalogue failure preserves the query and a working retry action');
    failMusic = false; await window.loadURL(origin + '/app/native-test.html'); await until(() => js('!!window.LolzCloudApp&&LolzCloudApp.snapshot().native'), 'Native adapter not detected');
    check(await js('(()=>{const first=__nativeCalls[0];return first.action==="queue"&&first.handshake===true&&first.requestId===1&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(first.clientId)&&__nativeCalls.every(call=>call.clientId===first.clientId&&Number.isSafeInteger(call.requestId)&&call.requestId>=1)})()'), 'Each native document sends a UUID queue handshake before downloads, rate or transport commands');
    await js('document.getElementById("search-query").value="native";document.getElementById("search-form").requestSubmit()'); await until(() => js('document.querySelectorAll("#search-results .track-play").length===2'), 'Native search failed');
    await js('document.querySelector("#search-results .track-play").click()'); await until(() => js('LolzCloudApp.snapshot().phase==="playing"'), 'Native play bridge failed');
    check(await js('__nativeCalls.some(call=>call.action==="play"&&call.id==="123"&&call.audioUrl.startsWith(location.origin+"/music/audio/"))&&!document.getElementById("audio").currentSrc'), 'Native mode sends the validated numeric ID and signed audio to AVPlayer without also starting HTMLAudio');
    check(await js('(()=>{const firstPlay=__nativeCalls.findIndex(call=>call.action==="play");return firstPlay>0&&__nativeCalls.slice(0,firstPlay).some(call=>call.action==="queue"&&call.tracks.map(row=>row.id).join(",")==="123,124"&&call.index===0&&call.repeat==="one")})()'), 'Native queue snapshot, index and repeat mode arrive before explicit play');
    check(await js('(()=>{const play=__nativeCalls.find(call=>call.action==="play"),same=__nativeCalls.filter(call=>call.requestId===play.requestId);return play.requestId>1&&same.some(call=>call.action==="stop")&&same.some(call=>call.action==="queue")&&same.at(-1).action==="play"})()'), 'A new explicit selection uses one newer intent for stop, queue and play');
    await js('window.__choiceA={...__nativeTag};window.__trackA=__nativeQueue.tracks[0];window.__playsBeforeB=__nativeCalls.filter(call=>call.action==="play").length');
    stallNativePreparation = '124';
    await js('window.dispatchEvent(new CustomEvent("lolzcloud:command",{detail:{action:"next"}}))');
    await until(() => (prepareCounts.get('124') || 0) > 0, 'Native B preparation did not start');
    await js('nativeEmit("selection",{...__choiceA,index:0,track:__trackA,queue:true});nativeEmit("playback",{...__choiceA,id:"123",state:"playing",time:41,duration:60,queue:true})');
    await delay(650);
    check(await js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().index===1&&LolzCloudApp.snapshot().phase==="loading"&&__nativeCalls.filter(call=>call.action==="play").length===__playsBeforeB'), 'Delayed native A selection and playback cannot cancel a newer B choice while its HTTP preparation is pending');
    stallNativePreparation = false;
    await until(() => js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"'), 'Native remote next failed');
    check(true, 'Native remote next uses the same JavaScript queue');
    await js('nativeEmit("selection",{...__choiceA,index:0,track:__trackA,queue:true});nativeEmit("playback",{...__choiceA,id:"124",state:"error",time:41,duration:60,error:"stale intent",queue:true})');
    check(await js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"&&LolzCloudApp.snapshot().elapsed===0&&__nativeCalls.filter(call=>call.action==="play").length===__playsBeforeB+1'), 'Old selection and even matching-track old playback remain rejected after the newer native play has been sent');
    await js('nativeEmit("playback",{id:"123",state:"error",time:0,duration:60,error:"stale"})');
    check(await js('LolzCloudApp.snapshot().phase==="playing"&&!document.getElementById("player-state").textContent.includes("stale")'), 'A late native error from another track cannot replace the current playback state');
    await js('window.__playingB={...__nativeTag}');
    await click('mini-open'); await click('player-play'); check(await js('__nativeCalls.at(-1).action==="pause"&&LolzCloudApp.snapshot().phase==="paused"'), 'Native pause follows the bridge contract');
    await js('window.__pausedB={...__nativeTag};nativeEmit("playback",{...__playingB,id:"124",state:"playing",time:12,duration:60,queue:true})');
    check(await js('LolzCloudApp.snapshot().phase==="paused"&&LolzCloudApp.snapshot().elapsed===0&&__pausedB.requestId>__playingB.requestId'), 'An old playing snapshot cannot undo a newer explicit pause of the same track');
    await click('player-play');
    check(await js('__nativeCalls.at(-1).action==="resume"&&LolzCloudApp.snapshot().phase==="playing"'), 'Native resume follows the bridge contract');
    await js('nativeEmit("playback",{...__pausedB,id:"124",state:"paused",time:12,duration:60,queue:true});window.dispatchEvent(new CustomEvent("lolzcloud:playback",{detail:{id:"124",state:"error",error:"untagged"}}));window.dispatchEvent(new CustomEvent("lolzcloud:selection",{detail:{index:0,track:__trackA,queue:true}}))');
    check(await js('LolzCloudApp.snapshot().phase==="playing"&&LolzCloudApp.snapshot().current==="124"&&__nativeTag.requestId>__pausedB.requestId'), 'A resumed intent ignores delayed paused snapshots and untagged playback or selection events');
    await click('player-download'); await until(() => js('LolzCloudApp.snapshot().offline.includes("124")'), 'Native download event not consumed');
    check(await js('__nativeCalls.some(call=>call.action==="download"&&call.track.id==="124")'), 'Native download/list events populate the same offline collection');
    await js('window.__playCount=__nativeCalls.filter(call=>call.action==="play").length;nativeEmit("playback",{id:"124",state:"ended",time:60,duration:60,queue:true})');
    check(await js('__nativeCalls.filter(call=>call.action==="play").length===__playCount&&LolzCloudApp.snapshot().phase==="ended"'), 'Native-owned ended never triggers a duplicate JavaScript next/play');
    await js('nativeEmit("selection",{index:0,track:{...__nativeQueue.tracks[0],id:"999"},queue:true})');
    check(await js('LolzCloudApp.snapshot().current==="124"'), 'A native selection with a mismatched track ID is ignored');
    await js('window.__nativeTrack=__nativeQueue.tracks[0];nativeSelection();nativeEmit("playback",{id:"123",state:"playing",time:7,duration:60,queue:true})');
    check(await js('LolzCloudApp.snapshot().current==="123"&&LolzCloudApp.snapshot().index===0&&LolzCloudApp.snapshot().elapsed===7&&LolzCloudApp.snapshot().phase==="playing"&&__nativeCalls.filter(call=>call.action==="play").length===__playCount'), 'Background native selection reconciles the queue and progress without replaying or rewinding audio');
    await js('nativeSelection();nativeSelection()');
    check(await js('LolzCloudApp.snapshot().phase==="playing"&&LolzCloudApp.snapshot().elapsed===7'), 'Repeated identical native selections preserve progress and avoid resetting playback');
    stallNativePreparation = '123'; await js('window.__playCount=__nativeCalls.filter(call=>call.action==="play").length;document.querySelector("#search-results .track-play").click()'); await delay(80);
    await js('window.__nativeTrack=__nativeQueue.tracks[1];nativeSelection();nativeEmit("playback",{id:"124",state:"playing",time:3,duration:60,queue:true})'); await delay(850); stallNativePreparation = false;
    check(await js('LolzCloudApp.snapshot().current==="124"&&LolzCloudApp.snapshot().phase==="playing"&&__nativeCalls.filter(call=>call.action==="play").length===__playCount'), 'Native background next cancels an older PWA preparation before it can issue stale play');
    await click('player-play'); await js('document.getElementById("rate-presets").children[2].click()');
    check(await js('LolzCloudApp.snapshot().phase==="paused"&&__nativeCalls.at(-1).action==="rate"&&__nativeCalls.at(-1).value===1.2'), 'Native speed changes send rate only and preserve a paused player');
    await js('document.getElementById("sleep-select").value="45";document.getElementById("sleep-select").dispatchEvent(new Event("change"))');
    check(await js('__nativeCalls.at(-1).action==="sleep"&&__nativeCalls.at(-1).minutes===45&&LolzCloudApp.snapshot().sleepDeadline>Date.now()'), 'Native sleep selection sends the exact supported minutes and saves a wall-clock deadline');
    await js('nativeEmit("playback",{id:"124",state:"paused",time:3,duration:60,queue:true,rate:1.2,sleepDeadline:0})');
    check(await js('LolzCloudApp.snapshot().phase==="paused"&&LolzCloudApp.snapshot().sleepDeadline===0&&LolzCloudApp.snapshot().rate===1.2'), 'Native sleep expiry clears the web deadline and keeps the player paused');
    await js('document.getElementById("player-dialog").close();document.querySelector("[data-view=library]").click()'); await click('native-audio-import');
    check(await js('__nativeCalls.some(call=>call.action==="importAudio")&&LolzCloudApp.snapshot().offline.some(id=>id.startsWith("local:"))&&!document.getElementById("native-audio-import").disabled&&document.getElementById("audio-import-control").hidden'), 'Native document-picker action and local import result events populate the same library');
    const prepareBeforeLocal = requests.filter(url => url.startsWith('/music/prepare')).length;
    await js('[...document.querySelectorAll("#library-results .track-row")].find(row=>row.dataset.trackId.startsWith("local:")).querySelector(".track-play").click()'); await until(() => js('LolzCloudApp.snapshot().current.startsWith("local:")&&LolzCloudApp.snapshot().phase==="playing"'), 'Native local selection failed');
    check(requests.filter(url => url.startsWith('/music/prepare')).length === prepareBeforeLocal && await js('__nativeCalls.some(call=>call.action==="play"&&call.local===true&&call.audioUrl==="")'), 'Native local play and queue use local identities without network preparation');
    await click('queue-clear'); await js('for(let i=0;i<2;i++)[...document.querySelectorAll("#library-results .track-row")].find(row=>row.dataset.trackId.startsWith("local:")).querySelector(".icon-button").click();document.getElementById("mini-open").click();document.querySelectorAll("#queue-list .track-play")[0].click();window.__firstDuplicate={...__nativeTag};document.querySelectorAll("#queue-list .track-play")[2].click()');
    await until(() => js('LolzCloudApp.snapshot().index===2&&LolzCloudApp.snapshot().phase==="playing"'), 'Duplicate native queue index was lost');
    check(await js('__nativeCalls.filter(call=>call.action==="play").at(-1).queueIndex===2&&LolzCloudApp.snapshot().queue[0]===LolzCloudApp.snapshot().queue[2]'), 'Explicit native play preserves the selected duplicate queue occurrence through queueIndex');
    await js('nativeEmit("selection",{...__firstDuplicate,index:0,track:__nativeQueue.tracks[0],queue:true});nativeEmit("playback",{...__firstDuplicate,id:__nativeQueue.tracks[0].id,state:"paused",time:6,duration:8,queue:true})');
    check(await js('LolzCloudApp.snapshot().index===2&&LolzCloudApp.snapshot().phase==="playing"&&LolzCloudApp.snapshot().elapsed===0'), 'Delayed same-ID events from the first duplicate cannot replace the explicitly selected third queue occurrence');
    const previousClient = await js('__nativeTag.clientId'); await delay(150); await reload();
    await until(() => js('!!window.LolzCloudApp&&LolzCloudApp.snapshot().native'), 'Native document reload failed');
    check(await js('(()=>{const first=__nativeCalls[0];return first.action==="queue"&&first.handshake===true&&first.requestId===1&&first.clientId!=='+JSON.stringify(previousClient)+'})()'), 'A reloaded document creates a fresh client handshake instead of comparing request numbers across pages');
    await js('window.__oldClient='+JSON.stringify(previousClient)+';nativeEmit("selection",{clientId:__oldClient,requestId:500,index:0,track:__nativeQueue.tracks[0],queue:true});nativeEmit("playback",{clientId:__oldClient,requestId:500,id:__nativeQueue.tracks[0].id,state:"playing",time:6,duration:8,queue:true})');
    check(await js('LolzCloudApp.snapshot().index===2&&LolzCloudApp.snapshot().phase==="paused"'), 'High-numbered snapshots from a previous document cannot hijack the new client');
    await js('window.__nativeTrack={...__nativeQueue.tracks[1],queueIndex:1};nativeSelection();nativeEmit("playback",{id:__nativeTrack.id,state:"playing",time:2,duration:8,queue:true})');
    check(await js('LolzCloudApp.snapshot().index===1&&LolzCloudApp.snapshot().phase==="playing"&&LolzCloudApp.snapshot().elapsed===2&&!__nativeCalls.some(call=>call.action==="play")'), 'Matching-tag native background selection survives a reload and selects the exact duplicate without replay');
    check(errors.length === 0, 'No uncaught JavaScript errors in actual browser scenarios');
    console.log(JSON.stringify({ ok: true, count: checks.length, checks, screenshots }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); if (window) try { await capture('pwa-failure'); } catch {} }
  finally {
    fs.writeFileSync(path.join(output, 'pwa-ui-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, screenshots, errors, failure, fixtureNote: 'Real Chromium HTMLAudio, HTTP, IndexedDB and service worker. Music is a generated 60s MP3; LRCLIB, external room SDKs and the native message handler are deterministic adapters. This does not verify Safari hardware, actual AVPlayer or compile iOS native code.' }, null, 2));
    if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });
