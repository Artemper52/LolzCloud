'use strict';
// Root installs the production APK; this runner only installs the separate test APK on the task AVD.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..'),sdk=process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk';
const adb=path.join(sdk,'platform-tools/adb.exe'),output=process.env.LOLZCLOUD_LYRICS_TEST_OUTPUT||'D:/LolzCloud-Android-Toolchain/lyrics-0.1.4-review';
function run(args,timeout=150000){const value=spawnSync(adb,['-s','emulator-5554',...args],{encoding:'utf8',windowsHide:true,timeout,maxBuffer:2*1024*1024});if(value.error||value.status)throw value.error||new Error(value.stdout+value.stderr);return value.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1'||run(['shell','getprop','sys.boot_completed']).trim()!=='1')throw new Error('Only booted emulator-5554 is allowed.');
fs.mkdirSync(output,{recursive:true});
console.log(run(['install','-r',path.join(project,'build/instrumentation/LolzCloud-core-tests.apk')]).trim());
const stdout=run(['shell','am','instrument','-w','com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.LyricsInstrumentation']);
fs.writeFileSync(path.join(output,'instrumentation-stdout.txt'),stdout);
const raw=run(['exec-out','cat','/sdcard/Android/data/com.lolzcloud.mobile/files/lyrics-review/android-lyrics-test.json']);
const report=JSON.parse(raw),version=JSON.parse(fs.readFileSync(path.join(project,'version.json'),'utf8'));
const apk=path.join(project,'output','LolzCloud-Android-'+version.versionName+'.apk');
const sha=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
if(report.apkSha256!==sha||report.version!==version.versionName||report.versionCode!==version.versionCode)throw new Error('Installed test target does not match the current production artifact.');
report.generatedAt=new Date().toISOString();report.emulator='emulator-5554';
const serialized=JSON.stringify(report,null,2)+'\n';fs.writeFileSync(path.join(output,'android-lyrics-verification.json'),serialized);fs.writeFileSync(path.join(project,'output/android-lyrics-verification.json'),serialized);
for(const file of report.screenshots||[]){if(!/^\/(?:sdcard|storage\/emulated\/0)\/Android\/data\/com\.lolzcloud\.mobile\/files\/lyrics-review\/lyrics-[a-z]+\.png$/.test(file))throw new Error('Unexpected screenshot path');run(['pull',file,path.join(output,path.basename(file))]);}
if(report.status!=='passed')throw new Error(report.error||'Lyrics checks failed');
console.log('PASS: '+report.checks.length+' actual native lyrics behavior checks. Artifacts: '+output);
