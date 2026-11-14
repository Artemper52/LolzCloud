'use strict';
// Layout smoke check on a local emulator: 360dp wide and large Android font scaling.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const sdk=process.env.LOLZCLOUD_ANDROID_SDK||process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk';
const adb=path.join(sdk,'platform-tools','adb.exe'),serial='emulator-5554';
const root=path.resolve(__dirname,'..','..');const out=path.join(root,'docs/android/screenshots/checks');fs.mkdirSync(out,{recursive:true});
function run(args){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:3*1024*1024});if(r.status||r.error)throw r.error||new Error(r.stderr||r.stdout);return r.stdout;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function nodes(){run(['shell','uiautomator','dump','/sdcard/lolzcloud-accessibility.xml']);return [...run(['shell','cat','/sdcard/lolzcloud-accessibility.xml']).matchAll(/<node\s+[^>]+>/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));}
function bounds(n){return n.bounds.match(/\d+/g).map(Number);}
async function tap(value,desc=false){const n=nodes().find(n=>(desc?n['content-desc']:n.text)===value);if(!n)throw new Error('Missing UI: '+value);const b=bounds(n);run(['shell','input','tap',String((b[0]+b[2])>>1),String((b[1]+b[3])>>1)]);await pause(400);}
async function shot(name){run(['shell','screencap','-p','/sdcard/lolzcloud-accessibility.png']);run(['pull','/sdcard/lolzcloud-accessibility.png',path.join(out,name+'.png')]);}
const checks=[];function check(ok,name){checks.push({name,passed:!!ok});if(!ok)throw new Error(name);}
async function main(){
 if(run(['shell','getprop','ro.kernel.qemu']).trim()!=='1')throw new Error('Emulator required');
 const font=run(['shell','settings','get','system','font_scale']).trim();const density=run(['shell','wm','density']);
 let error;try{
  run(['shell','wm','density','480']);run(['shell','settings','put','system','font_scale','2.0']);run(['shell','am','force-stop','com.lolzcloud.mobile']);run(['shell','am','start','-n','com.lolzcloud.mobile/.MainActivity']);await pause(600);
  let tree=nodes();check(tree.some(n=>n.text==='Моя волна'),'Home renders at 360dp / font scale 2');
  for(const label of ['Волна, выбрано','Поиск','Моя музыка','Комнаты']){const n=tree.find(n=>n['content-desc']===label);check(n&&bounds(n)[2]<=1080,'Bottom navigation visible: '+label);}
  await tap('Моя музыка',true);tree=nodes();check(tree.some(n=>n.text==='Добавить файлы'),'Import action remains visible at large font');await shot('360dp-font2-library');
  await tap('Ночной маршрут');run(['shell','input','keyevent','127']);await pause(300);tree=nodes();
  let scroll=tree.find(n=>n.class==='android.widget.ScrollView'&&n.scrollable==='true');
  if(scroll){const b=bounds(scroll),x=(b[0]+b[2])>>1;run(['shell','input','swipe',String(x),String(Math.round(b[1]+(b[3]-b[1])*.82)),String(x),String(Math.round(b[1]+(b[3]-b[1])*.25)),'350']);await pause(300);tree=nodes();}
  check(tree.some(n=>n['content-desc']==='Продолжить воспроизведение'),'Native transport reachable with large font');check(tree.some(n=>n['content-desc']==='Звук'),'Sound action reachable by scrolling');await shot('360dp-font2-player');
 }catch(e){error=e;}
 finally{
  run(['shell','settings','put','system','font_scale',font==='null'?'1.0':font]);const override=density.match(/Override density: (\d+)/);run(['shell','wm','density',override?override[1]:'reset']);run(['shell','am','force-stop','com.lolzcloud.mobile']);run(['shell','am','start','-n','com.lolzcloud.mobile/.MainActivity']);
 }
 const report={target:serial,widthDp:360,fontScale:2,status:error?'failed':'passed',checks,error:error?.message||null};fs.writeFileSync(path.join(root,'docs/android/verification-accessibility.json'),JSON.stringify(report,null,2)+'\n');
 if(error)throw error;console.log('PASS: '+checks.length+' layout checks');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
