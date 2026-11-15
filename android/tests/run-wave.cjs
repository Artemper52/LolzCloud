'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const argv=process.argv.slice(2),arg=(name,fallback='')=>{const index=argv.indexOf(name);return index<0?fallback:argv[index+1]||'';};
const version=arg('--expected-version'),code=arg('--expected-code'),sha=arg('--expected-sha').toLowerCase(),serial=arg('--serial','emulator-5554'),avd=arg('--expected-avd','LolzCloud');
const phase=arg('--phase','full');if(!['full','bookmark'].includes(phase))throw Error('Unsupported Wave phase');
if(!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{64}$/.test(sha)||!/^\d+$/.test(code)||!/^emulator-\d+$/.test(serial))throw Error('Explicit candidate version, code, SHA and owned emulator required');
const root=path.resolve(__dirname,'../..'),output=arg('--output','D:/LolzCloud-Android-Toolchain/android-wave/runtime'),sdk=process.env.LOLZCLOUD_ANDROID_SDK||'D:/LolzCloud-Android-Toolchain/sdk',adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');fs.mkdirSync(output,{recursive:true});
function run(args,timeout=30000){const result=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout,maxBuffer:4*1024*1024});if(result.error||result.status!==0)throw result.error||Error(result.stdout+result.stderr);return result.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1'||run(['shell','getprop','sys.boot_completed']).trim()!=='1'||run(['emu','avd','name']).split(/\r?\n/)[0].trim()!==avd)throw Error('Only the booted task-owned AVD is permitted');
const installed=run(['shell','pm','path','com.lolzcloud.mobile']).trim().replace(/^package:/,'');if(!/^\/data\/app\/[A-Za-z0-9_~+=./-]+\/base\.apk$/.test(installed)||run(['shell','sha256sum',installed]).split(/\s+/)[0]!==sha)throw Error('Installed candidate SHA/path mismatch');
run(['install','-r',arg('--test-apk',path.join(root,'android/build/instrumentation/LolzCloud-core-tests.apk'))],60000);run(['shell','am','force-stop','com.lolzcloud.mobile']);
const runId=crypto.randomUUID(),stdout=run(['shell','am','instrument','-w','-e','runId',runId,'-e','phase',phase,'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.WaveInstrumentation'],360000);fs.writeFileSync(path.join(output,'instrumentation-stdout.txt'),stdout);
const remote='/sdcard/Android/data/com.lolzcloud.mobile/files/wave-review/',report=JSON.parse(run(['exec-out','cat',remote+'android-wave-test.json']));
if(report.runId!==runId||report.version!==version||report.versionCode!==Number(code)||report.apkSha256!==sha)throw Error('Stale/incorrect Wave report');
report.productionShaUnchanged=run(['shell','sha256sum',installed]).split(/\s+/)[0]===sha;report.checkedAt=new Date().toISOString();report.emulator=serial;report.avd=avd;report.phase=phase;if(phase==='bookmark')report.scope='Declared provider fixture -> actual PCM -> genuine native PopupMenu -> moment list and portable JSON. No live Wave API or personal account in this focused phase.';
for(const name of report.screenshots||[])if(/^[a-z0-9-]+\.png$/.test(name))run(['pull',remote+name,path.join(output,name)]);
fs.writeFileSync(path.join(output,'android-wave-verification.json'),JSON.stringify(report,null,2)+'\n');
if(report.status!=='passed'||!report.preferencesRestored||!report.productionShaUnchanged||phase==='full'&&(!report.live?.acceptedFrames||!report.live?.playedFrames))throw Error(report.error||report.cleanupError||'Actual native Wave verification failed');
console.log('PASS: '+report.checks.length+' native Wave checks; '+output);
