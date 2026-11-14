'use strict';
// Exercise real Settings + Package Installer, only on the explicitly selected local emulator.
// The newer APK is never installed: the runner presses Cancel and verifies the current baseline remains.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk';
const adb = path.join(sdk, 'platform-tools', 'adb.exe');
const serial = 'emulator-5554';
const version = JSON.parse(fs.readFileSync(path.join(project, 'version.json'), 'utf8'));
const mainApk = path.join(project, 'output', 'LolzCloud-Android-' + version.versionName + '.apk');
const fixtureDirectory = path.join(project, 'build', 'update-fixtures', 'current');
const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, 'metadata.json'), 'utf8'));
const testApk = path.join(project, 'build', 'instrumentation', 'LolzCloud-core-tests.apk');
const outputFile = path.join(project, 'output', 'android-installer-verification.json');
function run(args) {
  const result = spawnSync(adb, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status) throw result.error || new Error(result.stderr || result.stdout);
  return result.stdout;
}
function installedVersion() {
  const text = run(['shell', 'dumpsys', 'package', 'com.lolzcloud.mobile']);
  const code = text.match(/\bversionCode=(\d+)/), name = text.match(/\bversionName=([^\s]+)/);
  return code && name ? { versionCode: Number(code[1]), versionName: name[1] } : null;
}
if (!fixtures.fixtureOnly || !fixtures.neverInstallNewerApk || fixtures.current.versionName !== version.versionName || fixtures.current.versionCode !== version.versionCode)
  throw new Error('Build updater fixtures for the current version.json before running the installer checks.');
const apkHash = crypto.createHash('sha256').update(fs.readFileSync(mainApk)).digest('hex');
if (apkHash !== fixtures.current.sha256) throw new Error('Production APK changed after updater fixture generation; regenerate fixtures and instrumentation.');
if (run(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1') throw new Error('Installer checks require emulator-5554 and never run on a physical device.');
const installedBefore = installedVersion();
if (installedBefore && (installedBefore.versionCode > version.versionCode || installedBefore.versionCode === version.versionCode && installedBefore.versionName !== version.versionName))
  throw new Error('Refusing to replace a newer or mismatched installed baseline; this runner never downgrades.');
const permissionBefore = run(['shell', 'appops', 'get', 'com.lolzcloud.mobile', 'REQUEST_INSTALL_PACKAGES']).trim();
const report = { target: serial, generatedAt: new Date().toISOString(), apkSha256: apkHash, baseline: version, offeredFixture: { versionName: fixtures.next.versionName, versionCode: fixtures.next.versionCode, sha256: fixtures.next.sha256 },
  installedBefore, permissionBefore, newerApkInstalled: false, status: 'failed' };
try {
  console.log(run(['install', '-r', mainApk]).trim());
  console.log(run(['install', '-r', testApk]).trim());
  const output = run(['shell', 'am', 'instrument', '-w', '-e', 'phase', 'installer', 'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.CoreInstrumentation']);
  fs.writeFileSync(path.join(project, 'build', 'instrumentation', 'installer-stdout.txt'), output);
  const start = output.indexOf('{'), end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Instrumentation returned no report: ' + output);
  report.phase = JSON.parse(output.slice(start, end + 1));
  report.status = report.phase.status;
  if (report.status !== 'passed') throw new Error(report.phase.error || 'Installer integration checks failed');
} catch (error) {
  report.status = 'failed'; report.error = error.message;
} finally {
  // Restore a denied source even if a UI assertion or instrumentation process failed.
  try { run(['shell', 'appops', 'set', 'com.lolzcloud.mobile', 'REQUEST_INSTALL_PACKAGES', 'deny']);
    report.permissionAfter = run(['shell', 'appops', 'get', 'com.lolzcloud.mobile', 'REQUEST_INSTALL_PACKAGES']).trim();
    report.permissionRestoredToDeny = /REQUEST_INSTALL_PACKAGES: deny/.test(report.permissionAfter);
    if (!report.permissionRestoredToDeny) { report.cleanupError = 'Install source permission was not returned to deny'; report.status = 'failed'; } }
  catch (error) { report.cleanupError = error.message; report.status = 'failed'; }
  try {
    report.installedAfter = installedVersion();
    report.baselinePreserved = !!report.installedAfter && report.installedAfter.versionCode === version.versionCode && report.installedAfter.versionName === version.versionName;
    report.newerApkInstalled = !!report.installedAfter && report.installedAfter.versionCode >= fixtures.next.versionCode;
    if (!report.baselinePreserved || report.newerApkInstalled) { report.status = 'failed'; report.cleanupError = 'The original baseline was not preserved after Cancel'; }
  } catch (error) { report.cleanupError = error.message; report.status = 'failed'; }
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
}
if (report.status !== 'passed') { console.error('FAIL: ' + report.error + '\nReport: ' + outputFile); process.exitCode = 1; }
else console.log('PASS: ' + report.phase.checks.length + ' installer integration checks. Report: ' + outputFile);
