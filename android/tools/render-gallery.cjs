'use strict';
// Deterministic overview of unmodified emulator screenshots, rendered as an HTML contact sheet.
const path=require('node:path'),fs=require('node:fs');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..','..');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1260,height:2100,show:false,useContentSize:true,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
 await win.loadFile(path.join(root,'docs/android/screenshots/index.html'));
 await win.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{}))))');
 await win.webContents.executeJavaScript('document.querySelector(".alternatives").remove();document.querySelector("nav").remove()');
 const height=await win.webContents.executeJavaScript('document.querySelector("main").scrollHeight');
 win.setContentSize(1260,height);
 const screenshot=await win.webContents.capturePage();
 const target=path.join(root,'docs/android/screenshots/overview.png');fs.writeFileSync(target,screenshot.toPNG());console.log('Actual screenshot overview: '+target);win.destroy();app.quit();
}).catch(error=>{console.error(error.stack);app.exit(1);});
