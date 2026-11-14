'use strict';
// Explicitly isolated Linux QA. This never updates an installed user program.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {fileHash,startTime,imageArchitecture}=require('../source/integrations/linux-appimage-update.cjs');
const root=process.env.LOLZCLOUD_LINUX_UPDATE_TEST_ROOT,profile=process.env.LOLZCLOUD_SELF_TEST_DIR;
if(process.platform!=='linux'||process.getuid()===0||!root||!path.isAbsolute(root)||!fs.realpathSync(root).includes('/.build/appimage-update-qa-')||!profile||path.dirname(fs.realpathSync(profile))!==fs.realpathSync(os.tmpdir())||!path.basename(profile).startsWith('LolzCloud-self-test-'))throw Error('An owned Linux QA root and isolated native self-test profile are required.');
const fixtures=[{version:'0.9.15',sha256:'ab81a437bc6fe8960268efee47ab2b8e213fbee5d6549a9998e44c528824a4e4'},{version:'0.9.16',sha256:'3242003d61d123325a9b2b16445e12fe2bc1b17933233e6d0ecdb5855fea5301'}].map(row=>({...row,file:'/opt/lolzcloud-builds/release-'+row.version+'/dist/LolzCloud-'+row.version+'-linux-x64.AppImage'}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,ms=15000){const end=Date.now()+ms;while(!await predicate()){if(Date.now()>end)throw Error(label);await delay(50);}}
(async()=>{
 let parent,child,working,result,failure='';const checks=[];
 const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
 try{
  for(const row of fixtures){assert.equal(await fileHash(row.file),row.sha256);assert.equal(imageArchitecture(row.file),'x64');}
  const directory=fs.mkdtempSync(path.join(root,"Real AppImage's transaction-")),image=path.join(directory,"LolzCloud's player.AppImage"),id=crypto.randomBytes(16).toString('hex');working=fs.mkdtempSync(path.join(directory,'.lolzcloud-update-'+id+'-'));const staged=path.join(working,'update.AppImage');
  fs.copyFileSync(fixtures[0].file,image,fs.constants.COPYFILE_EXCL);fs.copyFileSync(fixtures[1].file,staged,fs.constants.COPYFILE_EXCL);fs.chmodSync(image,0o755);fs.chmodSync(staged,0o755);
  parent=spawn('/bin/sleep',['120'],{stdio:'ignore'});await until(()=>fs.existsSync('/proc/'+parent.pid+'/stat'),'Owned parent missing');const parentStart=startTime(fs.readFileSync('/proc/'+parent.pid+'/stat','utf8'));
  child=spawn('/bin/sh',[path.join(__dirname,'../source/integrations/linux-appimage-update.sh'),String(parent.pid),parentStart,image,staged,fixtures[0].sha256,fixtures[1].sha256,id,'--password-store=gnome-libsecret','--self-test'],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal,stderr})));
  await until(()=>fs.existsSync(path.join(working,'ready')),'Actual AppImage helper not ready');await delay(100);
  check(await fileHash(image)===fixtures[0].sha256&&parent.exitCode===null&&parent.signalCode===null,'Verified real AppImage15 remains untouched while the exact owned parent is alive');
  check(await fileHash(path.join(working,'previous.AppImage'))===fixtures[0].sha256,'Helper confirms ready only after an exact verified real AppImage15 backup exists');
  parent.kill('SIGTERM');await new Promise(resolve=>parent.once('exit',resolve));const exit=await Promise.race([exited,delay(15000).then(()=>{throw Error('Actual helper did not finish')})]);const state=fs.readFileSync(path.join(working,'result.txt'),'utf8').trim();
  check(exit.code===0&&state==='updated'&&await fileHash(image)===fixtures[1].sha256,'After exact parent exit the real helper atomically installs frozen AppImage16 and launches it');
  const relaunch=path.join(working,'relaunch.log');await until(()=>fs.existsSync(relaunch)&&fs.readFileSync(relaunch,'utf8').includes('Compatibility self-test passed: Electron 45.2.1,'),'Actual packaged native self-test did not confirm success',60000);
  check(!fs.readFileSync(relaunch,'utf8').includes('--no-sandbox'),'Real AppImage16 native self-test passes under isolated Xvfb/D-Bus/keyring without a no-sandbox flag');
  for(const row of fixtures)assert.equal(await fileHash(row.file),row.sha256);check(true,'Both source release15/16 AppImage artifacts retain their original pinned hashes');
  result={state,exit,working,profile};
 }catch(error){failure=error.stack||String(error);}
 finally{
  if(failure&&working)try{fs.writeFileSync(path.join(working,'cancel'),'cancel\n');}catch{}
  if(parent&&parent.exitCode===null&&parent.signalCode===null){parent.kill('SIGTERM');await delay(100);}
  if(child&&child.exitCode===null&&child.signalCode===null){await delay(1200);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}
  const report={ok:!failure,checkedAt:new Date().toISOString(),count:checks.length,checks,failure,result,uid:process.getuid(),platform:process.platform,arch:process.arch,sources:fixtures,note:'Transaction uses only copied frozen AppImages and an owned sleeping parent. New AppImage16 is genuine and runs its packaged native self-test; updater controller/Windows policy and tiny ELF fixture tests are separate. No physical DAC/Wayland/ARM64 or user profile was tested.'};fs.writeFileSync(path.join(root,'native-appimage-update-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(failure)process.exitCode=1;
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
