'use strict';
// Root installs the production artifact. This runner installs only test code on
// the designated emulator and records the exact installed production checksum.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..'),sdk=process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk';
const adb=path.join(sdk,'platform-tools/adb.exe'),output=process.env.LOLZCLOUD_ROOM_MEDIA_OUTPUT||'D:/LolzCloud-Android-Toolchain/room-media-0.1.6-review';
function run(args){const r=spawnSync(adb,['-s','emulator-5554',...args],{encoding:'utf8',windowsHide:true,timeout:150000,maxBuffer:2*1024*1024});if(r.error||r.status)throw r.error||Error(r.stdout+r.stderr);return r.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1'||run(['shell','getprop','sys.boot_completed']).trim()!=='1')throw Error('Only booted task emulator-5554 is allowed.');
fs.mkdirSync(output,{recursive:true});
console.log(run(['install','-r',path.join(project,'build/instrumentation/LolzCloud-core-tests.apk')]).trim());
run(['shell','rm','-f','/sdcard/Android/data/com.lolzcloud.mobile/files/room-media-review/android-room-media-test.json']);
const stdout=run(['shell','am','instrument','-w','com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.RoomMediaInstrumentation']);
fs.writeFileSync(path.join(output,'instrumentation-stdout.txt'),stdout);
const report=JSON.parse(run(['exec-out','cat','/sdcard/Android/data/com.lolzcloud.mobile/files/room-media-review/android-room-media-test.json']));
const version=JSON.parse(fs.readFileSync(path.join(project,'version.json'),'utf8')),apk=path.join(project,'output','LolzCloud-Android-'+version.versionName+'.apk');
const sha=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
if(report.apkSha256!==sha||report.version!==version.versionName||report.versionCode!==version.versionCode)throw Error('Installed target does not match the current production artifact.');
report.generatedAt=new Date().toISOString();report.emulator='emulator-5554';report.api=run(['shell','getprop','ro.build.version.sdk']).trim();
const text=JSON.stringify(report,null,2)+'\n';fs.writeFileSync(path.join(output,'android-room-media-verification.json'),text);fs.writeFileSync(path.join(project,'output/android-room-media-verification.json'),text);
if(report.status!=='passed')throw Error(report.error||'Room media runtime probe failed.');
console.log('PASS: '+report.checks.length+' actual WebView fixture checks. Report: '+output);
