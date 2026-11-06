'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const run = promisify(execFile), { buildSetup } = require('./build-setup.cjs');
const { validateManifest } = require('../source/integrations/app-updates.cjs');
const { download, extract } = require('../source/integrations/portable-update.cjs');
const { testPackaged } = require('./compatibility-test.cjs');
async function main() {
  if (process.platform !== 'win32') throw Error('Test Windows Setup on Windows.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-setup-check-'));
  const profile = path.join(temporary, 'profile'), target = path.join(temporary, 'installed');
  fs.mkdirSync(profile);
  const env = { ...process.env, LOLZCLOUD_SETUP_TEST_PROFILE: profile };
  let uninstaller;
  try {
    let previous = process.env.LOLZCLOUD_SETUP_PREVIOUS_APP;
    if (!previous) {
      const response = await fetch('https://github.com/Artemper52/LolzCloud/releases/download/v0.9.7/update.json', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error('Previous Setup fixture release is unavailable.');
      const manifest = validateManifest(await response.json());
      if (manifest.version !== '0.9.7') throw Error('Unexpected previous fixture version.');
      const archive = path.join(temporary, 'previous.zip');
      await download({ browser_download_url: manifest.archive.url, size: manifest.archive.size }, manifest.archive.sha256, archive);
      previous = path.join(temporary, 'previous'); await extract(archive, previous);
    }
    const current = path.resolve(process.argv[2] || path.join(process.env.LOLZCLOUD_RELEASE_OUTPUT || 'dist/windows-release', 'modern/LolzCloud-win32-x64'));
    const testId = crypto.randomBytes(8).toString('hex');
    const fixture = async phase => {
      const result = await run(require('electron'), [path.join(__dirname, '../tests/setup-profile.cjs')], { env: { ...env, LOLZCLOUD_SETUP_TEST_PHASE: phase }, windowsHide: true, timeout: 30000 });
      process.stdout.write(result.stdout);
    };
    const hashes = () => Object.fromEntries(fs.readdirSync(profile).filter(name => name.endsWith('.json')).map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(profile, name))).digest('hex')]));
    await fixture('save');
    const expected = hashes();
    for (const [directory, version] of [[previous, '0.9.7'], [current, require('../package.json').version]]) {
      if (version !== '0.9.7') {
        const before = fs.readFileSync(path.join(target, 'resources/app.asar'));
        const blocked = await buildSetup({ directory, output: path.join(temporary, 'insufficient-space'), testId, version, testRequiredKiB: 1024 * 1024 * 1024 * 100 });
        let rejected = false;
        try { await run(blocked.find(name => name.endsWith('-Setup.exe')), ['/S'], { env, windowsHide: true, timeout: 30000 }); }
        catch (error) { if (error.code !== 112) throw error; rejected = true; }
        if (!rejected) throw Error('Setup ignored insufficient disk space.');
        if (!fs.readFileSync(path.join(target, 'resources/app.asar')).equals(before) || JSON.stringify(hashes()) !== JSON.stringify(expected)) throw Error('Rejected Setup changed existing application or profile.');
        console.log('Low-space Setup stopped before changing the previous application or profile.');
      }
      const files = await buildSetup({ directory, output: path.join(temporary, 'setup-' + version), testId, version });
      await run(files.find(name => name.endsWith('-Setup.exe')), version === '0.9.7' ? ['/S', '/D=' + target] : ['/S'], { env, windowsHide: true, timeout: 120000 });
      for (const name of ['LolzCloud.exe', 'resources/app.asar', 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe']) {
        const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if (hash(path.join(target, name)) !== hash(path.join(directory, name))) throw Error('Installed file differs: ' + name);
      }
      if (JSON.stringify(hashes()) !== JSON.stringify(expected)) throw Error('Setup changed the saved profile.');
      uninstaller = path.join(target, 'Uninstall LolzCloud.exe');
      if (fs.statSync(uninstaller).size < 10000) throw Error('The uninstaller is incomplete.');
      console.log('Real silent Setup installed and verified: ' + version);
    }
    await fixture('restore');
    const selfTest = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-self-test-'));
    await testPackaged(path.join(target, 'LolzCloud.exe'), { env: { ...process.env, LOLZCLOUD_SELF_TEST_DIR: selfTest }, expectedElectron: require('electron/package.json').version });
    console.log('Setup upgrade passed from 0.9.7: exact application files, native launch and complete saved profile.');
  } finally {
    if (uninstaller && fs.existsSync(uninstaller)) {
      await run(uninstaller, ['/S', '_?=' + target], { env, windowsHide: true, timeout: 30000 });
    }
    if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('LolzCloud-setup-check-')) fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error.stderr || error.stack || error.message); process.exitCode = 1; });
