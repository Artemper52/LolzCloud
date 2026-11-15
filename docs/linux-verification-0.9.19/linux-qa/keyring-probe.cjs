'use strict';
const {app,safeStorage,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const profile=path.resolve(process.env.LOLZCLOUD_SELF_TEST_DIR||'');
if(path.dirname(profile)!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('LolzCloud-self-test-'))process.exit(1);
app.setPath('userData',profile);app.setPath('sessionData',profile);app.disableHardwareAcceleration();
app.commandLine.appendSwitch('password-store','gnome-libsecret');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let win;
 try{
  const available=require(path.join(process.env.LOLZCLOUD_BUILD_ROOT,'source/integrations/secure-storage.cjs')).storageAvailable;
  const backend=safeStorage.getSelectedStorageBackend();
  assert.equal(backend,'gnome_libsecret');assert.equal(available(safeStorage,'linux'),true);
  const fixture='Synthetic Linux keyring round trip';const encrypted=safeStorage.encryptString(fixture);
  assert.equal(encrypted.includes(Buffer.from(fixture)),false);assert.equal(safeStorage.decryptString(encrypted),fixture);
  assert.equal(app.commandLine.hasSwitch('no-sandbox'),false);
  win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'sandbox-preload.cjs')}});
  await win.loadURL('data:text/html,<html><body>Isolated Linux native QA</body></html>');
  const sandbox=await win.webContents.executeJavaScript('window.linuxNativeQA');assert.equal(sandbox.sandboxed,true);
  const status=fs.readFileSync('/proc/'+win.webContents.getOSProcessId()+'/status','utf8');
  const seccomp=Number(status.match(/^Seccomp:\s+(\d+)/m)?.[1]);assert.equal(seccomp,2);
  const report={status:'passed',platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,
   realSystemKeyring:true,backend,encryptedRoundTrip:true,personalAccountsUsed:false,rendererSandboxed:sandbox.sandboxed,rendererSeccomp:seccomp,noSandboxSwitch:false};
  fs.writeFileSync(path.join(__dirname,'keyring-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));if(win&&!win.isDestroyed())win.destroy();app.exit(0);
 }catch(error){console.error(error.stack||error.message);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}
});
