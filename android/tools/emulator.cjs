'use strict';
// Optional local verification device, entirely under the named toolchain directory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync,spawn}=require('node:child_process');
const {Readable}=require('node:stream'); const {pipeline}=require('node:stream/promises');
const base='D:/LolzCloud-Android-Toolchain'; const sdk=process.env.LOLZCLOUD_ANDROID_SDK||path.join(base,'sdk');
async function install(name,url,hash,destination){
 if(fs.existsSync(destination))return;
 const cache=path.join(sdk,'archives');fs.mkdirSync(cache,{recursive:true});const archive=path.join(cache,name);
 if(!fs.existsSync(archive)){console.log('Downloading '+name);const r=await fetch(url);if(!r.ok)throw new Error('HTTP '+r.status);await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(archive));}
 const digest=crypto.createHash('sha1');for await(const bytes of fs.createReadStream(archive))digest.update(bytes);if(digest.digest('hex')!==hash)throw new Error('SDK image checksum mismatch: '+name);
 const unpack=path.join(cache,name+'.unpacked');fs.mkdirSync(unpack,{recursive:true});const r=spawnSync('tar.exe',['-xf',archive,'-C',unpack],{windowsHide:true,stdio:['ignore','ignore','pipe'],encoding:'utf8'});if(r.status)throw new Error(r.stderr.slice(-2000));
 const folder=fs.readdirSync(unpack,{withFileTypes:true}).find(x=>x.isDirectory());fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(path.join(unpack,folder.name),destination);
}
async function main(){
 await install('emulator-windows_x64-16863232.zip','https://dl.google.com/android/repository/emulator-windows_x64-16863232.zip','f7bc48d1899941702fa20686dd532ca7eeba229d',path.join(sdk,'emulator'));
 await install('x86_64-35_r02.zip','https://dl.google.com/android/repository/sys-img/android/x86_64-35_r02.zip','2d857d170c0d1b827149565da34b3383e5306f7f',path.join(sdk,'system-images/android-35/default/x86_64'));
 const avds=path.join(base,'avd');const avd=path.join(avds,'LolzCloud.avd');fs.mkdirSync(avd,{recursive:true});
 fs.writeFileSync(path.join(avds,'LolzCloud.ini'),'avd.ini.encoding=UTF-8\npath='+avd+'\ntarget=android-35\n');
 fs.writeFileSync(path.join(avd,'config.ini'),['avd.ini.encoding=UTF-8','AvdId=LolzCloud','avd.ini.displayname=LolzCloud verification','abi.type=x86_64','hw.cpu.arch=x86_64','hw.cpu.ncore=2','hw.ramSize=2048','hw.lcd.width=1080','hw.lcd.height=2340','hw.lcd.density=420','hw.keyboard=yes','hw.mainKeys=no','hw.gpu.enabled=yes','hw.gpu.mode=swiftshader','hw.audioInput=no','hw.audioOutput=no','disk.dataPartition.size=1073741824','image.sysdir.1='+path.join(sdk,'system-images/android-35/default/x86_64')+path.sep,'tag.id=default','tag.display=Default','vm.heapSize=256','PlayStore.enabled=false'].join('\n'));
 const args=['-avd','LolzCloud','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-gpu','swiftshader','-memory','2048','-camera-back','none','-camera-front','none'];
 if(process.argv.includes('--no-accel'))args.push('-accel','off');
 const log=fs.openSync(path.join(base,'emulator.log'),'a');const child=spawn(path.join(sdk,'emulator/emulator.exe'),args,{detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,ANDROID_HOME:sdk,ANDROID_AVD_HOME:avds}});child.unref();console.log('Emulator PID '+child.pid+'; adb: '+path.join(sdk,'platform-tools/adb.exe'));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
