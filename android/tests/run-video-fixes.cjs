'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
const adb=path.join(process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk','platform-tools','adb.exe');
const version=JSON.parse(fs.readFileSync(path.join(project,'version.json'),'utf8'));
const apk=path.join(project,'output','LolzCloud-Android-'+version.versionName+'.apk');
function run(args){const r=spawnSync(adb,args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});if(r.error||r.status)throw r.error||new Error(r.stdout+r.stderr);return r.stdout;}
function phase(name){const output=run(['shell','am','instrument','-w','-e','phase',name,'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.VideoFixesInstrumentation']);const start=output.indexOf('{'),end=output.lastIndexOf('}');if(start<0||end<start)throw new Error(output);const report=JSON.parse(output.slice(start,end+1));if(report.status!=='passed')throw new Error(JSON.stringify(report,null,2));return report;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1')throw new Error('Only the isolated Android emulator is allowed.');
console.log(run(['install','-r',path.join(project,'build','instrumentation','LolzCloud-core-tests.apk')]).trim());
run(['shell','am','force-stop','com.lolzcloud.mobile']);
const before=phase('snapshot');
console.log(run(['install','-r',apk]).trim());
const after=phase('snapshot');
assert.deepEqual(after.data,before.data,'Installing the new APK must preserve preferences, library, queue and SAF read grants');
assert.equal(after.version,version.versionName);
const ui=phase('ui');
const report={status:'passed',generatedAt:new Date().toISOString(),apk:path.basename(apk),apkSha256:crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),upgrade:{from:before.version,to:after.version,preservesAllPreferences:true,preservesSafReadGrants:true},checks:ui.checks};
const target=path.join(project,'output','android-video-fixes-verification.json');fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
const screenshots='D:/LolzCloud-Android-Toolchain/video-review-20261112/fixed-native';fs.mkdirSync(screenshots,{recursive:true});console.log(run(['pull','/sdcard/Android/data/com.lolzcloud.mobile/files/video-fixes/.',screenshots]).trim());
console.log('PASS: '+ui.checks.length+' UI checks; update '+before.version+' → '+after.version+' preserves preferences and file grants. Report: '+target);
