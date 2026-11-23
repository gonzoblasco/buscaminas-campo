// sw.js - Service worker. Hand written, no workbox, no dependency.
//
// Strategy: precache the shell on install, serve cache-first for the shell and
// network-first-then-cache for everything else. The game must run with the network
// off, so the precache has to be complete; a partial precache would fail silently
// the first time the user goes offline, which is the worst possible moment.

const VERSION = 'bc-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      await cache.addAll(SHELL);
      // Assets are hashed by the build, so discover them from the HTML rather than
      // hard-coding names that change on every build.
      const html = await fetch('./index.html').then((r) => r.text());
      const assets = [...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css|png|webmanifest))"/g)]
        .map((m) => m[1])
        .filter((p) => !p.startsWith('http'));
      await Promise.all(
        assets.map((a) => cache.add(a).catch(() => undefined))
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network, fall back to the cached shell so the app opens
  // offline. This is the case that matters most.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
