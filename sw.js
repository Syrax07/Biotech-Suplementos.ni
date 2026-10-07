const CACHE = 'biotech-store-v23';
const SHELL = ['./', './index.html', './admin-tools.js', './supplier-tools.js', './customer-tools.js', './product-experience.js', './order-review.js', './flash-offer.js', './ai-config.js', './cloud-config.js', './cloud-data.js', './product-import.js', './data/fitshop-2026-09-24.json', './manifest.json', './brand-logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('biotech-store-') && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || /(?:^|\/)admin(?:\/|$)/i.test(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match('./index.html'))));
});
