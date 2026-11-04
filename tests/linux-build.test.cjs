'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), tar = require('tar');
const { storageAvailable } = require('../source/integrations/secure-storage.cjs');
const { elfArchitecture, archiveLinux } = require('../tools/linux-artifacts.cjs');
test('Linux credentials require an unlocked real keyring and never use basic_text', () => {
  for (const backend of ['basic_text', 'unknown']) assert.equal(storageAvailable({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend }, 'linux'), false);
  for (const backend of ['gnome_libsecret', 'kwallet5', 'kwallet6']) assert.equal(storageAvailable({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend }, 'linux'), true);
  assert.equal(storageAvailable({ isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux'), false);
  assert.equal(storageAvailable({ isEncryptionAvailable: () => true }, 'win32'), true);
});
test('portable Linux tar preserves executable modes when cross-built from Windows', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-tar-')), target = path.join(directory, 'LolzCloud-linux-x64');
  const elf = Buffer.alloc(32); elf.write('ELF', 1); elf[0] = 0x7f; elf[5] = 1; elf.writeUInt16LE(62, 18);
  const binary = path.join(target, 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'); fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, elf); fs.writeFileSync(path.join(target, 'LolzCloud'), elf); fs.writeFileSync(path.join(target, 'resources/app.asar'), 'fixture');
  const version = 'fixture-' + process.pid, archive = path.resolve('dist', `LolzCloud-${version}-linux-x64.tar.gz`);
  try {
    assert.equal(elfArchitecture(binary), 'x64'); await archiveLinux(target, 'x64', version);
    const entries = new Map(); await tar.t({ file: archive, onReadEntry(entry) { entries.set(entry.path, entry.mode); entry.resume(); } });
    assert.equal(entries.get('LolzCloud-linux-x64/LolzCloud'), 0o755);
    assert.equal(entries.get('LolzCloud-linux-x64/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'), 0o755);
    assert.equal(entries.get('LolzCloud-linux-x64/resources/app.asar'), 0o644);
  } finally {
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('LolzCloud-tar-')) fs.rmSync(directory, { recursive: true, force: true });
    if (path.dirname(archive) === path.resolve('dist') && path.basename(archive).includes('fixture-' + process.pid)) fs.rmSync(archive, { force: true });
  }
});
