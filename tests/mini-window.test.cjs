'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { MiniPlayerWindow, fitBounds } = require('../source/integrations/mini-window.cjs');
const delay = () => new Promise(resolve => setTimeout(resolve, 15));
class Window extends EventEmitter {
  constructor(options) { super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; this.visible = false; this.minimized = false; this.dead = false; this.focuses = 0; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = callback => { this.popup = callback; }; }
  isDestroyed() { return this.dead; } isVisible() { return this.visible; } isMinimized() { return this.minimized; }
  isAlwaysOnTop() { return this.top; }
  getBounds() { return { ...this.bounds }; } getNormalBounds() { return this.getBounds(); }
  setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); this.emit('resize'); }
  setMinimumSize(width, height) { this.minimum = [width, height]; }
  setAlwaysOnTop(flag, level) { this.top = flag; this.level = level; this.emit('always-on-top-changed', {}, flag); }
  moveTop() { this.raised = (this.raised || 0) + 1; } focus() { this.focuses++; }
  setMenu(value) { this.menu = value; }
  restore() { this.minimized = false; this.visible = true; this.emit('restore'); }
  showInactive() { this.visible = true; this.emit('show'); }
  hide() { this.visible = false; this.emit('hide'); }
  minimize() { this.minimized = true; this.visible = false; this.emit('minimize'); }
  loadFile() { queueMicrotask(() => this.emit('ready-to-show')); return Promise.resolve(); }
  close() { this.emit('close'); this.destroy(); }
  destroy() { this.dead = true; this.visible = false; this.emit('closed'); }
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-window-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const screen = new EventEmitter(), app = new EventEmitter();
  screen.displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: -1280, y: 0, width: 1280, height: 720 } }];
  screen.getPrimaryDisplay = () => screen.displays[0]; screen.getDisplayMatching = bounds => bounds.x < 0 && screen.displays[1] || screen.displays[0];
  const options = { BrowserWindow: Window, screen, app, filename: path.join(directory, 'mini-window.json'), html: 'mini.html' };
  const model = new MiniPlayerWindow(options); t.after(() => model.dispose()); return { model, options, screen, app };
}
test('mini stays pinned after losing focus, hiding or being minimized without stealing focus', async t => {
  const { model, app } = fixture(t), window = model.open(); await delay();
  assert.equal(window.options.minimizable, false); assert.equal(window.options.maximizable, false); assert.equal(window.options.parent, undefined);
  assert.equal(window.level, 'screen-saver'); assert.equal(window.top, true);
  window.emit('blur'); app.emit('browser-window-focus', {}, {}); window.minimize(); await delay();
  assert.equal(window.minimized, false); assert.equal(window.visible, true); assert.equal(window.top, true); assert.equal(window.focuses, 0);
  window.hide(); await delay(); assert.equal(window.visible, true);
  window.setAlwaysOnTop(false); await delay(); assert.equal(window.top, true);
  let prevented = false; window.emit('system-context-menu', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  window.close(); await delay(); assert.equal(model.window, null); assert.equal(model.saved.open, false);
});
test('position and both mini sizes survive reopening, resizing and an application restart', async t => {
  const { model, options } = fixture(t), window = model.open(); await delay();
  window.setBounds({ x: -1100, y: 100, width: 430, height: 270 }); model.remember();
  model.resize(true); assert.equal(window.bounds.height, 580); window.setBounds({ ...window.bounds, width: 490, height: 560 }); model.remember();
  model.resize(false); assert.equal(window.bounds.width, 430); assert.equal(window.bounds.height, 270);
  const expected = window.getBounds(); model.dispose();
  const reopened = new MiniPlayerWindow(options); t.after(() => reopened.dispose());
  assert.equal(reopened.saved.open, true); const restored = reopened.open(); await delay(); assert.deepEqual(restored.getBounds(), expected);
  reopened.resize(true); assert.equal(restored.bounds.width, 490); assert.equal(restored.bounds.height, 560);
});
test('a disconnected monitor cannot leave the mini outside the remaining work area', async t => {
  const { model, screen } = fixture(t), window = model.open(true); await delay();
  window.setBounds({ x: -1200, y: 40, width: 400, height: 580 }); model.remember();
  screen.displays.length = 1; screen.emit('display-removed');
  assert.equal(window.bounds.x, 0); assert.ok(window.bounds.y >= 0 && window.bounds.y + window.bounds.height <= 1040);
  assert.deepEqual(fitBounds({ x: 900, y: 900, width: 500, height: 600 }, { x: 0, y: 0, width: 800, height: 700 }, true), { x: 300, y: 100, width: 500, height: 600 });
});
