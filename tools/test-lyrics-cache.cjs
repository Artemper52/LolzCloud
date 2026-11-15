'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFile } = require('node:child_process');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-lyric-ui-'));
const output = process.env.LOLZCLOUD_LYRIC_TEST_OUTPUT || path.join(temporary, 'result.json');
if (fs.existsSync(output)) throw new Error('Use a new output file so stale results cannot pass this run.');
execFile(require('electron'), [path.join(__dirname, '../tests/lyrics-cache-ui.cjs')], { windowsHide: true, timeout: 45000, maxBuffer: 262144, env: { ...process.env, LOLZCLOUD_LYRIC_TEST_PROFILE: temporary, LOLZCLOUD_LYRIC_TEST_OUTPUT: output } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(stderr || error.message); process.exitCode = 1; }
  try { if (JSON.parse(fs.readFileSync(output, 'utf8')).status !== 'passed') throw new Error('The UI verification did not pass.'); } catch (resultError) { console.error(resultError.message); process.exitCode = 1; }
  const target = path.resolve(temporary); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('LolzCloud-lyric-ui-')) fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
