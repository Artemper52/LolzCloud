'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto'), { execFile, spawn } = require('node:child_process');
const execute = (filename, args) => new Promise((resolve, reject) => execFile(filename, args, { windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
async function main() {
  if (process.platform !== 'win32') { console.log('Portable Windows updater fixture skipped on this platform.'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-portable-helper-test-')), id = crypto.randomBytes(16).toString('hex'), target = path.join(root, 'LolzCloud'), working = path.join(root, 'LolzCloud-update-' + id), stage = path.join(working, 'app'), script = path.resolve(__dirname, '../source/integrations/portable-update.ps1');
  try {
    fs.mkdirSync(path.join(stage, 'resources'), { recursive: true }); fs.mkdirSync(target);
    const code = path.join(root, 'fixture.cs'); fs.writeFileSync(code, 'using System; using System.IO; class Fixture { static void Main() { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"restarted.txt"),"new process"); } }');
    const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await execute(compiler, ['/nologo', '/target:winexe', '/out:' + path.join(stage, 'LolzCloud.exe'), code]);
    fs.copyFileSync(path.join(stage, 'LolzCloud.exe'), path.join(target, 'LolzCloud.exe'));
    fs.writeFileSync(path.join(target, 'lolzcloud-portable.json'), JSON.stringify({ appId: 'app.lolzcloud.desktop', version: '0.8.5' }));
    fs.writeFileSync(path.join(stage, 'lolzcloud-portable.json'), JSON.stringify({ appId: 'app.lolzcloud.desktop', version: '0.9.0' })); fs.writeFileSync(path.join(stage, 'resources/app.asar'), 'isolated fixture');
    const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{},700)'], { windowsHide: true, stdio: 'ignore' });
    await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentId', String(parent.pid), '-TargetDirectory', target, '-StageDirectory', stage, '-UpdateId', id]);
    assert.equal(fs.readFileSync(path.join(working, 'result.txt'), 'utf8').trim(), 'updated');
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'lolzcloud-portable.json'))).version, '0.9.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.LolzCloud-before-update-' + id, 'lolzcloud-portable.json'))).version, '0.8.5');
    const deadline = Date.now() + 5000; while (!fs.existsSync(path.join(target, 'restarted.txt')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fs.readFileSync(path.join(target, 'restarted.txt'), 'utf8'), 'new process');
    console.log('Portable update passed: parent exit, guarded folder replacement, retained previous version and actual process restart.');
  } finally { const resolved = path.resolve(root); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('LolzCloud-portable-helper-test-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
