'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const MIB = 1024 * 1024;

function freeBytes(directory, { statfs = fs.statfsSync, run = execFileSync, platform = process.platform, env = process.env } = {}) {
  if (typeof statfs === 'function') {
    const value = statfs(directory, { bigint: true }), bytes = Number(value.bavail) * Number(value.bsize);
    if (Number.isSafeInteger(bytes) && bytes >= 0) return bytes;
  }
  if (platform !== 'win32') throw new Error('Free space cannot be checked');
  // Electron 22/Node 16 has no statfs. DriveInfo is read-only; the path is data
  // on stdin, never interpolated into executable PowerShell text.
  const executable = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = '$updateVolume = [System.IO.Path]::GetPathRoot([Console]::In.ReadToEnd()); (New-Object System.IO.DriveInfo $updateVolume).AvailableFreeSpace';
  const output = String(run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { input: directory, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4096 })).trim();
  const bytes = /^\d+$/.test(output) ? Number(output) : NaN;
  if (!Number.isSafeInteger(bytes)) throw new Error('Free space cannot be checked');
  return bytes;
}

function writable(directory) {
  const probe = path.join(directory, '.lolzcloud-write-' + crypto.randomBytes(12).toString('hex'));
  let fd;
  try { fd = fs.openSync(probe, 'wx', 0o600); fs.writeSync(fd, Buffer.from('LolzCloud update preflight')); fs.fsyncSync(fd); }
  finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(probe); } }
}
const defaultIo = { realpath: directory => fs.realpathSync(directory), ensure: directory => fs.mkdirSync(directory, { recursive: true }), free: freeBytes, writable };
const within = (parent, child, paths) => { const relative = paths.relative(parent, child); return !relative || !relative.startsWith('..' + paths.sep) && relative !== '..' && !paths.isAbsolute(relative); };
const equal = (left, right) => left.toLowerCase() === right.toLowerCase();

/** Read/check only until a verified outside-the-app directory has been chosen. */
function prepareNsisTemporary({ installationDirectory, tempDirectory, installerSize }, { io = defaultIo, paths = path } = {}) {
  if (!Number.isSafeInteger(installerSize) || installerSize <= 0 || installerSize > 600 * MIB) throw new Error('Некорректный размер установщика обновления.');
  const install = io.realpath(installationDirectory);
  const available = directory => { const value = io.free(directory); if (!Number.isSafeInteger(value) || value < 0) throw new Error('Не удалось проверить свободное место для обновления.'); return value; };
  // Include headroom for NSIS unpacking and replacement on the installation disk.
  const temporaryBytes = Math.max(1536 * MIB, installerSize * 4 + 128 * MIB);
  const installationBytes = Math.max(512 * MIB, installerSize * 3);
  if (available(install) < installationBytes) throw new Error('Недостаточно места на диске установки LolzCloud. Освободи минимум ' + Math.ceil(installationBytes / MIB) + ' МБ и повтори обновление.');
  const fallback = paths.join(paths.dirname(install), '.LolzCloud-update-temp');
  for (const [candidate, alternate] of [[tempDirectory, false], [fallback, true]]) {
    try {
      if (!candidate || !paths.isAbsolute(candidate) || within(install, paths.resolve(candidate), paths)) continue;
      // Only our fixed sibling is created; existing system temp is never moved or cleaned.
      if (alternate) io.ensure(candidate);
      const directory = io.realpath(candidate);
      if (within(install, directory, paths)) continue;
      if (alternate && (!equal(directory, fallback) || !equal(paths.parse(directory).root, paths.parse(install).root))) continue;
      const sameVolume = equal(paths.parse(directory).root, paths.parse(install).root);
      const required = temporaryBytes + (sameVolume ? installationBytes : 0);
      if (available(directory) < required) continue;
      io.writable(directory);
      return Object.freeze({ directory, alternate, requiredBytes: required });
    } catch { /* Try the fixed installation-volume sibling, then keep the app open. */ }
  }
  throw new Error('Недостаточно места или нет доступа к временной папке обновления. Нужны минимум ' + Math.ceil(temporaryBytes / MIB) + ' МБ для распаковки. Освободи место и повтори — приложение не закрыто.');
}

/** NSIS inherits only this process's environment. Failure restores both presence and value. */
function applyTemporaryEnvironment(directory, env = process.env) {
  const previous = Object.fromEntries(['TEMP', 'TMP'].map(key => [key, { exists: Object.hasOwn(env, key), value: env[key] }]));
  const restore = () => { for (const key of ['TEMP', 'TMP']) if (previous[key].exists) env[key] = previous[key].value; else delete env[key]; };
  try { env.TEMP = directory; env.TMP = directory; } catch (error) { restore(); throw error; }
  return restore;
}
function cacheSpaceError(error) {
  if (['ENOSPC', 'ERROR_DISK_FULL'].includes(error?.code) || /ENOSPC|no space left|not enough (?:disk )?space|disk (?:is )?full/i.test(error?.message || ''))
    return new Error('Недостаточно места в кэше обновлений Windows. Освободи место на системном диске и повтори. LolzCloud остаётся открытым.');
  return error;
}
module.exports = { prepareNsisTemporary, applyTemporaryEnvironment, cacheSpaceError, freeBytes };
