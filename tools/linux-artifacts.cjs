'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tar = require('tar');
const root = path.resolve(__dirname, '..');
const FFMPEG = {
  x64: { binary: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99', readme: '72f4b1b06d419d22ace6e7cc75f06826f90737345aa0b1736158929f4aacc537' },
  arm64: { binary: '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce', readme: 'd6777d2fd276b23f0ac6666fa619e88ffe4826521881c7ff83836e30cb4acec2' },
};
const LICENSE = '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903';
const APPIMAGETOOL = {
  x64: { name: 'x86_64', digest: 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0' },
  arm64: { name: 'aarch64', digest: 'f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158' },
};
function digest(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
async function verifiedDownload(url, filename, expected) {
  if (fs.existsSync(filename) && digest(filename) === expected) return filename;
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Build download failed: ' + response.status + ' ' + url);
  const data = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(data).digest('hex') !== expected) throw new Error('Build dependency checksum mismatch: ' + url);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename + '.tmp', data, { mode: 0o755 });
  fs.renameSync(filename + '.tmp', filename);
  fs.chmodSync(filename, 0o755);
  return filename;
}
function elfArchitecture(filename) {
  const header = Buffer.alloc(20), fd = fs.openSync(filename, 'r');
  try { fs.readSync(fd, header, 0, 20, 0); } finally { fs.closeSync(fd); }
  if (header.subarray(0, 4).toString('hex') !== '7f454c46' || header[5] !== 1) return null;
  return { 62: 'x64', 183: 'arm64' }[header.readUInt16LE(18)] || null;
}
async function prepareLinuxFfmpeg({ buildPath, platform, arch }) {
  if (platform !== 'linux') return;
  if (!FFMPEG[arch]) throw new Error('Linux builds support x64 and arm64.');
  const destination = path.join(buildPath, 'node_modules', 'ffmpeg-static');
  if (!path.resolve(destination).startsWith(path.resolve(buildPath) + path.sep)) throw new Error('Invalid FFmpeg staging path.');
  const cache = path.join(root, '.build', 'linux-vendor', arch), base = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
  for (const [remote, local, hash] of [[`ffmpeg-linux-${arch}`, 'ffmpeg', FFMPEG[arch].binary], [`linux-${arch}.README`, 'ffmpeg.README', FFMPEG[arch].readme], [`linux-${arch}.LICENSE`, 'ffmpeg.LICENSE', LICENSE]]) {
    const cached = await verifiedDownload(base + remote, path.join(cache, local), hash);
    fs.copyFileSync(cached, path.join(destination, local));
  }
  for (const name of ['ffmpeg.exe', 'ffmpeg.exe.README', 'ffmpeg.exe.LICENSE']) fs.rmSync(path.join(destination, name), { force: true });
  fs.chmodSync(path.join(destination, 'ffmpeg'), 0o755);
  if (elfArchitecture(path.join(destination, 'ffmpeg')) !== arch) throw new Error('Incorrect Linux FFmpeg architecture.');
}
function entryMode(entry) {
  if (entry.type === 'Directory') return 0o755;
  if (entry.type === 'SymbolicLink') return 0o777;
  if (entry.type !== 'File') return 0o644;
  return elfArchitecture(entry.absolute) || ['AppRun', 'lolzcloud'].includes(path.basename(entry.path)) ? 0o755 : 0o644;
}
async function archiveLinux(directory, arch, version) {
  if (elfArchitecture(path.join(directory, 'LolzCloud')) !== arch) throw new Error('Incorrect Linux Electron architecture.');
  if (elfArchitecture(path.join(directory, 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')) !== arch) throw new Error('Missing target Linux converter.');
  fs.copyFileSync(path.join(root, 'source/app/lib/assets/logo.png'), path.join(directory, 'lolzcloud.png'));
  fs.writeFileSync(path.join(directory, 'lolzcloud.desktop'), '[Desktop Entry]\nType=Application\nName=LolzCloud\nComment=SoundCloud player with Lolzteam integration\nExec=LolzCloud %U\nIcon=lolzcloud\nTerminal=false\nCategories=AudioVideo;Audio;Music;\nStartupWMClass=LolzCloud\n');
  const filename = path.join(root, 'dist', `LolzCloud-${version}-linux-${arch}.tar.gz`);
  await tar.c({ cwd: path.dirname(directory), file: filename, gzip: true, portable: true, noMtime: true, onWriteEntry(entry) { entry.stat.mode = entryMode(entry); } }, [path.basename(directory)]);
  console.log('Linux archive: ' + filename);
  return filename;
}
module.exports = { root, APPIMAGETOOL, digest, verifiedDownload, elfArchitecture, prepareLinuxFfmpeg, archiveLinux };
