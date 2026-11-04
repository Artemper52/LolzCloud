'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-ui-test-'));
execFile(require('electron'), [path.join(__dirname, '../tests/ui-renderer.cjs')], { windowsHide: true, timeout: 35_000, maxBuffer: 262_144, env: { ...process.env, LOLZCLOUD_UI_TEST_PROFILE: temporary } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(stderr || error.message); process.exitCode = 1; }
  const target = path.resolve(temporary); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('LolzCloud-ui-test-')) fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
