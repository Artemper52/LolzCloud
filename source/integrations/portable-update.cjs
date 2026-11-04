'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const REPOSITORY = 'https://github.com/Artemper52/LolzCloud/releases/download/';
const MIRROR = 'https://lolzcloud.com/downloads/';
function newer(candidate, current) { const parse = value => { const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/); return match ? match.slice(1).map(Number) : null; }; const left = parse(candidate), right = parse(current); if (!left || !right) return false; for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index]; return false; }
function releaseAsset(release, name) { const row = release.assets?.find(row => row.name === name), expected = REPOSITORY + release.tag_name + '/' + name; if (!row || row.browser_download_url !== expected || !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > 600 * 1024 * 1024) throw new Error('В релизе нет проверенного файла ' + name + '.'); return row; }
function digestFrom(text, name) { const line = String(text).split(/\r?\n/).map(line => line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)).find(value => value && value[2] === name); if (!line) throw new Error('Контрольная сумма архива отсутствует в релизе.'); return line[1].toLowerCase(); }
async function download(asset, expected, destination, fetcher = fetch, onProgress = () => {}) {
  if (![REPOSITORY, MIRROR].some(prefix => asset.browser_download_url.startsWith(prefix))) throw new Error('Неизвестный источник обновления.');
  const response = await fetcher(asset.browser_download_url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw new Error('Не удалось скачать обновление.');
  if (response.url && (new URL(response.url).protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'lolzcloud.com'].includes(new URL(response.url).hostname))) throw new Error('Обновление перенаправлено на неизвестный сервер.');
  const file = await fs.promises.open(destination, 'wx', 0o600), hash = crypto.createHash('sha256'); let bytes = 0;
  try { for await (const chunk of response.body) { bytes += chunk.length; if (bytes > asset.size || bytes > 600 * 1024 * 1024) throw new Error('Размер обновления не совпадает с релизом.'); hash.update(chunk); let offset = 0; while (offset < chunk.length) offset += (await file.write(chunk, offset, chunk.length - offset)).bytesWritten; onProgress(bytes / asset.size * 100); } await file.sync(); if (bytes !== asset.size || hash.digest('hex') !== expected) throw new Error('Контрольная сумма обновления не совпала. Файл не будет запущен.'); }
  catch (error) { await file.close(); try { await fs.promises.unlink(destination); } catch { /* A failed download must never become an executable update. */ } throw error; }
  await file.close();
}
async function extract(archive, destination) {
  fs.mkdirSync(destination, { recursive: true }); const targetRoot = path.resolve(destination); let count = 0, bytes = 0;
  await new Promise((resolve, reject) => { yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error) { reject(error); return; } let failed = false;
    const fail = error => { if (failed) return; failed = true; zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', () => { if (!failed) resolve(); });
    zip.on('entry', entry => { void (async () => {
      const name = entry.fileName.replace(/\\/g, '/'); if (!/^LolzCloud-win32-x64(?:\/|$)/.test(name) || name.split('/').some(part => part === '..' || part.includes(':') || part.includes('\0')) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('Недопустимый путь внутри обновления.');
      const relative = name.split('/').slice(1).join('/'); if (!relative) { zip.readEntry(); return; }
      const target = path.resolve(targetRoot, relative); if (!target.startsWith(targetRoot + path.sep)) throw new Error('Обновление выходит за свою папку.');
      if (++count > 8000 || (bytes += entry.uncompressedSize) > 1500 * 1024 * 1024) throw new Error('Архив обновления слишком большой.');
      if (name.endsWith('/')) fs.mkdirSync(target, { recursive: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); const source = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream))); await pipeline(source, fs.createWriteStream(target, { flags: 'wx' })); }
      zip.readEntry();
    })().catch(fail); }); zip.readEntry();
  }); });
  for (const name of ['LolzCloud.exe', 'resources/app.asar', 'lolzcloud-portable.json']) if (!fs.statSync(path.join(targetRoot, name)).isFile()) throw new Error('Обновление не содержит полноценного приложения.');
  const marker = JSON.parse(fs.readFileSync(path.join(targetRoot, 'lolzcloud-portable.json'), 'utf8')); if (marker.appId !== 'app.lolzcloud.desktop') throw new Error('В архиве находится другое приложение.');
  return targetRoot;
}
module.exports = { newer, releaseAsset, digestFrom, download, extract, REPOSITORY, MIRROR };
