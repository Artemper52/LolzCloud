'use strict';
require('../source/integrations/legacy-runtime.cjs').install();
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');
const { AudioDucker } = require('../source/integrations/audio-ducker.cjs');
const { lyricKey } = require('../source/integrations/lyrics.cjs');
const temporary = process.env.LOLZCLOUD_PLAYER_TEST_PROFILE, root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-player-ui-')) throw new Error('An isolated test profile is required.');
app.setPath('userData', temporary); app.setPath('downloads', temporary); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio');
AudioDucker.prototype.start = () => {};
const delay = value => new Promise(resolve => setTimeout(resolve, value));
async function until(predicate, label, timeout = 8000) { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error(label); await delay(70); } }
function wave() { const samples = 16000 * 100, buffer = Buffer.alloc(44 + samples * 2); buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40); for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 16000) * 1000), 44 + i * 2); return buffer; }
app.whenReady().then(async () => {
  let host, studio, timer; const errors = [];
  try {
    const fixture = { title: 'Fixture original song', artist: 'Fixture artist', url: 'https://soundcloud.com/fixture/original', duration: 100, position: 23, playing: false };
    const service = new LolzteamService({ store: { load: () => null, save() {} }, api: {} }); service.setPlayback(fixture);
    const wav = wave(), audioFile = path.join(temporary, 'Fixture artist - Offline fixture.wav'); fs.writeFileSync(audioFile, wav);
    const fixtureHtml = '<html><body style="background:#102017;color:white"><div class="playControls"><button class="playControl">Play</button><div class="playbackSoundBadge"><a class="playbackSoundBadge__titleLink" href="' + fixture.url + '">' + fixture.title + '</a><a class="playbackSoundBadge__lightLink">' + fixture.artist + '</a></div><div class="playbackTimeline__timePassed">0:23</div><div class="playbackTimeline__duration">1:40</div></div><audio src="data:audio/wav;base64,' + wav.toString('base64') + '"></audio></body></html>';
    if (session.defaultSession.protocol.handle) await session.defaultSession.protocol.handle('https', () => new Response(fixtureHtml, { headers: { 'Content-Type': 'text/html' } }));
    else session.defaultSession.protocol.interceptBufferProtocol('https', (_request, done) => done({ mimeType: 'text/html', data: Buffer.from(fixtureHtml) }));
    host = new BrowserWindow({ show: false, width: 1366, height: 850, frame: false, webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true, backgroundThrottling: false, offscreen: true } });
    host.webContents.on('console-message', (_event, ...args) => { const value = args[1]; if (typeof value === 'string' && /Uncaught|TypeError|SyntaxError/.test(value)) errors.push(value + ' @ ' + args[3] + ':' + args[2]); });
    host.webContents.on('will-attach-webview', (_event, preferences) => { preferences.preload = path.join(root, 'source/guest-preload.cjs'); preferences.nodeIntegration = false; preferences.contextIsolation = true; preferences.sandbox = true; });
    const notify = () => { if (host && !host.isDestroyed() && studio) host.webContents.send('lolzcloud:state', { ...studio.snapshot(service.getState()), features: studio.getState(), discord: { connected: false } }); };
    studio = require('../source/integrations/studio.cjs').createStudio({ app, service, getWindow: () => host, trusted: event => event.sender === host.webContents && event.senderFrame === event.sender.mainFrame, onStateChange: notify });
    ipcMain.handle('lolzteam:action', () => ({ ok: true, state: { ...studio.snapshot(service.getState()), features: studio.getState(), discord: { connected: false } } }));
    ipcMain.handle('updates:action', () => ({ ok: true, state: { currentVersion: '0.9.0', supported: false, status: 'unsupported' } }));
    ipcMain.on('lolzteam:playback', () => {});
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(temporary, 'exported-profile.json') });
    await host.loadFile(path.join(root, 'source/app/index.html')); timer = setInterval(() => { studio.observe(); notify(); }, 500); notify();
    const js = code => host.webContents.executeJavaScript(code);
    await until(() => js('typeof window.LolzCloudPlayerTools?.palette === "function"'), 'New tools did not initialize');
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}))'); assert.equal(await js('document.getElementById("xp-palette").open'), true);
    await until(() => js('document.querySelectorAll("#xp-results [role=option]").length > 0'), 'Command palette returned no commands');
    await js('document.getElementById("xp-search").value="Сохранить момент";document.getElementById("xp-search").dispatchEvent(new Event("input"))'); await delay(200);
    fs.writeFileSync(path.join(root, '.build/player-palette-test.png'), (await host.webContents.capturePage()).toPNG());
    await js('document.getElementById("xp-palette").close();window.LolzCloudPlayerTools.bookmarkOpen()'); await until(() => js('document.getElementById("xp-bookmark-dialog").open'), 'Bookmark dialog did not open');
    await js('document.getElementById("xp-bookmark-position").value="0:23.45";document.getElementById("xp-bookmark-note").value="<b>My favourite chorus</b>";document.getElementById("xp-bookmark-form").requestSubmit()');
    await until(() => studio.getState().tools.bookmarks.length === 1, 'Bookmark did not persist'); assert.equal(studio.getState().tools.bookmarks[0].position, 23.45);
    await js('window.LolzCloudPlayerTools.open("moments")'); await delay(150); assert.equal(await js('document.querySelector("#xp-moments-list b") !== null'), false); fs.writeFileSync(path.join(root, '.build/player-moments-test.png'), (await host.webContents.capturePage()).toPNG());
    await js('window.LolzCloudPlayerTools.timingOpen()'); await js('document.getElementById("xp-timing-text").value="Original first line\\nOriginal second line";document.getElementById("xp-timing-build").click()');
    await js('(()=>{const inputs=[...document.querySelectorAll("#xp-timing-lines .xp-timing-row>input:first-child")];for(let i=0;i<inputs.length;i++){inputs[i].value=String(1.25+i*2.25);inputs[i].dispatchEvent(new Event("change"));}})()');
    await delay(180); fs.writeFileSync(path.join(root, '.build/player-timing-test.png'), (await host.webContents.capturePage()).toPNG()); await js('document.getElementById("xp-timing-save").click()');
    await until(() => fs.existsSync(path.join(temporary, 'lyric-timing.json')), 'Edited timings were not saved'); assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'lyric-timing.json')))[lyricKey(fixture)].lines[1].time, 3.5);
    const imported = await js('(async()=>{const {ipcRenderer}=require("electron");return ipcRenderer.invoke("player-tools:action",{type:"local-files",files:[' + JSON.stringify(audioFile) + ']})})()'); assert.equal(imported.ok, true); const local = imported.state.library.tracks[0];
    await js('(async()=>{const {ipcRenderer}=require("electron");return ipcRenderer.invoke("player-tools:action",{type:"local-play",id:' + JSON.stringify(local.id) + '})})()');
    await until(() => studio.snapshot().local && studio.snapshot().playback.playing && studio.snapshot().playback.position > .2, 'Offline audio did not start', 12000);
    assert.equal(studio.snapshot().private, true); assert.ok(!JSON.stringify(studio.snapshot()).includes(audioFile));
    await js('document.getElementById("player-playPause").click()'); await until(() => studio.snapshot().playback.playing === false, 'Footer pause did not control local audio');
    await js('document.getElementById("player-repeat").click()'); await until(() => studio.getState().transport.repeat.mode === 'one', 'Local repeat was not selected');
    await js('window.LolzCloudPlayerTools.open("library")'); await delay(100); fs.writeFileSync(path.join(root, '.build/player-offline-test.png'), (await host.webContents.capturePage()).toPNG());
    await js('(async()=>{const {ipcRenderer}=require("electron");await ipcRenderer.invoke("player-tools:action",{type:"profile-export"})})()'); const exported = JSON.parse(fs.readFileSync(path.join(temporary, 'exported-profile.json'))); assert.equal(exported.format, 'lolzcloud-profile'); assert.ok(!JSON.stringify(exported).includes(audioFile));
    assert.deepEqual(errors, []); console.log('Player UI passed: Ctrl+K, safe exact bookmarks, persisted timing editor, real offline audio, footer transport/repeat, portable profile.');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { clearInterval(timer); if (host && !host.isDestroyed()) { await host.webContents.executeJavaScript('window.LolzCloudLocal?.shutdown()').catch(() => {}); await delay(80); } if (studio) await studio.shutdown(); if (host && !host.isDestroyed()) host.destroy(); app.exit(process.exitCode || 0); }
});
