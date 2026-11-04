'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-session-ui-'));
execFile(require('electron'), [path.join(__dirname, '../tests/session-transfer-ui.cjs')], { windowsHide: true, timeout: 45000, maxBuffer: 262144, env: { ...process.env, LOLZCLOUD_SESSION_TEST_PROFILE: directory } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(stderr || error.message); process.exitCode = 1; }
  const target = path.resolve(directory); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('LolzCloud-session-ui-')) fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
