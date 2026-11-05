'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
function run(app) {
  const directory = process.env.LOLZCLOUD_SELF_TEST_DIR, root = directory && path.resolve(directory);
  if (!root || path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('LolzCloud-self-test-')) { app.exit(1); return; }
  app.setPath('userData', root); app.setPath('sessionData', root); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('mute-audio');
  // Keep shutdown under this test's control. Destroying its last window must
  // not make Electron exit successfully before asynchronous cleanup completes.
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    let server, window, resultCode = 0;
    try {
      const assert = require('node:assert/strict'), { BrowserWindow, session } = require('electron');
      assert.equal(typeof AbortSignal.any, 'function'); assert.equal(typeof structuredClone, 'function'); assert.deepEqual(structuredClone({ values: [1, 2] }), { values: [1, 2] });
      require('./portable-profile.cjs'); require('./app-updates.cjs'); require('electron-updater'); require('./player-experience.cjs');
      const bytes = Buffer.from([0, 255, 127, 128, 1]); server = http.createServer((request, response) => { if (request.url === '/binary') { response.end(bytes); return; } if (request.url === '/renderer') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><body>Isolated compatibility self-test</body></html>'); return; } response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, cookie: String(request.headers.cookie || '').includes('lc_fixture=ok') })); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
      assert.deepEqual(Buffer.from(await (await fetch(origin + '/binary')).arrayBuffer()), bytes);
      const reader = (await fetch(origin + '/binary')).body.getReader(), streamed = []; while (true) { const value = await reader.read(); if (value.done) break; streamed.push(Buffer.from(value.value)); } assert.deepEqual(Buffer.concat(streamed), bytes);
      await session.defaultSession.cookies.set({ url: origin, name: 'lc_fixture', value: 'ok', path: '/' }); assert.equal((await (await session.defaultSession.fetch(origin)).json()).cookie, true);
      assert.equal((await (await session.defaultSession.fetch(origin, { credentials: 'omit' })).json()).cookie, false);
      const Tools = require('./player-tools.cjs').PlayerTools, tools = new Tools(path.join(root, 'tools.json')); tools.addBookmark({ url: 'https://soundcloud.com/fixture/song', title: 'Fixture', artist: 'Fixture', position: 12.34 }); assert.equal(tools.state().bookmarks[0].position, 12.34);
      window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }); window.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') resultCode = 1; console.error('Compatibility renderer stopped: ' + details.reason + ' (' + details.exitCode + ')'); }); await window.loadURL(origin + '/renderer'); const result = await window.webContents.executeJavaScript('({fixture:document.body.textContent,dialog:typeof HTMLDialogElement,audio:typeof AudioContext,clone:typeof structuredClone})'); assert.deepEqual(result, { fixture: 'Isolated compatibility self-test', dialog: 'function', audio: 'function', clone: 'function' });
      console.log('Compatibility self-test passed: Electron ' + process.versions.electron + ', Node ' + process.versions.node + ', binary fetch/streams, session cookies, stored bookmarks and native renderer.');
    } catch (error) { console.error(error.stack || error.message); resultCode = 1; }
    finally { if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); } app.exit(resultCode); }
  });
}
module.exports = { run };
