'use strict';
// The root build installs the production APK; this runner only replaces the separate test APK.
const fs = require('node:fs'), path = require('node:path'), { spawn, spawnSync } = require('node:child_process');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk';
const adb = path.join(sdk, 'platform-tools/adb.exe'), serial = 'emulator-5554';
const output = process.env.LOLZCLOUD_CATALOG_TEST_OUTPUT || 'D:/LolzCloud-Android-Toolchain/native-catalog-review';
function command(args, options = {}) { const result = spawnSync(adb, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, ...options }); if (result.error || result.status) throw result.error || new Error(result.stderr || result.stdout || 'adb failed'); return result.stdout; }
async function main() {
  if (command(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1' || command(['shell', 'getprop', 'sys.boot_completed']).trim() !== '1') throw new Error('Only a booted emulator-5554 is permitted.');
  fs.mkdirSync(output, { recursive: true });
  const testApk = path.join(__dirname, '../build/instrumentation/LolzCloud-core-tests.apk');
  if (!fs.existsSync(testApk)) throw new Error('Build the separate instrumentation APK first.');
  process.stdout.write(command(['install', '-r', testApk], { timeout: 60000 }));
  const target = fs.createWriteStream(path.join(output, 'instrumentation-stdout.txt'));
  await new Promise((resolve, reject) => {
    const child = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', 'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.CatalogInstrumentation'], { windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Catalog instrumentation exceeded six minutes.')); }, 360000);
    child.stdout.on('data', data => { target.write(data); process.stdout.write(data); }); child.stderr.on('data', data => { target.write(data); process.stderr.write(data); });
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); target.end(); code ? reject(new Error('am instrument failed: ' + code)) : resolve(); });
  });
  const json = command(['exec-out', 'cat', '/sdcard/Android/data/com.lolzcloud.mobile/files/native-catalog/android-catalog-test.json']);
  const report = JSON.parse(json); fs.writeFileSync(path.join(output, 'android-catalog-verification.json'), JSON.stringify(report, null, 2) + '\n');
  for (const file of report.screenshots || []) {
    if (!/^\/(?:storage\/emulated\/0|sdcard)\/Android\/data\/com\.lolzcloud\.mobile\/files\/native-catalog\/[a-z-]+\.png$/.test(file)) throw new Error('Unexpected screenshot path.');
    command(['pull', file, path.join(output, path.basename(file))]);
  }
  if (report.status !== 'passed') throw new Error(report.error || report.cleanupError || 'Catalog checks failed.');
  console.log('PASS: native catalog ' + report.checks.length + ' checks, APK ' + report.apkSha256 + '. Artifacts: ' + output);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
