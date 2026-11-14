'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..'),adb=path.join(process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk','platform-tools','adb.exe');
function run(args){const r=spawnSync(adb,args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});if(r.error||r.status)throw r.error||new Error(r.stdout+r.stderr);return r.stdout;}
if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1')throw new Error('Only the isolated emulator is allowed.');
const font=run(['shell','settings','get','system','font_scale']).trim(),density=run(['shell','wm','density']);const override=/Override density:\s*(\d+)/.exec(density);
try{
    run(['shell','settings','put','system','font_scale','2.0']);run(['shell','wm','density','480']);
    const output=run(['shell','am','instrument','-w','-e','phase','layout','com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.VideoFixesInstrumentation']);
    const start=output.indexOf('{'),end=output.lastIndexOf('}');if(start<0||end<start)throw new Error(output);const report=JSON.parse(output.slice(start,end+1));if(report.status!=='passed')throw new Error(JSON.stringify(report,null,2));
    report.generatedAt=new Date().toISOString();report.configuration={widthDp:360,fontScale:2,theme:'paper'};const apk=path.join(project,'output','LolzCloud-Android-'+report.version+'.apk');report.apkSha256=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
    const target=path.join(project,'output','android-video-layout-verification.json');fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
    const screenshots='D:/LolzCloud-Android-Toolchain/video-review-20261112/fixed-native';fs.mkdirSync(screenshots,{recursive:true});run(['pull','/sdcard/Android/data/com.lolzcloud.mobile/files/video-fixes/.',screenshots]);
    console.log('PASS: '+report.checks.length+' layout checks at 360dp and 200% font. Report: '+target);
}finally{
    if(font==='null')run(['shell','settings','delete','system','font_scale']);else run(['shell','settings','put','system','font_scale',font]);
    run(['shell','wm','density',override?override[1]:'reset']);
}
