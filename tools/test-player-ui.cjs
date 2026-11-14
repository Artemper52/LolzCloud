'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-player-ui-'));
execFile(process.env.LOLZCLOUD_TEST_ELECTRON || require('electron'), [path.join(__dirname, '../tests/player-ui.cjs')], { windowsHide: true, timeout: 90000, maxBuffer: 262144, env: { ...process.env, LOLZCLOUD_PLAYER_TEST_PROFILE: directory } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(error.message); if (stderr) console.error(stderr); process.exitCode = 1; }
  const target = path.resolve(directory); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('LolzCloud-player-ui-')) fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
