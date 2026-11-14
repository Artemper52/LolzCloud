'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(!process.versions.electron){
  const r=require('node:child_process').spawnSync(require('electron'),[__filename],{stdio:'inherit',windowsHide:true,env:process.env});process.exitCode=r.status||0;
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'LolzCloud-ios-icon-')));app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{let win;try{
    const svg=fs.readFileSync(path.join(__dirname,'../../source/app/lib/assets/logo.svg'),'utf8');
    win=new BrowserWindow({show:false,width:1024,height:1024,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;background:#15291e}svg{display:block;width:100%;height:100%}</style>'+svg));
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const image=await win.webContents.capturePage({x:0,y:0,width:1024,height:1024});
    const folder=path.join(__dirname,'../LolzCloud/Assets.xcassets/AppIcon.appiconset');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'icon.png'),image.toPNG());fs.writeFileSync(path.join(folder,'Contents.json'),JSON.stringify({images:[{filename:'icon.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'xcode',version:1}},null,2));
    fs.writeFileSync(path.join(folder,'../Contents.json'),JSON.stringify({info:{author:'xcode',version:1}},null,2));console.log('Rendered existing LolzCloud SVG as opaque 1024px Apple app icon');
  }catch(error){console.error(error.message);process.exitCode=1;}finally{win?.destroy();app.quit();}});
}
