'use strict';
// Only the separate test APK is installed. The production artifact must be supplied and match the installed target.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const argument=name=>{const i=process.argv.indexOf('--'+name);return i<0?'':process.argv[i+1];};
const expected=argument('expected-sha'),version=argument('expected-version'),code=Number(argument('expected-code'));
if(!/^[a-f0-9]{64}$/.test(expected)||!/^0\.1\.\d+$/.test(version)||!Number.isInteger(code)||code<1)throw Error('Supply --expected-version, --expected-code and --expected-sha for this exact candidate.');
const project=path.resolve(__dirname,'..'),sdk=process.env.LOLZCLOUD_ANDROID_SDK||process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk',adb=path.join(sdk,'platform-tools/adb.exe');
const output=argument('output')||process.env.LOLZCLOUD_ROOM_TRANSPORT_OUTPUT||'D:/LolzCloud-Android-Toolchain/android-room-transport/candidate';
function run(args,timeout=30000){const r=spawnSync(adb,['-s','emulator-5554',...args],{encoding:'utf8',windowsHide:true,timeout,maxBuffer:3*1024*1024});if(r.error||r.status!==0)throw r.error||Error(r.stdout+r.stderr);return r.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1'||run(['shell','getprop','sys.boot_completed']).trim()!=='1')throw Error('Only the booted task emulator-5554 is allowed.');
const installed=()=>{const raw=run(['shell','pm','path','com.lolzcloud.mobile']).trim();if(!/^package:\/data\/app\/[A-Za-z0-9_/.=+~-]+\/base\.apk$/.test(raw))throw Error('Unexpected installed target path');const file=raw.slice(8);return run(['shell','sha256sum',file]).trim().split(/\s+/)[0];};
if(installed()!==expected)throw Error('Installed production APK does not match --expected-sha.');fs.mkdirSync(output,{recursive:true});
process.stdout.write(run(['install','-r',path.join(project,'build/instrumentation/LolzCloud-core-tests.apk')],60000));
const stdout=run(['shell','am','instrument','-w','com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.RoomTransportInstrumentation'],300000);fs.writeFileSync(path.join(output,'instrumentation-stdout.txt'),stdout);process.stdout.write(stdout);
const report=JSON.parse(run(['exec-out','cat','/sdcard/Android/data/com.lolzcloud.mobile/files/room-transport-review/room-transport-test.json']));
fs.writeFileSync(path.join(output,'android-room-transport-verification.json'),JSON.stringify(report,null,2)+'\n');
if(report.apkSha256!==expected||report.version!==version||report.versionCode!==code||installed()!==expected)throw Error('The room report is not from the exact expected version/code/SHA.');
for(const file of report.screenshots||[]){if(!/^\/(?:sdcard|storage\/emulated\/0)\/Android\/data\/com\.lolzcloud\.mobile\/files\/room-transport-review\/room-transport-[a-z-]+\.png$/.test(file))throw Error('Unexpected screenshot path');run(['pull',file,path.join(output,path.basename(file))]);}
if(report.status!=='passed')throw Error(report.error||report.cleanupError||'Room transport checks failed.');
console.log('PASS: '+report.checks.length+' room transport checks on '+expected+'. Artifacts: '+output);
