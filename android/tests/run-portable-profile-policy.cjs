'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),sdk=process.env.LOLZCLOUD_ANDROID_SDK||'D:/LolzCloud-Android-Toolchain/sdk',jar=path.join(sdk,'platforms/android-36/android.jar');
const output=process.env.LOLZCLOUD_PORTABLE_POLICY_OUTPUT||(process.platform==='win32'?'D:/LolzCloud-Android-Toolchain/android-portable-profile/policy':fs.mkdtempSync(path.join(os.tmpdir(),'LolzCloud-portable-policy-')));
fs.mkdirSync(output,{recursive:true});const classes=path.join(output,'classes');fs.mkdirSync(classes,{recursive:true});
function run(tool,args){const binary=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',tool+(process.platform==='win32'?'.exe':'')):tool;const r=spawnSync(binary,args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:1048576});if(r.error||r.status!==0)throw r.error||Error(r.stdout+r.stderr);return r.stdout;}
const source=path.join(root,'android/app/src/main/java/com/lolzcloud/mobile');
run('javac',['--release','8','-encoding','UTF-8','-classpath',jar,'-d',classes,...['Track','OnlineCatalog','AudioPreparation','PortableProfile','PortableAudioCurve','ProfileJson'].map(name=>path.join(source,name+'.java')),path.join(__dirname,'PortableProfilePolicyTest.java')]);
const stdout=run('java',['-cp',[classes,jar].join(path.delimiter),'PortableProfilePolicyTest']);process.stdout.write(stdout);
const count=Number(stdout.match(/PASS: (\d+) portable policy checks/)?.[1]);if(!count)throw Error('Missing policy success marker');
const report={status:'passed',checkedAt:new Date().toISOString(),checks:count,scope:'Real Java reference/URI policy and log-frequency native curve mapping. android.jar supplies unused JSON type signatures only; real JSON/SharedPreferences/SAF/service lifecycle require Android instrumentation separately.'};
fs.writeFileSync(path.join(output,'portable-profile-policy-verification.json'),JSON.stringify(report,null,2)+'\n');
