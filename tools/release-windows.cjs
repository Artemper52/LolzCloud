'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
async function main() {
  const root = path.resolve(__dirname, '..'), version = require('../package.json').version, releaseRoot = path.resolve(process.env.LOLZCLOUD_RELEASE_OUTPUT || path.join(root, 'dist', 'windows-release')), cache = path.resolve(process.env.LOLZCLOUD_RELEASE_CACHE || path.join(releaseRoot, 'cache'));
  const temporary = path.join(cache, 'temp'); fs.mkdirSync(temporary, { recursive: true });
  for (const name of ['electron', 'builder', 'packager']) fs.mkdirSync(path.join(cache, name), { recursive: true });
  const base = { ...process.env, TEMP: temporary, TMP: temporary, LOLZCLOUD_ELECTRON_CACHE: path.join(cache, 'electron'), ELECTRON_BUILDER_CACHE: path.join(cache, 'builder'), LOLZCLOUD_BUILD_TEMP: path.join(cache, 'packager'), LOLZCLOUD_SETUP_OUTPUT: releaseRoot };
  async function node(script, args = [], env = {}) { await new Promise((resolve, reject) => { const child = spawn(process.execPath, [path.join(__dirname, script), ...args], { cwd: root, env: { ...base, ...env }, windowsHide: true, stdio: 'inherit' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(script + ' failed: ' + code))); }); }
  for (const legacy of [false, true]) {
    const output = path.join(releaseRoot, legacy ? 'legacy' : 'modern'); await node('build.cjs', legacy ? ['--legacy'] : [], { LOLZCLOUD_BUILD_PLATFORM: 'win32', LOLZCLOUD_BUILD_ARCH: 'x64', LOLZCLOUD_BUILD_OUTPUT: output });
    const appDirectory = path.join(output, 'LolzCloud-win32-x64'); const testDirectory = fs.mkdtempSync(path.join(temporary, 'LolzCloud-self-test-'));
    await new Promise((resolve, reject) => { const child = spawn(path.join(appDirectory, 'LolzCloud.exe'), ['--self-test'], { env: { ...base, LOLZCLOUD_SELF_TEST_DIR: testDirectory }, windowsHide: true, stdio: 'inherit' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Native compatibility self-test failed: ' + code))); });
    await node('build-setup.cjs', legacy ? ['--legacy'] : [], { LOLZCLOUD_SETUP_APP: appDirectory });
    const filename = path.join(releaseRoot, 'LolzCloud-' + version + (legacy ? '-win7-legacy-x64.zip' : '-win-x64.zip')); if (fs.existsSync(filename)) throw new Error('Portable archive already exists; choose a clean release output.'); await require('./windows-artifacts.cjs').archive(appDirectory, filename);
  }
  const helper = path.join(root, 'source/app/session-transfer');
  fs.copyFileSync(path.join(helper, 'helper.zip'), path.join(releaseRoot, 'LolzCloud-browser-helper-1.1.0-chromium.zip'));
  fs.copyFileSync(path.join(helper, 'helper-firefox.zip'), path.join(releaseRoot, 'LolzCloud-browser-helper-1.1.0-firefox.zip'));
  await node('update-manifests.cjs', [releaseRoot]); console.log('Windows release is ready: ' + releaseRoot);
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
