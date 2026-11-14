'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process');
if (!process.env.LOLZCLOUD_ROOMS_TEST_OUTPUT) throw Error('LOLZCLOUD_ROOMS_TEST_OUTPUT must name an isolated artifact directory.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-rooms-mobile-'));
execFile(require('electron'), [path.join(__dirname, '../tests/rooms-mobile-ui.cjs')], { windowsHide: true, timeout: 125000, maxBuffer: 262144, env: { ...process.env, LOLZCLOUD_ROOMS_TEST_PROFILE: profile } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(stderr || error.message); process.exitCode = 1; }
  const resolved = path.resolve(profile); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-rooms-mobile-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
