'use strict';
// Isolated emulator only. The test never signs into a personal account or approves a browser code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
const adb=path.join(process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk','platform-tools','adb.exe');
function run(args){const result=spawnSync(adb,['-s','emulator-5554',...args],{encoding:'utf8',windowsHide:true,timeout:150000,maxBuffer:2*1024*1024});if(result.error||result.status)throw result.error||new Error(result.stdout+result.stderr);return result.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1')throw new Error('Only emulator-5554 is allowed.');
const version=JSON.parse(fs.readFileSync(path.join(project,'version.json'),'utf8'));
const apk=path.join(project,'output','LolzCloud-Android-'+version.versionName+'.apk');
console.log(run(['install','-r',path.join(project,'build','instrumentation','LolzCloud-core-tests.apk')]).trim());
const output=run(['shell','am','instrument','-w','com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.LoginInstrumentation']);
const begin=output.indexOf('{'),end=output.lastIndexOf('}');if(begin<0||end<begin)throw new Error(output);
const report=JSON.parse(output.slice(begin,end+1));report.generatedAt=new Date().toISOString();report.emulator='emulator-5554';report.androidApi=run(['shell','getprop','ro.build.version.sdk']).trim();report.apk=path.basename(apk);report.apkSha256=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
fs.writeFileSync(path.join(project,'output','android-account-login-verification.json'),JSON.stringify(report,null,2)+'\n');
if(report.status!=='passed')throw new Error(JSON.stringify(report,null,2));console.log('PASS: '+report.checks.length+' account protocol/lifecycle checks; no real user login or approval.');
