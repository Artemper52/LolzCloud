const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('linuxNativeQA',{sandboxed:process.sandboxed===true});
