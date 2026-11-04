'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const appData = process.platform === 'win32' ? process.env.APPDATA
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
if (!appData) throw new Error('Application data directory not found.');
const profile = path.join(appData, 'LolzCloud');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-diagnostics-'));
function cleanup() {
  const target = path.resolve(temporary);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('LolzCloud-diagnostics-')) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
try {
  const localState = path.join(profile, 'Local State');
  if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(temporary, 'Local State'));
  execFile(require('electron'), [path.join(__dirname, 'diagnostic-main.cjs')], {
    windowsHide: true, timeout: 30_000, maxBuffer: 262_144,
    env: { ...process.env, LOLZCLOUD_DIAGNOSTIC_PROFILE: profile, LOLZCLOUD_DIAGNOSTIC_SESSION: temporary },
  }, (error, stdout, stderr) => {
    try {
      if (stdout.trim()) process.stdout.write(stdout);
      if (error) { process.stderr.write(stderr || 'Diagnostic failed.\n'); process.exitCode = 1; }
    } finally { cleanup(); }
  });
} catch (error) { cleanup(); console.error(error.message); process.exitCode = 1; }
