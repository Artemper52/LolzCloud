'use strict';
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function roomNavigation({ host, studio, roomJs, mediaPlaying, label }) {
  const js = code => host.webContents.executeJavaScript(code, true);
  const selector = '#lc-room-webview';
  const contentsId = await js(`document.querySelector('${selector}').getWebContentsId()`);
  const before = studio.getState();
  const control = state => [state.room.url, state.room.controller?.connection, state.room.hosting];
  await roomJs('document.getElementById("chat-input").value="Room draft survives navigation"');
  async function resident(step) {
    await delay(80);
    assert.equal(await js(`document.querySelector('${selector}')?.getWebContentsId()`), contentsId, label + ': ' + step + ' removed the room player');
    assert.equal(studio.getState().source, before.source, label + ': ' + step + ' changed the playback source');
    assert.deepEqual(control(studio.getState()), control(before), label + ': ' + step + ' changed the room controller');
    assert.equal(await roomJs('document.getElementById("chat-input").value'), 'Room draft survives navigation', label + ': ' + step + ' lost the chat draft');
    assert.equal(await mediaPlaying(), true, label + ': ' + step + ' stopped room music');
  }
  for (const panel of ['audio', 'lyrics', 'settings', 'library', 'community', 'radar', 'moments', 'versions', 'private', 'keys', 'sources', 'share', 'wave']) {
    await js(`window.LolzCloudStudio.open(${JSON.stringify(panel)})`);
    await resident('open ' + panel);
    assert.equal(await js('document.body.classList.contains("room-stage-open")'), false, 'Room layout covered ' + panel);
    assert.equal(await js('document.getElementById("lc-room-return").hidden'), false, 'A return action is missing in ' + panel);
    await js('document.getElementById("lc-studio-close").click()');
    assert.equal(await js('document.body.dataset.view'), 'room', 'Closing ' + panel + ' did not return to the room');
    await resident('close ' + panel);
  }
  await js('window.LolzCloudStudio.open("audio")');
  assert.equal(await js('document.getElementById("lc-speed").disabled'), true, 'Shared playback must keep speed at 1x');
  await assert.rejects(studio.act({ type: 'dsp', settings: { rate: 1.2 } }), /1×/);
  await assert.rejects(studio.act({ type: 'dsp', settings: { preset: 'Nightcore' } }), /1×/);
  const sound = { ...studio.getState().dsp, gains: [...studio.getState().dsp.gains] };
  await studio.act({ type: 'dsp', settings: { enabled: true, gains: [3, 2, 0, -1, 0], reverb: .2 } });
  await resident('EQ and reverb');
  if (label === 'SoundCloud host') {
    const fs = require('node:fs'), path = require('node:path');
    await delay(150);
    fs.writeFileSync(path.resolve(__dirname, '../../.build/room-effects-0912.png'), (await host.webContents.capturePage()).toPNG());
  }
  const { preset, ...settings } = sound; await studio.act({ type: 'dsp', settings });
  for (const [open, target] of [['window.lolzShowAccount()', 'lzt-dialog'], ['window.LolzCloudPlayerTools.palette()', 'xp-palette']]) {
    await js(open); await resident('open ' + target);
    await js('require("electron").ipcRenderer.emit("appReqEsc",{})');
    assert.equal(await js(`document.getElementById('${target}').open`), false, target + ' did not close');
    assert.equal(await js('document.body.dataset.view'), 'audio', 'Esc closed the underlying effects panel');
    await resident('close ' + target);
  }
  await js('require("electron").ipcRenderer.emit("appReqEsc",{})');
  assert.equal(await js('document.body.dataset.view'), 'room', 'Esc from effects did not return to the room');
  await resident('Esc from effects');
  const { BrowserWindow } = require('electron');
  const windows = new Set(BrowserWindow.getAllWindows());
  await studio.act({ type: 'mini' });
  await delay(200); await resident('open mini player');
  for (const window of BrowserWindow.getAllWindows()) if (!windows.has(window) && window !== host) window.close();
  await resident('close mini player');
  // Closing the room presentation hides its panel; only Leave ends the session.
  await js('document.getElementById("lc-studio-close").click()');
  await delay(100); await resident('hide room panel');
  await js('document.querySelector("[data-view=room]").click()');
  await resident('reopen room panel');
  console.log('Room navigation passed: ' + label + ', 13 panels, profile/search overlays, Esc, close/reopen and preserved chat/audio/lease.');
};
