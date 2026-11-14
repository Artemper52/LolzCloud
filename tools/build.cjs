'use strict';
const path = require('node:path');
const root = path.resolve(__dirname, '..');

async function main() {
  require('./prepare.cjs').prepare();
  await require('./build-session-helper.cjs').buildSessionHelper();
  const { packager } = await import('@electron/packager');
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const asar = await import('@electron/asar');
  const metadata = require('../package.json');
  const legacy = process.argv.includes('--legacy');
  const config = require('../config/app.json');
  if (config.discordApplicationId && !/^[1-9]\d{16,21}$/.test(config.discordApplicationId)) throw new Error('Invalid Discord application ID in config/app.json.');
  if (require('../source/package.json').version !== metadata.version) throw new Error('Application versions do not match.');
  const platform = process.env.LOLZCLOUD_BUILD_PLATFORM || process.platform;
  const arch = process.env.LOLZCLOUD_BUILD_ARCH || process.arch;
  const output = path.resolve(process.env.LOLZCLOUD_BUILD_OUTPUT || path.join(root, 'dist'));
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64', 'ia32'].includes(arch)) throw new Error('Unsupported build target.');
  if (platform === 'linux' && !['x64', 'arm64'].includes(arch)) throw new Error('Linux builds support x64 and arm64.');
  const directories = await packager({
    dir: root, out: output, name: 'LolzCloud', executableName: 'LolzCloud',
    platform, arch, overwrite: true, asar: { unpack: '**/ffmpeg-static/ffmpeg{,.exe}' }, prune: true,
    electronVersion: legacy ? '22.3.27' : require('electron/package.json').version,
    download: process.env.LOLZCLOUD_ELECTRON_CACHE ? { cacheRoot: path.resolve(process.env.LOLZCLOUD_ELECTRON_CACHE) } : undefined,
    tmpdir: process.env.LOLZCLOUD_BUILD_TEMP ? path.resolve(process.env.LOLZCLOUD_BUILD_TEMP) : undefined,
    afterCopy: [require('./linux-artifacts.cjs').prepareLinuxFfmpeg],
    appVersion: metadata.version, appBundleId: 'app.lolzcloud.desktop',
    appCopyright: 'Copyright (c) 2026 Artemper (artemper_lzt) and LolzCloud contributors. See LICENSE and THIRD_PARTY_NOTICES.md.',
    icon: path.join(root, 'source/app/lib/assets', platform === 'linux' ? 'logo.png' : 'icon.ico'),
    win32metadata: { CompanyName: 'Artemper (artemper_lzt)', FileDescription: 'LolzCloud', ProductName: 'LolzCloud', OriginalFilename: 'LolzCloud.exe' },
    ignore: [/^\/(dist|\.build|\.git|tests|tools|docs|server|android|ios|website|telegram|music|\.github|backups|portable|\.diagnostic)(\/|$)/,
      /\.lnk$/, /\.log$/, /^\/source\/Downloads(\/|$)/],
  });
  for (const directory of directories) {
    if (platform === 'win32') {
      require('node:fs').writeFileSync(path.join(directory, 'lolzcloud-portable.json'), JSON.stringify({ appId: 'app.lolzcloud.desktop', version: metadata.version, legacy }, null, 2));
      require('node:fs').writeFileSync(path.join(directory, 'resources/app-update.yml'), 'provider: generic\nurl: https://github.com/Artemper52/LolzCloud/releases/latest/download/\nchannel: ' + (legacy ? 'legacy' : 'latest') + '\nupdaterCacheDirName: ' + (legacy ? 'lolzcloud-legacy-updater' : 'lolzcloud-updater') + '\n');
    }
    const binary = platform === 'win32' ? path.join(directory, 'LolzCloud.exe')
      : platform === 'darwin' ? path.join(directory, 'LolzCloud.app') : path.join(directory, 'LolzCloud');
    await flipFuses(binary, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      ...(!legacy ? { [FuseV1Options.EnableCookieEncryption]: true } : {}),
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      ...(!legacy ? { [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: platform !== 'linux' } : {}),
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    const archive = platform === 'darwin' ? path.join(directory, 'LolzCloud.app/Contents/Resources/app.asar') : path.join(directory, 'resources/app.asar');
    const host = asar.extractFile(archive, path.normalize('source/app/index.html')).toString();
    if (/<script[^>]*src=["']https?:/i.test(host)) throw new Error('Remote script in the privileged host window.');
    for (const file of ['source/main.js', 'source/integrations/lolzteam/index.cjs', 'config/app.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      if (!asar.extractFile(archive, path.normalize(file)).length) throw new Error('Missing ' + file);
    }
    console.log('Built: ' + binary);
    if (platform === 'linux') await require('./linux-artifacts.cjs').archiveLinux(directory, arch, metadata.version);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
