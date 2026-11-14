/* Only the public app shell is cached. Never cache sessions, social, rooms or
   signed audio implicitly; audio is saved by explicit action in IndexedDB. */
'use strict';
const CACHE = 'lolzcloud-app-shell-v6';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/core.js', '/app/offline.js', '/app/imports.js', '/app/effects-policy.js', '/app/effects.js', '/app/normalization-worklet.js', '/app/limiter-worklet.js', '/app/profile-policy.js', '/app/profile-crypto.js', '/app/profile-cloud.js', '/app/profile-crypto-worker.js', '/app/vendor-scrypt-3.0.1.js', '/app/profile.js', '/app/app.js', '/app/icon.svg', '/app/icon-192.png', '/app/icon-512.png', '/app/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lolzcloud-app-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  // A shell version is installed as one complete set. Replacing individual
  // scripts on every fetch can leave offline HTML referring to missing modules.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch { return event.request.mode === 'navigate' ? (await cache.match('/app/')) || Response.error() : Response.error(); }
  }));
});
