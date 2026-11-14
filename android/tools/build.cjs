'use strict';
// Small, dependency-free Android build. Downloads only Google's official SDK archives.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || (process.platform === 'win32' && fs.existsSync('D:/') ? 'D:/LolzCloud-Android-Toolchain/sdk' : path.join(os.homedir(), '.android', 'lolzcloud-sdk'));
const build = path.join(root, 'build');
const output = process.env.LOLZCLOUD_ANDROID_OUTPUT || path.join(root, 'output');
const sourceVersion = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const version = { versionName: process.env.LOLZCLOUD_ANDROID_VERSION_NAME || sourceVersion.versionName, versionCode: Number(process.env.LOLZCLOUD_ANDROID_VERSION_CODE || sourceVersion.versionCode) };
if (!/^\d+\.\d+\.\d+$/.test(version.versionName) || !Number.isSafeInteger(version.versionCode) || version.versionCode < 1) throw new Error('Invalid Android version.json');
const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot';
function run(file, args) {
  const r = spawnSync(file, args, { stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status) throw new Error(path.basename(file) + ' failed: ' + r.status);
}
function javaTool(name) { return path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : '')); }
async function download(url, dest, sha1) {
  if (fs.existsSync(dest) && (!sha1 || crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex') === sha1)) return;
  console.log('Downloading ' + url);
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha1 && crypto.createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('SDK archive checksum mismatch');
  fs.writeFileSync(dest, bytes);
}
async function installSdk() {
  fs.mkdirSync(sdk, { recursive: true });
  const cache = path.join(sdk, 'archives'); fs.mkdirSync(cache, { recursive: true });
  const packages = [
    ['platforms/android-36/android.jar', 'platform-36_r02.zip', '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576', 'platforms/android-36'],
    ['build-tools/36.0.0/aapt2.exe', 'build-tools_r36_windows.zip', 'f16ccffd34de8790dede813a6c7d8e2c11a27b50', 'build-tools/36.0.0'],
    ['platform-tools/adb.exe', 'platform-tools_r37.0.3-win.zip', 'b3fde5239ad89229d5a9178375b81c9887a24172', null]
  ];
  for (const [check, name, hash, dest] of packages) {
    if (fs.existsSync(path.join(sdk, check))) continue;
    const archive = path.join(cache, name); await download('https://dl.google.com/android/repository/' + name, archive, hash);
    const unpack = path.join(cache, name + '.unpacked'); fs.mkdirSync(unpack, { recursive: true });
    run('tar.exe', ['-xf', archive, '-C', unpack]);
    const folder = fs.readdirSync(unpack, { withFileTypes: true }).find(d => d.isDirectory());
    if (!folder) throw new Error('SDK archive has no root directory');
    const target = path.join(sdk, dest || folder.name); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.cpSync(path.join(unpack, folder.name), target, { recursive: true });
    else fs.renameSync(path.join(unpack, folder.name), target);
  }
  console.log('SDK ready: ' + sdk);
}
function walk(dir, extension) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), extension) : e.name.endsWith(extension) ? [path.join(dir, e.name)] : []);
}
async function main() {
  if (process.platform !== 'win32') throw new Error('Use the Gradle project on Linux/macOS, or run this Windows SDK bootstrap on Windows.');
  await installSdk();
  if (process.argv.includes('--sdk-only')) return;
  require('./sync-room-assets.cjs').syncRoomAssets();
  fs.mkdirSync(build, { recursive: true }); fs.mkdirSync(output, { recursive: true });
  const tools = path.join(sdk, 'build-tools/36.0.0');
  const androidJar = path.join(sdk, 'platforms/android-36/android.jar');
  const generated = path.join(build, 'generated'); const classes = path.join(build, 'classes'); const dex = path.join(build, 'dex');
  for (const dir of [generated, classes, dex]) fs.mkdirSync(dir, { recursive: true });
  run(path.join(tools, 'aapt2.exe'), ['compile', '--dir', path.join(root, 'app/src/main/res'), '-o', path.join(build, 'resources.zip')]);
  const unsigned = path.join(build, 'unsigned.apk');
  const manifest = path.join(build, 'AndroidManifest.xml');
  fs.writeFileSync(manifest, fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8').replace('<manifest ', '<manifest package="com.lolzcloud.mobile" '));
  run(path.join(tools, 'aapt2.exe'), ['link', '-o', unsigned, '--manifest', manifest, '-I', androidJar, '--java', generated, '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', String(version.versionCode), '--version-name', version.versionName, path.join(build, 'resources.zip')]);
  const sources = [...walk(path.join(root, 'app/src/main/java'), '.java'), ...walk(generated, '.java')];
  const argsFile = path.join(build, 'javac.args');
  fs.writeFileSync(argsFile, ['-encoding UTF-8', '-source 8', '-target 8', '-classpath "' + androidJar.replaceAll('\\', '/') + '"', '-d "' + classes.replaceAll('\\', '/') + '"', ...sources.map(x => '"' + x.replaceAll('\\', '/') + '"')].join('\n'));
  run(javaTool('javac'), ['@' + argsFile]);
  const jar = path.join(build, 'classes.jar'); run(javaTool('jar'), ['cf', jar, '-C', classes, '.']);
  run(javaTool('java'), ['-cp', path.join(tools, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--lib', androidJar, '--min-api', '26', '--output', dex, jar]);
  run(javaTool('jar'), ['uf', unsigned, '-C', dex, 'classes.dex']);
  // AAPT2 on Windows stored nested asset names with backslashes, which Android's
  // AssetManager cannot resolve. Java's JAR tool writes canonical ZIP '/' paths.
  run(javaTool('jar'), ['uf', unsigned, '-C', path.join(root, 'app/src/main'), 'assets']);
  const aligned = path.join(build, 'aligned.apk'); run(path.join(tools, 'zipalign.exe'), ['-f', '-p', '4', unsigned, aligned]);
  const key = process.env.LOLZCLOUD_KEYSTORE || path.join(os.homedir(), '.android', 'lolzcloud-development.jks');
  if (process.env.LOLZCLOUD_KEYSTORE && (!process.env.LOLZCLOUD_STORE_PASS || !process.env.LOLZCLOUD_KEY_ALIAS)) throw new Error('Custom signing requires LOLZCLOUD_STORE_PASS and LOLZCLOUD_KEY_ALIAS');
  if (!fs.existsSync(key)) run(javaTool('keytool'), ['-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android', '-alias', 'lolzcloud-development', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=LolzCloud Development, O=LolzCloud, C=RU']);
  const apk = path.join(output, 'LolzCloud-Android-' + version.versionName + '.apk');
  const signer = ['-jar', path.join(tools, 'lib/apksigner.jar')];
  const signing = process.env.LOLZCLOUD_KEYSTORE ? ['--ks-key-alias', process.env.LOLZCLOUD_KEY_ALIAS, '--ks-pass', 'env:LOLZCLOUD_STORE_PASS', '--key-pass', process.env.LOLZCLOUD_KEY_PASS ? 'env:LOLZCLOUD_KEY_PASS' : 'env:LOLZCLOUD_STORE_PASS'] : ['--ks-key-alias', 'lolzcloud-development', '--ks-pass', 'pass:android', '--key-pass', 'pass:android'];
  run(javaTool('java'), [...signer, 'sign', '--ks', key, ...signing, '--out', apk, aligned]);
  run(javaTool('java'), [...signer, 'verify', '--verbose', '--print-certs', apk]);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'); fs.writeFileSync(apk + '.sha256', sha256 + '  ' + path.basename(apk) + '\n');
  console.log('APK: ' + apk + '\nSHA-256: ' + sha256);
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
