'use strict';
const path = require('node:path'), fs = require('node:fs');
async function main() {
  if (process.platform !== 'win32') throw new Error('Build Windows Setup on Windows.');
  const legacy = process.argv.includes('--legacy'), { build, Platform, Arch } = require('electron-builder'), root = path.resolve(__dirname, '..'), metadata = require('../package.json');
  const directory = path.resolve(process.env.LOLZCLOUD_SETUP_APP || path.join(root, 'dist', legacy ? 'LolzCloud-legacy-win32-x64' : 'LolzCloud-win32-x64'));
  if (!fs.existsSync(path.join(directory, 'LolzCloud.exe'))) throw new Error('Build the application before creating Setup: ' + directory);
  const output = path.resolve(process.env.LOLZCLOUD_SETUP_OUTPUT || path.join(root, 'dist', 'installers'));
  const files = await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), prepackaged: directory, publish: 'never', effectiveOptionComputed: async ([defines]) => { if (defines.PRODUCT_FILENAME !== 'LolzCloud' || defines.APP_FILENAME !== (legacy ? 'lolzcloud-legacy' : 'lolzcloud')) throw new Error('Installer executable or application directory does not match the packaged files.'); return false; }, config: {
    appId: legacy ? 'app.lolzcloud.desktop.legacy' : 'app.lolzcloud.desktop', productName: legacy ? 'LolzCloud Legacy' : 'LolzCloud',
    executableName: 'LolzCloud', extraMetadata: { name: legacy ? 'lolzcloud-legacy' : 'lolzcloud' },
    artifactName: 'LolzCloud-' + metadata.version + (legacy ? '-win7-legacy' : '-win-x64') + '-Setup.${ext}',
    directories: { output }, win: { icon: path.join(root, 'source/app/lib/assets/icon.ico'), signAndEditExecutable: false },
    publish: [{ provider: 'generic', url: 'https://github.com/Artemper52/LolzCloud/releases/latest/download/', channel: legacy ? 'legacy' : 'latest' }],
    nsis: { oneClick: true, perMachine: false, allowElevation: false, createDesktopShortcut: 'always', createStartMenuShortcut: true, shortcutName: legacy ? 'LolzCloud Legacy' : 'LolzCloud', uninstallDisplayName: legacy ? 'LolzCloud Legacy' : 'LolzCloud', runAfterFinish: true, deleteAppDataOnUninstall: false, installerIcon: path.join(root, 'source/app/lib/assets/icon.ico'), uninstallerIcon: path.join(root, 'source/app/lib/assets/icon.ico'), installerLanguages: ['ru_RU', 'en_US'], include: path.join(root, 'tools', legacy ? 'installer-legacy.nsh' : 'installer.nsh') }
  } });
  files.forEach(file => console.log('Installer: ' + file));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
