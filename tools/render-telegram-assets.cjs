'use strict';
// Render the real welcome card from its HTML source, using the project's Electron.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
if(!process.versions.electron){
  const result=spawnSync(require('electron'),[__filename],{stdio:'inherit',windowsHide:true,env:{...process.env,LOLZCLOUD_TELEGRAM_RENDER:'1'}});process.exitCode=result.status||0;
}else{
  const {app,BrowserWindow}=require('electron');
  const profile=process.env.LOLZCLOUD_TELEGRAM_RENDER_PROFILE||'D:/LolzCloud-Android-Toolchain/telegram-checks/render-profile';app.setPath('userData',profile);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{let win;try{
    const folder=path.join(__dirname,'../telegram/assets');win=new BrowserWindow({show:false,width:1280,height:640,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,zoomFactor:1}});
    await win.loadFile(path.join(folder,'welcome.html'));await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
    const image=await win.webContents.capturePage({x:0,y:0,width:1280,height:640});fs.writeFileSync(path.join(folder,'welcome.png'),image.toPNG());fs.writeFileSync(path.join(folder,'welcome.jpg'),image.toJPEG(92));fs.copyFileSync(path.join(__dirname,'../source/app/lib/assets/logo.png'),path.join(folder,'icon.png'));console.log('Rendered Telegram welcome card: '+image.getSize().width+' × '+image.getSize().height);
  }catch(e){console.error(e.message);process.exitCode=1;}finally{win?.destroy();app.quit();}});
}
