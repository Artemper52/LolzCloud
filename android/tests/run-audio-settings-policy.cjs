'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), output = process.env.LOLZCLOUD_AUDIO_SETTINGS_CHECK_DIR || (process.platform === 'win32' ? 'D:/LolzCloud-Android-Toolchain/audio-settings-0.1.7/policy' : fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-audio-policy-')));
fs.mkdirSync(output, { recursive: true }); const classes = path.join(output, 'classes'); fs.mkdirSync(classes, { recursive: true });
function run(tool, args) { const binary = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', tool + (process.platform === 'win32' ? '.exe' : '')) : tool; const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 1048576 }); if (result.error || result.status !== 0) throw result.error || Error(result.stdout + result.stderr); return result.stdout; }
const source = path.join(root, 'android/app/src/main/java/com/lolzcloud/mobile');
run('javac', ['--release', '8', '-encoding', 'UTF-8', '-d', classes, ...['AudioEffectsPolicy', 'SleepTimerPolicy'].map(name => path.join(source, name + '.java')), ...['AudioEffectsPolicyTest', 'SleepTimerPolicyTest'].map(name => path.join(__dirname, name + '.java'))]);
const suites = [];
for (const name of ['AudioEffectsPolicyTest', 'SleepTimerPolicyTest']) { const stdout = run('java', ['-cp', classes, 'com.lolzcloud.mobile.' + name]), count = Number(stdout.match(/(\d+) .*behavior checks passed/)?.[1]); if (!count) throw Error('Missing behavior-test success marker'); process.stdout.write(stdout); suites.push({ suite: name, passed: true, checks: count }); }
const report = { status: 'passed', generatedAt: new Date().toISOString(), suites, total: suites.reduce((sum, row) => sum + row.checks, 0), scope: 'Pure JVM production policy with declared rounded/fixed/released/lost-control native driver adapters and dual-clock persistence inputs. No actual AudioEffect, MediaPlayer, device or APK execution.' };
fs.writeFileSync(path.join(output, 'audio-settings-policy-verification.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'android/output/android-audio-settings-policy-verification.json'), JSON.stringify(report, null, 2) + '\n');
