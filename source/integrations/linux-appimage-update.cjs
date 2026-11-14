'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {newer,download,MIRROR}=require('./portable-update.cjs');
const SEMVER=/^\d+\.\d+\.\d+$/,HASH=/^[a-f0-9]{64}$/;
function manifest(value,arch=process.arch){
 if(!['x64','arm64'].includes(arch)||!SEMVER.test(value?.version||'')||value.linux?.version!==value.version)throw Error('Сервер вернул неподходящее обновление Linux.');
 const name='LolzCloud-'+value.version+'-linux-'+arch+'.AppImage',asset=value.linux[arch==='x64'?'x64AppImage':'arm64AppImage'];
 if(!asset||asset.name!==name||asset.url!==MIRROR+name||!HASH.test(asset.sha256||'')||!Number.isSafeInteger(asset.size)||asset.size<1_000_000||asset.size>600*1024*1024)throw Error('Для этой архитектуры нет проверенного обновления AppImage.');
 return{version:value.version,asset};
}
function imageArchitecture(file){
 const header=Buffer.alloc(20),fd=fs.openSync(file,'r');try{if(fs.readSync(fd,header,0,20,0)!==20)return null;}finally{fs.closeSync(fd);}
 if(header.subarray(0,4).toString('hex')!=='7f454c46'||header[4]!==2||header[5]!==1||header.subarray(8,11).toString('hex')!=='414902')return null;
 return{62:'x64',183:'arm64'}[header.readUInt16LE(18)]||null;
}
function startTime(text){const closing=text.lastIndexOf(') ');const value=closing>=0?text.slice(closing+2).trim().split(/\s+/)[19]:'';if(!/^\d+$/.test(value||''))throw Error('Не удалось проверить процесс приложения.');return value;}
async function fileHash(file){const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);return hash.digest('hex');}
async function officialFetch(fetcher,url,options){
 const response=await fetcher(url,{...options,redirect:'error'});
 if(response.redirected||response.url&&response.url!==url)throw Error('Обновление перенаправлено на непроверенный адрес.');
 return response;
}
async function manifestText(response){
 const limit=100000,announced=Number(response.headers?.get('content-length'));
 if(Number.isFinite(announced)&&announced>limit){await response.body?.cancel();throw Error('Слишком большой ответ обновления.');}
 const chunks=[];let bytes=0;
 if(!response.body)throw Error('Сервер вернул пустой ответ обновления.');
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('Слишком большой ответ обновления.');chunks.push(Buffer.from(chunk));}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
}
function sameInstallation(located){
 const stat=fs.lstatSync(located.target);
 return stat.isFile()&&!stat.isSymbolicLink()&&['dev','ino','size','mtimeMs','ctimeMs'].every(key=>stat[key]===located[key]);
}
function installation(image,{arch=process.arch,uid=process.getuid?.()}={}){
 if(typeof image!=='string'||!path.isAbsolute(image)||/[\u0000-\u001f\u007f]/.test(image))throw Error('Не удалось определить установленный AppImage.');
 const target=fs.realpathSync(image),stat=fs.lstatSync(target),parent=fs.realpathSync(path.dirname(target));
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==uid||uid===0||parent===path.parse(parent).root||imageArchitecture(target)!==arch)throw Error('Обновлять можно свой AppImage из папки с правом записи.');
 fs.accessSync(target,fs.constants.R_OK|fs.constants.X_OK);fs.accessSync(parent,fs.constants.W_OK|fs.constants.X_OK);
 return{target,parent,dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,mode:(stat.mode&0o777)|0o100};
}
class LinuxAppImageUpdates{
 constructor({app,onState=()=>{},prepareRestart,fetcher=(...args)=>fetch(...args),image=process.env.APPIMAGE,arch=process.arch,uid=process.getuid?.(),spawnProcess=spawn,relaunchArgs=[]}){
  Object.assign(this,{app,onState,prepareRestart,fetcher,image,arch,uid,spawnProcess,relaunchArgs});this.busy=false;this.manifest=null;
  const supported=app.isPackaged&&!!image;
  this.value={currentVersion:app.getVersion(),version:'',status:supported?'idle':'unsupported',percent:0,error:supported?'':'Автообновление доступно в AppImage. Версию из архива можно заменить скачанной с lolzcloud.com.',supported,legacy:false,kind:'appimage'};
  if(this.value.supported){this.startup=setTimeout(()=>{void this.check(true);},15000);this.startup.unref?.();this.timer=setInterval(()=>{void this.check(true);},6*3600000);this.timer.unref?.();}
 }
 state(){return{...this.value,available:!!this.manifest&&newer(this.manifest.version,this.value.currentVersion)};}
 set(patch){Object.assign(this.value,patch);this.onState(this.state());}
 async check(quiet=false){
  if(this.busy)return this.state();
  if(!this.value.supported){this.set({status:'unsupported',error:'Автообновление Linux доступно при запуске собственного AppImage.'});return this.state();}
  this.busy=true;this.set({status:'checking',error:''});
  try{
   const response=await officialFetch(this.fetcher,MIRROR+'platforms.json',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Обновления Linux пока недоступны. Повтори позже.');const raw=await manifestText(response);
   this.manifest=manifest(JSON.parse(raw),this.arch);this.set({version:this.manifest.version,status:newer(this.manifest.version,this.value.currentVersion)?'available':'current',percent:0,error:''});
  }catch(error){this.set({status:quiet?'idle':'error',error:quiet?'':error.message});}finally{this.busy=false;}
  return this.state();
 }
 async install(){
  if(this.busy)return;
  if(!this.manifest||!newer(this.manifest.version,this.app.getVersion())){await this.check();if(this.value.status!=='available')return;}
  this.busy=true;let working,child;
  try{
   const located=installation(this.image,{arch:this.arch,uid:this.uid}),id=crypto.randomBytes(16).toString('hex');
   const oldHash=await fileHash(located.target);
   if(!sameInstallation(located))throw Error('Файл приложения изменился. Повтори проверку обновления.');
   if(typeof fs.statfsSync==='function'){const disk=fs.statfsSync(located.parent);if(Number(disk.bavail)*Number(disk.bsize)<this.manifest.asset.size+located.size+32*1024*1024)throw Error('Не хватает места рядом с AppImage для загрузки и сохранения прежней версии. Освободи место и повтори.');}
   working=fs.mkdtempSync(path.join(located.parent,'.lolzcloud-update-'+id+'-'));fs.chmodSync(working,0o700);
   const staged=path.join(working,'update.AppImage'),helper=path.join(working,'apply.sh'),asset=this.manifest.asset;
   this.set({status:'downloading',percent:0,error:''});
   await download({browser_download_url:asset.url,size:asset.size},asset.sha256,staged,(url,options)=>officialFetch(this.fetcher,url,options),percent=>this.set({percent}));
   if(imageArchitecture(staged)!==this.arch)throw Error('AppImage предназначен для другой архитектуры.');fs.chmodSync(staged,located.mode);
   if(!sameInstallation(located))throw Error('Файл приложения изменился. Повтори проверку обновления.');
   this.set({status:'preparing',percent:100});
   const parentStart=startTime(fs.readFileSync('/proc/self/stat','utf8'));
   fs.copyFileSync(path.join(__dirname,'linux-appimage-update.sh'),helper,fs.constants.COPYFILE_EXCL);fs.chmodSync(helper,0o700);
   await new Promise((resolve,reject)=>{child=this.spawnProcess('/bin/sh',[helper,String(process.pid),parentStart,located.target,staged,oldHash,asset.sha256,id,...this.relaunchArgs],{detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',resolve);});
   const deadline=Date.now()+45000;let ready=false;
   while(Date.now()<deadline){
    const result=path.join(working,'result.txt');if(fs.existsSync(result)){
     const code=fs.readFileSync(result,'utf8').trim(),messages={'update-already-running':'Обновление AppImage уже выполняется. Повтори чуть позже.','old-image-changed':'Файл приложения изменился. Повтори проверку обновления.','staged-image-changed':'Скачанный AppImage не прошёл проверку. Повтори загрузку.','backup-failed':'Не удалось сохранить прежнюю версию. Проверь свободное место и доступ к папке.'};
     throw Error(messages[code]||'Не удалось подготовить обновление AppImage. Прежняя версия сохранена.');
    }
    if(fs.existsSync(path.join(working,'ready'))){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,40));
   }
   if(!ready)throw Error('Помощник обновления не подтвердил готовность. Приложение осталось открытым.');
   this.set({status:'installing',percent:100});await this.prepareRestart();child.unref?.();this.app.quit();
  }catch(error){if(working)try{fs.writeFileSync(path.join(working,'cancel'),'cancel\n',{flag:'wx',mode:0o600});}catch{}child?.unref?.();this.set({status:'error',error:error.message||'Обновление не установлено. Прежняя версия сохранена.'});throw error;}
  finally{this.busy=false;}
 }
 dispose(){clearTimeout(this.startup);clearInterval(this.timer);}
}
module.exports={LinuxAppImageUpdates,manifest,imageArchitecture,startTime,installation,fileHash};
