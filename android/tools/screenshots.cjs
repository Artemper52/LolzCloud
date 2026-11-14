'use strict';
// Captures real Android views after the separate instrumentation fixtures were imported via SAF.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..','..');
const sdk=process.env.LOLZCLOUD_ANDROID_SDK||process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk';
const serial=process.env.LOLZCLOUD_TEST_SERIAL||'emulator-5554';
if(!serial.startsWith('emulator-'))throw new Error('This capture script is restricted to a local emulator.');
const adb=path.join(sdk,'platform-tools','adb.exe');
const directory=path.join(root,'docs/android/screenshots');fs.mkdirSync(directory,{recursive:true});
function run(args){const p=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:3*1024*1024});if(p.status||p.error)throw p.error||new Error(p.stderr||p.stdout);return p.stdout;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function nodes(){run(['shell','uiautomator','dump','/sdcard/lolzcloud-capture.xml']);const xml=run(['shell','cat','/sdcard/lolzcloud-capture.xml']);return [...xml.matchAll(/<node\s+[^>]+>/g)].map(match=>Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replace(/&amp;/g,'&')])));}
async function tap(value,description=false){const n=nodes().find(n=>(description?n['content-desc']:n.text)===value);if(!n)throw new Error('UI node not found: '+value);const b=n.bounds.match(/\d+/g).map(Number);run(['shell','input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2))]);await pause(400);}
async function capture(name){await pause(300);run(['shell','screencap','-p','/sdcard/lolzcloud-capture.png']);run(['pull','/sdcard/lolzcloud-capture.png',path.join(directory,name+'.png')]);console.log('Captured '+name);}
async function main(){
 run(['shell','am','force-stop','com.lolzcloud.mobile']);run(['shell','am','start','-n','com.lolzcloud.mobile/.MainActivity']);await pause(700);
 if(!nodes().some(n=>n.text==='Моя волна'))throw new Error('Home screen did not finish opening');
 await capture('forest-wave');
 await tap('Моя музыка',true);await capture('forest-library');
 await tap('Ночной маршрут');await capture('forest-player');
 // Pause through the system MediaSession before querying accessibility: a playing
 // progress bar intentionally keeps changing, so UIAutomator cannot reach idle.
 run(['shell','input','keyevent','127']);await pause(350);
 await tap('Текст',true);await capture('forest-lyrics');run(['shell','input','keyevent','4']);await pause(250);
 await tap('Очередь',true);await capture('forest-queue');run(['shell','input','keyevent','4']);await pause(250);
 await tap('Звук',true);await capture('forest-sound');run(['shell','input','keyevent','4']);run(['shell','input','keyevent','4']);await pause(350);
 await tap('Комнаты',true);await capture('forest-rooms');await tap('Профиль и настройки',true);await capture('forest-profile');
 await tap('Paper');run(['shell','input','keyevent','4']);await tap('Волна',true);await capture('paper-wave');
 await tap('Профиль и настройки',true);await tap('Ink');run(['shell','input','keyevent','4']);await capture('ink-wave');
 await tap('Профиль и настройки',true);await tap('Forest');run(['shell','input','keyevent','4']);await pause(300);await capture('forest-wave');
 console.log('Real Android screenshots: '+directory);
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
