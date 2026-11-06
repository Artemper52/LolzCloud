'use strict';
const path = require('node:path'), fs = require('node:fs');
async function buildSetup({ legacy = false, directory, output, testId = '', testRequiredKiB = 0, version = require('../package.json').version } = {}) {
  if (process.platform !== 'win32') throw new Error('Build Windows Setup on Windows.');
  const { build, Platform, Arch } = require('electron-builder'), root = path.resolve(__dirname, '..');
  if (testId && !/^[a-f0-9]{16}$/.test(testId)) throw Error('Invalid isolated installer test ID.');
  if (testRequiredKiB && (!testId || !Number.isSafeInteger(testRequiredKiB) || testRequiredKiB < 0)) throw Error('Disk-space simulation is restricted to isolated installers.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid installer version.');
  directory = path.resolve(directory || process.env.LOLZCLOUD_SETUP_APP || path.join(root, 'dist', legacy ? 'LolzCloud-legacy-win32-x64' : 'LolzCloud-win32-x64'));
  if (!fs.existsSync(path.join(directory, 'LolzCloud.exe'))) throw new Error('Build the application before creating Setup: ' + directory);
  output = path.resolve(output || process.env.LOLZCLOUD_SETUP_OUTPUT || path.join(root, 'dist', 'installers'));
  const packageName = testId ? 'lolzcloud-setup-check-' + testId : legacy ? 'lolzcloud-legacy' : 'lolzcloud';
  const productName = testId ? 'LolzCloud Setup Check' : legacy ? 'LolzCloud Legacy' : 'LolzCloud';
  function directoryBytes(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).reduce((total, entry) => {
      const file = path.join(folder, entry.name);
      return total + (entry.isDirectory() ? directoryBytes(file) : fs.statSync(file).size);
    }, 0);
  }
  const requiredKiB = Math.max(Math.ceil(directoryBytes(directory) / 1024) * 2 + 256 * 1024, testRequiredKiB);
  const files = await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), prepackaged: directory, publish: 'never', effectiveOptionComputed: async ([defines]) => {
    if (!testId && defines.PRODUCT_FILENAME !== 'LolzCloud' || defines.APP_FILENAME !== packageName) throw new Error('Installer executable or application directory does not match the packaged files.');
    // Isolated tests use their own uninstall key and data directory while
    // installing the same executable and package as the published Setup.
    if (testId) Object.assign(defines, { PRODUCT_FILENAME: 'LolzCloud', APP_PRODUCT_FILENAME: packageName, APP_PACKAGE_NAME: packageName });
    Object.assign(defines, {
      LOLZCLOUD_REQUIRED_KB: String(requiredKiB), LOLZCLOUD_REQUIRED_MB: String(Math.ceil(requiredKiB / 1024)),
      LOLZCLOUD_EXE_BYTES: String(fs.statSync(path.join(directory, 'LolzCloud.exe')).size),
      LOLZCLOUD_ASAR_BYTES: String(fs.statSync(path.join(directory, 'resources/app.asar')).size),
      LOLZCLOUD_FFMPEG_BYTES: String(fs.statSync(path.join(directory, 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe')).size),
    });
    return false;
  }, config: {
    appId: testId ? 'app.lolzcloud.setup-check.' + testId : legacy ? 'app.lolzcloud.desktop.legacy' : 'app.lolzcloud.desktop', productName,
    executableName: 'LolzCloud', extraMetadata: { name: packageName, version },
    artifactName: 'LolzCloud-' + version + (legacy ? '-win7-legacy' : '-win-x64') + '-Setup.${ext}',
    directories: { output }, win: { icon: path.join(root, 'source/app/lib/assets/icon.ico'), signAndEditExecutable: false },
    publish: [{ provider: 'generic', url: 'https://github.com/Artemper52/LolzCloud/releases/latest/download/', channel: legacy ? 'legacy' : 'latest' }],
    nsis: { oneClick: true, perMachine: false, allowElevation: false, createDesktopShortcut: testId ? false : 'always', createStartMenuShortcut: !testId, shortcutName: productName, uninstallDisplayName: productName, runAfterFinish: !testId, deleteAppDataOnUninstall: false, installerIcon: path.join(root, 'source/app/lib/assets/icon.ico'), uninstallerIcon: path.join(root, 'source/app/lib/assets/icon.ico'), installerLanguages: ['ru_RU', 'en_US'], include: path.join(root, 'tools', legacy ? 'installer-legacy.nsh' : 'installer.nsh') }
  } });
  files.forEach(file => console.log('Installer: ' + file));
  return files;
}
if (require.main === module) buildSetup({ legacy: process.argv.includes('--legacy') }).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { buildSetup };
