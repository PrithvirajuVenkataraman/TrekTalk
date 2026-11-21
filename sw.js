const CACHE = 'trektalk-v16';
const CORE = [
  './', './index.html', './manifest.json', './icon.svg', './style.css?v=16', './app.js?v=16',
  './vendor/qr.js', './vendor/scan.js',
  ...['camera.mjs','pairing.mjs','link.mjs','room.mjs','signaling.mjs','scanner.mjs']
    .map(file => './radio/' + file + '?v=16')
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(path => new Request(new URL(path, self.location.href), {cache: 'reload'})));
    await cache.put(new URL('./__trektalk_ready_v16__', self.location.href), new Response('ready'));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('trektalk-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const network = await fetch(req, {signal: AbortSignal.timeout(1800), cache: 'no-cache'});
        if (network.ok) return network;
      } catch {}
      return await cache.match('./index.html') || Response.error();
    })());
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => await cache.match(req) || fetch(req)));
});
