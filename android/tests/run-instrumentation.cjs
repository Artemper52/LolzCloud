'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const appVersion = JSON.parse(fs.readFileSync(path.join(project, 'version.json'), 'utf8')).versionName;
const appApk = path.join(project, 'output', 'LolzCloud-Android-' + appVersion + '.apk');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk';
const adb = path.join(sdk, 'platform-tools', 'adb.exe');
function run(args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status) throw result.error || new Error(result.stderr || result.stdout);
  return result.stdout;
}
function phase(name) {
  const output = run(['shell', 'am', 'instrument', '-w', '-e', 'phase', name, 'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.CoreInstrumentation']);
  fs.writeFileSync(path.join(project, 'build', 'instrumentation', name + '-stdout.txt'), output);
  const start = output.indexOf('{'), end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Instrumentation did not return its JSON report: ' + output);
  const report = JSON.parse(output.slice(start, end + 1));
  if (report.status !== 'passed') throw new Error(JSON.stringify(report, null, 2));
  return report;
}
if (run(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1')
  throw new Error('These tests change fixture preferences and may only run on an Android emulator.');
const target = path.join(project, 'output', 'android-verification.json');
const phases = [];
let report;
if (process.argv.includes('--updates-only')) {
  console.log(run(['install', '-r', path.join(project, 'build', 'instrumentation', 'LolzCloud-core-tests.apk')]).trim());
  const updates = phase('updates');
  report = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { target: 'Android emulator', apkReinstalledBetweenPhases: false, phases: [] };
  report.phases = report.phases.filter(p => p.phase !== 'updates').concat(updates);
  report.generatedAt = new Date().toISOString(); report.status = 'passed';
} else {
  console.log(run(['install', '-r', appApk]).trim());
  console.log(run(['install', '-r', path.join(project, 'build', 'instrumentation', 'LolzCloud-core-tests.apk')]).trim());
  phases.push(phase('fresh'));
  run(['shell', 'am', 'force-stop', 'com.lolzcloud.mobile']);
  console.log(run(['install', '-r', appApk]).trim());
  phases.push(phase('restore'));
  if (process.argv.includes('--with-updates')) phases.push(phase('updates'));
  report = { target: 'Android emulator', generatedAt: new Date().toISOString(), apkReinstalledBetweenPhases: true, status: 'passed', phases };
}
fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
console.log('PASS: ' + report.phases.reduce((n, phase) => n + phase.checks.length, 0) + ' real Android checks. Report: ' + target);
