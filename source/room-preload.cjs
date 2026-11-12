'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (location.origin === 'https://lolzcloud.com' && /^\/room\/[a-f0-9]{32}\/?$/.test(location.pathname)) {
  const call = (type, data = {}) => ipcRenderer.invoke('rooms:desktop', { type, ...data });
  contextBridge.exposeInMainWorld('LolzCloudDesktopRoom', {
    state: () => call('state'), claim: () => call('claim'), release: () => call('release'),
    play: url => call('play', { url }), media: (command,value) => call('media',{command,value}), next: () => call('next'),
    listen: playback => ipcRenderer.send('rooms:playback',playback),
  });
}
