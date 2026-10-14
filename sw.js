// Offline support: precache the app shell; network-first (with a short timeout)
// so updates show up immediately, cache when offline. Videos are blob: URLs and never touch this.
const CACHE = 'localvr-v3';
const ASSETS = [
  './', './index.html', './manifest.json', './css/styles.css',
  './js/app.js', './js/player.js', './js/profiles.js', './js/subtitles.js', './js/storage.js',
  './vendor/three.min.js', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await cache.match(req, { ignoreSearch: true }) ||
        (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
      if (cached) return cached;
      throw err;
    }
  })());
});
