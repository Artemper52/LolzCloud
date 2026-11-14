/* Only the public app shell is cached. Never cache sessions, social, rooms or
   signed audio implicitly; audio is saved by explicit action in IndexedDB. */
'use strict';
const CACHE = 'lolzcloud-app-shell-v3';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/core.js', '/app/offline.js', '/app/imports.js', '/app/app.js', '/app/icon.svg', '/app/icon-192.png', '/app/icon-512.png', '/app/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lolzcloud-app-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); return response; }
    return caches.match(event.request).then(cached => cached || response);
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('/app/') : Response.error())));
});
