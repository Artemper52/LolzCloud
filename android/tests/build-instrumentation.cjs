'use strict';
// Build a separate test APK. Production APK never includes these fixtures or instrumentation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const repo = path.resolve(project, '..');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk';
const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot';
const build = path.join(project, 'build', 'instrumentation');
const tools = path.join(sdk, 'build-tools', '36.0.0');
const androidJar = path.join(sdk, 'platforms', 'android-36', 'android.jar');
const appClasses = path.join(project, 'build', 'classes');
function run(file, args) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status) throw result.error || new Error(path.basename(file) + ' failed: ' + result.status);
}
function java(name) { return path.join(javaHome, 'bin', name + '.exe'); }
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.java') ? [path.join(dir, e.name)] : []); }
for (const dir of ['classes', 'dex', 'assets/fixtures']) fs.mkdirSync(path.join(build, dir), { recursive: true });
const titles = ['Ночной маршрут', 'Тёплый воздух', 'Тихий берег', 'До рассвета'];
const ids = ['night-route', 'warm-air', 'quiet-shore', 'before-dawn'];
const ffmpeg = require(path.join(repo, 'node_modules', 'ffmpeg-static'));
for (let i = 0; i < ids.length; i++) {
  const file = path.join(build, 'assets', 'fixtures', ids[i] + '.mp3');
  if (!fs.existsSync(file)) run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '40', '-c:a', 'libmp3lame', '-b:a', '96k', '-metadata', 'title=' + titles[i], '-metadata', 'artist=LolzCloud · демо', '-metadata', 'album=Generated Android test fixtures', '-metadata', 'comment=Silent generated fixture; not a commercial song', '-y', file]);
}
fs.writeFileSync(path.join(build, 'assets', 'fixtures', 'night-route-lyrics.lrc'), '[ar:LolzCloud · демо]\n[ti:Ночной маршрут]\n[00:00.00]Демонстрационный текст\n[00:08.00]Тихий город за окном\n[00:16.00]Музыка идёт со мной\n[00:24.00]Впереди ещё дорога\n[00:32.00]Этот ритм — только мой\n[00:39.00]До рассвета\n');
const fixtureDirectory = path.join(project, 'build', 'update-fixtures', 'current');
const fixtureMetadata = path.join(fixtureDirectory, 'metadata.json');
const bundledUpdates = path.join(build, 'assets', 'updates');
const updateNames = ['current.apk', 'next.apk', 'wrong-signer.apk', 'metadata.json'];
if (fs.existsSync(fixtureMetadata)) {
  const metadata = JSON.parse(fs.readFileSync(fixtureMetadata, 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(project, 'version.json'), 'utf8'));
  if (!metadata.fixtureOnly || !metadata.neverInstallNewerApk || metadata.current.versionName !== version.versionName || metadata.current.versionCode !== version.versionCode)
    throw new Error('Updater fixtures do not match the current Android baseline. Run build-update-fixtures.cjs.');
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const production = path.join(project, 'output', 'LolzCloud-Android-' + version.versionName + '.apk');
  if (hash(production) !== metadata.current.sha256) throw new Error('Production APK changed after updater fixture generation. Regenerate fixtures.');
  for (const [name, info] of [['current.apk', metadata.current], ['next.apk', metadata.next], ['wrong-signer.apk', metadata.wrongSigner]])
    if (hash(path.join(fixtureDirectory, name)) !== info.sha256) throw new Error('Updater fixture checksum changed: ' + name);
  fs.mkdirSync(bundledUpdates, { recursive: true });
  for (const name of updateNames) fs.copyFileSync(path.join(fixtureDirectory, name), path.join(bundledUpdates, name));
} else {
  // Never let a previous instrumentation build silently reuse old updater assets.
  for (const name of updateNames) { const file = path.join(bundledUpdates, name); if (fs.existsSync(file)) fs.unlinkSync(file); }
  console.log('Updater fixtures not bundled; run build-update-fixtures.cjs before installer/update phases.');
}
const unsigned = path.join(build, 'unsigned.apk');
run(path.join(tools, 'aapt2.exe'), ['link', '-o', unsigned, '--manifest', path.join(__dirname, 'instrumentation', 'AndroidManifest.xml'), '-I', androidJar, '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', '1', '--version-name', '1']);
const sources = walk(path.join(__dirname, 'instrumentation', 'src'));
const argsFile = path.join(build, 'javac.args');
fs.writeFileSync(argsFile, ['-encoding UTF-8', '-source 8', '-target 8', '-classpath "' + [androidJar, appClasses].map(x => x.replaceAll('\\', '/')).join(';') + '"', '-d "' + path.join(build, 'classes').replaceAll('\\', '/') + '"', ...sources.map(x => '"' + x.replaceAll('\\', '/') + '"')].join('\n'));
run(java('javac'), ['@' + argsFile]);
const classesJar = path.join(build, 'classes.jar');
run(java('jar'), ['cf', classesJar, '-C', path.join(build, 'classes'), '.']);
run(java('java'), ['-cp', path.join(tools, 'lib', 'd8.jar'), 'com.android.tools.r8.D8', '--lib', androidJar, '--classpath', path.join(project, 'build', 'classes.jar'), '--min-api', '26', '--output', path.join(build, 'dex'), classesJar]);
run(java('jar'), ['uf', unsigned, '-C', path.join(build, 'dex'), 'classes.dex', '-C', build, 'assets']);
const aligned = path.join(build, 'aligned.apk');
run(path.join(tools, 'zipalign.exe'), ['-f', '-p', '4', unsigned, aligned]);
const apk = path.join(build, 'LolzCloud-core-tests.apk');
run(java('java'), ['-jar', path.join(tools, 'lib', 'apksigner.jar'), 'sign', '--ks', path.join(os.homedir(), '.android', 'lolzcloud-development.jks'), '--ks-key-alias', 'lolzcloud-development', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', apk, aligned]);
console.log('Instrumentation APK: ' + apk);
