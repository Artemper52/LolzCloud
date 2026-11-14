'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { newer, download, extract, REPOSITORY, MIRROR } = require('./portable-update.cjs');
const { prepareNsisTemporary, applyTemporaryEnvironment, cacheSpaceError } = require('./update-temporary.cjs');
const BASE = 'https://github.com/Artemper52/LolzCloud/releases/latest/download/';
function validateManifest(value, legacy = false) {
  if (!value || !/^\d+\.\d+\.\d+$/.test(value.version) || value.tag !== 'v' + value.version || value.channel !== (legacy ? 'legacy' : 'latest')) throw new Error('Сервер вернул неподходящее обновление.');
  const prefix = 'LolzCloud-' + value.version, archive = prefix + (legacy ? '-win7-legacy-x64.zip' : '-win-x64.zip'), setup = prefix + (legacy ? '-win7-legacy' : '-win-x64') + '-Setup.exe';
  for (const [key, name] of [['archive', archive], ['setup', setup]]) { const asset = value[key]; if (asset?.name !== name || ![REPOSITORY + value.tag + '/' + name, MIRROR + name].includes(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 600 * 1024 * 1024) throw new Error('Обновление содержит непроверенный файл.'); }
  return value;
}
class AppUpdates {
  constructor({ app, onState = () => {}, prepareRestart, fetcher = (...args) => fetch(...args), nativeFactory = () => require('electron-updater').autoUpdater, platform = process.platform, prepareInstall = prepareNsisTemporary, processEnv = process.env, execPath = process.execPath }) {
    Object.assign(this, { app, onState, prepareRestart, fetcher, nativeFactory, prepareInstall, processEnv, execPath }); this.legacy = Number(process.versions.electron?.split('.')[0] || 99) < 23; this.busy = false; this.manifest = null; this.native = null;
    this.value = { currentVersion: app.getVersion(), version: '', status: 'idle', percent: 0, error: '', supported: platform === 'win32' && app.isPackaged, legacy: this.legacy };
    if (this.value.supported) { this.startup = setTimeout(() => { void this.check(true); }, 15000); this.startup.unref(); this.timer = setInterval(() => { void this.check(true); }, 6 * 3600000); this.timer.unref(); }
  }
  state() {
    return { ...this.value, available: !!this.manifest && newer(this.manifest.version, this.value.currentVersion) };
  }
  set(patch) { Object.assign(this.value, patch); this.onState(this.state()); }
  async check(quiet = false) {
    if (this.busy) return this.state(); if (!this.value.supported) { this.set({ status: 'unsupported', error: 'Обновление доступно в собранном приложении Windows.' }); return this.state(); }
    this.busy = true; this.set({ status: 'checking', error: '' });
    try {
      const replies = await Promise.allSettled([BASE, MIRROR].map(async feed => { const response = await this.fetcher(feed + (this.legacy ? 'update-legacy.json' : 'update.json'), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error('Обновления пока недоступны. Попробуй позже.'); const raw = await response.text(); if (raw.length > 20000) throw new Error('Слишком большой ответ обновления.'); return { feed, manifest: validateManifest(JSON.parse(raw), this.legacy) }; }));
      const candidates = replies.filter(row => row.status === 'fulfilled').map(row => row.value); if (!candidates.length) throw replies[0].reason;
      const chosen = candidates.reduce((left, right) => newer(right.manifest.version, left.manifest.version) ? right : left); this.manifest = chosen.manifest; this.feed = chosen.feed;
      this.set({ version: this.manifest.version, status: newer(this.manifest.version, this.app.getVersion()) ? 'available' : 'current', percent: 0, error: '' });
    }
    catch (error) { this.set({ status: quiet ? 'idle' : 'error', error: quiet ? '' : error.message }); }
    finally { this.busy = false; }
    return this.state();
  }
  installed() { return ['LolzCloud', 'LolzCloud Legacy'].some(name => fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall ' + name + '.exe'))); }
  async install() {
    if (this.busy) return; if (!this.value.supported) throw new Error('Обновление доступно в собранном приложении Windows.');
    if (!this.manifest || !newer(this.manifest.version, this.app.getVersion())) { await this.check(); if (this.value.status !== 'available') return; }
    this.busy = true; this.set({ status: 'downloading', percent: 0, error: '' });
    try { if (this.installed()) await this.installNsis(); else await this.installPortable(); }
    catch (error) { this.set({ status: 'error', error: error.message || 'Не удалось обновиться. Прежняя версия сохранена.' }); throw error; }
    finally { this.busy = false; }
  }
  async installNsis() {
    const updater = this.native ||= this.nativeFactory(); updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.channel = this.legacy ? 'legacy' : 'latest'; updater.allowDowngrade = false; updater.setFeedURL({ provider: 'generic', url: this.feed || BASE, channel: updater.channel, useMultipleRangeRequest: false });
    let nativeError = null;
    const progress = value => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, value.percent || 0)) }); const error = value => { nativeError = value; };
    updater.on('download-progress', progress); updater.on('error', error);
    try {
      const result = await updater.checkForUpdates();
      if (!result || !newer(result.updateInfo.version, this.app.getVersion()) || result.updateInfo.version !== this.manifest.version || !result.updateInfo.files?.some(file => path.basename(file.url) === this.manifest.setup.name)) throw new Error('Релиз ещё публикуется. Повтори обновление чуть позже.');
      let files;
      try { files = await updater.downloadUpdate(); } catch (error) { throw cacheSpaceError(error); }
      const file = files.find(file => file.toLowerCase().endsWith('.exe'));
      if (!file || fs.statSync(file).size !== this.manifest.setup.size) throw new Error('Размер установщика обновления не совпал.');
      const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') !== this.manifest.setup.sha256) throw new Error('Контрольная сумма установщика не совпала.');
      const temporary = await this.prepareInstall({ installationDirectory: path.dirname(this.execPath), tempDirectory: this.app.getPath?.('temp') || require('node:os').tmpdir(), installerSize: this.manifest.setup.size });
      this.set({ status: 'installing', percent: 100 }); await this.prepareRestart();
      const restoreEnvironment = applyTemporaryEnvironment(temporary.directory, this.processEnv);
      try { nativeError = null; updater.quitAndInstall(true, true); if (nativeError) throw nativeError; }
      catch (error) { restoreEnvironment(); throw error; }
    }
    finally { updater.removeListener('download-progress', progress); updater.removeListener('error', error); }
  }
  async installPortable() {
    const target = fs.realpathSync(path.dirname(process.execPath)), reserved = ['home', 'desktop', 'documents', 'downloads', 'appData', 'userData', 'temp'].map(name => path.resolve(this.app.getPath(name)).toLowerCase());
    if (reserved.includes(target.toLowerCase()) || target === path.parse(target).root || !fs.existsSync(path.join(target, 'lolzcloud-portable.json'))) throw new Error('Для обновления переносимой версии помести LolzCloud в отдельную папку.');
    const id = crypto.randomBytes(16).toString('hex'), directory = fs.mkdtempSync(path.join(this.app.getPath('temp'), 'LolzCloud-update-' + id + '-'));
    // The fixed directory name is checked again by the detached helper.
    const working = path.join(directory, 'LolzCloud-update-' + id); fs.mkdirSync(working); const archive = path.join(working, 'update.zip'), stage = path.join(working, 'app');
    const asset = this.manifest.archive; await download({ browser_download_url: asset.url, size: asset.size }, asset.sha256, archive, this.fetcher, percent => this.set({ percent })); await extract(archive, stage);
    const marker = JSON.parse(fs.readFileSync(path.join(stage, 'lolzcloud-portable.json'))); if (marker.version !== this.manifest.version || !!marker.legacy !== this.legacy) throw new Error('Архив предназначен для другой версии приложения.');
    const script = path.join(working, 'apply-update.ps1'); fs.copyFileSync(path.join(__dirname, 'portable-update.ps1'), script);
    this.set({ status: 'installing', percent: 100 });
    await new Promise((resolve, reject) => { const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentId', String(process.pid), '-TargetDirectory', target, '-StageDirectory', stage, '-UpdateId', id], { detached: true, windowsHide: true, stdio: 'ignore' }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
    await this.prepareRestart(); this.app.quit();
  }
  dispose() { clearTimeout(this.startup); clearInterval(this.timer); }
}
module.exports = { AppUpdates, validateManifest, BASE };
