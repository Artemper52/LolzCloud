'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { EventEmitter } = require('node:events'), { ZipFile } = require('yazl');
const { newer, download, extract, digestFrom } = require('../source/integrations/portable-update.cjs');
const { AppUpdates, validateManifest } = require('../source/integrations/app-updates.cjs');
const { prepareNsisTemporary, applyTemporaryEnvironment, freeBytes } = require('../source/integrations/update-temporary.cjs');
function temporary(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-update-test-')); t.after(() => { const resolved = path.resolve(directory); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-update-test-')) fs.rmSync(resolved, { recursive: true, force: true }); }); return directory; }
function manifest(bytes = Buffer.from('fixture-setup'), legacy = false) { const version = '1.0.0', tag = 'v' + version, names = { archive: 'LolzCloud-' + version + (legacy ? '-win7-legacy-x64.zip' : '-win-x64.zip'), setup: 'LolzCloud-' + version + (legacy ? '-win7-legacy' : '-win-x64') + '-Setup.exe' }, result = { version, tag, channel: legacy ? 'legacy' : 'latest' }; for (const [kind, name] of Object.entries(names)) result[kind] = { name, url: 'https://github.com/Artemper52/LolzCloud/releases/download/' + tag + '/' + name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; return result; }
async function zip(filename, entries) { const archive = new ZipFile(), stream = fs.createWriteStream(filename); archive.outputStream.pipe(stream); for (const entry of entries) archive.addBuffer(Buffer.from(entry.body), 'LolzCloud-win32-x64/' + entry.name, entry.options); archive.end(); await new Promise((resolve, reject) => { stream.on('close', resolve); stream.on('error', reject); }); }
test('update manifests isolate legacy and modern channels, reject other repositories and compare versions numerically', () => {
  assert.equal(newer('0.10.0', '0.9.9'), true); assert.equal(newer('0.9.0', '0.9.0'), false); assert.equal(newer('0.8.9', '0.9.0'), false); assert.equal(newer('1.0.0-beta', '0.9.0'), false);
  validateManifest(manifest()); validateManifest(manifest(undefined, true), true); assert.throws(() => validateManifest(manifest(), true)); const malicious = manifest(); malicious.setup.url = 'https://example.test/installer.exe'; assert.throws(() => validateManifest(malicious));
  assert.equal(digestFrom('a'.repeat(64) + '  fixture.zip\n', 'fixture.zip'), 'a'.repeat(64)); assert.throws(() => digestFrom('a'.repeat(64) + '  other.zip', 'fixture.zip'));
});
test('portable updates verify both byte count and SHA-256 and never retain a bad download', async t => {
  const directory = temporary(t), bytes = Buffer.from('fixture-binary'), digest = crypto.createHash('sha256').update(bytes).digest('hex'), asset = { browser_download_url: 'https://github.com/Artemper52/LolzCloud/releases/download/v1.0.0/fixture.zip', size: bytes.length }, filename = path.join(directory, 'valid.zip');
  await download(asset, digest, filename, async () => new Response(bytes)); assert.deepEqual(fs.readFileSync(filename), bytes);
  const bad = path.join(directory, 'bad.zip'); await assert.rejects(download(asset, '0'.repeat(64), bad, async () => new Response(bytes))); assert.equal(fs.existsSync(bad), false);
  await assert.rejects(download({ ...asset, size: 1 }, digest, bad, async () => new Response(bytes))); assert.equal(fs.existsSync(bad), false);
});
test('portable extraction accepts a complete application and rejects traversal and symlink entries', async t => {
  const directory = temporary(t), valid = path.join(directory, 'valid.zip'); await zip(valid, [{ name: 'LolzCloud.exe', body: 'fixture' }, { name: 'resources/app.asar', body: 'fixture' }, { name: 'lolzcloud-portable.json', body: JSON.stringify({ appId: 'app.lolzcloud.desktop', version: '1.0.0' }) }]);
  const extracted = await extract(valid, path.join(directory, 'app')); assert.equal(fs.readFileSync(path.join(extracted, 'LolzCloud.exe'), 'utf8'), 'fixture');
  const traversal = path.join(directory, 'traversal.zip'); await zip(traversal, [{ name: 'escape__/outside', body: 'malicious' }]); fs.writeFileSync(traversal, Buffer.from(fs.readFileSync(traversal).toString('latin1').replaceAll('escape__', '../../..'), 'latin1')); await assert.rejects(extract(traversal, path.join(directory, 'blocked'))); assert.equal(fs.existsSync(path.join(directory, 'outside')), false);
  const symlink = path.join(directory, 'symlink.zip'); await zip(symlink, [{ name: 'link', body: '../outside', options: { mode: 0o120777 } }]); await assert.rejects(extract(symlink, path.join(directory, 'blocked-link')));
});
test('one update click downloads, verifies, saves the profile and requests a silent restart in that order', async t => {
  const directory = temporary(t), bytes = Buffer.from('fixture-setup'), value = manifest(bytes), setup = path.join(directory, value.setup.name); fs.writeFileSync(setup, bytes); const events = [], native = new EventEmitter();
  native.setFeedURL = config => { assert.ok(config.url.startsWith('https://github.com/Artemper52/LolzCloud/')); }; native.checkForUpdates = async () => ({ updateInfo: { version: value.version, files: [{ url: value.setup.name }] } }); native.downloadUpdate = async () => { events.push('download'); native.emit('download-progress', { percent: 50 }); return [setup]; }; native.quitAndInstall = (silent, restart) => events.push('restart:' + silent + ':' + restart);
  const updates = new AppUpdates({ app: { getVersion: () => '0.9.0', isPackaged: true }, platform: 'win32', fetcher: async () => new Response(JSON.stringify(value)), nativeFactory: () => native, prepareInstall: () => { events.push('preflight'); return { directory }; }, processEnv: {}, prepareRestart: async () => { events.push('save-profile'); } }); updates.installed = () => true; t.after(() => updates.dispose());
  await updates.check(); assert.equal(updates.state().status, 'available'); await updates.install(); assert.deepEqual(events, ['download', 'preflight', 'save-profile', 'restart:true:true']); assert.equal(updates.state().status, 'installing');
});
test('a corrupted installer cannot trigger preflight, change the environment, shut down the profile or execute an update', async t => {
  const directory = temporary(t), bytes = Buffer.from('fixture-setup'), value = manifest(bytes), setup = path.join(directory, value.setup.name); fs.writeFileSync(setup, Buffer.from('wrong-content')); let shutdown = false, executed = false; const native = new EventEmitter(); native.setFeedURL = () => {}; native.checkForUpdates = async () => ({ updateInfo: { version: value.version, files: [{ url: value.setup.name }] } }); native.downloadUpdate = async () => [setup]; native.quitAndInstall = () => { executed = true; };
  const env = { TEMP: 'old-temp', TMP: 'old-tmp' }; let preflight = false;
  const updates = new AppUpdates({ app: { getVersion: () => '0.9.0', isPackaged: true }, platform: 'win32', fetcher: async () => new Response(JSON.stringify(value)), nativeFactory: () => native, prepareInstall: () => { preflight = true; throw new Error('Must not run'); }, processEnv: env, prepareRestart: async () => { shutdown = true; } }); updates.installed = () => true; t.after(() => updates.dispose()); await updates.check(); await assert.rejects(updates.install(), /сумма/); assert.equal(shutdown, false); assert.equal(executed, false); assert.equal(preflight, false); assert.deepEqual(env, { TEMP: 'old-temp', TMP: 'old-tmp' }); assert.equal(updates.state().status, 'error'); assert.equal(updates.state().available, true);
});

test('the official website can deliver updates while GitHub is unavailable', async t => {
  const value = manifest(); for (const key of ['archive', 'setup']) value[key].url = 'https://lolzcloud.com/downloads/' + value[key].name;
  const updates = new AppUpdates({ app: { getVersion: () => '0.9.0', isPackaged: true }, platform: 'win32', fetcher: async url => url.startsWith('https://lolzcloud.com/') ? new Response(JSON.stringify(value)) : new Response('unavailable', { status: 503 }), prepareRestart: async () => {} }); t.after(() => updates.dispose());
  await updates.check(); assert.equal(updates.state().status, 'available'); assert.equal(updates.feed, 'https://lolzcloud.com/downloads/'); assert.equal(updates.manifest.setup.url, value.setup.url);
});

const GIB = 1024 * 1024 * 1024;
function windowsDisk({ c = 8 * GIB, d = 8 * GIB, writable = true, linked = '' } = {}) {
  const writes = [], created = [], fallback = 'D:\\Applications\\.LolzCloud-update-temp';
  const io = { realpath: value => value === fallback && linked ? linked : path.win32.normalize(value), ensure: value => created.push(value),
    free: value => value.startsWith('C:') ? c : d, writable: value => { if (!writable) throw new Error('EACCES'); writes.push(value); } };
  return { io, writes, created, fallback, options: { installationDirectory: 'D:\\Applications\\LolzCloud', tempDirectory: 'C:\\Temp', installerSize: 150 * 1024 * 1024 } };
}
test('C temp full with D available selects a writable installation-volume sibling outside the uninstall target', () => {
  const disk = windowsDisk({ c: 3 * 1024 * 1024 }), plan = prepareNsisTemporary(disk.options, { io: disk.io, paths: path.win32 });
  assert.equal(plan.directory, disk.fallback); assert.equal(plan.alternate, true); assert.deepEqual(disk.writes, [disk.fallback]);
  assert.ok(path.win32.relative(disk.options.installationDirectory, plan.directory).startsWith('..'));
});
test('1100 MiB free on C cannot pass the real 0.9.14 NSIS temporary-space requirement and falls back to D', () => {
  const disk = windowsDisk({ c: 1100 * 1024 * 1024 }), plan = prepareNsisTemporary(disk.options, { io: disk.io, paths: path.win32 });
  assert.equal(plan.directory, disk.fallback); assert.equal(plan.alternate, true);
  assert.ok(plan.requiredBytes >= (1536 + 512) * 1024 * 1024);
  assert.deepEqual(disk.writes, [disk.fallback]);
});
test('a usable normal temp is retained and unknown, unwritable or inside-target alternatives fail closed', () => {
  const normal = windowsDisk(), plan = prepareNsisTemporary(normal.options, { io: normal.io, paths: path.win32 });
  assert.equal(plan.directory, 'C:\\Temp'); assert.equal(plan.alternate, false); assert.deepEqual(normal.created, []);
  for (const config of [{ c: 0, d: 0 }, { c: 0, writable: false }, { c: 0, linked: 'D:\\Applications\\LolzCloud\\temp' }, { c: 0, linked: 'C:\\OtherTemp' }, { c: NaN, d: NaN }]) {
    const disk = windowsDisk(config); assert.throws(() => prepareNsisTemporary(disk.options, { io: disk.io, paths: path.win32 }), /мест|папк/);
  }
  const inside = windowsDisk(); inside.options.tempDirectory = inside.options.installationDirectory + '\\temp';
  assert.equal(prepareNsisTemporary(inside.options, { io: inside.io, paths: path.win32 }).directory, inside.fallback);
});
test('legacy Node without statfs uses bounded read-only DriveInfo with the path on stdin', () => {
  const directory = 'D:\\Temp with spaces\\$(not-a-command)', env = { SystemRoot: 'C:\\Windows', TEMP: 'before' };
  const bytes = freeBytes(directory, { statfs: null, platform: 'win32', env, run: (file, args, options) => {
    assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.ok(!args.join(' ').includes(directory)); assert.equal(options.input, directory); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 10000); return '2147483648\r\n';
  } });
  assert.equal(bytes, 2 * GIB); assert.deepEqual(env, { SystemRoot: 'C:\\Windows', TEMP: 'before' });
});
test('temporary environment restoration preserves absent variables without touching the global environment', () => {
  const globalBefore = { TEMP: process.env.TEMP, TMP: process.env.TMP }, env = { TEMP: 'old' };
  const restore = applyTemporaryEnvironment('D:\\Alternate', env); assert.deepEqual(env, { TEMP: 'D:\\Alternate', TMP: 'D:\\Alternate' });
  restore(); assert.deepEqual(env, { TEMP: 'old' }); assert.deepEqual({ TEMP: process.env.TEMP, TMP: process.env.TMP }, globalBefore);
});
async function nativeFixture(t, { preflight, failDownload, failHandoff, failPrepare } = {}) {
  const directory = temporary(t), bytes = Buffer.from('fixture-setup'), value = manifest(bytes), file = path.join(directory, value.setup.name); fs.writeFileSync(file, bytes);
  const env = { TEMP: 'C:\\Temp', TMP: 'C:\\Other' }, events = [], native = new EventEmitter();
  native.setFeedURL = () => {}; native.checkForUpdates = async () => ({ updateInfo: { version: value.version, files: [{ url: value.setup.name }] } });
  native.downloadUpdate = async () => { events.push('download'); if (failDownload) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); return [file]; };
  native.quitAndInstall = () => { events.push('handoff'); if (failHandoff) throw new Error('spawn failed'); assert.equal(env.TEMP, 'D:\\Applications\\.LolzCloud-update-temp'); assert.equal(env.TMP, env.TEMP); };
  // AppUpdates uses the host path.dirname before entering our Windows disk
  // adapter. Join that executable using host semantics so its directory stays
  // the intended simulated D: location on both POSIX and Windows test hosts.
  const updates = new AppUpdates({ app: { getVersion: () => '0.9.0', isPackaged: true, getPath: () => 'C:\\Temp' }, platform: 'win32', execPath: path.join('D:\\Applications\\LolzCloud', 'LolzCloud.exe'), processEnv: env,
    fetcher: async () => new Response(JSON.stringify(value)), nativeFactory: () => native,
    prepareInstall: options => { events.push('preflight'); assert.equal(options.installationDirectory, 'D:\\Applications\\LolzCloud'); assert.equal(options.tempDirectory, 'C:\\Temp'); return preflight ? preflight(options) : { directory: 'D:\\Applications\\.LolzCloud-update-temp' }; },
    prepareRestart: async () => { events.push('prepare'); assert.deepEqual(env, { TEMP: 'C:\\Temp', TMP: 'C:\\Other' }); if (failPrepare) throw new Error('save failed'); } });
  updates.installed = () => true; t.after(() => updates.dispose()); await updates.check(); return { updates, env, events };
}
test('verified cached installer can hand off with D temp while C is full, after preflight and profile preparation', async t => {
  const disk = windowsDisk({ c: 0 }), original = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  const f = await nativeFixture(t, { preflight: options => prepareNsisTemporary(options, { io: disk.io, paths: path.win32 }) });
  await f.updates.install(); assert.deepEqual(f.events, ['download', 'preflight', 'prepare', 'handoff']); assert.equal(f.updates.state().status, 'installing');
  assert.deepEqual({ TEMP: process.env.TEMP, TMP: process.env.TMP }, original);
});
test('no safe temp alternative leaves the app open and the original process environment intact before profile shutdown', async t => {
  const disk = windowsDisk({ c: 0, writable: false });
  const f = await nativeFixture(t, { preflight: options => prepareNsisTemporary(options, { io: disk.io, paths: path.win32 }) });
  await assert.rejects(f.updates.install(), /временной папке|временной папки|временной папк/);
  assert.deepEqual(f.events, ['download', 'preflight']); assert.deepEqual(f.env, { TEMP: 'C:\\Temp', TMP: 'C:\\Other' }); assert.equal(f.updates.state().status, 'error'); assert.equal(f.updates.state().available, true);
});
test('a full download cache reports a clear recoverable error before preflight or shutdown', async t => {
  const f = await nativeFixture(t, { failDownload: true });
  await assert.rejects(f.updates.install(), /кэше обновлений Windows/); assert.deepEqual(f.events, ['download']);
  assert.deepEqual(f.env, { TEMP: 'C:\\Temp', TMP: 'C:\\Other' }); assert.equal(f.updates.state().status, 'error');
});
test('prepare failure never changes TEMP and a synchronous handoff failure restores both TEMP and TMP', async t => {
  for (const config of [{ failPrepare: true }, { failHandoff: true }]) {
    const f = await nativeFixture(t, config); await assert.rejects(f.updates.install(), /failed/);
    assert.deepEqual(f.env, { TEMP: 'C:\\Temp', TMP: 'C:\\Other' }); assert.equal(f.updates.state().status, 'error');
  }
});
test('real filesystem preflight probes only the selected temporary directory and leaves no probe file', t => {
  const directory = temporary(t), install = path.join(directory, 'LolzCloud'), temp = path.join(directory, 'temp');
  fs.mkdirSync(install); fs.mkdirSync(temp); fs.writeFileSync(path.join(install, 'keep.json'), '{"profile":"unchanged"}');
  const before = fs.readFileSync(path.join(install, 'keep.json'));
  const plan = prepareNsisTemporary({ installationDirectory: install, tempDirectory: temp, installerSize: 1024 });
  assert.equal(plan.directory, fs.realpathSync(temp)); assert.deepEqual(fs.readdirSync(temp), []);
  assert.deepEqual(fs.readFileSync(path.join(install, 'keep.json')), before);
});
test('a second desktop instance returns immediately after quit instead of registering a ghost client', () => {
  const vm = require('node:vm'), events = [], app = { setAppUserModelId() {}, requestSingleInstanceLock: () => { events.push('lock'); return false; }, quit: () => events.push('quit'), whenReady: () => { throw new Error('Ghost ready handler registered'); } };
  const fakeRequire = name => {
    if (name === 'electron') return { app, ipcMain: { on: () => { throw new Error('Ghost IPC registered'); } } };
    if (name === 'node:path') return path;
    if (name === './integrations/legacy-runtime.cjs') return { install() {} };
    if (name === './integrations/profile-migration.cjs') return { configureProfile: () => events.push('profile') };
    return {};
  };
  const source = fs.readFileSync(path.join(__dirname, '../source/main.js'), 'utf8');
  const module = { exports: {} }, run = vm.runInNewContext('(function(require,module,exports,process){' + source + '\n})');
  run(fakeRequire, module, module.exports, { platform: 'win32', versions: { electron: '45.2.1' }, argv: [] });
  assert.deepEqual(events, ['profile', 'lock', 'quit']);
});
