'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk';
const adb = path.join(sdk, 'platform-tools', 'adb.exe');
function run(args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status) throw result.error || new Error(result.stderr || result.stdout);
  return result.stdout;
}
if (run(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1') throw new Error('This test only runs on an emulator.');
const version = JSON.parse(fs.readFileSync(path.join(project, 'version.json'), 'utf8')).versionName;
const apk = path.join(project, 'output', 'LolzCloud-Android-' + version + '.apk');
console.log(run(['install', '-r', apk]).trim());
console.log(run(['install', '-r', path.join(project, 'build', 'instrumentation', 'LolzCloud-core-tests.apk')]).trim());
const output = run(['shell', 'am', 'instrument', '-w', '-e', 'phase', 'configuration', 'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.CoreInstrumentation']);
const start = output.indexOf('{'), end = output.lastIndexOf('}');
if (start < 0 || end < start) throw new Error(output);
const result = JSON.parse(output.slice(start, end + 1));
result.apkSha256 = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
result.generatedAt = new Date().toISOString();
const target = path.join(project, 'output', 'android-configuration-verification.json');
fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
if (result.status !== 'passed') throw new Error(JSON.stringify(result, null, 2));
console.log('PASS: ' + result.checks.length + ' real activity-recreation checks. Report: ' + target);
