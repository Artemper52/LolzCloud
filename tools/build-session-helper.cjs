'use strict';
const fs = require('node:fs'), path = require('node:path'), yazl = require('yazl');
async function buildSessionHelper() {
  const directory = path.join(__dirname, '../source/app/session-transfer');
  for (const firefox of [false, true]) {
    const archive = new yazl.ZipFile(), options = { mtime: new Date('2026-11-05T00:00:00Z'), mode: 0o100644 };
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'helper/manifest.json')));
    if (firefox) manifest.background = { scripts: ['bridge.js', 'background.js'] };
    archive.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 'manifest.json', options);
    for (const name of ['popup.html', 'popup.css', 'popup.js', 'bridge.js', 'background.js', 'content.js']) archive.addFile(path.join(directory, 'helper', name), name, options);
    const filename = path.join(directory, firefox ? 'helper-firefox.zip' : 'helper.zip'), output = fs.createWriteStream(filename + '.tmp');
    await new Promise((resolve, reject) => { archive.outputStream.pipe(output); output.on('close', resolve); output.on('error', reject); archive.outputStream.on('error', reject); archive.end(); });
    fs.renameSync(filename + '.tmp', filename);
  }
}
if (require.main === module) buildSessionHelper().then(() => console.log('Built the SoundCloud-only browser helper.')).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildSessionHelper };
