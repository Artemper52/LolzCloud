'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
async function main() {
  const directory = path.resolve(process.argv[2] || 'dist/installers'), version = require('../package.json').version, tag = 'v' + version, base = 'https://github.com/Artemper52/LolzCloud/releases/download/' + tag + '/';
  for (const legacy of [false, true]) {
    const archiveName = 'LolzCloud-' + version + (legacy ? '-win7-legacy-x64.zip' : '-win-x64.zip'), setupName = 'LolzCloud-' + version + (legacy ? '-win7-legacy' : '-win-x64') + '-Setup.exe';
    const asset = async name => { const file = path.join(directory, name), hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return { name, url: base + name, size: fs.statSync(file).size, sha256: hash.digest('hex') }; };
    const value = { version, tag, channel: legacy ? 'legacy' : 'latest', archive: await asset(archiveName), setup: await asset(setupName) }; fs.writeFileSync(path.join(directory, legacy ? 'update-legacy.json' : 'update.json'), JSON.stringify(value, null, 2));
  }
  console.log('Update manifests generated for Windows and Windows 7 Legacy.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
