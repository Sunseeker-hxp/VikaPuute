// Service worker: tallentaa sovelluksen tiedostot laitteeseen, jotta se toimii ilman verkkoa.
// Nosta versionumeroa aina, kun sovelluksen tiedostoja muutetaan.
const CACHE = 'vikapuute-v1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'js/db.js', 'js/pdf.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Vastataan välimuistista heti ja päivitetään tausta-ajona, kun verkko on käytettävissä.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (cached) {
      e.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    try {
      return await fresh;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
