const CACHE_NAME = 'my-pwa-cache-v3';
const urlsToCache = [
  '/source/icon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    // HTML은 항상 네트워크 우선 — 오래된 페이지 캐시 방지
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(r => r || fetch(req)));
});
