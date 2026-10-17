// Service Worker — Pointeur ATLAS
// v4 : purge des photos du personnel mises en cache par les versions précédentes.
const CACHE = 'pointeur-atlas-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first : API jamais mise en cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Jamais en cache : l'API, et les photos/documents du personnel (/uploads/), qui restaient sur
  // un poste partagé après la déconnexion.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          // Cloner immédiatement : une fois la réponse rendue au navigateur,
          // son body peut déjà être consommé lorsque la promesse du cache aboutit.
          const cacheCopy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, cacheCopy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
