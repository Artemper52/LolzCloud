'use strict';
require('../source/integrations/legacy-runtime.cjs').install();
const { app, BrowserWindow, session, shell, dialog, ipcMain } = require('electron'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const directory = process.env.LOLZCLOUD_SESSION_TEST_PROFILE, root = path.resolve(__dirname, '..');
if (!directory || !path.basename(directory).startsWith('LolzCloud-session-ui-')) throw Error('An isolated fixture profile is required');
app.setPath('userData', directory); app.setPath('downloads', directory); app.disableHardwareAcceleration();
require('../source/integrations/audio-ducker.cjs').AudioDucker.prototype.start = () => {};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { const end = Date.now() + 9000; while (!await predicate()) { if (Date.now() > end) throw Error(label); await delay(70); } }
app.whenReady().then(async () => {
  let host, browser, integration; let external = '', selected = '';
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
    await js('document.getElementById("browser-sign-in").click();document.getElementById("sc-login-start").click()');
    await until(() => external.startsWith('http://127.0.0.1:'), 'Native sign-in did not open a local browser transfer');
    assert.equal(await js('document.getElementById("sc-login-dialog").open'), true);
    const welcome = await fetch(external), html = await welcome.text();
    const rawBookmark = html.match(/id="bookmark" href="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const browserStore = session.fromPartition('fixture-browser-transfer'); await browserStore.protocol.handle('https', fixture);
    await browserStore.cookies.set({ url: 'https://soundcloud.com/', domain: '.soundcloud.com', name: 'oauth_token', value: 'fixture-browser-auth', path: '/', secure: true });
    browser = new BrowserWindow({ show: false, webPreferences: { session: browserStore, nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true } });
    await browser.loadURL('https://soundcloud.com/you');
    await browser.webContents.executeJavaScript(rawBookmark.replace(/^javascript:/, ''), true).catch(() => {});
    await until(async () => (await session.defaultSession.cookies.get({ url: 'https://soundcloud.com/', name: 'oauth_token' })).some(row => row.value === 'fixture-browser-auth'), 'The browser navigation did not decrypt and transfer its session');
    await until(() => js('document.getElementById("sc-login-status").textContent.includes("Готово")'), 'The application did not confirm the imported account');
    const saved = fs.readFileSync(path.join(directory, 'soundcloud-session.json'), 'utf8'); assert.ok(!saved.includes('fixture-browser-auth')); assert.ok(saved.includes('encryptedCookies'));
    await delay(200); fs.writeFileSync(path.join(root, '.build/session-import-ui.png'), (await host.webContents.capturePage()).toPNG());
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
    console.log('Session and transport UI passed: clean-PC prompt, real browser WebCrypto handoff through loopback navigation, encrypted native persistence, password export import, failure recovery, previous/previous/next using the actual footer and webview.');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { if (integration) await integration.shutdown(); if (browser && !browser.isDestroyed()) browser.destroy(); if (host && !host.isDestroyed()) host.destroy(); app.exit(process.exitCode || 0); }
});
