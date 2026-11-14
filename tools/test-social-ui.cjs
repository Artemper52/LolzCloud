'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process');
const temporaryRoot = process.env.LOLZCLOUD_TEST_TEMP || os.tmpdir();
const directory = fs.mkdtempSync(path.join(temporaryRoot, 'LolzCloud-social-ui-'));
const output = process.env.LOLZCLOUD_SOCIAL_TEST_OUTPUT || path.join(temporaryRoot, 'LolzCloud-social-ui-results');
execFile(require('electron'), [path.join(__dirname, '../tests/social-ui.cjs')], { windowsHide: true, timeout: 100000, maxBuffer: 262144,
  env: { ...process.env, LOLZCLOUD_SOCIAL_TEST_PROFILE: directory, LOLZCLOUD_SOCIAL_TEST_OUTPUT: output } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(stderr || error.message); process.exitCode = 1; }
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) === path.resolve(temporaryRoot) && path.basename(resolved).startsWith('LolzCloud-social-ui-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
