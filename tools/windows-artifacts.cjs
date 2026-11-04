'use strict';
const fs = require('node:fs'), path = require('node:path'), { pipeline } = require('node:stream/promises');
async function archive(directory, filename) {
  const { ZipFile } = require('yazl'), zip = new ZipFile(), root = path.resolve(directory);
  function visit(folder, base) { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name), name = base + '/' + entry.name; if (entry.isDirectory()) visit(file, name); else if (entry.isFile()) zip.addFile(file, name); else throw new Error('Unsupported symbolic link in Windows application.'); } }
  visit(root, 'LolzCloud-win32-x64'); const result = pipeline(zip.outputStream, fs.createWriteStream(filename, { flags: 'wx' })); zip.end(); await result; console.log('Portable archive: ' + filename);
}
if (require.main === module) archive(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { archive };
