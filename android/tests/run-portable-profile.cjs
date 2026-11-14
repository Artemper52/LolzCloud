'use strict';
// Production build/install/start belongs to the coordinator. Only this task's emulator is touched.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const argv=process.argv.slice(2),arg=(key,fallback='')=>{const at=argv.indexOf(key);return at<0?fallback:argv[at+1]||'';};
const version=arg('--expected-version'),sha=arg('--expected-sha').toLowerCase(),code=arg('--expected-code'),serial=arg('--serial','emulator-5554'),avd=arg('--expected-avd','LolzCloud');
if(!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{64}$/.test(sha)||code&&!/^\d+$/.test(code)||!/^emulator-\d+$/.test(serial))throw Error('Explicit coordinator version/SHA and owned emulator are required');
const root=path.resolve(__dirname,'../..'),sdk=process.env.LOLZCLOUD_ANDROID_SDK||'D:/LolzCloud-Android-Toolchain/sdk',adb=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const output=arg('--output','D:/LolzCloud-Android-Toolchain/android-portable-profile/runtime');fs.mkdirSync(output,{recursive:true});
function run(args,timeout=30000){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw r.error||Error(r.stdout+r.stderr);return r.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1'||run(['shell','getprop','sys.boot_completed']).trim()!=='1'||run(['emu','avd','name']).split(/\r?\n/)[0].trim()!==avd)throw Error('Only the booted task-owned AVD is permitted');
const apk=run(['shell','pm','path','com.lolzcloud.mobile']).trim().replace(/^package:/,'');if(!/^\/data\/app\/[A-Za-z0-9_~+=./-]+\/base\.apk$/.test(apk))throw Error('Unexpected APK path');
if(run(['shell','sha256sum',apk]).split(/\s+/)[0]!==sha)throw Error('Unexpected installed production SHA');
run(['install','-r',arg('--test-apk',path.join(root,'android/build/instrumentation/LolzCloud-core-tests.apk'))],60000);run(['shell','am','force-stop','com.lolzcloud.mobile']);
const runId=crypto.randomUUID(),stdout=run(['shell','am','instrument','-w','-e','runId',runId,'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.PortableProfileInstrumentation'],360000);fs.writeFileSync(path.join(output,'instrumentation-stdout.txt'),stdout);
const remote='/sdcard/Android/data/com.lolzcloud.mobile/files/portable-profile-review/',report=JSON.parse(run(['exec-out','cat',remote+'android-portable-profile-test.json']));
if(report.runId!==runId||report.version!==version||report.apkSha256!==sha||code&&report.versionCode!==Number(code))throw Error('Report is not from the expected production candidate/run');
report.productionShaUnchanged=run(['shell','sha256sum',apk]).split(/\s+/)[0]===sha;report.checkedAt=new Date().toISOString();
for(const name of report.screenshots||[])if(/^[a-z0-9-]+\.png$/.test(name))run(['pull',remote+name,path.join(output,name)]);
fs.writeFileSync(path.join(output,'android-portable-profile-verification.json'),JSON.stringify(report,null,2)+'\n');
if(report.status!=='passed'||!report.preferencesRestored||!report.productionShaUnchanged)throw Error(report.error||report.cleanupError||'Portable profile runtime failed');
for(const name of ['java-roundtrip.json','android-saf-export.json','java-after-edits.json'])fs.writeFileSync(path.join(output,name),run(['exec-out','cat',remote+name]));
const {normalizeProfile}=require(path.join(root,'source/integrations/portable-profile.cjs'));
function canonical(value){const result=JSON.parse(JSON.stringify(normalizeProfile(value)));delete result.exportedAt;return result;}
const expected=canonical(JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/portable-profiles/desktop-v1.json'),'utf8'))),java=canonical(JSON.parse(fs.readFileSync(path.join(output,'java-roundtrip.json'),'utf8'))),saf=canonical(JSON.parse(fs.readFileSync(path.join(output,'android-saf-export.json'),'utf8')));
assert.deepEqual(java,expected,'Authoritative Node → actual Android Java → Node retains all valid portable fields');assert.deepEqual(saf,expected,'Genuine SAF export has the same complete portable profile');
const edited=canonical(JSON.parse(fs.readFileSync(path.join(output,'java-after-edits.json'),'utf8')));
assert.deepEqual(edited.music,expected.music,'Unsupported music/custom DSP/collections survive Android edits');
for(const key of ['feedback','preferences','blockedArtists','played24h','adventurous'])assert.deepEqual(edited.wave[key],expected.wave[key],'Wave '+key+' survives');
assert.ok(!edited.wave.likes.some(row=>row.id===123),'Unlike after import stays removed');
assert.ok(!edited.tools.bookmarks.some(row=>row.id==='fixture-bookmark-sc'),'Removed SC moment stays removed');
assert.deepEqual(edited.tools.bookmarks.find(row=>row.id==='fixture-bookmark-yt'),expected.tools.bookmarks.find(row=>row.id==='fixture-bookmark-yt'),'Unsupported YouTube bookmark metadata remains intact');
assert.deepEqual(edited.tools.groups,expected.tools.groups);assert.equal(edited.tools.normalization,expected.tools.normalization);
const bridge={status:'passed',checkedAt:new Date().toISOString(),apkSha256:sha,runId,comparisons:['Node fixture → Java import/export → Node normalize deep equal','Actual SAF output → authoritative Node deep equal','Unlike/remove do not resurrect SC entries','Unsupported collections/customEffects/wave/groups/YouTube metadata preserved after real Android edits'],scope:'Bidirectional clear portable-file interoperability only. Cloud crypto/account transfer and physical device are separate checks.'};
fs.writeFileSync(path.join(output,'node-java-roundtrip-verification.json'),JSON.stringify(bridge,null,2)+'\n');console.log('PASS: '+report.checks.length+' Android portable checks + bidirectional Node/Java/SAF semantic roundtrip; '+output);
