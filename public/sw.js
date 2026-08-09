const VERSION = 'kanjuboost-v2';
const CORE_ASSETS = [
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

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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

  // 页面和资源都走 network-first：每次刷新先问网络拿最新，失败才用缓存兜底。
  // 这样部署更新后刷新一次就能拿到新内容，不被旧缓存卡住。
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && url.pathname.match(/\.(css|js|png|webmanifest|wasm)$/)) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 }))),
  );
});
