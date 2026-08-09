const VERSION = 'kanjuboost-v1';
const CORE_ASSETS = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/vendor/hls.min.js',
  '/vendor/artplayer.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/') {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put('/', copy));
        return response;
      }).catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && url.pathname.match(/\.(css|js|png|webmanifest|wasm)$/)) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    }),
  );
});
