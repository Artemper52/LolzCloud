'use strict';
// The full desktop UI and real Studio/Library/Prefetcher run here. Only the
// remote catalogue, provider page and lyric responses are synthetic fixtures.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { createRequire } = require('node:module');
const { LolzteamService } = require('../source/integrations/lolzteam/service.cjs');
const root = path.resolve(__dirname, '..'), temporary = process.env.LOLZCLOUD_LYRIC_TEST_PROFILE;
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-lyric-ui-')) throw new Error('An isolated test profile is required.');
const output = process.env.LOLZCLOUD_LYRIC_TEST_OUTPUT || path.join(temporary, 'result.json');
app.setPath('userData', temporary); app.setPath('downloads', temporary); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) { const deadline = Date.now() + 5000; while (!await predicate()) { if (Date.now() > deadline) throw new Error(message); await delay(35); } }
const songs = [0, 1, 2].map(id => ({ url: 'https://soundcloud.com/lyric-fixture/song-' + id, title: 'Synthetic song ' + id, artist: 'Synthetic artist', duration: 100, position: 0, playing: true }));
const calls = [], assertions = [], errors = [];
const rich = id => ({ found: true, source: 'Synthetic lyrics fixture', lines: [{ time: 0, text: 'Cached words for song ' + id, words: [{ time: 0, text: 'Cached ' }, { time: 2, text: 'words for song ' + id }] }, { time: 20, text: 'Second synthetic line ' + id }], plain: '' });
let finishPartial, host, studio, phase = 'setup';
class LyricFixture {
  constructor() { this.cooldowns = new Map(); this.spotifyToken = null; }
  search(track, options) {
    const id = Number(track.url.split('-').at(-1)); calls.push({ id, force: options.force === true });
    if (options.force) return Promise.resolve({ found: false, lines: [], plain: '', attempts: [{ id: 'fixture', status: 'miss' }] });
    if (id === 2) { options.onProgress(rich(id)); return new Promise(resolve => { finishPartial = () => resolve({ found: false, lines: [], plain: '' }); }); }
    return Promise.resolve(rich(id));
  }
}
class CatalogueFixture {
  async resolve(url) { const track = songs.find(value => value.url === url); if (!track) throw new Error('Unknown fixture song'); return { ...track, duration: track.duration * 1000, bpm: 120, user: { username: track.artist } }; }
}
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); assertions.push(name); }
app.whenReady().then(async () => {
  try {
    await session.defaultSession.protocol.handle('https', () => new Response('<html><body><div class="playControls"><div class="playControls__elements"><button class="playControl playing">Pause</button></div></div></body></html>', { headers: { 'Content-Type': 'text/html' } }));
    host = new BrowserWindow({ show: false, width: 1366, height: 850, frame: false, webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true, backgroundThrottling: false, offscreen: true } });
    host.webContents.on('console-message', (_event, ...args) => { const message = args[1]; if (typeof message === 'string' && /Uncaught|TypeError|SyntaxError/.test(message)) errors.push(message); });
    host.webContents.on('will-attach-webview', (_event, preferences) => { preferences.preload = path.join(root, 'source/guest-preload.cjs'); preferences.nodeIntegration = false; preferences.contextIsolation = true; preferences.sandbox = true; });
    const service = new LolzteamService({ store: { load: () => null, save() {} }, api: {} }); service.setPlayback(songs[0]);
    const filename = path.join(root, 'source/integrations/studio.cjs'), originalRequire = createRequire(filename);
    const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), fetch, console, Buffer, require(name) {
      if (name === './lyric-providers.cjs') return { LyricsEngine: LyricFixture };
      if (name === './discovery.cjs') return { SoundCloudDiscovery: CatalogueFixture };
      if (name === './audio-ducker.cjs') return { AudioDucker: class { start() {} dispose() {} state() { return {}; } config() { return {}; } } };
      return originalRequire(name);
    } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    const state = () => ({ ...studio.snapshot(service.getState()), features: studio.getState(), discord: { connected: false } });
    const notify = () => { if (studio && host && !host.isDestroyed()) host.webContents.send('lolzcloud:state', state()); };
    studio = sandbox.module.exports.createStudio({ app, service, getWindow: () => host, trusted: event => event.sender === host.webContents && event.senderFrame === event.sender.mainFrame, onStateChange: notify });
    ipcMain.handle('lolzteam:action', () => ({ ok: true, state: state() }));
    ipcMain.handle('updates:action', () => ({ ok: true, state: { currentVersion: '0.9.0', supported: false } }));
    await host.loadFile(path.join(root, 'source/app/index.html'));
    const js = code => host.webContents.executeJavaScript(code);
    await until(() => js('typeof window.LolzCloudStudio?.open === "function"'), 'Desktop UI did not initialize');
    // Count invoke calls in the renderer while retaining Electron's actual IPC.
    await js(`(()=>{const ipc=require('electron').ipcRenderer,invoke=ipc.invoke.bind(ipc);window.fixtureLyricCalls=[];ipc.invoke=(name,action)=>{if(name==='features:action'&&action?.type==='lyrics')window.fixtureLyricCalls.push({...action});return invoke(name,action)}})()`);
    phase = 'prefetch'; studio.setUpcoming(songs.slice(1).map(value => value.url)); studio.observe();
    await until(() => !!finishPartial || studio.getState().lyricCache.ready >= 1, 'Initial lyrics did not load');
    await delay(40); studio.observe();
    await until(() => calls.some(value => value.id === 1) && !!finishPartial, 'The real prefetcher did not warm both upcoming songs');
    await delay(40);
    check('Each current/upcoming song was requested once', calls.map(value => value.id).sort(), [0, 1, 2]);
    phase = 'ready-transition';
    service.setPlayback({ ...songs[1], title: 'Synthetic artist - Synthetic song 1', artist: 'Fixture uploader', duration: 0 }); studio.observe(); notify();
    await js('window.LolzCloudStudio.open("lyrics")');
    const text = () => js('document.getElementById("lc-lyrics").textContent');
    await until(async () => (await text()).includes('Cached words for song 1'), 'Ready prefetched lyrics were lost on opening');
    await delay(120); check('A ready cached transition sends no redundant lyric IPC', await js('window.fixtureLyricCalls.length'), 0);
    for (const duration of [100.4, 101.9]) { service.setPlayback({ ...songs[1], title: 'Synthetic artist - Synthetic song 1', artist: 'Fixture uploader', duration }); studio.observe(); notify(); await delay(50); check('Ready text survives duration ' + duration, (await text()).includes('Cached words for song 1'), true); }
    check('Unknown/jitter metadata causes no provider request', calls.filter(value => value.id === 1).length, 1);
    phase = 'partial-transition';
    service.setPlayback({ ...songs[2], title: 'Synthetic artist - Synthetic song 2', artist: 'Another fixture uploader', duration: 0 }); studio.setUpcoming([]); studio.observe(); notify();
    await until(async () => (await text()).includes('Cached words for song 2'), 'Partial prefetch was erased during promotion');
    finishPartial(); await delay(40); notify();
    await until(() => !studio.getState().lyrics.loading, 'Partial lookup did not settle');
    await delay(80);
    check('An empty final response retains useful prefetched lines', (await text()).includes('Cached words for song 2'), true);
    check('Partial promotion shares its original provider request', calls.filter(value => value.id === 2).length, 1);
    check('A settled cached lyric is not reported missing', /не найден|Ищем слова/.test(await js('document.getElementById("lc-lyric-status").textContent')), false);
    phase = 'forced-miss'; await js('document.getElementById("lc-reload-lyrics").click()'); await delay(120); notify(); await delay(70);
    check('Explicit failed refresh retains known lyrics', (await text()).includes('Cached words for song 2'), true);
    check('Explicit refresh issues exactly one deliberate request', calls.filter(value => value.id === 2 && value.force).length, 1);
    phase = 'controls'; await js('window.LolzCloudStudio.open("sound");for(const [id,value]of [["lc-speed",150],["lc-pitch",75]]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event("input"));e.dispatchEvent(new Event("change"));}'); await delay(130);
    const dsp = studio.getState().dsp;
    check('UI tone/tempo controls enable only transport', { enabled: dsp.enabled, transportEnabled: dsp.transportEnabled, preservesPitch: dsp.preservesPitch, rate: dsp.rate, pitch: dsp.pitch }, { enabled: false, transportEnabled: true, preservesPitch: true, rate: 1.5, pitch: .75 });
    check('The full UI has no uncaught script errors', errors, []);
    await js('window.LolzCloudStudio.open("lyrics")'); await delay(50);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output.replace(/\.json$/i, '.png'), (await host.webContents.capturePage()).toPNG());
    fs.writeFileSync(output, JSON.stringify({ status: 'passed', scope: 'Real desktop UI, Studio, LyricPrefetcher, LyricsLibrary and Electron IPC; declared synthetic remote catalogue/provider/lyrics', assertions, calls }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', assertions: assertions.length, providerRequests: calls.length, output }));
  } catch (error) {
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ status: 'failed', phase, error: error.stack, errors, calls, assertions }, null, 2)); console.error(phase + ': ' + error.stack); process.exitCode = 1;
  } finally { if (studio) await studio.shutdown(); host?.destroy(); app.exit(process.exitCode || 0); }
});
