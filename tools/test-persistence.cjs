'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const run = promisify(execFile), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-native-persistence-'));
(async () => {
  try { for (const phase of ['save', 'restore']) { const { stdout } = await run(require('electron'), [path.join(__dirname, '../tests/persistence-renderer.cjs')], { windowsHide: true, timeout: 20000, maxBuffer: 64000, env: { ...process.env, LOLZCLOUD_PERSISTENCE_TEST_PROFILE: directory, LOLZCLOUD_PERSISTENCE_TEST_PHASE: phase } }); if (stdout.trim()) process.stdout.write(stdout); } }
  finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('LolzCloud-native-persistence-')) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
})().catch(error => { console.error(error.stderr || error.message); process.exitCode = 1; });
