'use strict';
// The coordinator installs production. This runner installs only instrumentation
// and refuses a different installed version/hash or a physical/unowned device.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2), option = (key, fallback = '') => { const index = argv.indexOf(key); return index < 0 ? fallback : argv[index + 1] || ''; };
const expectedVersion = option('--expected-version'), expectedSha = option('--expected-sha').toLowerCase(), expectedCode = option('--expected-code');
if (!/^\d+\.\d+\.\d+$/.test(expectedVersion) || !/^[a-f0-9]{64}$/.test(expectedSha) || expectedCode && !/^\d+$/.test(expectedCode)) throw Error('Pass --expected-version, --expected-sha and optionally --expected-code from the coordinator-built APK.');
const sdk = process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk', adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const project = path.resolve(__dirname, '..'), serial = option('--serial', 'emulator-5554'), expectedAvd = option('--expected-avd', 'LolzCloud');
if (!/^emulator-\d+$/.test(serial)) throw Error('Only the explicitly owned emulator is allowed.');
const output = option('--output', process.env.LOLZCLOUD_AUDIO_COMFORT_OUTPUT || 'D:/LolzCloud-Android-Toolchain/audio-settings-review');
function run(args) { const result = spawnSync(adb, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: 150000, maxBuffer: 4 * 1024 * 1024 }); if (result.error || result.status !== 0) throw result.error || Error(result.stdout + result.stderr); return result.stdout; }
if (run(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1' || run(['shell', 'getprop', 'sys.boot_completed']).trim() !== '1') throw Error('The designated task emulator must already be booted.');
if (run(['emu', 'avd', 'name']).split(/\r?\n/)[0].trim() !== expectedAvd) throw Error('Unexpected AVD identity; do not touch a personal emulator.');
const installed = run(['shell', 'pm', 'path', 'com.lolzcloud.mobile']).trim().replace(/^package:/, '');
if (!/^\/data\/app\/[A-Za-z0-9_~+=./-]+\/base\.apk$/.test(installed)) throw Error('Unexpected installed package path.');
const before = run(['shell', 'sha256sum', installed]).trim().split(/\s+/)[0];
if (before !== expectedSha) throw Error('Installed production SHA differs from the explicitly expected candidate.');
const packageInfo = run(['shell', 'dumpsys', 'package', 'com.lolzcloud.mobile']);
if (packageInfo.match(/versionName=([^\s]+)/)?.[1] !== expectedVersion) throw Error('Installed production version differs from the expected candidate.');
fs.mkdirSync(output, { recursive: true });
run(['install', '-r', option('--test-apk', path.join(project, 'build/instrumentation/LolzCloud-core-tests.apk'))]);
run(['shell', 'am', 'force-stop', 'com.lolzcloud.mobile']);
const runId = crypto.randomUUID(), stdout = run(['shell', 'am', 'instrument', '-w', '-e', 'runId', runId, 'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.AudioComfortInstrumentation']);
fs.writeFileSync(path.join(output, 'instrumentation-stdout.txt'), stdout);
const remote = '/sdcard/Android/data/com.lolzcloud.mobile/files/audio-comfort-review/', report = JSON.parse(run(['exec-out', 'cat', remote + 'android-audio-comfort-test.json']));
if (report.runId !== runId || report.version !== expectedVersion || report.apkSha256 !== expectedSha || expectedCode && report.versionCode !== Number(expectedCode)) throw Error('The report does not belong to this exact installed candidate/run.');
const after = run(['shell', 'sha256sum', installed]).trim().split(/\s+/)[0];
if (after !== before) throw Error('Installed production changed during the test.');
report.generatedAt = new Date().toISOString(); report.emulator = serial; report.avd = expectedAvd; report.productionShaUnchanged = true;
for (const name of report.screenshots || []) if (/^[a-z0-9-]+\.png$/.test(name)) run(['pull', remote + name, path.join(output, name)]);
const value = JSON.stringify(report, null, 2) + '\n'; fs.writeFileSync(path.join(output, 'android-audio-comfort-verification.json'), value); fs.writeFileSync(path.join(project, 'output/android-audio-comfort-verification.json'), value);
if (report.status !== 'passed' || !report.preferencesRestored) throw Error(report.error || report.cleanupError || report.stopError || 'Audio comfort checks or preference restoration failed.');
console.log('PASS: ' + report.checks.length + ' actual audio comfort checks; report ' + output);
