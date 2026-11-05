'use strict';
require('../source/integrations/legacy-runtime.cjs').install();
const { app, BrowserWindow, session, shell, dialog, ipcMain } = require('electron'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), vm = require('node:vm');
const directory = process.env.LOLZCLOUD_SESSION_TEST_PROFILE, root = path.resolve(__dirname, '..');
if (!directory || !path.basename(directory).startsWith('LolzCloud-session-ui-')) throw Error('An isolated fixture profile is required');
app.setPath('userData', directory); app.setPath('downloads', directory); app.disableHardwareAcceleration();
require('../source/integrations/audio-ducker.cjs').AudioDucker.prototype.start = () => {};
require('../source/integrations/browser-profiles.cjs').BrowserProfiles.prototype.list = () => [{ id: 'fixture-browser', family: 'chrome', name: 'Тестовый браузер', detail: 'Музыкальный профиль' }];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { const end = Date.now() + 9000; while (!await predicate()) { if (Date.now() > end) throw Error(label); await delay(70); } }
app.whenReady().then(async () => {
  let host, browser, popup, integration; let external = '', selected = '';
  try {
    fs.mkdirSync(path.join(root, '.build'), { recursive: true });
    const fixture = request => {
      const url = new URL(request.url), active = (url.pathname.match(/\/song-(\d)/) || [])[1];
      if (url.hostname === 'api.soundcloud.com') return new Response(JSON.stringify({ id: 42, username: 'Fixture listener', permalink_url: 'https://soundcloud.com/fixture-listener' }), { headers: { 'Content-Type': 'application/json' } });
      const song = active ? '<div class="playControls__elements"><button class="playControl playing">Pause</button></div><div class="playbackSoundBadge"><a class="playbackSoundBadge__titleLink" href="https://soundcloud.com/fixture/song-' + active + '">Song ' + active + '</a><a class="playbackSoundBadge__lightLink">Fixture artist</a></div><div class="playbackTimeline__timePassed">0:30</div><div class="playbackTimeline__duration">1:40</div>' : '';
      return new Response('<html><body style="background:#101813;color:#e2f4e8"><header><a class="header__userNavButton" href="https://soundcloud.com/fixture-listener">Fixture listener</a></header><p>SoundCloud fixture</p><div class="playControls">' + song + '</div></body></html>', { headers: { 'Content-Type': 'text/html' } });
    };
    await session.defaultSession.protocol.handle('https', fixture);
    host = new BrowserWindow({ show: false, width: 1366, height: 850, frame: false, webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true, backgroundThrottling: false, offscreen: true } });
    host.show = () => {}; host.focus = () => {};
    host.webContents.on('will-attach-webview', (_event, preferences) => { preferences.preload = path.join(root, 'source/guest-preload.cjs'); preferences.nodeIntegration = false; preferences.contextIsolation = true; preferences.sandbox = true; });
    shell.openExternal = async url => { external = url; };
    dialog.showOpenDialog = async () => ({ canceled: !selected, filePaths: selected ? [selected] : [] });
    integration = require('../source/integrations/lolzteam/index.cjs').registerLolzteam(app, () => host); await integration.ready;
    ipcMain.handle('updates:action', () => ({ ok: true, state: { currentVersion: '0.9.1', supported: false, status: 'unsupported' } }));
    await host.loadFile(path.join(root, 'source/app/index.html')); const js = code => host.webContents.executeJavaScript(code);
    await until(() => js('!!window.LolzCloudSignIn && document.getElementById("sc-signin-banner").hidden === false'), 'Clean installation did not offer browser sign-in');
    await js('document.getElementById("browser-sign-in").click()');
    await until(() => js('!document.getElementById("sc-login-start").disabled'), 'Browser profile discovery did not complete');
    await js('document.getElementById("sc-login-start").click()');
    await until(() => external.startsWith('http://127.0.0.1:'), 'Native sign-in did not open a local browser transfer');
    assert.equal(await js('document.getElementById("sc-login-dialog").open'), true);
    const welcome = await fetch(external), html = await welcome.text();
    const rawBookmark = html.match(/id="bookmark" href="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const browserStore = session.fromPartition('fixture-browser-transfer'); await browserStore.protocol.handle('https', fixture);
    await browserStore.cookies.set({ url: 'https://soundcloud.com/', domain: '.soundcloud.com', name: 'oauth_token', value: 'fixture-browser-auth', path: '/', secure: true });
    browser = new BrowserWindow({ show: false, webPreferences: { session: browserStore, nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true } });
    await browser.loadURL('https://soundcloud.com/you');
    await browser.webContents.executeJavaScript(rawBookmark.replace(/^javascript:/, ''), true).catch(() => {});
    await until(() => js('document.querySelectorAll("#sc-login-account-list button").length===1'), 'The browser account did not appear in the chooser');
    await delay(250); fs.writeFileSync(path.join(root, '.build/browser-account-picker-093.png'), (await host.webContents.capturePage()).toPNG());
    assert.equal((await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' })).some(row => row.value === 'fixture-browser-auth'), false, 'An offered account must not be imported before selection');
    await js('document.querySelector("#sc-login-account-list button").click()');
    await until(async () => (await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' })).some(row => row.value === 'fixture-browser-auth'), 'The browser navigation did not decrypt and transfer its session');
    await until(() => js('document.getElementById("sc-login-status").textContent.includes("Готово")'), 'The application did not confirm the imported account');
    const saved = fs.readFileSync(path.join(directory, 'soundcloud-session.json'), 'utf8'); assert.ok(!saved.includes('fixture-browser-auth')); assert.ok(saved.includes('encryptedCookies'));
    await delay(200); fs.writeFileSync(path.join(root, '.build/session-import-ui.png'), (await host.webContents.capturePage()).toPNG());
    // Exercise the real helper worker/content/popup programs against an isolated
    // browser cookie store. Only extension API transport is supplied by the fixture.
    await browserStore.cookies.set({ url: 'https://soundcloud.com/', domain: '.soundcloud.com', name: 'oauth_token', value: 'fixture-automatic-httponly-auth', path: '/', secure: true, httpOnly: true });
    const helperDirectory = path.join(root, 'source/app/session-transfer/helper');
    const popupPreload = path.join(directory, 'helper-fixture-preload.cjs');
    fs.writeFileSync(popupPreload, `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('browser', { runtime: { sendMessage: value => ipcRenderer.invoke('fixture:helper', value) } });`);
    popup = new BrowserWindow({ show: false, width: 420, height: 760, webPreferences: { preload: popupPreload, nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true } });
    const scope = { crypto: crypto.webcrypto, TextEncoder, Uint8Array, atob, btoa, URL, Date, Set, JSON, Promise }; let listener, stored = {}, cookieReads = 0;
    scope.browser = { runtime: { getURL: name => 'chrome-extension://fixture/' + name, onMessage: { addListener: value => { listener = value; } } }, storage: { local: { get: async () => structuredClone(stored), set: async value => { stored = { ...stored, ...structuredClone(value) }; }, remove: async key => { delete stored[key]; } } }, cookies: { getAll: async details => { cookieReads++; return browserStore.cookies.get(details); } }, tabs: { query: async () => [{ id: browser.webContents.id, url: browser.webContents.getURL() }], sendMessage: async (_id, message) => browser.webContents.executeJavaScript(message.type === 'describe-transfer' ? '({request:JSON.parse(document.getElementById("lolzcloud-transfer-request").dataset.request)})' : 'window.__helperMessage({type:"retry-transfer"})') } };
    vm.createContext(scope); vm.runInContext(fs.readFileSync(path.join(helperDirectory, 'bridge.js'), 'utf8'), scope); vm.runInContext(fs.readFileSync(path.join(helperDirectory, 'background.js'), 'utf8'), scope);
    ipcMain.handle('fixture:helper', (event, message) => {
      if (event.sender !== popup.webContents) throw Error('Unexpected fixture sender');
      return new Promise(resolve => listener(message, { url: 'chrome-extension://fixture/popup.html' }, resolve));
    });
    const injectHelper = async () => {
      // Page JS and the helper run in a real Chromium secure loopback context;
      // the mock runtime only forwards extension messages to the real worker.
      const request = await browser.webContents.executeJavaScript('JSON.parse(document.getElementById("lolzcloud-transfer-request").dataset.request)');
      let sender = { frameId: 0, url: browser.webContents.getURL(), tab: { id: browser.webContents.id, url: browser.webContents.getURL() } };
      const initial = await new Promise(resolve => listener({ type: 'auto-transfer', request }, sender, resolve));
      // Keep the encrypted response in the isolated fixture's runtime; cookie
      // plaintext never enters either the transfer DOM or app renderer.
      await browser.webContents.executeJavaScript('window.browser={runtime:{sendMessage:async()=>(' + JSON.stringify(initial) + '),onMessage:{addListener:callback=>{window.__helperMessage=message=>callback(message,{},()=>{})}}}};'+ fs.readFileSync(path.join(helperDirectory, 'content.js'), 'utf8'));
      return request;
    };
    const previousTransfer = external;
    await js('document.getElementById("sc-login-start").click()'); await until(() => external !== previousTransfer && external.startsWith('http://127.0.0.1:'), 'A new browser transfer did not open');
    await browser.loadURL(external); await injectHelper();
    await until(() => browser.webContents.executeJavaScript('document.getElementById("helper-status").dataset.mode === "pair"'), 'The helper did not offer pairing'); assert.equal(cookieReads, 0);
    await popup.loadFile(path.join(helperDirectory, 'popup.html'));
    await until(() => popup.webContents.executeJavaScript('document.getElementById("pair-code").textContent.length > 10'), 'The helper popup did not display a pairing code');
    assert.equal(await popup.webContents.executeJavaScript('document.getElementById("pair-code").textContent'), await js('document.getElementById("sc-login-pairing-code").textContent'));
    // Pair using the actual popup button, then reload the transfer page so the
    // paired helper's automatic content-script path runs without any clicks.
    await popup.webContents.executeJavaScript('document.getElementById("pair").click()'); await until(() => !!stored.pairedApps?.length, 'Popup approval did not persist');
    await browser.loadURL(external); await injectHelper();
    await until(() => js('document.querySelectorAll("#sc-login-account-list button").length===1'), 'The paired helper did not offer its HttpOnly account');
    await js('document.querySelector("#sc-login-account-list button").click()');
    await until(async () => (await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' })).some(row => row.value === 'fixture-automatic-httponly-auth'), 'The paired helper did not transfer HttpOnly cookies automatically');
    await until(() => browser.webContents.executeJavaScript('document.getElementById("helper-status").dataset.mode === "done"'), 'The browser did not confirm automatic sign-in');
    assert.ok(!await browser.webContents.executeJavaScript('document.documentElement.outerHTML.includes("fixture-automatic-httponly-auth")'));
    await delay(200); fs.writeFileSync(path.join(root, '.build/automatic-browser-signin.png'), (await browser.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(root, '.build/browser-helper-popup.png'), (await popup.webContents.capturePage()).toPNG());
    assert.ok(!fs.readFileSync(path.join(directory, 'browser-pairing.json'), 'utf8').includes('PRIVATE KEY'));
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync('fixture-password-123', salt, 310000, 32, 'sha256'), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('lolzcloud-session-export:1'));
    const data = Buffer.concat([cipher.update(JSON.stringify({ cookies: [{ domain: '.soundcloud.com', name: 'oauth_token', value: 'fixture-encrypted-file-auth', path: '/', secure: true, httpOnly: true, session: true }] })), cipher.final(), cipher.getAuthTag()]);
    selected = path.join(directory, 'SoundCloud.lolzcloud-session'); fs.writeFileSync(selected, JSON.stringify({ format: 'lolzcloud-session-export', version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }));
    await js('document.getElementById("sc-login-file").click()'); await until(() => js('document.getElementById("sc-login-unlock").hidden === false'), 'Encrypted exports did not ask for their file password');
    await js('document.getElementById("sc-login-password").value="fixture-password-123";document.getElementById("sc-login-unlock").requestSubmit()');
    await until(async () => (await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' })).some(row => row.value === 'fixture-encrypted-file-auth'), 'The password-protected file did not import');
    assert.equal(await js('document.getElementById("sc-login-password").value'), '');
    const publicState = await js('require("electron").ipcRenderer.invoke("lolzteam:action",{type:"state"})'); assert.ok(!JSON.stringify(publicState).includes('fixture-encrypted-file-auth'));
    await js('document.getElementById("sc-login-dialog").close();document.getElementById("webview").dispatchEvent(Object.assign(new Event("did-fail-load"),{errorCode:-105,isMainFrame:true}))');
    assert.equal(await js('document.getElementById("sc-connection").hidden'), false); await delay(200); fs.writeFileSync(path.join(root, '.build/soundcloud-recovery-ui.png'), (await host.webContents.capturePage()).toPNG());
    await js('document.getElementById("sc-connection-retry").click()'); await until(() => js('document.getElementById("sc-connection").hidden'), 'Retry did not recover the SoundCloud view');
    for (const id of [1, 2, 3]) {
      await js('require("electron").ipcRenderer.invoke("features:action",{type:"play-url",url:"https://soundcloud.com/fixture/song-' + id + '"})');
      await until(() => js('document.getElementById("player-title").textContent === "Song ' + id + '"'), 'Track ' + id + ' did not become current');
    }
    await js('document.getElementById("player-previous").click()'); await until(() => js('document.getElementById("player-title").textContent === "Song 2"'), 'Previous restarted the current song instead of changing it');
    await js('document.getElementById("player-previous").click()'); await until(() => js('document.getElementById("player-title").textContent === "Song 1"'), 'A second previous did not go back again');
    await js('document.getElementById("player-next").click()'); await until(() => js('document.getElementById("player-title").textContent === "Song 2"'), 'Next did not return forward after going back');
    console.log('Session and transport UI passed: clean-PC prompt, browser WebCrypto handoff, actual helper content/worker/popup with HttpOnly cookies and one-time approval, automatic direct transfer, encrypted persistence, password file fallback, failure recovery and previous/previous/next.');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { ipcMain.removeHandler('fixture:helper'); if (integration) await integration.shutdown(); if (popup && !popup.isDestroyed()) popup.destroy(); if (browser && !browser.isDestroyed()) browser.destroy(); if (host && !host.isDestroyed()) host.destroy(); app.exit(process.exitCode || 0); }
});
