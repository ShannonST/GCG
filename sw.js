// GTCG My Card Collection — service worker
// Keeps the app working offline and receives screenshots shared from other apps.
const SHELL = 'gtcg-shell-v31';
const IMAGES = 'gtcg-card-pictures';
const LIBS = 'gtcg-libs-v1';
const SHARED = 'gtcg-shared';
const SHELL_FILES = ['./', './index.html', './catalog.json', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'docs.opencv.org', 'tessdata.projectnaptha.com'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own 10-minute cache, so a new upload is picked up straight away
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('gtcg-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Screenshots shared to the app from the phone's share menu
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const files = form.getAll('images').filter(f => f && f.size);
      const cache = await caches.open(SHARED);
      for (const k of await cache.keys()) await cache.delete(k);
      let i = 0;
      for (const f of files) {
        await cache.put(new Request(`./shared/${i++}`), new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }));
      }
      return Response.redirect(`./?shared=${i}`, 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  // Text-reading and edge-finding libraries: keep a copy once downloaded
  if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(LIBS).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // Card pictures: keep each one once seen, so the collection shows pictures offline
  if (url.hostname === 'tcgplayer-cdn.tcgplayer.com') {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request.url, res.clone());
      return res;
    }).catch(() => fetch(e.request)));
    return;
  }

  // The app itself: try the network first so updates arrive, fall back to the saved copy offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) caches.open(SHELL).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
  }
});
