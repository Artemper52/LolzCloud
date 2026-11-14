'use strict';
// Test APKs only. Reuses the frozen resource/dex output; never compiles or installs production.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const yauzl = require('yauzl');
const project = path.resolve(__dirname, '..'), build = path.join(project, 'build');
const sdk = process.env.LOLZCLOUD_ANDROID_SDK || process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk';
const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot';
const tools = path.join(sdk, 'build-tools', '36.0.0'), androidJar = path.join(sdk, 'platforms', 'android-36', 'android.jar');
const output = path.join(build, 'update-fixtures', 'current');
const version = JSON.parse(fs.readFileSync(path.join(project, 'version.json'), 'utf8'));
const nextParts = version.versionName.split('.').map(Number), next = { versionName: '', versionCode: version.versionCode + 1 };
assert.ok(/^\d+\.\d+\.\d+$/.test(version.versionName) && Number.isSafeInteger(version.versionCode) && version.versionCode > 0);
nextParts[2]++; next.versionName = nextParts.join('.');
const production = path.join(process.env.LOLZCLOUD_ANDROID_OUTPUT || path.join(project, 'output'), 'LolzCloud-Android-' + version.versionName + '.apk');
const resources = path.join(build, 'resources.zip'), manifest = path.join(build, 'AndroidManifest.xml'), dex = path.join(build, 'dex', 'classes.dex');
const key = path.join(os.homedir(), '.android', 'lolzcloud-development.jks');
for (const file of [production, resources, manifest, dex, key]) assert.ok(fs.statSync(file).isFile(), 'Required frozen build input: ' + file);
fs.mkdirSync(output, { recursive: true });
assert.notEqual(fs.realpathSync(output).toLowerCase(), fs.realpathSync(path.dirname(production)).toLowerCase());
if (process.platform === 'win32') assert.ok(fs.realpathSync(output).toLowerCase().startsWith('d:\\'), 'Large fixture output must stay on D');
const working = fs.mkdtempSync(path.join(output, 'working-'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => sha(fs.readFileSync(file));
const inputs = Object.fromEntries([production, resources, manifest, dex].map(file => [file, fileSha(file)]));
function java(name) { return path.join(javaHome, 'bin', name + '.exe'); }
function run(file, args) { const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }); if (result.error || result.status) throw result.error || new Error(path.basename(file) + ': ' + result.stdout + result.stderr); return result.stdout; }
function info(file) { const text = run(path.join(tools, 'aapt2.exe'), ['dump', 'badging', file]); const match = text.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/); assert.ok(match, 'APK package metadata missing'); const certs = [...run(java('java'), ['-jar', path.join(tools, 'lib', 'apksigner.jar'), 'verify', '--print-certs', file]).matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})/gi)].map(row => row[1].toLowerCase()).sort(); assert.ok(certs.length); return { packageName: match[1], versionCode: Number(match[2]), versionName: match[3], size: fs.statSync(file).size, sha256: fileSha(file), certificates: certs }; }
async function frozenEntries() {
  const entries = new Map();
  await new Promise((resolve, reject) => yauzl.open(production, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error); zip.on('error', reject); zip.on('end', resolve);
    zip.on('entry', entry => {
      if (entry.fileName !== 'classes.dex' && !entry.fileName.startsWith('assets/')) { zip.readEntry(); return; }
      assert.ok(!entry.fileName.split('/').some(part => part === '..' || part.includes(':') || part.includes('\\')));
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => { if (error) return reject(error); const chunks = []; stream.on('data', data => chunks.push(data)); stream.on('error', reject); stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); }); });
    }); zip.readEntry();
  }));
  return entries;
}
(async () => {
  const baseline = info(production); assert.equal(baseline.packageName, 'com.lolzcloud.mobile'); assert.equal(baseline.versionName, version.versionName); assert.equal(baseline.versionCode, version.versionCode);
  const entries = await frozenEntries(); assert.equal(sha(entries.get('classes.dex')), inputs[dex], 'Frozen dex differs from production APK; wait for a completed build');
  // Copy only the frozen APK's own assets. Later source edits cannot enter a fixture.
  const assets = path.join(working, 'input'); fs.mkdirSync(assets, { recursive: true });
  for (const [name, bytes] of entries) if (name.startsWith('assets/')) { const dest = path.join(assets, ...name.split('/')); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); }
  const unsigned = path.join(working, 'unsigned.apk'), aligned = path.join(working, 'aligned.apk');
  run(path.join(tools, 'aapt2.exe'), ['link', '-o', unsigned, '--manifest', manifest, '-I', androidJar, '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', String(next.versionCode), '--version-name', next.versionName, resources]);
  run(java('jar'), ['uf', unsigned, '-C', path.dirname(dex), 'classes.dex', '-C', assets, 'assets']);
  run(path.join(tools, 'zipalign.exe'), ['-f', '-p', '4', unsigned, aligned]);
  const sign = (file, store, alias, password) => run(java('java'), ['-jar', path.join(tools, 'lib', 'apksigner.jar'), 'sign', '--ks', store, '--ks-key-alias', alias, '--ks-pass', 'pass:' + password, '--key-pass', 'pass:' + password, '--out', file, aligned]);
  const currentFile = path.join(output, 'current.apk'), nextFile = path.join(output, 'next.apk'), wrongFile = path.join(output, 'wrong-signer.apk');
  fs.copyFileSync(production, currentFile); sign(nextFile, key, 'lolzcloud-development', 'android');
  const wrongKey = path.join(working, 'wrong-signer-test-only.jks');
  if (!fs.existsSync(wrongKey)) run(java('keytool'), ['-genkeypair', '-keystore', wrongKey, '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-alias', 'fixture-wrong-signer', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1000', '-dname', 'CN=LolzCloud Wrong Signer Test, O=Test Only, C=RU']);
  sign(wrongFile, wrongKey, 'fixture-wrong-signer', 'fixture-only');
  const current = info(currentFile), future = info(nextFile), wrong = info(wrongFile);
  assert.deepEqual(current, baseline); assert.deepEqual(future.certificates, current.certificates); assert.notDeepEqual(wrong.certificates, current.certificates);
  for (const candidate of [future, wrong]) { assert.equal(candidate.packageName, current.packageName); assert.equal(candidate.versionName, next.versionName); assert.equal(candidate.versionCode, next.versionCode); }
  for (const [file, hash] of Object.entries(inputs)) assert.equal(fileSha(file), hash, 'Production input changed during fixture build');
  const metadata = { schemaVersion: 1, generatedAt: new Date().toISOString(), fixtureOnly: true, neverInstallNewerApk: true, current: { file: 'current.apk', ...current }, next: { file: 'next.apk', ...future }, wrongSigner: { file: 'wrong-signer.apk', ...wrong }, sourceInputs: inputs };
  fs.writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'ready', output: fs.realpathSync(output), current: version, next, currentSha256: current.sha256, nextSha256: future.sha256, wrongSignerSha256: wrong.sha256, productionUnchanged: true, apkInstalled: false }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
