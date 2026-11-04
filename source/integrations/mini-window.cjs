'use strict';
const fs = require('node:fs');
const path = require('node:path');
const validBounds = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) && Math.abs(value.x) < 100_000 && Math.abs(value.y) < 100_000 && value.width >= 360 && value.width <= 3000 && value.height >= 210 && value.height <= 3000;
function fitBounds(bounds, area, lyrics = false) {
  const width = Math.min(Math.max(360, Math.round(bounds.width)), area.width);
  const height = Math.min(Math.max(lyrics ? 340 : 260, Math.round(bounds.height)), area.height);
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))), width, height };
}
class MiniPlayerWindow {
  constructor({ BrowserWindow, screen, app = null, filename, html, onClosed = () => {} }) {
    Object.assign(this, { BrowserWindow, screen, app, filename, html, onClosed });
    this.window = null; this.closing = false; this.disposed = false; this.ready = false; this.mode = 'compact';
    this.saved = { open: false, bounds: null, sizes: { compact: { width: 400, height: 260 }, lyrics: { width: 400, height: 580 } } };
    try {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (data.version === 1) {
        if (validBounds(data.bounds)) this.saved.bounds = data.bounds;
        this.saved.open = data.open === true;
        for (const mode of ['compact', 'lyrics']) if (validBounds({ x: 0, y: 0, ...data.sizes?.[mode] })) this.saved.sizes[mode] = { width: data.sizes[mode].width, height: data.sizes[mode].height };
      }
    } catch { /* Start with a visible position on the primary display. */ }
    this.displayChanged = () => { if (!this.window || this.window.isDestroyed()) return; this.resize(this.mode === 'lyrics'); this.pin(); };
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, this.displayChanged);
    this.appFocused = (_event, window) => { if (window !== this.window) this.pin(); };
    app?.on('browser-window-focus', this.appFocused);
  }
  persist() {
    if (!this.filename) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(this.filename + '.tmp', JSON.stringify({ version: 1, ...this.saved }), { mode: 0o600 });
    fs.renameSync(this.filename + '.tmp', this.filename);
  }
  area(bounds) { return bounds ? this.screen.getDisplayMatching(bounds).workArea : this.screen.getPrimaryDisplay().workArea; }
  remember() {
    const window = this.window; if (!window || window.isDestroyed()) return;
    const bounds = window.isMinimized() ? window.getNormalBounds() : window.getBounds();
    if (!validBounds(bounds)) return;
    this.saved.bounds = { ...bounds }; this.saved.sizes[this.mode] = { width: bounds.width, height: bounds.height }; this.persist();
  }
  pin() {
    const window = this.window; if (!window || window.isDestroyed() || this.closing || this.disposed) return;
    window.setAlwaysOnTop(true, 'screen-saver');
    if (this.ready && window.isVisible()) window.moveTop();
  }
  repair() {
    const window = this.window; if (!window || window.isDestroyed() || !this.ready || this.closing || this.disposed) return;
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.showInactive();
    this.pin();
  }
  resize(lyrics) {
    const window = this.window; if (!window || window.isDestroyed()) return;
    const mode = lyrics ? 'lyrics' : 'compact', current = window.getNormalBounds();
    let bounds = { ...current };
    if (mode !== this.mode) {
      this.remember(); const area = this.area(current), size = this.saved.sizes[mode];
      bounds.width = size.width; bounds.height = size.height;
      const bottom = area.y + area.height - current.y - current.height, right = area.x + area.width - current.x - current.width;
      if (bottom >= 0 && bottom <= 28) bounds.y = area.y + area.height - bottom - size.height;
      if (right >= 0 && right <= 28) bounds.x = area.x + area.width - right - size.width;
    }
    this.mode = mode; bounds = fitBounds(bounds, this.area(bounds), lyrics);
    window.setMinimumSize(Math.min(360, this.area(bounds).width), Math.min(lyrics ? 340 : 260, this.area(bounds).height));
    if (['x', 'y', 'width', 'height'].some(key => bounds[key] !== current[key])) window.setBounds(bounds);
    this.remember(); this.pin();
  }
  open(lyrics = false) {
    if (this.disposed) return null;
    if (this.window && !this.window.isDestroyed()) { this.resize(lyrics); this.repair(); return this.window; }
    this.mode = lyrics ? 'lyrics' : 'compact'; this.closing = false; this.ready = false;
    const area = this.area(this.saved.bounds), size = this.saved.sizes[this.mode];
    const bounds = fitBounds({ x: area.x + area.width - size.width - 20, y: area.y + area.height - size.height - 20, ...this.saved.bounds, ...size }, area, lyrics);
    const window = this.window = new this.BrowserWindow({ ...bounds, show: false, minWidth: Math.min(360, area.width), minHeight: Math.min(lyrics ? 340 : 260, area.height), alwaysOnTop: true, minimizable: false, maximizable: false, fullscreenable: false, movable: true, frame: false, resizable: true, skipTaskbar: true, backgroundColor: '#171b19', webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    window.setMenu(null); this.pin(); this.saved.open = true; this.persist();
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('system-context-menu', event => event.preventDefault());
    window.once('ready-to-show', () => { this.ready = true; this.repair(); });
    const scheduleRepair = () => { clearTimeout(this.repairTimer); this.repairTimer = setTimeout(() => this.repair(), 0); };
    window.on('blur', scheduleRepair); window.on('minimize', scheduleRepair); window.on('hide', scheduleRepair);
    window.on('show', () => this.pin());
    window.on('always-on-top-changed', (_event, onTop) => { if (!onTop) scheduleRepair(); });
    const scheduleSave = () => { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.remember(), 250); };
    window.on('move', scheduleSave); window.on('resize', scheduleSave);
    window.on('close', () => { this.closing = true; this.remember(); this.saved.open = false; this.persist(); });
    window.on('closed', () => { clearTimeout(this.saveTimer); clearTimeout(this.repairTimer); this.window = null; this.ready = false; this.onClosed(); });
    void window.loadFile(this.html).catch(() => { if (!window.isDestroyed()) window.close(); });
    return window;
  }
  state() { const window = this.window && !this.window.isDestroyed() ? this.window : null; return { open: !!window, visible: !!window?.isVisible(), minimized: !!window?.isMinimized(), alwaysOnTop: window ? window.isAlwaysOnTop() : true, bounds: window ? window.getNormalBounds() : this.saved.bounds }; }
  dispose() {
    if (this.disposed) return;
    this.remember(); this.disposed = true; this.closing = true;
    clearTimeout(this.saveTimer); clearTimeout(this.repairTimer);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) this.screen.removeListener(event, this.displayChanged);
    this.app?.removeListener('browser-window-focus', this.appFocused);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
module.exports = { MiniPlayerWindow, fitBounds, validBounds };
