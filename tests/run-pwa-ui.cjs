'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process');
const root = process.env.LOLZCLOUD_TEST_TEMP || os.tmpdir(), output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT;
if (!output) throw new Error('LOLZCLOUD_PWA_TEST_OUTPUT must name an isolated output directory.');
fs.mkdirSync(root, { recursive: true }); const profile = fs.mkdtempSync(path.join(root, 'LolzCloud-pwa-ui-'));
const suite = { login: 'pwa-login-ui.cjs', website: 'website-ui.cjs', lyrics: 'pwa-lyrics-ui.cjs', imports: 'pwa-imports-ui.cjs', idb: 'pwa-idb-ui.cjs' }[process.env.LOLZCLOUD_PWA_TEST_SUITE] || 'pwa-ui.cjs';
execFile(require('electron'), [path.join(__dirname, suite)], { windowsHide: true, timeout: 120000, maxBuffer: 262144, env: { ...process.env, LOLZCLOUD_PWA_TEST_PROFILE: profile } }, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout); if (error) { console.error(stderr || error.message); process.exitCode = 1; }
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) === path.resolve(root) && path.basename(resolved).startsWith('LolzCloud-pwa-ui-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
