'use strict';
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process'), yazl = require('yazl');
const roots = ['.gitattributes', '.gitignore', '.github', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'source', 'tests', 'tools', 'config', 'docs', 'licenses', 'server'];
async function sourceArchive({ root = path.resolve(__dirname, '..'), filename = process.env.LOLZCLOUD_SOURCE_OUTPUT || path.join(root, 'dist/LolzCloud-source.zip') } = {}) {
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean))].sort();
  if (!files.includes('package.json') || !files.includes('source/main.js')) throw Error('Expected the LolzCloud source repository.');
  const archive = new yazl.ZipFile();
  for (const name of files) {
    if (path.isAbsolute(name) || name.includes('\\') || name.split('/').includes('..') || !roots.some(item => name === item || name.startsWith(item + '/'))) throw Error('Unexpected source archive path.');
    const file = path.join(root, name); if (!fs.existsSync(file)) continue;
    if (!fs.lstatSync(file).isFile()) throw Error('Source archives cannot include symbolic links.');
    archive.addFile(file, name, { mtime: new Date('2026-11-05T00:00:00Z'), mode: 0o100644 });
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true }); const output = fs.createWriteStream(filename + '.tmp');
  await new Promise((resolve, reject) => { archive.outputStream.pipe(output); output.on('close', resolve); output.on('error', reject); archive.outputStream.on('error', reject); archive.end(); });
  fs.renameSync(filename + '.tmp', filename); return filename;
}
if (require.main === module) sourceArchive().then(filename => console.log('Source archive: ' + filename)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { sourceArchive };
