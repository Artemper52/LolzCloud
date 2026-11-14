'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (location.origin === 'https://lolzcloud.com' && (/^\/room\/[a-f0-9]{32}\/?$/.test(location.pathname) || ['/social', '/rooms'].includes(location.pathname))) {
  contextBridge.exposeInMainWorld('LolzCloudDesktopSocial', {
    nativeNotifications: true,
    openRoom: url => ipcRenderer.sendToHost('lolzcloud:social-open-room', { url: typeof url === 'string' ? url : '' }),
  });
  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', event => {
      const link = event.target?.closest?.('a[href]'); if (!link) return;
      try {
        const url = new URL(link.href);
        if (url.origin === location.origin && url.pathname === '/rooms') { event.preventDefault(); ipcRenderer.sendToHost('lolzcloud:social-open-rooms'); }
      } catch { /* Not a community navigation link. */ }
    }, true);
  });
}
if (location.origin === 'https://lolzcloud.com' && /^\/room\/[a-f0-9]{32}\/?$/.test(location.pathname)) {
  const call = (type, data = {}) => ipcRenderer.invoke('rooms:desktop', { type, ...data });
  contextBridge.exposeInMainWorld('LolzCloudDesktopRoom', {
    state: () => call('state'), claim: () => call('claim'), release: () => call('release'),
    play: url => call('play', { url }), playQueued: id => call('play-queue', { id }), media: (command,value) => call('media',{command,value}), next: input => call('next', { automatic: input?.automatic === true, expectedUrl: input?.expectedUrl, expectedEpoch: input?.expectedEpoch, expectedController: input?.expectedController }),
    listen: playback => ipcRenderer.send('rooms:playback',playback),
  });
}
