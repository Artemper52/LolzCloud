'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const project = path.resolve(__dirname, '..');
const repository = path.resolve(project, '..');
const { files } = require('../tools/sync-room-assets.cjs');
const version = JSON.parse(fs.readFileSync(path.join(project, 'version.json'), 'utf8')).versionName;
const apk = process.argv[2] ? path.resolve(process.argv[2]) : path.join(project, 'output', 'LolzCloud-Android-' + version + '.apk');
const expected = new Map(files.map(([source, name]) => ['assets/room-client/' + name, path.join(repository, source)]));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const assets = [];
  await new Promise((resolve, reject) => {
    // Inspect the actual ZIP name bytes. yauzl's default mode rewrites Windows
    // backslashes to '/', which previously concealed APKs unreadable by Android.
    yauzl.open(apk, { lazyEntries: true, decodeStrings: false, strictFileNames: true }, (error, archive) => {
      if (error) return reject(error);
      archive.on('error', reject);
      archive.on('end', resolve);
      archive.on('entry', entry => {
        const rawName = entry.fileNameRaw || entry.fileName;
        const name = Buffer.isBuffer(rawName) ? rawName.toString('utf8') : String(rawName);
        if (name.includes('\\')) return reject(new Error('APK ZIP entry contains a Windows backslash: ' + name));
        if (name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.'))
          return reject(new Error('APK ZIP entry has a non-canonical path: ' + name));
        if (name.endsWith('/')) return archive.readEntry();
        if (!name.startsWith('assets/room-client/')) return archive.readEntry();
        const source = expected.get(name);
        if (!source) return reject(new Error('Unexpected bundled room file: ' + name));
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            const actual = Buffer.concat(chunks), original = fs.readFileSync(source);
            if (!actual.equals(original)) return reject(new Error('APK room asset differs from current source: ' + name));
            assets.push({ path: name, bytes: actual.length, sha256: sha256(actual) });
            expected.delete(name);
            archive.readEntry();
          });
        });
      });
      archive.readEntry();
    });
  });
  if (expected.size) throw new Error('APK is missing bundled room assets: ' + [...expected.keys()].join(', '));
  const report = { status: 'passed', generatedAt: new Date().toISOString(), apk: path.basename(apk), apkSha256: sha256(fs.readFileSync(apk)),
    assetCount: assets.length, canonicalRawZipPaths: true, sourceBytesMatch: true, assets };
  const target = path.join(project, 'output', 'android-room-assets-verification.json');
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: ' + assets.length + ' bundled room assets match their source bytes. Report: ' + target);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
